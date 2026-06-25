'use strict';
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { Request, Response } from 'express';
import { db } from '../db';
import { calls, campaigns, users, creditTransactions, contacts, globalSettings, phoneNumbers, incomingAgents, incomingConnections, agents, knowledgeBase, appointments, appointmentSettings, flows, sipCalls, sipPhoneNumbers, elevenLabsCredentials } from '../../shared/schema';
import { nanoid } from 'nanoid';
import { eq, and, inArray, sql } from 'drizzle-orm';
import WebSocket from 'ws';
import { getTwilioClient } from '../services/twilio-connector';
import { twilioService } from '../services/twilio';
import { getDomain } from '../utils/domain';
import { elevenLabsService, ElevenLabsService } from '../services/elevenlabs';
import { ElevenLabsPoolService } from '../services/elevenlabs-pool';
import twilio from 'twilio';
import crypto from 'crypto';
import { storage } from '../storage';
import { webhookDeliveryService } from '../services/webhook-delivery';
import {
  createCalendarEvent,
  isCalendarSyncEnabled,
} from '../services/google-calendar/google-calendar.service';
import { recordWebhookReceived } from '../engines/payment/webhook-helper';
import { CreditDeductionResult } from '../services/credit-service';
import { 
  sendWebSocketWithRetry,
  classifyLeadFromTranscript,
  formatAndSaveTranscript,
  updateCampaignStats,
  fireWebhook,
  deductCallCreditsForElevenLabs
} from './webhooks/helpers';
import { deductSipCallCredits } from '../services/credit-service';
import { checkAndDisconnectIfLowCredits } from '../services/sip-credit-guard';
// Static imports for appointment webhook - moved from dynamic imports to reduce latency
import * as chrono from 'chrono-node';
import { format as formatDate, addDays } from 'date-fns';
import { validateAppointmentWebhookToken } from '../services/appointment-elevenlabs-tool';
import { validateFormWebhookToken, sanitizeFieldId } from '../services/form-elevenlabs-tool';
import { findCallForWebhook } from '../services/call-matcher';
import { resyncSinglePhoneCredentials } from '../services/elevenlabs-phone-resync';
import { markCampaignForRetry } from '../engines/elevenlabs-migration';

const activeConnections = new Map<string, WebSocket>();

/**
 * Helper: Detect PostgreSQL type mismatch errors (varchar vs uuid)
 * Production databases may have uuid-typed columns where schema defines varchar.
 * Error codes: 42804 = datatype_mismatch, 42883 = undefined_function (operator mismatch)
 */
function isTypeMismatchError(error: any): boolean {
  return error?.code === '42804' || error?.code === '42883' ||
    (error?.message && error.message.includes('character varying') && error.message.includes('uuid'));
}

// Helper function to end Twilio call
async function endTwilioCall(twilioCallSid: string | null, reason: string): Promise<void> {
  try {
    if (!twilioCallSid) {
      console.error(`❌ [Call End Failed] No Twilio CallSid available`);
      return;
    }
    
    console.log(`📞 [Ending Call] Reason: ${reason}`);
    console.log(`   CallSid: ${twilioCallSid}`);
    
    const twilioClient = await getTwilioClient();
    await twilioClient.calls(twilioCallSid).update({ status: 'completed' });
    
    console.log(`✅ [Call Ended Successfully] CallSid: ${twilioCallSid}`);
  } catch (error) {
    console.error(`❌ [Call End Error]`, error);
  }
}

// Helper function to execute call transfer via Twilio REST API
async function executeCallTransfer(twilioCallSid: string, transferPhoneNumber: string): Promise<void> {
  try {
    console.log(`📞 [Twilio Transfer] Initiating transfer for CallSid: ${twilioCallSid}`);
    console.log(`   Transfer to: ${transferPhoneNumber}`);
    
    const twilioClient = await getTwilioClient();
    
    // Get the original call to retrieve the caller's number
    const call = await twilioClient.calls(twilioCallSid).fetch();
    const fromNumber = call.from; // The original caller's number (shows on transfer recipient's phone)
    
    // Create TwiML to transfer the call
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while I transfer your call.</Say>
  <Dial callerId="${fromNumber}">
    <Number>${transferPhoneNumber}</Number>
  </Dial>
</Response>`;
    
    console.log(`📋 [Twilio Transfer] TwiML:`, twiml);
    
    // Update the active call with the transfer TwiML
    await twilioClient.calls(twilioCallSid).update({
      twiml: twiml
    });
    
    console.log(`✅ [Twilio Transfer] Call transfer initiated successfully`);
    console.log(`   The caller will now be connected to ${transferPhoneNumber}`);
  } catch (error: any) {
    console.error(`❌ [Twilio Transfer] Failed to transfer call:`, error);
    throw new Error(`Twilio transfer failed: ${error.message}`);
  }
}

// Helper function to setup ElevenLabs message handlers
function setupElevenLabsMessageHandlers(
  elevenLabsWs: WebSocket,
  callId: string,
  streamSid: string | null,
  twilioWs: WebSocket,
  conversationHistory: Array<{ role: 'user' | 'agent', text: string, timestamp: Date }>,
  silenceTimerRef: { current: NodeJS.Timeout | null },
  endCall: (reason: string) => Promise<void>,
  flowBridge?: any  // Optional FlowExecutionBridge instance
): void {
  elevenLabsWs.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 [ElevenLabs] Received message type: ${message.type}`);
      
      switch (message.type) {
        case 'conversation_initiation_metadata':
          console.log(`✅ [ElevenLabs] Conversation initiated for call ${callId}`);
          break;
          
        case 'audio':
          let audioPayload: string | null = null;
          
          if (message.audio?.chunk) {
            audioPayload = message.audio.chunk;
          } else if (message.audio_event?.audio_base_64) {
            audioPayload = message.audio_event.audio_base_64;
          }
          
          if (audioPayload && streamSid) {
            const audioData = {
              event: 'media',
              streamSid,
              media: {
                payload: audioPayload,
              },
            };
            if (twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.send(JSON.stringify(audioData));
            }
          }
          break;
          
        case 'interruption':
          console.log(`🛑 [ElevenLabs] User interruption detected`);
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
          break;
          
        case 'user_transcript':
          const userText = message.user_transcription_event?.user_transcript || 'N/A';
          const userTranscriptLength = userText.length;
          const transcriptTime = new Date().toISOString();
          
          // Enhanced logging for transcription quality monitoring
          console.log(`🗣️ [User Said]: "${userText}"`);
          console.log(`   📊 Transcript length: ${userTranscriptLength} chars`);
          console.log(`   ⏱️  Received at: ${transcriptTime}`);
          if (message.user_transcription_event?.confidence) {
            console.log(`   🎯 Confidence: ${message.user_transcription_event.confidence}`);
          }
          
          if (userText && userText !== 'N/A') {
            conversationHistory.push({
              role: 'user',
              text: userText,
              timestamp: new Date()
            });

            // Real-time banned word detection
            try {
              const callRecord = await storage.getCall(callId);
              if (callRecord && callRecord.userId) {
                const bannedWords = await storage.getActiveBannedWords();
                const userTextLower = userText.toLowerCase();
                
                let violationDetected = false;
                let autoBlockTriggered = false;
                
                for (const bannedWord of bannedWords) {
                  const wordLower = bannedWord.word.toLowerCase();
                  if (userTextLower.includes(wordLower)) {
                    console.log(`🚨 [Realtime Banned Word] Detected "${bannedWord.word}" in user transcript for call ${callId}`);
                    
                    // Calculate context
                    const position = userTextLower.indexOf(wordLower);
                    const contextStart = Math.max(0, position - 50);
                    const contextEnd = Math.min(userText.length, position + wordLower.length + 50);
                    const context = userText.substring(contextStart, contextEnd);
                    
                    // Create Content Violation
                    await storage.createContentViolation({
                      callId,
                      userId: callRecord.userId,
                      bannedWordId: bannedWord.id,
                      detectedWord: bannedWord.word,
                      severity: bannedWord.severity,
                      context: context,
                      status: 'pending',
                    });
                    
                    violationDetected = true;
                    
                    // Handle Auto-Block
                    if (bannedWord.autoBlock) {
                      autoBlockTriggered = true;
                      const user = await storage.getUser(callRecord.userId);
                      if (user && user.role !== 'admin' && user.isActive) {
                        await storage.updateUser(callRecord.userId, {
                          isActive: false,
                          blockedReason: `Auto-blocked: Realtime content violation detected (${bannedWord.category}: "${bannedWord.word}")`,
                          blockedAt: new Date(),
                          blockedBy: 'system',
                        });
                        console.log(`⚠️ [Realtime Banned Word] Auto-blocked user ${callRecord.userId} for violation: ${bannedWord.word}`);
                      }
                      
                      // End the call immediately if autoBlock is enabled
                      console.log(`🚫 [Realtime Banned Word] Auto-block is ON. Terminating call ${callId}`);
                      await endCall('Banned word detected (auto-block)');
                      break; // Stop checking more words
                    }
                  }
                }
                
                if (autoBlockTriggered) {
                  return; // Stop processing the transcript event
                }
                
                if (violationDetected) {
                  // If autoBlock is OFF but violation was detected, give a warning to the customer
                  console.log(`⚠️ [Realtime Banned Word] Violation detected but Auto-block is OFF. Giving warning to customer for call ${callId}`);
                  
                  // Send warning instruction to ElevenLabs
                  const warningText = `[SYSTEM WARNING] The user used inappropriate or offensive language. Please politely warn the user to refrain from using offensive language and continue the conversation.`;
                  await sendWebSocketWithRetry(elevenLabsWs, {
                    type: "contextual_update",
                    text: warningText
                  });
                }
              }
            } catch (violationError) {
              console.error(`❌ [Realtime Banned Word] Error checking violations:`, violationError);
            }
            
            // Process user response through flow bridge if in flow mode
            if (flowBridge) {
              try {
                // Process response - this auto-progresses through nodes
                await flowBridge.processUserResponse(userText);
                console.log(`[Flow Bridge] ✅ Processed user response`);
                
                // Check if flow has ended (after auto-progression)
                if (flowBridge.hasFlowEnded()) {
                  console.log(`[Flow Bridge] 🎯 Flow execution completed (reached END node)`);
                  
                  // Send final contextual update with END node message
                  try {
                    const finalUpdate = flowBridge.generateContextualUpdate();
                    const finalText = finalUpdate.text || "Thank you for your time. Goodbye!";
                    
                    console.log(`[Flow Bridge] 📤 Sending final contextual update to ElevenLabs:`);
                    console.log(`   Instruction: "${finalText}"`);
                    
                    const success = await sendWebSocketWithRetry(elevenLabsWs, {
                      type: "contextual_update",
                      text: finalText
                    });
                    
                    if (success) {
                      console.log(`[Flow Bridge] ✅ Final contextual update sent`);
                    } else {
                      console.error(`[Flow Bridge] ❌ Failed to send final update after retries - terminating call anyway`);
                    }
                  } catch (sendError) {
                    console.error(`[Flow Bridge] ❌ Failed to send final contextual update:`, sendError);
                  }
                  
                  // Don't update call status here - let it be updated when call actually ends
                  // The Twilio status webhook will update status to 'completed' when call terminates
                  // This ensures DB state matches actual call lifecycle
                  console.log(`[Flow Bridge] ✅ Flow execution completed - final goodbye sent`);
                  console.log(`[Flow Bridge] 📞 Letting call end naturally via silence detection`);
                  console.log(`[Flow Bridge] 💾 Call status will be updated to 'completed' by Twilio webhook when call actually ends`);
                } else {
                  // Send contextual update to ElevenLabs with next node instructions
                  if (flowBridge.shouldSendContextualUpdate()) {
                    try {
                      const contextualUpdate = flowBridge.generateContextualUpdate();
                      const instructionText = contextualUpdate.text || "Continue the conversation.";
                      
                      if (instructionText.trim()) {
                        console.log(`[Flow Bridge] 📤 Sending contextual update to ElevenLabs:`);
                        console.log(`   Instruction: "${instructionText}"`);
                        
                        const success = await sendWebSocketWithRetry(elevenLabsWs, {
                          type: "contextual_update",
                          text: instructionText
                        });
                        
                        if (success) {
                          console.log(`[Flow Bridge] ✅ Contextual update sent`);
                        } else {
                          console.error(`[Flow Bridge] ❌ Failed to send contextual update after retries`);
                        }
                      } else {
                        console.log(`[Flow Bridge] ℹ️ Skipping empty contextual update (likely condition node)`);
                      }
                    } catch (sendError) {
                      console.error(`[Flow Bridge] ❌ Failed to send contextual update:`, sendError);
                    }
                  } else {
                    console.log(`[Flow Bridge] ℹ️ No contextual update needed for current node`);
                  }
                }
              } catch (error) {
                console.error(`[Flow Bridge] ❌ Error processing user response:`, error);
                console.error(error);
                // Don't fail the entire call - log error and continue without flow
              }
            }
            
            // Check for user rejection/disinterest phrases
            const rejectionPhrases = [
              'not interested', 'no thanks', 'stop calling', 
              'remove my number', 'don\'t call', 'bye', 
              'goodbye', 'hang up', 'disconnect', 
              'interested nahi', 'nahi chahiye', 'band karo',
              'rukiye', 'call mat karo', 'बाद में'
            ];
            
            const lowerUserText = userText.toLowerCase();
            const userRejected = rejectionPhrases.some(phrase => lowerUserText.includes(phrase));
            
            if (userRejected) {
              console.log(`🚫 [User Rejected] User expressed disinterest, ending call in 2 seconds...`);
              setTimeout(async () => {
                await endCall('User expressed disinterest');
              }, 2000);
            }
          }
          
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          
          silenceTimerRef.current = setTimeout(async () => {
            console.log(`🔇 [Silence Detected] No user speech for 30 seconds, ending call...`);
            await endCall('30 seconds of user silence detected');
          }, 30000);
          break;
          
        case 'agent_response':
          const agentText = message.agent_response_event?.agent_response || 'N/A';
          console.log(`🤖 [AI Responded]: "${agentText}"`);
          
          if (agentText && agentText !== 'N/A') {
            conversationHistory.push({
              role: 'agent',
              text: agentText,
              timestamp: new Date()
            });
          }
          
          // Reset silence timer when agent responds (restart 30s countdown from agent's last message)
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          
          silenceTimerRef.current = setTimeout(async () => {
            console.log(`🔇 [Silence Detected] No activity for 30 seconds after agent response, ending call...`);
            await endCall('30 seconds of silence detected');
          }, 30000);
          
          const goodbyePhrases = [
            'goodbye', 'bye bye', 'thank you for calling', 
            'have a nice day', 'take care', 'alvida', 
            'dhanyawad', 'shukriya', 'aapka din shubh ho'
          ];
          
          const lowerText = agentText.toLowerCase();
          const saidGoodbye = goodbyePhrases.some(phrase => lowerText.includes(phrase));
          
          if (saidGoodbye && !lowerText.includes('?')) {
            console.log(`👋 [Agent Farewell] Agent said goodbye - call will end naturally via silence detection`);
            // Don't force termination - let the call end gracefully after agent finishes speaking
            // The 30-second silence timeout will handle call termination naturally
          }
          break;
        
        case 'ping':
          if (message.ping_event?.event_id && elevenLabsWs) {
            const pongResponse = {
              type: 'pong',
              event_id: message.ping_event.event_id,
            };
            elevenLabsWs.send(JSON.stringify(pongResponse));
          }
          break;
        
        case 'client_tool_call':
          console.log(`🔧 [Client Tool] Tool call received:`, message.client_tool_call);
          const toolCall = message.client_tool_call;
          
          if (toolCall?.tool_name === 'transfer_call') {
            console.log(`📞 [Call Transfer] Agent requested call transfer`);
            console.log(`   Reason: ${toolCall.parameters?.reason || 'Not specified'}`);
            console.log(`   Tool Call ID: ${toolCall.tool_call_id}`);
            
            try {
              // Get call details (works for both incoming and campaign calls)
              const call = await storage.getCallWithDetails(callId);
              if (!call) {
                throw new Error('Call not found');
              }
              
              // Determine agent ID from either incoming connection or campaign
              let agentIdToUse: string;
              
              if (call.incomingConnection?.agentId) {
                // Incoming call - get agent from incoming connection
                agentIdToUse = call.incomingConnection.agentId;
                console.log(`   📞 Incoming call - using incoming agent: ${agentIdToUse}`);
              } else if (call.campaign?.agentId) {
                // Outgoing campaign call - get agent from campaign
                agentIdToUse = call.campaign.agentId;
                console.log(`   📞 Campaign call - using campaign agent: ${agentIdToUse}`);
              } else {
                throw new Error('Call is not associated with any agent (neither incoming nor campaign)');
              }
              
              // Get agent details to retrieve transfer phone number
              const agent = await storage.getAgent(agentIdToUse);
              if (!agent?.transferPhoneNumber) {
                throw new Error('Transfer phone number not configured for this agent');
              }
              
              const transferNumber = agent.transferPhoneNumber;
              console.log(`   📲 Transferring to: ${transferNumber}`);
              
              // Execute the transfer via Twilio REST API
              if (!call.twilioSid) {
                throw new Error('Twilio CallSid not available for transfer');
              }
              
              await executeCallTransfer(call.twilioSid, transferNumber);
              
              // Send success result back to ElevenLabs
              const successResult = {
                type: 'client_tool_result',
                tool_call_id: toolCall.tool_call_id,
                result: `Successfully transferred call to ${transferNumber}`,
                is_error: false
              };
              
              elevenLabsWs.send(JSON.stringify(successResult));
              console.log(`✅ [Call Transfer] Transfer initiated and confirmed to ElevenLabs`);
              
              // Update call metadata for CRM Lead Processor detection
              try {
                const existingMetadata = (call.metadata as Record<string, unknown>) || {};
                const existingAiInsights = (existingMetadata.aiInsights as Record<string, unknown>) || {};
                
                const updatedMetadata = {
                  ...existingMetadata,
                  wasTransferred: true,
                  hasTransfer: true,
                  transferredTo: transferNumber,
                  transferredAt: new Date().toISOString(),
                  aiInsights: {
                    ...existingAiInsights,
                    primaryOutcome: 'call_transfer',
                    wasTransferred: true,
                    transferTarget: transferNumber,
                  },
                };
                
                await db
                  .update(calls)
                  .set({ 
                    wasTransferred: true,
                    transferredTo: transferNumber,
                    metadata: updatedMetadata 
                  })
                  .where(eq(calls.id, callId));
                
                console.log(`📞 [Call Transfer] Updated call metadata for CRM detection`);
              } catch (metadataError: any) {
                console.error(`📞 [Call Transfer] Failed to update call metadata:`, metadataError.message);
              }
              
            } catch (error: any) {
              console.error(`❌ [Call Transfer] Failed:`, error);
              
              // Determine detailed error message for ElevenLabs
              let errorMessage = 'We encountered a technical difficulty while transferring your call';
              if (error.message?.includes('not found')) {
                errorMessage = 'Call not found or ended';
              } else if (error.message?.includes('not configured')) {
                errorMessage = 'Transfer phone number not configured for this agent';
              } else if (error.message?.includes('not associated')) {
                errorMessage = 'Call not associated with an incoming agent';
              } else if (error.message?.includes('Twilio')) {
                errorMessage = 'A technical difficulty occurred during the transfer';
              }
              
              // Send error result back to ElevenLabs with user-friendly message
              const errorResult = {
                type: 'client_tool_result',
                tool_call_id: toolCall.tool_call_id,
                result: `I apologize, but I was unable to transfer your call. ${errorMessage}. Please try calling back or contact support directly.`,
                is_error: true
              };
              
              elevenLabsWs.send(JSON.stringify(errorResult));
              console.log(`❌ [Call Transfer] Error sent to ElevenLabs: ${errorMessage}`);
            }
          } else {
            console.log(`❓ [Client Tool] Unknown tool: ${toolCall?.tool_name}`);
          }
          break;
          
        default:
          console.log(`❓ [ElevenLabs] Unhandled message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`❌ [ElevenLabs] Error parsing message for call ${callId}:`, error);
    }
  });
}

// Helper function to initialize ElevenLabs connection
async function initializeElevenLabsConnection(
  agentId: string,
  callId: string,
  contactName: string | undefined,
  contactPhone: string | undefined,
  streamSid: string | null,
  twilioWs: WebSocket,
  conversationHistory: Array<{ role: 'user' | 'agent', text: string, timestamp: Date }>,
  silenceTimerRef: { current: NodeJS.Timeout | null },
  endCall: (reason: string) => Promise<void>,
  flowBridge?: any  // Optional FlowExecutionBridge instance
): Promise<WebSocket> {
  // agentId is the database UUID - need to look up the ElevenLabs agent ID
  console.log(`[Stream] Looking up ElevenLabs agent ID for database agent ${agentId}`);
  
  const agent = await storage.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  if (!agent.elevenLabsAgentId) {
    throw new Error(`Agent ${agentId} is missing ElevenLabs configuration. Please configure the agent in the admin panel.`);
  }
  
  const elevenLabsAgentId = agent.elevenLabsAgentId;
  console.log(`[Stream] Resolved database agent ${agentId} to ElevenLabs agent ${elevenLabsAgentId}`);
  
  // Get the pool-assigned credential for this agent
  console.log(`[Stream] 🔑 Resolving pool-assigned credential for agent ${agentId}...`);
  const credential = await ElevenLabsPoolService.getCredentialForAgent(agentId);
  if (!credential) {
    throw new Error(`No ElevenLabs credential found for agent ${agentId}`);
  }
  console.log(`[Stream] ✅ Using credential: ${credential.name} (ID: ${credential.id})`);
  
  // Create ElevenLabsService instance with the agent's pool-assigned credential
  const agentElevenLabsService = new ElevenLabsService(credential.apiKey);
  
  // Sync agent configuration to ElevenLabs before starting call
  // SKIP for Flow agents - their workflow is already compiled and saved when user edits the flow
  // Syncing here would overwrite the visual flow with a simplified built-in tools workflow
  if (agent.type === 'flow') {
    console.log(`[Stream] ⏭️ Skipping agent sync for Flow agent - workflow is managed by flow builder`);
  } else {
    // For Natural/Incoming agents, sync configuration to ensure latest settings
    console.log(`[Stream] 🔄 Syncing agent configuration to ElevenLabs...`);
    try {
      // Fetch knowledge base items if agent has knowledge base IDs
      let knowledgeBases: any[] = [];
      if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
        console.log(`[Stream] 📚 Fetching ${agent.knowledgeBaseIds.length} knowledge base items...`);
        const kbItems = await db
          .select()
          .from(knowledgeBase)
          .where(inArray(knowledgeBase.id, agent.knowledgeBaseIds));
        
        knowledgeBases = kbItems
          .filter(kb => kb.elevenLabsDocId) // Only include items synced to ElevenLabs
          .map(kb => ({
            type: kb.type,
            title: kb.title,
            elevenLabsDocId: kb.elevenLabsDocId,
          }));
        
        console.log(`[Stream] 📚 Found ${knowledgeBases.length} synced knowledge base items`);
      }
      
      await agentElevenLabsService.updateAgent(elevenLabsAgentId, {
        prompt: agent.systemPrompt || undefined,
        voice_tone: agent.voiceTone || undefined,
        personality: agent.personality || undefined,
        first_message: agent.firstMessage || undefined,
        model: agent.llmModel || undefined,
        temperature: agent.temperature || undefined,
        language: agent.language || undefined,
        knowledge_bases: knowledgeBases.length > 0 ? knowledgeBases : undefined,
        // Include tool settings to preserve them during call initialization
        transferEnabled: agent.transferEnabled || undefined,
        transferPhoneNumber: agent.transferPhoneNumber || undefined,
        detectLanguageEnabled: agent.detectLanguageEnabled || undefined,
        endConversationEnabled: agent.endConversationEnabled || undefined,
      });
      console.log(`[Stream] ✅ Agent configuration synced to ElevenLabs using credential: ${credential.name}`);
    } catch (syncError: any) {
      console.error(`[Stream] ⚠️ Failed to sync agent config (continuing anyway):`, syncError.message);
      // Continue with call even if sync fails - agent will use previous config
    }
  }
  
  // Check if this is a Flow agent (uses native ElevenLabs workflows)
  const isFlowAgent = agent.type === 'flow';
  
  console.log(`[Stream] Getting fresh signed URL for ElevenLabs agent ${elevenLabsAgentId} using credential: ${credential.name}`);
  const wsAuth = await agentElevenLabsService.getConversationWebSocketAuth(elevenLabsAgentId);
  
  if (!wsAuth.signed_url) {
    throw new Error('Failed to get signed URL from ElevenLabs');
  }

  console.log(`[ElevenLabs] Attempting to connect to ElevenLabs WebSocket...`);
  console.log(`[ElevenLabs] Signed URL obtained (first 100 chars): ${wsAuth.signed_url.substring(0, 100)}...`);
  const elevenLabsWs = new WebSocket(wsAuth.signed_url);
  
  elevenLabsWs.on('open', async () => {
    console.log(`✅ [ElevenLabs] WebSocket connection established for call ${callId}`);
    
    // Increment load counter for this credential
    try {
      await ElevenLabsPoolService.incrementLoad(credential.id);
      console.log(`[Pool] ✅ Incremented load for credential: ${credential.name}`);
    } catch (loadError) {
      console.error(`[Pool] ⚠️ Failed to increment load:`, loadError);
      // Continue with call even if load tracking fails
    }
    
    // For Flow agents with native ElevenLabs workflows:
    // DO NOT send any agent config - let ElevenLabs use the saved workflow without overrides
    // Sending an empty agent: {} could override/disable the workflow
    if (isFlowAgent) {
      console.log(`[ElevenLabs] 🔄 Flow Agent: Using native ElevenLabs workflow (no config override)`);
      
      // Only send dynamic variables if we have them, no agent config
      const hasDynamicVars = !!(contactName || contactPhone);
      
      if (hasDynamicVars) {
        const minimalConfig = {
          type: "conversation_initiation_client_data",
          conversation_config: {
            dynamic_variables: {
              ...(contactName  && { contact_name:  contactName  }),
              ...(contactPhone && { contact_phone: contactPhone }),
            }
          }
        };
        console.log(`[ElevenLabs] Sending minimal config (dynamic vars only)`);
        console.log(`   Dynamic variables:`, JSON.stringify(minimalConfig.conversation_config.dynamic_variables));
        elevenLabsWs.send(JSON.stringify(minimalConfig));
      } else {
        // For Flow agents with no dynamic vars, don't send any initiation config
        // Let ElevenLabs use the agent's saved workflow configuration entirely
        console.log(`[ElevenLabs] No initiation config sent - using agent's saved workflow`);
      }
      
      console.log(`[ElevenLabs] ✅ Flow agent ready - workflow handles conversation flow`);
    } else {
      // For Natural/Incoming agents, use the standard conversation config
      const conversationConfig: any = {
        agent: {},
        dynamic_variables: {}
      };
      
      // Add dynamic variables
      if (contactName) {
        conversationConfig.dynamic_variables.contact_name = contactName;
        console.log(`[ElevenLabs] Adding contact name: ${contactName}`);
      }
      if (contactPhone) {
        conversationConfig.dynamic_variables.contact_phone = contactPhone;
        console.log(`[ElevenLabs] Adding contact phone: ${contactPhone}`);
      }
      
      // For flow-based calls with flowBridge (legacy), use first_message from the flow
      if (flowBridge) {
        const firstMessage = flowBridge.getFirstMessage();
        console.log(`[ElevenLabs] 🔀 Flow Mode: Setting first message from flow`);
        console.log(`   First message: "${firstMessage}"`);
        conversationConfig.agent.first_message = firstMessage;
      }
      
      // Build the complete initiation message with correct structure
      const initialConfig = {
        type: "conversation_initiation_client_data",
        conversation_config: conversationConfig
      };
      
      console.log(`[ElevenLabs] Sending conversation initiation`);
      console.log(`   Dynamic variables:`, JSON.stringify(conversationConfig.dynamic_variables));
      
      elevenLabsWs.send(JSON.stringify(initialConfig));
      console.log(`[ElevenLabs] ✅ Sent initial config`);
    }
    
    // Continue with flow bridge handling only for non-Flow agents
    if (!isFlowAgent && elevenLabsWs) {
      
      // For flow-based calls, ALWAYS send contextual update after auto-progression
      // (initialize() may have advanced through message/delay/condition nodes)
      if (flowBridge) {
        // Small delay to ensure initial config is processed first
        setTimeout(async () => {
          try {
            // Generate contextual update regardless of node type
            // This ensures agent gets instructions even if flow auto-progressed
            const contextualUpdate = flowBridge.generateContextualUpdate();
            const instructionText = contextualUpdate.text || "";
            
            // Always send if we have non-empty text OR if we're on an END node
            if (instructionText.trim() || flowBridge.hasFlowEnded()) {
              console.log(`[Flow Bridge] 📤 Sending post-initialization contextual update:`);
              console.log(`   Instruction: "${instructionText}"`);
              console.log(`   Flow ended: ${flowBridge.hasFlowEnded()}`);
              
              const success = await sendWebSocketWithRetry(elevenLabsWs, {
                type: "contextual_update",
                text: instructionText || "Continue the conversation."
              });
              
              if (success) {
                console.log(`[Flow Bridge] ✅ Post-init contextual update sent`);
              } else {
                console.error(`[Flow Bridge] ❌ Failed to send post-init update after retries`);
              }
            } else {
              // If text is empty and not END node, send a generic instruction
              console.log(`[Flow Bridge] ℹ️ Sending fallback instruction after auto-progression`);
              const success = await sendWebSocketWithRetry(elevenLabsWs, {
                type: "contextual_update",
                text: "Continue the conversation naturally."
              });
              
              if (success) {
                console.log(`[Flow Bridge] ✅ Fallback instruction sent`);
              } else {
                console.error(`[Flow Bridge] ❌ Failed to send fallback instruction after retries`);
              }
            }
          } catch (error) {
            console.error(`[Flow Bridge] ❌ Failed to send post-init contextual update:`, error);
          }
        }, 100);
      }
    }
  });

  setupElevenLabsMessageHandlers(
    elevenLabsWs,
    callId,
    streamSid,
    twilioWs,
    conversationHistory,
    silenceTimerRef,
    endCall,
    flowBridge  // Pass flow bridge to message handlers
  );

  elevenLabsWs.on('error', (error) => {
    console.error(`[ElevenLabs] WebSocket error for call ${callId}:`, error);
  });

  elevenLabsWs.on('close', async (code, reason) => {
    console.log(`[ElevenLabs] WebSocket closed for call ${callId}`);
    console.log(`   Close code: ${code}`);
    console.log(`   Close reason: ${reason.toString() || 'No reason provided'}`);
    
    // Decrement load counter for this credential
    try {
      await ElevenLabsPoolService.decrementLoad(credential.id);
      console.log(`[Pool] ✅ Decremented load for credential: ${credential.name}`);
    } catch (loadError) {
      console.error(`[Pool] ⚠️ Failed to decrement load:`, loadError);
    }
    
    await formatAndSaveTranscript(callId, conversationHistory);
    
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.close();
    }
  });
  
  return elevenLabsWs;
}

// Handle incoming calls to Twilio numbers (for incoming agents)
export async function handleIncomingCallWebhook(req: Request, res: Response) {
  try {
    console.log(`📞 [Incoming Call] Received incoming call from Twilio`);
    console.log(`   Body:`, req.body);
    
    const { To, From, CallSid, CallerId } = req.body;
    
    if (!To || !From || !CallSid) {
      console.error(`❌ [Incoming Call] Missing required parameters`);
      return res.status(400).send('Missing required parameters');
    }

    console.log(`📞 [Incoming Call] From: ${From}, To: ${To}, CallSid: ${CallSid}`);

    // Look up the phone number and its incoming connection
    const phoneNumber = await db
      .select({
        id: phoneNumbers.id,
        userId: phoneNumbers.userId,
        phoneNumber: phoneNumbers.phoneNumber,
      })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.phoneNumber, To))
      .limit(1);

    if (!phoneNumber || phoneNumber.length === 0) {
      console.error(`❌ [Incoming Call] REJECTED - Phone number ${To} not found in database`);
      console.error(`   🚨 [Security Audit] Unauthorized incoming call attempt: From=${From}, To=${To}, CallSid=${CallSid}`);
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();
      // Use reject() to minimize cost - caller hears busy/disconnect, no billing
      response.reject({ reason: 'rejected' });
      res.type('text/xml');
      return res.send(response.toString());
    }

    const phone = phoneNumber[0];

    // Look up the incoming connection for this phone number
    const connection = await db
      .select({
        id: incomingConnections.id,
        agentId: incomingConnections.agentId,
      })
      .from(incomingConnections)
      .where(eq(incomingConnections.phoneNumberId, phone.id))
      .limit(1);

    if (!connection || connection.length === 0) {
      console.error(`❌ [Incoming Call] REJECTED - Phone number ${To} has no incoming connection configured`);
      console.error(`   🚨 [Security Audit] Incoming call to unconfigured number: From=${From}, To=${To}, CallSid=${CallSid}`);
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();
      // Use reject() to minimize cost - caller hears busy/disconnect, no billing
      response.reject({ reason: 'rejected' });
      res.type('text/xml');
      return res.send(response.toString());
    }

    const incomingConnection = connection[0];

    // Verify connection belongs to the same user as the phone number (security check)
    const connectionDetails = await db
      .select({
        userId: incomingConnections.userId,
      })
      .from(incomingConnections)
      .where(eq(incomingConnections.id, incomingConnection.id))
      .limit(1);

    if (!connectionDetails.length || connectionDetails[0].userId !== phone.userId) {
      console.error(`❌ [Incoming Call] REJECTED - Connection ownership mismatch for ${To}`);
      console.error(`   🚨 [Security Audit] Ownership mismatch: From=${From}, To=${To}, CallSid=${CallSid}`);
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();
      // Use reject() to minimize cost
      response.reject({ reason: 'rejected' });
      res.type('text/xml');
      return res.send(response.toString());
    }

    // Fetch the agent details (type='incoming')
    const agent = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, incomingConnection.agentId), eq(agents.type, 'incoming')))
      .limit(1);

    if (!agent || agent.length === 0) {
      console.error(`❌ [Incoming Call] REJECTED - Agent ${incomingConnection.agentId} not found or wrong type for ${To}`);
      console.error(`   🚨 [Security Audit] Missing agent: From=${From}, To=${To}, CallSid=${CallSid}`);
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const response = new VoiceResponse();
      // Use reject() to minimize cost
      response.reject({ reason: 'rejected' });
      res.type('text/xml');
      return res.send(response.toString());
    }

    const incomingAgent = agent[0];

    // NATIVE ELEVENLABS INTEGRATION:
    // This webhook should NOT be called for numbers with incoming connections.
    // Twilio should route directly to ElevenLabs (https://api.elevenlabs.io/twilio/inbound_call).
    // If we reach here, it means Twilio webhook is misconfigured for this number.
    
    console.log(`⚠️  [Incoming Call] Call reached our server but should be handled by ElevenLabs natively`);
    console.log(`   This indicates Twilio webhook is misconfigured for phone number ${To}`);
    console.log(`   Expected: Twilio should route to https://api.elevenlabs.io/twilio/inbound_call`);
    console.log(`   Fix: Delete and recreate the incoming connection to resync Twilio webhook`);
    
    // Return a helpful message to the caller
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('We are experiencing a temporary configuration issue. Please call back in a moment.');
    res.type('text/xml');
    return res.send(response.toString());
  } catch (error) {
    console.error('❌ [Incoming Call] Error:', error);
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('An error occurred. Please try again later.');
    res.type('text/xml');
    res.send(response.toString());
  }
}

// Handle outbound campaign calls
export async function handleTwilioVoiceWebhook(req: Request, res: Response) {
  try {
    console.log(`🎙️ [Voice Webhook] Received request from Twilio`);
    console.log(`   Query params:`, req.query);
    console.log(`   Body:`, req.body);
    
    const { callId, agentId, contactName, flowId, executionId } = req.query;
    
    if (!callId || !agentId) {
      console.error(`❌ [Voice Webhook] Missing required parameters - callId: ${callId}, agentId: ${agentId}`);
      return res.status(400).send('Missing required parameters');
    }

    console.log(`✅ [Voice Webhook] Call ${callId} answered, agent: ${agentId}, contact: ${contactName || 'N/A'}`);
    if (flowId) {
      console.log(`   Flow ID: ${flowId}, Execution ID: ${executionId}`);
    }

    await db
      .update(calls)
      .set({ status: 'answered' })
      .where(eq(calls.id, callId as string));

    const domain = getDomain(req.headers.host as string);
    const streamUrl = `wss://${domain}/api/webhooks/twilio/stream`;
    
    console.log(`📞 [Voice Webhook] Creating TwiML with stream URL: ${streamUrl}`);
    console.log(`   Parameters: callId=${callId}, agentId=${agentId}, contactName=${contactName || 'N/A'}`);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const connect = response.connect();
    
    const stream = connect.stream({ url: streamUrl });
    stream.parameter({ name: 'callId', value: callId as string });
    stream.parameter({ name: 'agentId', value: agentId as string });
    if (contactName) {
      stream.parameter({ name: 'contactName', value: contactName as string });
    }
    // Pass flow execution context to Media Streams handler
    if (flowId) {
      stream.parameter({ name: 'flowId', value: flowId as string });
    }
    if (executionId) {
      stream.parameter({ name: 'executionId', value: executionId as string });
    }
    
    const twimlString = response.toString();
    console.log(`📄 [Voice Webhook] Generated TwiML:\n${twimlString}`);
    
    res.type('text/xml');
    res.send(twimlString);
  } catch (error) {
    console.error('Voice webhook error:', error);
    res.status(500).send('Internal server error');
  }
}

export async function handleTwilioStatusWebhook(req: Request, res: Response) {
  try {
    console.log(`📊 [Status Webhook] Received status update from Twilio`);
    console.log(`   Query params:`, JSON.stringify(req.query));
    console.log(`   Body:`, JSON.stringify(req.body));
    console.log(`   CallSid: ${req.body.CallSid}, Status: ${req.body.CallStatus}`);
    
    const { callId: queryCallId } = req.query;
    const { 
      CallStatus, 
      CallDuration, 
      RecordingUrl, 
      To, 
      From, 
      CallSid,
      Direction,
      ForwardedFrom,
      CallerName
    } = req.body;
    
    let callId = queryCallId as string | undefined;

    if (!callId && CallSid) {
      const [matchedCall] = await db
        .select({ id: calls.id })
        .from(calls)
        .where(eq(calls.twilioSid, CallSid))
        .limit(1);
      
      if (matchedCall) {
        callId = matchedCall.id;
        console.log(`[Status Webhook] Resolved call by CallSid ${CallSid} -> ${callId}`);
      } else {
        console.warn(`[Status Webhook] No match found for CallSid ${CallSid} in calls table`);
      }
    }

    if (!callId) {
      // For SIP-based or ElevenLabs incoming calls, the call record may not exist in the calls table yet
      // (ElevenLabs webhook creates it later) or it may be in the sip_calls table.
      // Check sip_calls table as fallback before giving up.
      if (CallSid) {
        try {
          const sipCallResult = await db.execute(sql`
            SELECT id, status FROM sip_calls 
            WHERE external_call_id = ${CallSid} 
            OR elevenlabs_conversation_id = ${CallSid}
            LIMIT 1
          `);
          const sipCall = sipCallResult.rows[0] as any;
          
          if (sipCall) {
            console.log(`[Status Webhook] Found SIP call by CallSid ${CallSid} -> ${sipCall.id}`);
            
            const sipStatusMap: Record<string, string> = {
              'initiated': 'initiated',
              'ringing': 'ringing',
              'in-progress': 'in-progress',
              'completed': 'completed',
              'busy': 'failed',
              'failed': 'failed',
              'no-answer': 'failed'
            };
            const sipStatus = sipStatusMap[CallStatus] || CallStatus;
            
            const terminalStatuses = ['completed', 'failed'];
            if (!terminalStatuses.includes(sipCall.status)) {
              const recUrl = RecordingUrl ? (RecordingUrl.endsWith('.mp3') ? RecordingUrl : `${RecordingUrl}.mp3`) : null;
              await db.execute(sql`
                UPDATE sip_calls SET 
                  status = ${sipStatus},
                  duration_seconds = COALESCE(${CallDuration ? parseInt(CallDuration, 10) : null}::int, duration_seconds),
                  answered_at = CASE WHEN ${CallStatus} = 'in-progress' AND answered_at IS NULL THEN NOW() ELSE answered_at END,
                  ended_at = CASE WHEN ${CallStatus} = 'completed' THEN NOW() ELSE ended_at END,
                  recording_url = COALESCE(${recUrl}, recording_url),
                  updated_at = NOW()
                WHERE id = ${sipCall.id}
              `);
              console.log(`✅ [Status Webhook] SIP call ${sipCall.id} status updated: ${CallStatus}`);
            } else {
              console.log(`[Status Webhook] SIP call ${sipCall.id} already in terminal status '${sipCall.status}' - skipping`);
            }
            
            return res.sendStatus(200);
          }
        } catch (sipLookupError: any) {
          console.warn(`[Status Webhook] SIP calls lookup error (non-fatal): ${sipLookupError.message}`);
        }
      }
      
      // For ElevenLabs incoming calls, the call record may not exist yet 
      // (Twilio status webhook arrives before ElevenLabs post-call webhook creates the record).
      // Return 200 to prevent Twilio from retrying - the ElevenLabs webhook will handle call creation.
      console.warn(`[Status Webhook] Could not resolve call - no callId param and no matching CallSid ${CallSid || 'N/A'}. Returning 200 (call record may be created later by ElevenLabs webhook).`);
      return res.sendStatus(200);
    }

    const statusMap: Record<string, string> = {
      'initiated': 'initiated',
      'ringing': 'ringing',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'busy': 'busy',
      'failed': 'failed',
      'no-answer': 'no-answer'
    };

    const status = statusMap[CallStatus] || CallStatus;
    
    // Build metadata object with call information
    const metadata: any = {
      twilioCallSid: CallSid,
      to: To,
      from: From,
      direction: Direction,
    };
    
    if (ForwardedFrom) metadata.forwardedFrom = ForwardedFrom;
    if (CallerName) metadata.callerName = CallerName;
    
    const updateData: any = { 
      status,
      metadata 
    };

    if (CallSid && !queryCallId) {
      updateData.twilioSid = CallSid;
    }
    
    // Save recording URL if provided in status webhook
    if (RecordingUrl) {
      // Append .mp3 for direct audio playback access
      updateData.recordingUrl = RecordingUrl.endsWith('.mp3') ? RecordingUrl : `${RecordingUrl}.mp3`;
      console.log(`📼 [Status Webhook] Recording URL captured: ${updateData.recordingUrl}`);
    }
    
    // Save phone numbers from Twilio for incoming calls
    if (To) {
      updateData.toNumber = To;
    }
    if (From) {
      updateData.fromNumber = From;
    }
    
    if (CallStatus === 'completed') {
      updateData.endedAt = new Date();
      if (CallDuration) {
        updateData.duration = parseInt(CallDuration, 10);
      }
    }

    await db
      .update(calls)
      .set(updateData)
      .where(eq(calls.id, callId as string));

    console.log(`✅ [Status Webhook] Call ${callId} status updated: ${CallStatus}`);

    if (CallStatus === 'completed' && CallDuration) {
      const creditResult = await deductCallCreditsForElevenLabs(callId as string, parseInt(CallDuration, 10));
      
      if (!creditResult.success && !creditResult.alreadyDeducted) {
        console.error(`❌ [Status Webhook] Credit deduction failed for call ${callId}: ${creditResult.error}`);
        
        // Mark call as failed due to insufficient credits
        await db.update(calls)
          .set({ 
            status: 'failed',
            metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true, creditError: creditResult.error })}`
          })
          .where(eq(calls.id, callId as string));
        
        console.warn(`⚠️ [Status Webhook] Call ${callId} marked as failed due to credit deduction failure`);
        
        // CRITICAL: Stop all downstream processing when credits fail
        return res.status(200).json({ 
          success: false, 
          error: 'Credit deduction failed',
          callId 
        });
      }
    }

    // AUTOMATIC RECORDING RECOVERY: If call completed/answered but no recording URL, fetch from Twilio
    if (['completed', 'answered'].includes(CallStatus)) {
      try {
        // Get the call record to check if it has a recording URL and Twilio SID
        const [callRecord] = await db
          .select()
          .from(calls)
          .where(eq(calls.id, callId as string))
          .limit(1);
        
        if (callRecord && callRecord.twilioSid && !callRecord.recordingUrl) {
          console.log(`🎙️ [Auto Recovery] Call ${callId} completed but no recording URL. Fetching from Twilio...`);
          
          const twilioClient = await getTwilioClient();
          
          try {
            // Fetch recordings for this call from Twilio
            const recordings = await twilioClient.recordings.list({
              callSid: callRecord.twilioSid,
              limit: 1
            });
            
            if (recordings.length > 0) {
              const recording = recordings[0];
              const recordingUrl = `https://api.twilio.com${recording.uri.replace('.json', '')}`;
              
              console.log(`✅ [Auto Recovery] Found recording: ${recordingUrl}`);
              
              // Update call with recording URL
              await db
                .update(calls)
                .set({
                  recordingUrl,
                  duration: recording.duration ? parseInt(recording.duration, 10) : callRecord.duration
                })
                .where(eq(calls.id, callId as string));
              
              console.log(`✅ [Auto Recovery] Recording automatically recovered for call ${callId}`);
            } else {
              console.log(`⚠️ [Auto Recovery] No recording found in Twilio for call ${callId} (SID: ${callRecord.twilioSid})`);
            }
          } catch (recordingError: any) {
            console.error(`❌ [Auto Recovery] Failed to fetch recording from Twilio:`, recordingError.message);
          }
        } else if (callRecord && !callRecord.twilioSid) {
          console.warn(`⚠️ [Auto Recovery] Call ${callId} has no Twilio SID - cannot fetch recording`);
        }
      } catch (error: any) {
        console.error(`❌ [Auto Recovery] Error during automatic recording recovery:`, error.message);
      }
    }

    if (['completed', 'failed', 'busy', 'no-answer'].includes(CallStatus)) {
      await updateCampaignStats(callId as string, CallStatus);
      
      const ws = activeConnections.get(callId as string);
      if (ws) {
        ws.close();
        activeConnections.delete(callId as string);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Status webhook error:', error);
    res.status(500).send('Internal server error');
  }
}

export async function handleTwilioRecordingWebhook(req: Request, res: Response) {
  try {
    console.log(`📼 [Recording Webhook] Received request`);
    console.log(`   Query params:`, req.query);
    console.log(`   Body:`, req.body);
    
    const { callId } = req.query;
    const { RecordingUrl, RecordingDuration, RecordingSid, RecordingStatus } = req.body;
    
    if (!callId) {
      console.error(`❌ [Recording Webhook] Missing call ID in query params`);
      // Still return 200 to prevent Twilio retries
      return res.sendStatus(200);
    }
    
    // Twilio sends multiple callbacks for different recording statuses
    // Only process when status is 'completed' and we have a RecordingUrl
    if (RecordingStatus !== 'completed') {
      console.log(`⏳ [Recording Webhook] Status: ${RecordingStatus} (waiting for 'completed')`);
      return res.sendStatus(200);
    }
    
    if (!RecordingUrl) {
      console.error(`❌ [Recording Webhook] Status is 'completed' but RecordingUrl is missing`);
      // Still return 200 to prevent Twilio retries
      return res.sendStatus(200);
    }

    console.log(`💾 [Recording Webhook] Updating call ${callId}`);
    console.log(`   RecordingUrl: ${RecordingUrl}`);
    console.log(`   RecordingSid: ${RecordingSid}`);
    console.log(`   RecordingDuration: ${RecordingDuration}`);
    console.log(`   RecordingStatus: ${RecordingStatus}`);

    await db
      .update(calls)
      .set({ 
        recordingUrl: RecordingUrl,
        duration: RecordingDuration ? parseInt(RecordingDuration, 10) : undefined
      })
      .where(eq(calls.id, callId as string));

    console.log(`✅ [Recording Webhook] Successfully saved recording for call ${callId}`);

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ [Recording Webhook] Error:', error);
    // Always return 200 even on error to prevent Twilio retries
    res.sendStatus(200);
  }
}

export async function handleTwilioStreamWebSocket(ws: WebSocket, req: Request) {
  console.log(`[Stream] WebSocket connection established, waiting for Twilio start message...`);

  let callId: string | null = null;
  let agentId: string | null = null;
  let streamSid: string | null = null;
  let twilioCallSid: string | null = null;
  let elevenLabsWs: WebSocket | null = null;
  let mediaPacketCount = 0;
  const silenceTimerRef = { current: null as NodeJS.Timeout | null };
  
  // Flow execution context (optional)
  let flowId: string | null = null;
  let executionId: string | null = null;
  let flowBridge: any | null = null; // FlowExecutionBridge instance
  let fromPhoneNumber: string | null = null; // Originating phone number for transfers
  
  const conversationHistory: Array<{ role: 'user' | 'agent', text: string, timestamp: Date }> = [];
  
  const endCall = async (reason: string) => {
    // Clear any pending silence timer to prevent stale timeouts
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    await endTwilioCall(twilioCallSid, reason);
  };

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.event) {
        case 'start':
          streamSid = data.start.streamSid;
          twilioCallSid = data.start.callSid;
          const customParams = data.start.customParameters || {};
          callId = customParams.callId;
          agentId = customParams.agentId;
          const contactName = customParams.contactName;
          flowId = customParams.flowId || null;
          executionId = customParams.executionId || null;
          fromPhoneNumber = customParams.fromPhone || null;
          
          console.log(`✅ [Twilio] Media stream started`);
          console.log(`   StreamSid: ${streamSid}`);
          console.log(`   Twilio CallSid: ${twilioCallSid}`);
          console.log(`   CallId: ${callId}`);
          console.log(`   AgentId: ${agentId}`);
          console.log(`   Contact Name: ${contactName || 'N/A'}`);
          console.log(`   From Phone: ${fromPhoneNumber || 'N/A'}`);
          if (flowId) {
            console.log(`   🔀 Flow Mode Enabled`);
            console.log(`   Flow ID: ${flowId}`);
            console.log(`   Execution ID: ${executionId}`);
          }
          console.log(`   Custom parameters:`, JSON.stringify(customParams, null, 2));
          
          if (!callId || !agentId) {
            console.error('[Stream] Missing required parameters in start message');
            ws.close(1002, 'Missing parameters');
            return;
          }

          // Start call recording via Twilio REST API
          // Note: Recording cannot be enabled via TwiML when using <Connect><Stream>
          if (twilioCallSid) {
            try {
              const twilioClient = await getTwilioClient();
              const domain = getDomain(req.headers.host as string);
              const recordingCallbackUrl = `${domain}/api/webhooks/twilio/recording?callId=${callId}`;
              
              console.log(`📼 [Recording] Starting recording for call ${twilioCallSid}`);
              console.log(`   Recording callback URL: ${recordingCallbackUrl}`);
              
              await twilioClient.calls(twilioCallSid)
                .recordings
                .create({
                  recordingStatusCallback: recordingCallbackUrl,
                  recordingStatusCallbackMethod: 'POST',
                  recordingStatusCallbackEvent: ['completed'],
                });
                
              console.log(`✅ [Recording] Recording started successfully`);
            } catch (recordingError) {
              // Don't fail the call if recording fails - just log the error
              console.error(`❌ [Recording] Failed to start recording:`, recordingError);
            }
          } else {
            console.warn(`⚠️ [Recording] Cannot start recording - no Twilio CallSid available`);
          }

          try {
            activeConnections.set(callId, ws);
            
            // Resolve caller's phone so we can inject it as contact_phone dynamic variable.
            // This prevents the agent from asking the caller to repeat their phone number
            // during form collection. Prefer explicit custom param, fall back to call record.
            let callerPhone: string | undefined = customParams.contactPhone || undefined;
            if (!callerPhone) {
              try {
                const callRecord = await db
                  .select({ phoneNumber: calls.phoneNumber })
                  .from(calls)
                  .where(eq(calls.id, callId))
                  .limit(1);
                if (callRecord.length > 0 && callRecord[0].phoneNumber) {
                  callerPhone = callRecord[0].phoneNumber;
                  console.log(`[Stream] 📞 Resolved caller phone from call record: ${callerPhone}`);
                }
              } catch (phoneErr) {
                console.warn(`[Stream] ⚠️ Could not resolve caller phone for dynamic variable:`, phoneErr);
              }
            } else {
              console.log(`[Stream] 📞 Using caller phone from custom params: ${callerPhone}`);
            }
            
            // Flow Agents now execute entirely through ElevenLabs with compiled workflows
            // No need for FlowExecutionBridge - ElevenLabs handles the workflow execution
            if (flowId && executionId) {
              console.log(`🔄 [Flow Agent] Using ElevenLabs workflow execution`);
              console.log(`   Flow ID: ${flowId}`);
              console.log(`   Execution ID: ${executionId}`);
            }
            
            elevenLabsWs = await initializeElevenLabsConnection(
              agentId,
              callId,
              contactName,
              callerPhone,
              streamSid,
              ws,
              conversationHistory,
              silenceTimerRef,
              endCall,
              null  // Flow bridge no longer used - ElevenLabs handles workflow execution
            );
          } catch (error) {
            console.error(`[Stream] Error initializing ElevenLabs connection:`, error);
            ws.close();
          }
          break;
          
        case 'media':
          mediaPacketCount++;
          if (mediaPacketCount % 50 === 0) {
            console.log(`🎤 [Twilio→ElevenLabs] Sent ${mediaPacketCount} audio packets`);
          }
          
          if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN && data.media?.payload) {
            const audioMessage = {
              user_audio_chunk: data.media.payload,
            };
            elevenLabsWs.send(JSON.stringify(audioMessage));
          }
          break;
          
        case 'stop':
          console.log(`🛑 [Twilio] Media stream stopped for call ${callId}`);
          console.log(`[Twilio] Total media packets received: ${mediaPacketCount}`);
          if (elevenLabsWs) {
            elevenLabsWs.close();
          }
          break;
          
        default:
          console.log(`❓ [Twilio] Received unhandled event: ${data.event}`);
      }
    } catch (error) {
      console.error(`❌ [Twilio] Error processing message for call ${callId}:`, error);
    }
  });

  ws.on('close', async () => {
    console.log(`[Twilio] WebSocket closed for call ${callId}`);
    console.log(`[Twilio] Conversation history length: ${conversationHistory.length}`);
    console.log(`[Twilio] CallId present: ${!!callId}`);
    
    await formatAndSaveTranscript(callId, conversationHistory);
    
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
    if (callId) {
      activeConnections.delete(callId);
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
  });

  ws.on('error', (error) => {
    console.error(`[Twilio] WebSocket error for call ${callId}:`, error);
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });
}

// ============================================
// FLOW-BASED EXECUTION WEBHOOKS (DEPRECATED)
// Flow Agents now execute entirely through ElevenLabs
// These stubs are kept for backward compatibility
// ============================================

import { flowExecutions, FlowNode, ConditionNodeConfig } from '@shared/schema';

const FLOW_DEPRECATED_MESSAGE = 'Flow execution via TwiML webhooks is deprecated. Flow Agents now execute entirely through ElevenLabs. Please update your agent configuration.';

/**
 * DEPRECATED: Flow webhook handlers
 * Flow Agents now execute entirely through ElevenLabs using compiled workflows.
 * These handlers return deprecation notices for any legacy calls.
 */

function generateDeprecationTwiML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${FLOW_DEPRECATED_MESSAGE}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Initial webhook when flow-based call is answered (DEPRECATED)
 */
export async function handleFlowVoiceAnswer(req: Request, res: Response) {
  console.warn(`⚠️ [Flow Answer] DEPRECATED: ${FLOW_DEPRECATED_MESSAGE}`);
  res.type('text/xml').send(generateDeprecationTwiML());
}

/**
 * Serve TwiML for a specific node (DEPRECATED)
 */
export async function handleFlowNode(req: Request, res: Response) {
  console.warn(`⚠️ [Flow Node] DEPRECATED: ${FLOW_DEPRECATED_MESSAGE}`);
  res.type('text/xml').send(generateDeprecationTwiML());
}

/**
 * Handle user response from Question nodes (DEPRECATED)
 */
export async function handleFlowGather(req: Request, res: Response) {
  console.warn(`⚠️ [Flow Gather] DEPRECATED: ${FLOW_DEPRECATED_MESSAGE}`);
  res.type('text/xml').send(generateDeprecationTwiML());
}

/**
 * Continue to next node after Message/Delay (DEPRECATED)
 */
export async function handleFlowContinue(req: Request, res: Response) {
  console.warn(`⚠️ [Flow Continue] DEPRECATED: ${FLOW_DEPRECATED_MESSAGE}`);
  res.type('text/xml').send(generateDeprecationTwiML());
}

/**
 * Status callback for flow-based calls
 * This one is kept functional to handle status updates for any in-progress calls
 */
export async function handleFlowStatus(req: Request, res: Response) {
  try {
    console.log(`📊 [Flow Status] Received status update`);
    console.log(`   Query params:`, req.query);
    console.log(`   Body:`, req.body);
    
    const { executionId } = req.query;
    const { CallStatus, CallDuration } = req.body;
    
    if (!executionId) {
      console.error(`❌ [Flow Status] Missing execution ID`);
      return res.sendStatus(200);
    }

    // Load execution
    const [execution] = await db
      .select()
      .from(flowExecutions)
      .where(eq(flowExecutions.id, executionId as string));

    if (!execution) {
      console.error(`❌ [Flow Status] Execution not found: ${executionId}`);
      return res.sendStatus(200);
    }

    // If call completed and execution wasn't already marked complete
    if (CallStatus === 'completed' && execution.status === 'running') {
      await db
        .update(flowExecutions)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(flowExecutions.id, executionId as string));
      
      console.log(`✅ [Flow Status] Execution ${executionId} marked as completed`);
    }

    // Update call record if callId is available
    if (execution.callId && CallStatus) {
      const updateData: any = { status: CallStatus };
      if (CallStatus === 'completed' && CallDuration) {
        updateData.endedAt = new Date();
        updateData.duration = parseInt(CallDuration, 10);
      }

      await db
        .update(calls)
        .set(updateData)
        .where(eq(calls.id, execution.callId));
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ [Flow Status] Error:', error);
    res.sendStatus(200);
  }
}

/**
 * Verify ElevenLabs webhook signature
 * Header format: ElevenLabs-Signature: t=<timestamp>,v0=<hash>
 * Signed payload: timestamp.request_body
 * Hash: HMAC-SHA256 with shared secret
 */
function verifyElevenLabsWebhookSignature(
  body: string,
  signatureHeader: string | undefined,
  secret: string
): { valid: boolean; error?: string } {
  if (!signatureHeader) {
    return { valid: false, error: 'Missing ElevenLabs-Signature header' };
  }

  try {
    // Parse signature header: "t=1700000000,v0=abc123..."
    // Find timestamp and v0 signature
    const parts = signatureHeader.split(',');
    let timestamp: string | undefined;
    let receivedSignature: string | undefined;
    
    for (const part of parts) {
      if (part.startsWith('t=')) {
        timestamp = part.substring(2);
      } else if (part.startsWith('v0=')) {
        receivedSignature = part; // Keep the full 'v0=hash' for comparison
      }
    }

    if (!timestamp || !receivedSignature) {
      return { valid: false, error: `Invalid signature format. Got: ${signatureHeader.substring(0, 60)}...` };
    }

    // Check timestamp freshness (within 30 minutes as per ElevenLabs docs)
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (requestTime < currentTime - 30 * 60) {
      return { valid: false, error: 'Request expired - timestamp too old' };
    }

    // Compute expected signature: v0= + HMAC-SHA256(timestamp.body)
    const signedPayload = `${timestamp}.${body}`;
    const expectedHash = 'v0=' + crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (expectedHash.length !== receivedSignature.length) {
      return { valid: false, error: 'Signature mismatch (length)' };
    }
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(receivedSignature)
    );

    return { valid: isValid, error: isValid ? undefined : 'Signature mismatch' };
  } catch (err: any) {
    console.error('Signature verification error:', err.message);
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Get all webhook secrets from the credential pool for multi-secret verification
 * Returns unique secrets from all active credentials plus the global fallback
 */
async function getAllWebhookSecrets(): Promise<string[]> {
  const secrets: Set<string> = new Set();
  
  try {
    // Get all credential secrets from the pool
    const credentials = await db
      .select({ webhookSecret: elevenLabsCredentials.webhookSecret })
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.isActive, true));
    
    for (const cred of credentials) {
      if (cred.webhookSecret) {
        secrets.add(cred.webhookSecret);
      }
    }
    
    // Add global fallback secret
    const dbSecretSetting = await storage.getGlobalSetting('elevenlabs_hmac_secret');
    const globalSecret = (dbSecretSetting?.value as string) || process.env.ELEVENLABS_WEBHOOK_SECRET;
    if (globalSecret) {
      secrets.add(globalSecret);
    }
  } catch (err: any) {
    console.warn(`   ⚠️ Error fetching credential secrets: ${err.message}`);
    // Try global fallback
    const dbSecretSetting = await storage.getGlobalSetting('elevenlabs_hmac_secret');
    const globalSecret = (dbSecretSetting?.value as string) || process.env.ELEVENLABS_WEBHOOK_SECRET;
    if (globalSecret) {
      secrets.add(globalSecret);
    }
  }
  
  return Array.from(secrets);
}

/**
 * Verify webhook signature by trying all available secrets
 * This is secure because we verify BEFORE trusting any body data
 * Returns the matching secret if found, null otherwise
 */
async function verifyWithAllSecrets(
  rawBody: string,
  signatureHeader: string | undefined
): Promise<{ verified: boolean; unverified?: boolean; matchedSecret?: string; error?: string }> {
  // Fetch secrets first so we can make context-aware decisions below
  const allSecrets = await getAllWebhookSecrets();

  // Case 1: No secrets configured on the platform AND ElevenLabs didn't send a signature.
  // This is the "signing not set up on either side" scenario — nothing to verify against.
  // Allow through with a warning so calls, credits, and analytics are not silently blocked.
  if (allSecrets.length === 0 && !signatureHeader) {
    console.warn(`⚠️ [ElevenLabs Webhook] No webhook secrets configured and no signature header — allowing unsigned webhook. Configure a webhook secret in Admin > ElevenLabs to enable signature verification.`);
    return { verified: true, unverified: true };
  }

  // Case 2: Secrets ARE configured on the platform but the header is absent.
  // ElevenLabs always sends the header when a secret is registered, so a missing
  // header with secrets present is suspicious — reject it.
  if (!signatureHeader) {
    return { verified: false, error: 'Missing ElevenLabs-Signature header' };
  }

  // Case 3: Header is present but no secrets configured to verify against.
  // Can't verify but also can't block — allow through with a warning.
  if (allSecrets.length === 0) {
    console.warn(`⚠️ [ElevenLabs Webhook] Signature header present but no secrets configured for verification — allowing through. Configure a webhook secret in Admin > ElevenLabs to enable full security.`);
    return { verified: true, unverified: true };
  }

  console.log(`   🔐 Trying ${allSecrets.length} webhook secret(s) for verification...`);

  // Case 4: Both secrets and header present — verify HMAC normally.
  // Try each secret until one matches (supports credential pool rotation).
  for (const secret of allSecrets) {
    const verification = verifyElevenLabsWebhookSignature(rawBody, signatureHeader, secret);
    if (verification.valid) {
      console.log(`   ✅ Signature verified with credential secret`);
      return { verified: true, matchedSecret: secret };
    }
  }

  return { verified: false, error: 'Signature did not match any configured secrets' };
}

/**
 * Handle ElevenLabs post-call webhook events
 * Receives notifications when calls complete via ElevenLabs native Twilio integration
 * 
 * Webhook types (per ElevenLabs docs):
 * - post_call_transcription: Contains full conversation data including transcripts, analysis results
 * - post_call_audio: Contains minimal data with base64-encoded audio
 * - call_initiation_failure: Contains information about failed call initiation attempts
 * 
 * Security: Verifies HMAC signature by trying all credential secrets
 * Multi-key pool: Each ElevenLabs API key has its own webhook secret, we verify against all
 * This approach is secure because we verify BEFORE trusting any body data
 */
export async function handleElevenLabsWebhook(req: Request, res: Response) {
  try {
    console.log(`📞 [ElevenLabs Webhook] Received event`);
    
    // Get the raw body as string for signature verification
    // Must use the actual raw body buffer, not re-stringified JSON, for HMAC to match
    const rawBody = req.rawBody ? Buffer.from(req.rawBody as Uint8Array).toString() : JSON.stringify(req.body);
    const signatureHeader = req.headers['elevenlabs-signature'] as string | undefined;
    
    // Debug: Log signature header format
    console.log(`   Signature header present: ${!!signatureHeader}`);
    if (signatureHeader) {
      console.log(`   Signature header value: ${signatureHeader.substring(0, 60)}...`);
    }
    
    // Secure verification: Try all credential secrets until one matches
    // This way we don't trust the body data until AFTER verification succeeds
    const verification = await verifyWithAllSecrets(rawBody, signatureHeader);
    
    if (!verification.verified) {
      // SIP-originated webhooks from ElevenLabs may not include the signature header
      // Detect SIP webhooks by checking for SIP-specific metadata in the payload
      const bodyData = req.body?.data || req.body;
      const webhookMetadata = bodyData?.metadata || bodyData?.call?.metadata || {};
      const isSipWebhook = !signatureHeader && (
        webhookMetadata?.sip_trunk_id ||
        webhookMetadata?.phone_call?.sip_trunk_id ||
        webhookMetadata?.phone_call?.sip_phone_number_id
      );
      
      if (isSipWebhook) {
        console.warn(`⚠️ [ElevenLabs Webhook] Missing signature header (likely SIP-originated webhook) - allowing as sip-unverified`);
      } else if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ [ElevenLabs Webhook] Signature verification failed: ${verification.error}`);
        console.log(`   ⚠️ Continuing without signature verification (development mode)`);
      } else {
        console.warn(`⚠️ [ElevenLabs Webhook] Signature verification failed: ${verification.error}`);
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } else if (verification.unverified) {
      // Passed through without verification (no secrets configured on either side)
      console.warn(`⚠️ [ElevenLabs Webhook] Processing without signature verification — no secrets configured. Set up a webhook secret in Admin > ElevenLabs credentials to enable security.`);
    } else {
      console.log(`   ✅ Signature verified`);
    }
    
    // Parse the webhook body according to ElevenLabs format
    // Standard format: { type: string, data: object, event_timestamp: number }
    // Legacy audio format: { audio: "base64..." } (WebSocket streaming webhook)
    const { type, data, event_timestamp, audio } = req.body;
    
    // DEBUG: Log the entire webhook body structure (keys only for sensitive data)
    const bodyKeys = Object.keys(req.body);
    console.log(`   Body structure: { ${bodyKeys.join(', ')} }`);
    console.log(`   Has 'type': ${!!type}`);
    console.log(`   Has 'data': ${!!data}`);
    console.log(`   Has 'audio': ${!!audio}`);
    
    // Handle legacy audio-only webhook format (WebSocket streaming)
    if (audio && !type) {
      console.log(`📞 [ElevenLabs Webhook] Received legacy audio-only webhook - skipping`);
      console.log(`   Audio data size: ~${Math.round((audio as string).length / 1024)}KB`);
      // These are streaming audio chunks, not post-call data
      return res.sendStatus(200);
    }
    
    // Log webhook type
    console.log(`   Webhook type: ${type || 'undefined'}`);
    console.log(`   Event timestamp: ${event_timestamp || 'N/A'}`);
    
    if (!type) {
      console.warn(`⚠️ [ElevenLabs Webhook] Unknown webhook format - no 'type' field`);
      console.log(`   Full body keys: ${JSON.stringify(bodyKeys)}`);
      // Don't return 400 - just log and acknowledge to prevent retries
      return res.sendStatus(200);
    }
    
    // Handle post_call_audio webhooks (contains recording URL)
    // IMPORTANT: ElevenLabs recording URLs expire quickly, so we DON'T store them
    // Instead, we fetch ElevenLabs audio on-demand during playback
    // We only store Twilio recording URLs (stable/permanent)
    if (type === 'post_call_audio') {
      console.log(`📞 [ElevenLabs Webhook] Received post_call_audio`);
      const { conversation_id: audioConvId, recording_url, audio_url, metadata: audioMetadata } = data || {};
      
      console.log(`   Conversation ID: ${audioConvId || 'N/A'}`);
      console.log(`   ElevenLabs recording present: ${recording_url || audio_url ? 'yes (not storing - expires)' : 'no'}`);
      
      // Extract call_sid from metadata for Twilio fallback
      const callSid = audioMetadata?.phone_call?.call_sid || audioMetadata?.call_sid;
      console.log(`   Call SID for Twilio: ${callSid || 'N/A'}`);
      
      if (audioConvId) {
        try {
          const [existingCall] = await db
            .select()
            .from(calls)
            .where(eq(calls.elevenLabsConversationId, audioConvId))
            .limit(1);
          
          if (existingCall) {
            const twilioSid = callSid || existingCall.twilioSid;
            
            let twilioRecordingUrl: string | null = null;
            if (twilioSid && !existingCall.recordingUrl) {
              console.log(`   📞 Fetching stable Twilio recording for SID: ${twilioSid}`);
              try {
                const twilioData = await twilioService.getCallDetails(twilioSid);
                if (twilioData?.recordingUrl) {
                  twilioRecordingUrl = twilioData.recordingUrl;
                  console.log(`   ✅ Got stable Twilio recording URL`);
                } else {
                  console.log(`   ⚠️ No Twilio recording available (call may not have recording enabled)`);
                }
              } catch (twilioError: any) {
                console.warn(`   ⚠️ Twilio recording fetch failed: ${twilioError.message}`);
              }
            }
            
            const audioUpdateData = {
              recordingUrl: twilioRecordingUrl || existingCall.recordingUrl,
              twilioSid: twilioSid,
              metadata: {
                ...existingCall.metadata as object,
                hasElevenLabsRecording: !!(recording_url || audio_url),
                recordingMetadataUpdatedAt: new Date().toISOString(),
              }
            };
            try {
              await db
                .update(calls)
                .set(audioUpdateData)
                .where(eq(calls.id, existingCall.id));
            } catch (audioUpdateErr: any) {
              if (isTypeMismatchError(audioUpdateErr)) {
                console.warn(`[ElevenLabs Webhook] Type mismatch on audio UPDATE, retrying with raw SQL`);
                const metaJson = JSON.stringify(audioUpdateData.metadata);
                await db.execute(sql`
                  UPDATE calls SET
                    recording_url = ${audioUpdateData.recordingUrl},
                    twilio_sid = ${audioUpdateData.twilioSid},
                    metadata = ${metaJson}::jsonb
                  WHERE id::text = ${existingCall.id}::text
                `);
              } else {
                throw audioUpdateErr;
              }
            }
            console.log(`   ✅ Updated call record: ${existingCall.id} (Twilio SID: ${twilioSid || 'N/A'})`);
          } else {
            // Check SIP calls table if not found in main calls table
            // Critical for SIP-based clients who don't use Twilio
            const sipCallResult = await db.execute(sql`
              SELECT * FROM sip_calls WHERE elevenlabs_conversation_id = ${audioConvId} LIMIT 1
            `);
            const existingSipCall = sipCallResult.rows[0] as any;
            
            if (existingSipCall) {
              console.log(`   📞 Found SIP call record: ${existingSipCall.id}`);
              await db.execute(sql`
                UPDATE sip_calls SET
                  metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
                    hasElevenLabsRecording: !!(recording_url || audio_url),
                    recordingMetadataUpdatedAt: new Date().toISOString(),
                  })}::jsonb,
                  updated_at = NOW()
                WHERE id = ${existingSipCall.id}
              `);
              console.log(`   ✅ Updated SIP call record: ${existingSipCall.id}`);
            } else {
              console.log(`   ⚠️ No call record found (calls or sip_calls) for conversation: ${audioConvId}`);
            }
          }
        } catch (audioError: any) {
          console.error(`   ❌ Error updating call record:`, audioError.message);
        }
      }
      
      await recordWebhookReceived('elevenlabs');
      return res.sendStatus(200);
    }
    
    // Handle call_initiation_failure webhooks
    if (type === 'call_initiation_failure') {
      console.log(`📞 [ElevenLabs Webhook] Call initiation failed`);
      const { agent_id, conversation_id, failure_reason, metadata: failureMetadata } = data || {};
      console.log(`   Agent ID: ${agent_id}`);
      console.log(`   Conversation ID: ${conversation_id}`);
      console.log(`   Failure reason: ${failure_reason}`);
      
      // Try to update the call record if it exists
      if (conversation_id) {
        const [callRecord] = await db
          .select()
          .from(calls)
          .where(eq(calls.elevenLabsConversationId, conversation_id))
          .limit(1);
        
        if (callRecord) {
          await db
            .update(calls)
            .set({
              status: 'failed',
              endedAt: new Date(),
              metadata: {
                ...callRecord.metadata as object,
                failureReason: failure_reason,
                failureMetadata: failureMetadata,
              }
            })
            .where(eq(calls.id, callRecord.id));
          console.log(`   Updated call ${callRecord.id} as failed`);
          
          // Trigger call.failed webhook if user is known
          if (callRecord.userId) {
            const contact = callRecord.contactId ? await storage.getContact(callRecord.contactId) : null;
            const campaign = callRecord.campaignId ? await storage.getCampaign(callRecord.campaignId) : null;
            
            webhookDeliveryService.triggerEvent(callRecord.userId, 'call.failed', {
              campaign: campaign ? { id: campaign.id, name: campaign.name, type: campaign.type } : null,
              contact: contact ? {
                id: contact.id,
                firstName: contact.firstName,
                lastName: contact.lastName,
                phone: contact.phone,
                email: contact.email,
                customFields: contact.customFields,
              } : { phone: callRecord.phoneNumber },
              call: {
                id: callRecord.id,
                status: 'failed',
                phoneNumber: callRecord.phoneNumber,
                failureReason: failure_reason,
                startedAt: callRecord.startedAt,
                endedAt: new Date(),
              }
            }, callRecord.campaignId).catch(err => {
              console.error('❌ [Webhook] Error triggering call.failed event:', err);
            });
          }

          // AUTO-RESYNC: If failure reason indicates stale Twilio credentials in ElevenLabs,
          // re-register the phone number with current credentials in the background.
          // "max auth retry attempts reached" = ElevenLabs could not authenticate with Twilio
          // to place the call — caused by stale SID/Token stored in the ElevenLabs registration.
          // Broad pattern set covers all known ElevenLabs auth-retry failure messages:
          // "max auth retry attempts reached", "max auth retries reached", "auth retry …", etc.
          const isAuthRetryFailure = typeof failure_reason === 'string' &&
            (/max.*auth/i.test(failure_reason) ||
             /auth.*retry/i.test(failure_reason));

          if (isAuthRetryFailure) {
            console.log(`🔄 [ElevenLabs Webhook] Auth retry failure detected — triggering background credential resync`);
            console.log(`   Failure reason: "${failure_reason}"`);

            // Look up the phone number for this call so we can resync just that one
            const campaignId = callRecord.campaignId;
            let phoneDbId: string | null = null;

            if (campaignId) {
              const [campaign] = await db
                .select({ phoneNumberId: campaigns.phoneNumberId })
                .from(campaigns)
                .where(eq(campaigns.id, campaignId))
                .limit(1);
              if (campaign?.phoneNumberId) {
                phoneDbId = campaign.phoneNumberId;
              }
            }

            if (!phoneDbId) {
              console.warn(`⚠️ [ElevenLabs Webhook] Could not resolve phone number for resync — no campaignId on call record; skipping retry queue`);
            }

            // Run resync non-blocking so we return 200 to ElevenLabs quickly.
            // Campaign retry is only enqueued when (a) we resolved the phone and (b) resync succeeded,
            // to avoid scheduling a retry when the credential problem is still present.
            if (phoneDbId) {
              (async () => {
                try {
                  console.log(`🔄 [ElevenLabs Webhook] Resyncing phone DB id: ${phoneDbId}`);
                  const resyncResult = await resyncSinglePhoneCredentials(phoneDbId!);
                  if (resyncResult.success) {
                    console.log(`✅ [ElevenLabs Webhook] Credential resync succeeded for phone ${phoneDbId}`);
                    // Only now queue the campaign for retry — credentials are fresh
                    if (campaignId) {
                      console.log(`🔄 [ElevenLabs Webhook] Marking campaign ${campaignId} for retry after successful resync`);
                      await markCampaignForRetry(campaignId, `Auto-retry after credential resync (original failure: ${failure_reason})`);
                    }
                  } else {
                    console.error(`❌ [ElevenLabs Webhook] Credential resync failed: ${resyncResult.error}`);
                    console.warn(`⚠️ [ElevenLabs Webhook] Campaign retry NOT scheduled — credentials may still be stale`);
                  }
                } catch (resyncErr: any) {
                  console.error(`❌ [ElevenLabs Webhook] Background resync error: ${resyncErr?.message ?? resyncErr}`);
                }
              })();
            }
          }
        }
      }
      await recordWebhookReceived('elevenlabs');
      return res.sendStatus(200);
    }
    
    // Handle post_call_transcription webhooks (main call completion data)
    if (type !== 'post_call_transcription') {
      console.log(`⚠️ [ElevenLabs Webhook] Unknown webhook type: ${type}`);
      return res.sendStatus(200);
    }
    
    // Extract data from post_call_transcription webhook
    const { 
      agent_id, 
      conversation_id, 
      status,
      transcript: webhookTranscript,
      metadata,
      analysis 
    } = data || {};
    
    if (!conversation_id) {
      console.warn(`⚠️ [ElevenLabs Webhook] Missing conversation_id in data`);
      return res.status(400).json({ error: 'Missing conversation_id' });
    }
    
    console.log(`   Conversation ID: ${conversation_id}`);
    console.log(`   Agent ID: ${agent_id || 'N/A'}`);
    console.log(`   Status: ${status || 'N/A'}`);
    
    // COMPREHENSIVE LOGGING: Log all webhook data for debugging
    console.log(`📋 [ElevenLabs Webhook] Full webhook data structure:`);
    console.log(`   metadata keys: ${metadata ? Object.keys(metadata).join(', ') : 'N/A'}`);
    if (metadata) {
      // Log phone_call object (where phone numbers are nested for telephony calls)
      if (metadata.phone_call) {
        console.log(`   metadata.phone_call keys: ${Object.keys(metadata.phone_call).join(', ')}`);
        console.log(`   metadata.phone_call.from: ${metadata.phone_call.from || metadata.phone_call.from_number || 'N/A'}`);
        console.log(`   metadata.phone_call.to: ${metadata.phone_call.to || metadata.phone_call.to_number || 'N/A'}`);
        console.log(`   metadata.phone_call.call_sid: ${metadata.phone_call.call_sid || metadata.phone_call.twilio_call_sid || 'N/A'}`);
      } else {
        console.log(`   metadata.phone_call: N/A (not a phone call)`);
      }
      // Log batch_call object if present
      if (metadata.batch_call) {
        console.log(`   metadata.batch_call keys: ${Object.keys(metadata.batch_call).join(', ')}`);
        console.log(`   metadata.batch_call.batch_call_id: ${metadata.batch_call.batch_call_id || 'N/A'}`);
        console.log(`   metadata.batch_call.batch_call_recipient_id: ${metadata.batch_call.batch_call_recipient_id || 'N/A'}`);
      }
      // Log external_number if present (used in batch calls)
      if (metadata.phone_call?.external_number) {
        console.log(`   metadata.phone_call.external_number: ${metadata.phone_call.external_number}`);
      }
      // Log direct fields (fallback)
      console.log(`   metadata.from_number (direct): ${metadata.from_number || 'N/A'}`);
      console.log(`   metadata.to_number (direct): ${metadata.to_number || 'N/A'}`);
      console.log(`   metadata.call_duration_secs: ${metadata.call_duration_secs || 'N/A'}`);
      console.log(`   metadata.termination_reason: ${metadata.termination_reason || 'N/A'}`);
      // Log error and warnings for debugging failed calls
      if (metadata.error) {
        console.log(`   ❌ metadata.error: ${JSON.stringify(metadata.error)}`);
      }
      if (metadata.warnings && metadata.warnings.length > 0) {
        console.log(`   ⚠️ metadata.warnings: ${JSON.stringify(metadata.warnings)}`);
      }
    }
    console.log(`   analysis keys: ${analysis ? Object.keys(analysis).join(', ') : 'N/A'}`);
    if (analysis) {
      console.log(`   analysis.call_successful: ${analysis.call_successful || 'N/A'}`);
      console.log(`   analysis.transcript_summary: ${analysis.transcript_summary ? 'present (' + analysis.transcript_summary.length + ' chars)' : 'N/A'}`);
    }
    console.log(`   transcript entries: ${webhookTranscript ? webhookTranscript.length : 0}`);
    
    // EXTRACT PHONE NUMBERS: Check all possible locations
    // Priority: phone_call object > batch_call object > direct metadata fields
    // For SIP calls: agent_number = your SIP phone, external_number = caller/recipient
    // Direction matters: inbound (From=external, To=agent), outbound (From=agent, To=external)
    const callDirection = metadata?.phone_call?.direction;
    const agentNumber = metadata?.phone_call?.agent_number;
    const externalNumber = metadata?.phone_call?.external_number;
    
    // Determine From/To based on direction for SIP calls with agent_number/external_number
    let extractedFromNumber: string | null = null;
    let extractedToNumber: string | null = null;
    
    if (callDirection === 'inbound' && (agentNumber || externalNumber)) {
      // Inbound: caller is external_number, recipient is agent_number
      extractedFromNumber = externalNumber || metadata?.phone_call?.from || metadata?.phone_call?.from_number || null;
      extractedToNumber = agentNumber || metadata?.phone_call?.to || metadata?.phone_call?.to_number || null;
    } else if (callDirection === 'outbound' && (agentNumber || externalNumber)) {
      // Outbound: caller is agent_number, recipient is external_number
      extractedFromNumber = agentNumber || metadata?.phone_call?.from || metadata?.phone_call?.from_number || null;
      extractedToNumber = externalNumber || metadata?.phone_call?.to || metadata?.phone_call?.to_number || null;
    } else {
      // Fallback: Use explicit from/to fields, batch_call data, or Twilio metadata
      // Also check fromNumber/twilioFrom which the system itself writes at call creation time
      extractedFromNumber = 
        metadata?.phone_call?.from || 
        metadata?.phone_call?.from_number ||
        metadata?.batch_call?.from ||
        metadata?.from_number ||
        metadata?.fromNumber ||
        metadata?.twilioFrom ||
        null;
      extractedToNumber = 
        metadata?.phone_call?.to || 
        metadata?.phone_call?.to_number ||
        metadata?.batch_call?.to ||
        metadata?.to_number ||
        metadata?.toNumber ||
        metadata?.twilioTo ||
        null;
    }
    const extractedCallSid = 
      metadata?.phone_call?.call_sid ||
      metadata?.phone_call?.twilio_call_sid ||
      metadata?.call_sid ||
      null;
    
    console.log(`📱 [ElevenLabs Webhook] Extracted phone data (direction: ${callDirection || 'unknown'}):`);
    console.log(`   From: ${extractedFromNumber || 'N/A'} (caller)`);
    console.log(`   To: ${extractedToNumber || 'N/A'} (recipient)`);
    console.log(`   Agent Number: ${agentNumber || 'N/A'}, External Number: ${externalNumber || 'N/A'}`);
    console.log(`   CallSid: ${extractedCallSid || 'N/A'}`);
    
    // Find the call record by ElevenLabs conversation ID
    let [callRecord] = await db
      .select()
      .from(calls)
      .where(eq(calls.elevenLabsConversationId, conversation_id))
      .limit(1);
    
    // If no record found by conversation_id, try matching by phone number + agent for batch calls
    // Batch calls are pre-created with status='pending' and matching phone numbers
    // NOTE: Campaign scheduler may mark calls as 'failed' before this webhook arrives,
    // so we also search for 'failed' and 'in_progress' statuses
    if (!callRecord && agent_id) {
      console.log(`📞 [ElevenLabs Webhook] No record by conversation_id - attempting phone number match for batch calls`);
      
      const webhookPhoneNumber = extractedToNumber || extractedFromNumber;
      
      if (webhookPhoneNumber) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.elevenLabsAgentId, agent_id))
          .limit(1);
        
        if (agent && (agent.type === 'natural' || agent.type === 'flow')) {
          console.log(`   Found campaign agent: ${agent.name} (${agent.type})`);
          console.log(`   Looking for batch call to: ${webhookPhoneNumber}`);
          
          try {
            const pendingCallQuery = await db
              .select({ call: calls, campaign: campaigns })
              .from(calls)
              .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
              .where(
                and(
                  eq(calls.phoneNumber, webhookPhoneNumber),
                  inArray(calls.status, [
                    'pending',
                    'failed',
                    'in_progress',
                    'in-progress',
                    'answered',
                    'ringing',
                    'initiated',
                    'queued',
                  ]),
                  eq(calls.callDirection, 'outgoing'),
                  eq(campaigns.agentId, agent.id)
                )
              )
              .orderBy(sql`${calls.createdAt} DESC`)
              .limit(1);
            
            if (pendingCallQuery.length > 0 && pendingCallQuery[0].call) {
              callRecord = pendingCallQuery[0].call;
              console.log(`   ✅ Found matching pre-created batch call record: ${callRecord.id} (status: ${callRecord.status})`);
            } else {
              console.log(`   No batch call found by phone number for ${webhookPhoneNumber}`);
            }
          } catch (pendingQueryError: any) {
            if (isTypeMismatchError(pendingQueryError)) {
              console.warn(`[ElevenLabs Webhook] Type mismatch on pending call lookup, retrying with raw SQL and uuid casting`);
              try {
                const rawResult = await db.execute(sql`
                  SELECT c.* FROM calls c
                  LEFT JOIN campaigns camp ON c.campaign_id::text = camp.id::text
                  WHERE c.phone_number = ${webhookPhoneNumber}
                    AND c.status IN ('pending', 'failed', 'in_progress', 'in-progress', 'answered', 'ringing', 'initiated', 'queued')
                    AND c.call_direction = 'outgoing'
                    AND camp.agent_id::text = ${agent.id}::text
                  ORDER BY c.created_at DESC
                  LIMIT 1
                `);
                if (rawResult.rows && rawResult.rows.length > 0) {
                  callRecord = rawResult.rows[0] as any;
                  console.log(`   ✅ Found batch call via raw SQL: ${callRecord.id} (status: ${callRecord.status})`);
                } else {
                  console.log(`   No batch call found by phone number (raw SQL) for ${webhookPhoneNumber}`);
                }
              } catch (rawQueryError: any) {
                console.error(`   ❌ Raw SQL pending call lookup also failed:`, rawQueryError.message);
              }
            } else {
              console.error(`   ❌ Pending call lookup error:`, pendingQueryError.message);
            }
          }
          
          if (callRecord) {
            try {
              await db
                .update(calls)
                .set({ elevenLabsConversationId: conversation_id })
                .where(eq(calls.id, callRecord.id));
              console.log(`   Updated call record with conversation_id: ${conversation_id}`);
            } catch (updateConvIdError: any) {
              if (isTypeMismatchError(updateConvIdError)) {
                try {
                  await db.execute(sql`UPDATE calls SET elevenlabs_conversation_id = ${conversation_id} WHERE id::text = ${callRecord.id}::text`);
                  console.log(`   Updated call record with conversation_id (raw SQL): ${conversation_id}`);
                } catch (rawUpdateErr: any) {
                  console.warn(`   ⚠️ Failed to set conversation_id (non-fatal):`, rawUpdateErr.message);
                }
              } else {
                console.warn(`   ⚠️ Failed to set conversation_id (non-fatal):`, updateConvIdError.message);
              }
            }
          }
        }
      }
      
      // FALLBACK: Try matching by batch_call_id if phone number match failed
      // Batch calls have batchJobId stored in call record metadata
      if (!callRecord && metadata?.batch_call?.batch_call_id) {
        const batchCallId = metadata.batch_call.batch_call_id;
        const webhookPhone = extractedToNumber || extractedFromNumber;
        console.log(`   Attempting batch_call_id match: ${batchCallId}, phone: ${webhookPhone}`);
        
        try {
          const batchCallQuery = await db
            .select()
            .from(calls)
            .where(
              and(
                inArray(calls.status, [
                  'pending',
                  'failed',
                  'in_progress',
                  'in-progress',
                  'answered',
                  'ringing',
                  'initiated',
                  'queued',
                ]),
                eq(calls.callDirection, 'outgoing'),
                sql`${calls.metadata}->>'batchJobId' = ${batchCallId}`
              )
            )
            .orderBy(sql`${calls.createdAt} DESC`)
            .limit(20);
          
          console.log(`   Found ${batchCallQuery.length} calls for batch_call_id ${batchCallId}`);
          
          if (batchCallQuery.length > 0) {
            if (webhookPhone) {
              const normalizedWebhookPhone = webhookPhone.replace(/[^\d]/g, '');
              const exactMatch = batchCallQuery.find(c => {
                const normalizedCallPhone = c.phoneNumber?.replace(/[^\d]/g, '') || '';
                return normalizedCallPhone === normalizedWebhookPhone || 
                       normalizedCallPhone.endsWith(normalizedWebhookPhone) ||
                       normalizedWebhookPhone.endsWith(normalizedCallPhone);
              });
              if (exactMatch) {
                callRecord = exactMatch;
                console.log(`   ✅ Found batch call by batch_call_id + phone: ${callRecord.id}`);
              }
            }
            
            if (!callRecord) {
              callRecord = batchCallQuery[0];
              console.log(`   ✅ Found batch call by batch_call_id (first match): ${callRecord.id}`);
            }
            
            try {
              await db
                .update(calls)
                .set({ elevenLabsConversationId: conversation_id })
                .where(eq(calls.id, callRecord.id));
              console.log(`   Updated call record with conversation_id: ${conversation_id}`);
            } catch (updateConvIdError: any) {
              if (isTypeMismatchError(updateConvIdError)) {
                try {
                  await db.execute(sql`UPDATE calls SET elevenlabs_conversation_id = ${conversation_id} WHERE id::text = ${callRecord.id}::text`);
                  console.log(`   Updated call record with conversation_id (raw SQL): ${conversation_id}`);
                } catch (rawUpdateErr: any) {
                  console.warn(`   ⚠️ Failed to set conversation_id (non-fatal):`, rawUpdateErr.message);
                }
              } else {
                console.warn(`   ⚠️ Failed to set conversation_id (non-fatal):`, updateConvIdError.message);
              }
            }
          } else {
            console.log(`   No calls found for batch_call_id: ${batchCallId}`);
          }
        } catch (batchQueryError: any) {
          console.error(`   ❌ Batch call ID lookup error:`, batchQueryError.message);
        }
      }
    }
    
    // Update flow execution to 'running' status when call is matched
    if (callRecord) {
      try {
        const [flowExecution] = await db
          .select()
          .from(flowExecutions)
          .where(eq(flowExecutions.callId, callRecord.id))
          .limit(1);
        
        if (flowExecution && flowExecution.status === 'pending') {
          await db
            .update(flowExecutions)
            .set({
              status: 'running',
              startedAt: new Date(),
              metadata: sql`COALESCE(${flowExecutions.metadata}, '{}'::jsonb) || ${JSON.stringify({ conversationId: conversation_id })}::jsonb`,
            })
            .where(eq(flowExecutions.id, flowExecution.id));
          console.log(`🔀 [ElevenLabs Webhook] Flow execution ${flowExecution.id} started (pending -> running)`);
        }
      } catch (flowExecError: any) {
        console.warn(`⚠️ [ElevenLabs Webhook] Error updating flow execution to running:`, flowExecError.message);
      }
    }
    
    // If no call record exists, this might be an incoming call via ElevenLabs native integration
    // We need to create a call record for it - process the webhook data directly
    if (!callRecord) {
      console.log(`📞 [ElevenLabs Webhook] No existing call record - checking if this is a native incoming call or outbound campaign call`);
      
      try {
        // Find the agent by ElevenLabs agent ID
        if (agent_id) {
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.elevenLabsAgentId, agent_id))
            .limit(1);
          
          // CASE 0: ElevenLabs SIP calls - create/update record in sip_calls table
          // This handles calls through user's own SIP trunk via ElevenLabs
          // ISOLATION: Wrapped in try/catch so failures never block other CASE branches
          try {
          if (agent && agent.telephonyProvider === 'elevenlabs-sip') {
            console.log(`📞 [ElevenLabs SIP] Found SIP agent: ${agent.name}`);
            
            let callerPhoneNumber = extractedFromNumber;
            let calledNumber = extractedToNumber;
            const direction = metadata?.phone_call?.direction || 'inbound';
            const callDuration = metadata?.call_duration_secs || 0;
            
            console.log(`   SIP Call - Direction: ${direction}, From: ${callerPhoneNumber || 'N/A'}, To: ${calledNumber || 'N/A'}`);
            
            // First, check if there's an existing sip_calls record (for outbound calls)
            const existingSipCallResult = await db.execute(sql`
              SELECT * FROM sip_calls WHERE elevenlabs_conversation_id = ${conversation_id} LIMIT 1
            `);
            const existingSipCall = existingSipCallResult.rows[0] as any;
            
            if (existingSipCall) {
              console.log(`   Found existing SIP call record: ${existingSipCall.id} (${existingSipCall.direction})`);
              
              // Status downgrade protection: Don't update if already in terminal state
              const terminalStatuses = ['completed', 'failed'];
              if (terminalStatuses.includes(existingSipCall.status)) {
                console.log(`   SIP call already in terminal status '${existingSipCall.status}' - skipping update`);
                return res.sendStatus(200);
              }
              
              // FIX: Correct From/To for existing SIP calls using the stored sip_phone_number_id
              // Resolve the SIP phone number from the existing record to run swap detection
              if (existingSipCall.sip_phone_number_id) {
                try {
                  const existingSipPhoneResult = await db.execute(sql`
                    SELECT phone_number FROM sip_phone_numbers WHERE id::text = ${existingSipCall.sip_phone_number_id}::text LIMIT 1
                  `);
                  const existingSipPhone = existingSipPhoneResult.rows[0] as any;
                  if (existingSipPhone?.phone_number) {
                    const normalizeForCompare = (phone: string) => phone.replace(/[^0-9]/g, '');
                    const sipDigits = normalizeForCompare(existingSipPhone.phone_number);
                    const fDigits = callerPhoneNumber ? normalizeForCompare(callerPhoneNumber) : '';
                    const tDigits = calledNumber ? normalizeForCompare(calledNumber) : '';
                    const fIsSip = fDigits && (sipDigits.endsWith(fDigits) || fDigits.endsWith(sipDigits));
                    const tIsSip = tDigits && (sipDigits.endsWith(tDigits) || tDigits.endsWith(sipDigits));
                    
                    if (direction === 'inbound' && fIsSip && !tIsSip) {
                      console.log(`   🔄 Correcting existing inbound SIP From/To swap`);
                      const temp = callerPhoneNumber;
                      callerPhoneNumber = calledNumber;
                      calledNumber = temp || existingSipPhone.phone_number;
                    } else if (direction === 'outbound' && tIsSip && !fIsSip) {
                      console.log(`   🔄 Correcting existing outbound SIP From/To swap`);
                      const temp = calledNumber;
                      calledNumber = callerPhoneNumber;
                      callerPhoneNumber = temp || existingSipPhone.phone_number;
                    }
                  }
                } catch (err) {
                  console.warn(`   ⚠️ Could not resolve SIP phone for swap correction: ${err}`);
                }
              }
              
              // Use sync service to get transcript and analysis data
              const { callSyncService } = await import('../services/call-sync');
              const syncedData = await callSyncService.syncFromWebhook({
                conversationId: conversation_id,
                agentId: agent_id,
                transcript: webhookTranscript,
                analysis,
                metadata,
                status,
                callDurationSecs: callDuration,
              });
              
              // Determine final status based on webhook status
              // ElevenLabs status: 'completed', 'done', 'failed', 'error', 'timeout', etc.
              // Only mark as completed if explicitly completed; otherwise preserve status or mark failed
              const isCompletedCall = status === 'completed' || status === 'done';
              const isFailedCall = status === 'failed' || status === 'error' || status === 'timeout' || status === 'no-answer';
              const finalStatus = isCompletedCall ? 'completed' : (isFailedCall ? 'failed' : (status || 'in-progress'));
              
              // Calculate proper started_at from ended_at - duration
              const endedAt = new Date();
              const startedAt = new Date(endedAt.getTime() - (callDuration * 1000));
              
              // Update existing record with call completion data and corrected from/to
              await db.execute(sql`
                UPDATE sip_calls SET
                  status = ${finalStatus},
                  duration_seconds = ${callDuration},
                  from_number = COALESCE(${callerPhoneNumber || null}, from_number),
                  to_number = COALESCE(${calledNumber || null}, to_number),
                  transcript = ${syncedData.rawTranscript ? JSON.stringify(syncedData.rawTranscript) : null}::jsonb,
                  sentiment = ${syncedData.sentiment || null},
                  classification = ${syncedData.classification || null},
                  metadata = ${JSON.stringify({ 
                    analysis, 
                    aiSummary: syncedData.aiSummary,
                    classification: syncedData.classification,
                    sentiment: syncedData.sentiment,
                    recordingUrl: syncedData.recordingUrl,
                  })}::jsonb,
                  recording_url = ${syncedData.recordingUrl || null},
                  ai_summary = ${syncedData.aiSummary || null},
                  started_at = COALESCE(started_at, ${startedAt}),
                  ended_at = ${endedAt},
                  updated_at = NOW()
                WHERE id = ${existingSipCall.id}
              `);
              console.log(`✅ [ElevenLabs SIP] Updated SIP call record: ${existingSipCall.id} (status: ${finalStatus}, sentiment: ${syncedData.sentiment || 'N/A'}, classification: ${syncedData.classification || 'N/A'})`);
              
              // Pre-call credit balance check for existing SIP calls
              if (isCompletedCall && callDuration > 0) {
                const { checkUserCreditBalance } = await import('../services/credit-service');
                const creditCheck = await checkUserCreditBalance(existingSipCall.user_id);
                
                if (!creditCheck.hasCredits) {
                  console.error(`🚫 [ElevenLabs SIP] User has 0 credits - marking call ${existingSipCall.id} as credit_failed`);
                  await db.execute(sql`
                    UPDATE sip_calls SET 
                      status = 'credit_failed',
                      metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true, creditError: 'Insufficient credits', creditBalance: 0 })}::jsonb,
                      updated_at = NOW()
                    WHERE id = ${existingSipCall.id}
                  `);
                  const { notifyCreditFailure } = await import('../services/credit-service');
                  notifyCreditFailure({
                    userId: existingSipCall.user_id,
                    callId: existingSipCall.id,
                    creditsRequired: Math.max(1, Math.ceil(callDuration / 60)),
                    currentBalance: 0,
                    durationSeconds: callDuration,
                  });
                  return res.sendStatus(200);
                }
                
                console.log(`💳 [ElevenLabs SIP] Processing credit deduction for ${callDuration}s call`);
                const creditResult = await deductSipCallCredits(existingSipCall.id, callDuration, 'elevenlabs-sip');
                if (creditResult.success || creditResult.alreadyDeducted) {
                  console.log(`✅ [ElevenLabs SIP] Credits deducted: ${creditResult.creditsDeducted}`);
                  
                  checkAndDisconnectIfLowCredits(existingSipCall.user_id).catch(err =>
                    console.error(`[SIP Credit Guard] Error: ${err.message}`)
                  );
                  
                  import('../engines/crm/lead-processor.service').then(({ CRMLeadProcessor }) => {
                    CRMLeadProcessor.processSipCall(existingSipCall.id)
                      .then((result) => {
                        if (result?.leadId) {
                          console.log(`📋 [CRM] Lead created from SIP call ${existingSipCall.id}: ${result.leadId} (${result.qualification.category})`);
                        } else if (result) {
                          console.log(`📋 [CRM] SIP call ${existingSipCall.id} did not qualify for CRM lead`);
                        }
                      })
                      .catch((err) => {
                        console.error(`❌ [CRM] Error processing SIP call ${existingSipCall.id} for lead:`, err.message);
                      });
                  }).catch((err) => {
                    console.error(`❌ [CRM] Failed to import lead processor:`, err.message);
                  });
                } else {
                  console.error(`❌ [ElevenLabs SIP] Credit deduction failed: ${creditResult.error}`);
                  await db.execute(sql`
                    UPDATE sip_calls SET 
                      status = 'credit_failed',
                      metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true })}::jsonb,
                      updated_at = NOW()
                    WHERE id = ${existingSipCall.id}
                  `);
                }
              } else if (!isCompletedCall) {
                console.log(`⚠️ [ElevenLabs SIP] Call ${finalStatus} - no credit deduction`);
              }

              // Trigger post-call messaging for completed SIP calls (fire-and-forget)
              if (isCompletedCall && callerPhoneNumber) {
                import('../services/post-call-messaging').then(({ triggerPostCallMessaging }) => {
                  triggerPostCallMessaging({
                    elevenLabsAgentId: agent_id,
                    userId: existingSipCall.user_id,
                    callerPhone: callerPhoneNumber,
                    callId: existingSipCall.id,
                  }).catch(err => console.error(`❌ [Post-Call Messaging] SIP update error: ${err.message}`));
                }).catch(err => console.error(`❌ [Post-Call Messaging] Import error: ${err.message}`));
              }

              return res.sendStatus(200);
            }
            
            // Find the SIP phone number that received/made the call
            // For SIP calls: agentNumber is ALWAYS the SIP phone number (your number)
            // Use it directly as the primary match, with fallbacks
            let sipPhoneNumber = null;
            const sipPhoneToMatch = agentNumber || (direction === 'inbound' ? calledNumber : callerPhoneNumber);
            
            console.log(`   Looking for SIP phone: ${sipPhoneToMatch || 'N/A'} (agentNumber: ${agentNumber || 'N/A'})`);
            
            if (sipPhoneToMatch) {
              const normalizeDigits = (phone: string) => phone.replace(/[^0-9]/g, '');
              const normalizedTarget = normalizeDigits(sipPhoneToMatch);
              
              const allSipPhones = await db
                .select()
                .from(sipPhoneNumbers)
                .where(eq(sipPhoneNumbers.userId, agent.userId));
              
              console.log(`   Found ${allSipPhones.length} SIP phones for user, matching against: ${normalizedTarget}`);
              
              sipPhoneNumber = allSipPhones.find(sp => {
                const normalizedSp = normalizeDigits(sp.phoneNumber);
                return normalizedSp.endsWith(normalizedTarget) || normalizedTarget.endsWith(normalizedSp);
              });
              
              if (sipPhoneNumber) {
                console.log(`   ✅ Matched SIP phone: ${sipPhoneNumber.phoneNumber} (ID: ${sipPhoneNumber.id})`);
              }
            }
            
            // Fallback: Get SIP phone from agent's sipPhoneNumberId
            if (!sipPhoneNumber && agent.sipPhoneNumberId) {
              console.log(`   Fallback: Using agent's sipPhoneNumberId: ${agent.sipPhoneNumberId}`);
              const [spn] = await db
                .select()
                .from(sipPhoneNumbers)
                .where(eq(sipPhoneNumbers.id, agent.sipPhoneNumberId))
                .limit(1);
              sipPhoneNumber = spn;
            }
            
            // Final fallback: Get SIP phone assigned to this agent
            if (!sipPhoneNumber) {
              console.log(`   Final fallback: Looking for SIP phone assigned to agent ${agent.id}`);
              const [spn] = await db
                .select()
                .from(sipPhoneNumbers)
                .where(eq(sipPhoneNumbers.agentId, agent.id))
                .limit(1);
              sipPhoneNumber = spn;
              if (sipPhoneNumber) {
                console.log(`   ✅ Found SIP phone by agent assignment: ${sipPhoneNumber.phoneNumber}`);
              }
            }
            
            if (!sipPhoneNumber) {
              console.warn(`⚠️ [ElevenLabs SIP] Could not find SIP phone number for agent ${agent.id}`);
              return res.sendStatus(200);
            }
            
            // FIX: Correct From/To for SIP calls based on resolved sipPhoneNumber
            // ElevenLabs metadata may put the SIP phone (agent number) in 'from' and external caller in 'to'
            // For inbound calls: from_number should be the external caller, to_number should be the SIP phone
            // For outbound calls: from_number should be the SIP phone, to_number should be the external caller
            const normalizeDigitsForCompare = (phone: string) => phone.replace(/[^0-9]/g, '');
            const sipPhoneDigits = normalizeDigitsForCompare(sipPhoneNumber.phoneNumber);
            const fromDigits = callerPhoneNumber ? normalizeDigitsForCompare(callerPhoneNumber) : '';
            const toDigits = calledNumber ? normalizeDigitsForCompare(calledNumber) : '';
            const fromIsSipPhone = fromDigits && (sipPhoneDigits.endsWith(fromDigits) || fromDigits.endsWith(sipPhoneDigits));
            const toIsSipPhone = toDigits && (sipPhoneDigits.endsWith(toDigits) || toDigits.endsWith(sipPhoneDigits));
            
            if (direction === 'inbound' && fromIsSipPhone && !toIsSipPhone) {
              console.log(`   🔄 Correcting inbound SIP From/To swap: SIP phone was in 'from', swapping`);
              const temp = callerPhoneNumber;
              callerPhoneNumber = calledNumber;
              calledNumber = temp || sipPhoneNumber.phoneNumber;
            } else if (direction === 'outbound' && toIsSipPhone && !fromIsSipPhone) {
              console.log(`   🔄 Correcting outbound SIP From/To swap: SIP phone was in 'to', swapping`);
              const temp = calledNumber;
              calledNumber = callerPhoneNumber;
              callerPhoneNumber = temp || sipPhoneNumber.phoneNumber;
            }
            console.log(`   SIP Call (corrected) - From: ${callerPhoneNumber || 'N/A'}, To: ${calledNumber || 'N/A'}`);
            
            // Use sync service to get transcript and analysis data
            const { callSyncService } = await import('../services/call-sync');
            const syncedData = await callSyncService.syncFromWebhook({
              conversationId: conversation_id,
              agentId: agent_id,
              transcript: webhookTranscript,
              analysis,
              metadata,
              status,
              callDurationSecs: callDuration,
            });
            
            // Determine final status based on webhook status
            // Only mark as completed if explicitly completed; otherwise preserve status or mark failed
            const isCompletedCall = status === 'completed' || status === 'done';
            const isFailedCall = status === 'failed' || status === 'error' || status === 'timeout' || status === 'no-answer';
            const finalStatus = isCompletedCall ? 'completed' : (isFailedCall ? 'failed' : (status || 'in-progress'));
            
            // Calculate proper timestamps
            const endedAt = new Date();
            const startedAt = new Date(endedAt.getTime() - (callDuration * 1000));
            
            const sipCallResult = await db.execute(sql`
              INSERT INTO sip_calls (
                user_id, agent_id, sip_trunk_id, sip_phone_number_id,
                engine, elevenlabs_conversation_id, from_number, to_number,
                direction, status, duration_seconds, transcript, sentiment, classification, metadata,
                recording_url, ai_summary, started_at, ended_at
              )
              VALUES (
                ${agent.userId}, ${agent.id}, ${sipPhoneNumber.sipTrunkId}, ${sipPhoneNumber.id},
                'elevenlabs-sip', ${conversation_id}, ${callerPhoneNumber || 'Unknown'}, ${calledNumber || sipPhoneNumber.phoneNumber},
                ${direction}, ${finalStatus}, ${callDuration}, 
                ${syncedData.rawTranscript ? JSON.stringify(syncedData.rawTranscript) : null}::jsonb,
                ${syncedData.sentiment || null},
                ${syncedData.classification || null},
                ${JSON.stringify({ 
                  analysis, 
                  classification: syncedData.classification,
                  sentiment: syncedData.sentiment,
                  agentName: agent.name 
                })}::jsonb,
                ${syncedData.recordingUrl || null},
                ${syncedData.aiSummary || null},
                ${startedAt}, ${endedAt}
              )
              RETURNING *
            `);
            
            const sipCallRecord = sipCallResult.rows[0] as any;
            console.log(`✅ [ElevenLabs SIP] Created SIP call record: ${sipCallRecord?.id} (status: ${finalStatus}, sentiment: ${syncedData.sentiment || 'N/A'}, classification: ${syncedData.classification || 'N/A'})`);
            
            // Credit balance check + deduction for completed SIP calls
            if (isCompletedCall && callDuration > 0 && sipCallRecord?.id) {
              const { checkUserCreditBalance } = await import('../services/credit-service');
              const creditCheck = await checkUserCreditBalance(agent.userId);
              
              if (!creditCheck.hasCredits) {
                console.error(`🚫 [ElevenLabs SIP] User has 0 credits - marking call ${sipCallRecord.id} as credit_failed`);
                await db.execute(sql`
                  UPDATE sip_calls SET 
                    status = 'credit_failed',
                    metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true, creditError: 'Insufficient credits', creditBalance: 0 })}::jsonb,
                    updated_at = NOW()
                  WHERE id = ${sipCallRecord.id}
                `);
                const { notifyCreditFailure } = await import('../services/credit-service');
                notifyCreditFailure({
                  userId: agent.userId,
                  callId: sipCallRecord.id,
                  creditsRequired: Math.max(1, Math.ceil(callDuration / 60)),
                  currentBalance: 0,
                  durationSeconds: callDuration,
                });
                return res.sendStatus(200);
              }
              
              console.log(`💳 [ElevenLabs SIP] Processing credit deduction for ${callDuration}s call`);
              const creditResult = await deductSipCallCredits(sipCallRecord.id, callDuration, 'elevenlabs-sip');
              if (creditResult.success || creditResult.alreadyDeducted) {
                console.log(`✅ [ElevenLabs SIP] Credits deducted: ${creditResult.creditsDeducted}`);
                
                checkAndDisconnectIfLowCredits(agent.userId).catch(err =>
                  console.error(`[SIP Credit Guard] Error: ${err.message}`)
                );
                
                import('../engines/crm/lead-processor.service').then(({ CRMLeadProcessor }) => {
                  CRMLeadProcessor.processSipCall(sipCallRecord.id)
                    .then((result) => {
                      if (result?.leadId) {
                        console.log(`📋 [CRM] Lead created from SIP call ${sipCallRecord.id}: ${result.leadId} (${result.qualification.category})`);
                      } else if (result) {
                        console.log(`📋 [CRM] SIP call ${sipCallRecord.id} did not qualify for CRM lead`);
                      }
                    })
                    .catch((err) => {
                      console.error(`❌ [CRM] Error processing SIP call ${sipCallRecord.id} for lead:`, err.message);
                    });
                }).catch((err) => {
                  console.error(`❌ [CRM] Failed to import lead processor:`, err.message);
                });
              } else {
                console.error(`❌ [ElevenLabs SIP] Credit deduction failed: ${creditResult.error}`);
                await db.execute(sql`
                  UPDATE sip_calls SET 
                    status = 'credit_failed',
                    metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true })}::jsonb,
                    updated_at = NOW()
                  WHERE id = ${sipCallRecord.id}
                `);
              }
            } else if (!isCompletedCall) {
              console.log(`⚠️ [ElevenLabs SIP] Call ${finalStatus} - no credit deduction`);
            }

            // Trigger post-call messaging for completed SIP calls (fire-and-forget)
            if (isCompletedCall && callerPhoneNumber && sipCallRecord?.id) {
              import('../services/post-call-messaging').then(({ triggerPostCallMessaging }) => {
                triggerPostCallMessaging({
                  elevenLabsAgentId: agent_id,
                  userId: agent.userId,
                  callerPhone: callerPhoneNumber,
                  callId: sipCallRecord.id,
                }).catch(err => console.error(`❌ [Post-Call Messaging] SIP create error: ${err.message}`));
              }).catch(err => console.error(`❌ [Post-Call Messaging] Import error: ${err.message}`));
            }

            return res.sendStatus(200);
          }
          } catch (sipCase0Error: any) {
            console.error(`❌ [ElevenLabs SIP CASE 0] Error processing SIP call (non-fatal, continuing): ${sipCase0Error.message}`);
          }
          
          // CASE 0.5: SIP phone number fallback - check if phone is a SIP number even if agent doesn't have elevenlabs-sip provider
          // This catches calls where the SIP phone number is configured but agent's telephonyProvider isn't set correctly
          // SECURITY: Only proceed if we have agent context to ensure proper tenant scoping
          // ISOLATION: Wrapped in try/catch so failures here never block CASE 1/2 from creating call records
          try {
          if (agent && agent.userId) {
            // Normalize to digits only for comparison
            const extractedFromDigits = extractedFromNumber ? extractedFromNumber.replace(/[^0-9]/g, '') : '';
            const extractedToDigits = extractedToNumber ? extractedToNumber.replace(/[^0-9]/g, '') : '';
            
            // Only proceed if we have valid phone numbers with at least 10 digits (to avoid false matches)
            const validFromDigits = extractedFromDigits.length >= 10 ? extractedFromDigits : '';
            const validToDigits = extractedToDigits.length >= 10 ? extractedToDigits : '';
            
            if (!validFromDigits && !validToDigits) {
              console.log(`📞 [ElevenLabs SIP Fallback] Skipping - no valid phone numbers (from: ${extractedFromDigits.length} digits, to: ${extractedToDigits.length} digits)`);
            } else {
            
            // Look for SIP phone number scoped to the agent's user
            // This ensures tenant isolation - we only match SIP numbers belonging to this user
            const sipPhoneResult = await db.execute(sql`
              SELECT sp.*, st.user_id as trunk_user_id
              FROM sip_phone_numbers sp
              LEFT JOIN sip_trunks st ON sp.sip_trunk_id = st.id
              WHERE sp.is_active = true
              AND (
                -- Exact suffix match: last 10 digits must match exactly
                (${validFromDigits} != '' AND RIGHT(REGEXP_REPLACE(sp.phone_number, '[^0-9]', '', 'g'), 10) = RIGHT(${validFromDigits}, 10))
                OR
                (${validToDigits} != '' AND RIGHT(REGEXP_REPLACE(sp.phone_number, '[^0-9]', '', 'g'), 10) = RIGHT(${validToDigits}, 10))
              )
              -- TENANT SCOPING: Only match SIP numbers belonging to this user's trunks
              AND st.user_id::text = ${agent.userId}::text
              LIMIT 1
            `);
            
            const matchedSipPhone = sipPhoneResult.rows[0] as any;
            
            if (matchedSipPhone) {
              console.log(`📞 [ElevenLabs SIP Fallback] Found SIP phone number: ${matchedSipPhone.phone_number} (user: ${agent.userId})`);
              
              const direction = metadata?.phone_call?.direction || 'inbound';
              const callDuration = metadata?.call_duration_secs || 0;
              const terminationReason = metadata?.termination_reason || null;
              const errorInfo = metadata?.error || null;
              
              // FIX: Correct From/To for SIP calls based on resolved sipPhoneNumber
              let sipFallbackFrom = extractedFromNumber;
              let sipFallbackTo = extractedToNumber;
              const sipFbDigits = matchedSipPhone.phone_number.replace(/[^0-9]/g, '');
              const sipFbFromDigits = sipFallbackFrom ? sipFallbackFrom.replace(/[^0-9]/g, '') : '';
              const sipFbToDigits = sipFallbackTo ? sipFallbackTo.replace(/[^0-9]/g, '') : '';
              const sipFbFromIsSip = sipFbFromDigits && (sipFbDigits.endsWith(sipFbFromDigits) || sipFbFromDigits.endsWith(sipFbDigits));
              const sipFbToIsSip = sipFbToDigits && (sipFbDigits.endsWith(sipFbToDigits) || sipFbToDigits.endsWith(sipFbDigits));
              
              if (direction === 'inbound' && sipFbFromIsSip && !sipFbToIsSip) {
                console.log(`   🔄 Correcting inbound SIP Fallback From/To swap`);
                const temp = sipFallbackFrom;
                sipFallbackFrom = sipFallbackTo;
                sipFallbackTo = temp || matchedSipPhone.phone_number;
              } else if (direction === 'outbound' && sipFbToIsSip && !sipFbFromIsSip) {
                console.log(`   🔄 Correcting outbound SIP Fallback From/To swap`);
                const temp = sipFallbackTo;
                sipFallbackTo = sipFallbackFrom;
                sipFallbackFrom = temp || matchedSipPhone.phone_number;
              }
              
              // Check for existing SIP call record
              const existingSipCallResult = await db.execute(sql`
                SELECT * FROM sip_calls WHERE elevenlabs_conversation_id = ${conversation_id} LIMIT 1
              `);
              const existingSipCall = existingSipCallResult.rows[0] as any;
              
              if (existingSipCall) {
                // Status downgrade protection
                const terminalStatuses = ['completed', 'failed'];
                if (terminalStatuses.includes(existingSipCall.status)) {
                  console.log(`   SIP call already in terminal status '${existingSipCall.status}' - skipping update`);
                  return res.sendStatus(200);
                }
              }
              
              // Determine final status
              const isCompletedCall = status === 'completed' || status === 'done';
              const isFailedCall = status === 'failed' || status === 'error' || status === 'timeout' || status === 'no-answer' || !!errorInfo;
              const finalStatus = isCompletedCall ? 'completed' : (isFailedCall ? 'failed' : (status || 'in-progress'));
              
              // Get transcript data
              const { callSyncService } = await import('../services/call-sync');
              const syncedData = await callSyncService.syncFromWebhook({
                conversationId: conversation_id,
                agentId: agent_id,
                transcript: webhookTranscript,
                analysis,
                metadata,
                status,
                callDurationSecs: callDuration,
              });
              
              const endedAt = new Date();
              const startedAt = new Date(endedAt.getTime() - (callDuration * 1000));
              
              // Find the associated agent
              const agentForSip = agent || null;
              const userId = matchedSipPhone.trunk_user_id || matchedSipPhone.user_id || agentForSip?.userId;
              
              if (!userId) {
                console.warn(`⚠️ [ElevenLabs SIP Fallback] Could not determine user for SIP call`);
                return res.sendStatus(200);
              }
              
              if (existingSipCall) {
                // Update existing record with corrected from/to
                await db.execute(sql`
                  UPDATE sip_calls SET
                    status = ${finalStatus},
                    duration_seconds = ${callDuration},
                    from_number = COALESCE(${sipFallbackFrom || null}, from_number),
                    to_number = COALESCE(${sipFallbackTo || null}, to_number),
                    transcript = ${syncedData.rawTranscript ? JSON.stringify(syncedData.rawTranscript) : null}::jsonb,
                    sentiment = ${syncedData.sentiment || null},
                    classification = ${syncedData.classification || null},
                    metadata = ${JSON.stringify({ 
                      analysis, 
                      aiSummary: syncedData.aiSummary,
                      classification: syncedData.classification,
                      sentiment: syncedData.sentiment,
                      recordingUrl: syncedData.recordingUrl,
                      terminationReason,
                      error: errorInfo,
                    })}::jsonb,
                    recording_url = ${syncedData.recordingUrl || null},
                    ai_summary = ${syncedData.aiSummary || null},
                    started_at = COALESCE(started_at, ${startedAt}),
                    ended_at = ${endedAt},
                    updated_at = NOW()
                  WHERE id = ${existingSipCall.id}
                `);
                console.log(`✅ [ElevenLabs SIP Fallback] Updated SIP call record: ${existingSipCall.id} (status: ${finalStatus}, sentiment: ${syncedData.sentiment || 'N/A'}, classification: ${syncedData.classification || 'N/A'})`);
                
                // Credit check + deduction for completed calls only
                if (isCompletedCall && callDuration > 0 && !errorInfo) {
                  const { checkUserCreditBalance } = await import('../services/credit-service');
                  const creditCheck = await checkUserCreditBalance(userId);
                  
                  if (!creditCheck.hasCredits) {
                    console.error(`🚫 [ElevenLabs SIP Fallback] User has 0 credits - marking call ${existingSipCall.id} as credit_failed`);
                    await db.execute(sql`
                      UPDATE sip_calls SET status = 'credit_failed',
                        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true, creditError: 'Insufficient credits', creditBalance: 0 })}::jsonb,
                        updated_at = NOW()
                      WHERE id = ${existingSipCall.id}
                    `);
                    const { notifyCreditFailure } = await import('../services/credit-service');
                    notifyCreditFailure({
                      userId,
                      callId: existingSipCall.id,
                      creditsRequired: Math.max(1, Math.ceil(callDuration / 60)),
                      currentBalance: 0,
                      durationSeconds: callDuration,
                    });
                  } else {
                    const creditResult = await deductSipCallCredits(existingSipCall.id, callDuration, 'elevenlabs-sip');
                    if (creditResult.success || creditResult.alreadyDeducted) {
                      console.log(`✅ [ElevenLabs SIP Fallback] Credits deducted: ${creditResult.creditsDeducted}`);
                      
                      checkAndDisconnectIfLowCredits(userId).catch(err =>
                        console.error(`[SIP Credit Guard] Error: ${err.message}`)
                      );
                      
                      import('../engines/crm/lead-processor.service').then(({ CRMLeadProcessor }) => {
                        CRMLeadProcessor.processSipCall(existingSipCall.id)
                          .then((result) => {
                            if (result?.leadId) {
                              console.log(`📋 [CRM] Lead created from SIP call ${existingSipCall.id}: ${result.leadId} (${result.qualification.category})`);
                            }
                          })
                          .catch((err) => {
                            console.error(`❌ [CRM] Error processing SIP call for lead:`, err.message);
                          });
                      }).catch(() => {});
                    } else {
                      await db.execute(sql`
                        UPDATE sip_calls SET status = 'credit_failed',
                          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true })}::jsonb,
                          updated_at = NOW()
                        WHERE id = ${existingSipCall.id}
                      `);
                    }
                  }
                } else if (errorInfo) {
                  console.log(`⚠️ [ElevenLabs SIP Fallback] Skipping credit deduction due to error: ${JSON.stringify(errorInfo)}`);
                }
              } else {
                const sipCallResult = await db.execute(sql`
                  INSERT INTO sip_calls (
                    user_id, agent_id, sip_trunk_id, sip_phone_number_id,
                    engine, elevenlabs_conversation_id, from_number, to_number,
                    direction, status, duration_seconds, transcript, sentiment, classification, metadata,
                    recording_url, ai_summary, started_at, ended_at
                  )
                  VALUES (
                    ${userId}, ${agentForSip?.id || null}, ${matchedSipPhone.sipTrunkId || matchedSipPhone.sip_trunk_id}, ${matchedSipPhone.id},
                    'elevenlabs-sip', ${conversation_id}, ${sipFallbackFrom || 'Unknown'}, ${sipFallbackTo || matchedSipPhone.phone_number},
                    ${direction}, ${finalStatus}, ${callDuration}, 
                    ${syncedData.rawTranscript ? JSON.stringify(syncedData.rawTranscript) : null}::jsonb,
                    ${syncedData.sentiment || null},
                    ${syncedData.classification || null},
                    ${JSON.stringify({ 
                      analysis, 
                      classification: syncedData.classification,
                      sentiment: syncedData.sentiment,
                      agentName: agentForSip?.name || 'Unknown',
                      terminationReason,
                      error: errorInfo,
                    })}::jsonb,
                    ${syncedData.recordingUrl || null},
                    ${syncedData.aiSummary || null},
                    ${startedAt}, ${endedAt}
                  )
                  RETURNING *
                `);
                
                const sipCallRecord = sipCallResult.rows[0] as any;
                console.log(`✅ [ElevenLabs SIP Fallback] Created SIP call record: ${sipCallRecord?.id} (status: ${finalStatus}, sentiment: ${syncedData.sentiment || 'N/A'}, classification: ${syncedData.classification || 'N/A'})`);
                
                // Credit check + deduction for completed calls only
                if (isCompletedCall && callDuration > 0 && sipCallRecord?.id && !errorInfo) {
                  const { checkUserCreditBalance } = await import('../services/credit-service');
                  const creditCheck = await checkUserCreditBalance(userId);
                  
                  if (!creditCheck.hasCredits) {
                    console.error(`🚫 [ElevenLabs SIP Fallback] User has 0 credits - marking call ${sipCallRecord.id} as credit_failed`);
                    await db.execute(sql`
                      UPDATE sip_calls SET status = 'credit_failed',
                        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true, creditError: 'Insufficient credits', creditBalance: 0 })}::jsonb,
                        updated_at = NOW()
                      WHERE id = ${sipCallRecord.id}
                    `);
                    const { notifyCreditFailure } = await import('../services/credit-service');
                    notifyCreditFailure({
                      userId,
                      callId: sipCallRecord.id,
                      creditsRequired: Math.max(1, Math.ceil(callDuration / 60)),
                      currentBalance: 0,
                      durationSeconds: callDuration,
                    });
                  } else {
                    const creditResult = await deductSipCallCredits(sipCallRecord.id, callDuration, 'elevenlabs-sip');
                    if (creditResult.success || creditResult.alreadyDeducted) {
                      console.log(`✅ [ElevenLabs SIP Fallback] Credits deducted: ${creditResult.creditsDeducted}`);
                      
                      checkAndDisconnectIfLowCredits(userId).catch(err =>
                        console.error(`[SIP Credit Guard] Error: ${err.message}`)
                      );
                      
                      import('../engines/crm/lead-processor.service').then(({ CRMLeadProcessor }) => {
                        CRMLeadProcessor.processSipCall(sipCallRecord.id)
                          .then((result) => {
                            if (result?.leadId) {
                              console.log(`📋 [CRM] Lead created from SIP call ${sipCallRecord.id}: ${result.leadId} (${result.qualification.category})`);
                            }
                          })
                          .catch((err) => {
                            console.error(`❌ [CRM] Error processing SIP call for lead:`, err.message);
                          });
                      }).catch(() => {});
                    } else {
                      await db.execute(sql`
                        UPDATE sip_calls SET status = 'credit_failed',
                          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true })}::jsonb,
                          updated_at = NOW()
                        WHERE id = ${sipCallRecord.id}
                      `);
                    }
                  }
                } else if (errorInfo) {
                  console.log(`⚠️ [ElevenLabs SIP Fallback] Skipping credit deduction due to error: ${JSON.stringify(errorInfo)}`);
                }
              }
              
              return res.sendStatus(200);
            }
            } // Close the else block (valid phone digits)
          }
          } catch (sipFallbackError: any) {
            console.warn(`⚠️ [ElevenLabs SIP Fallback] Error in SIP phone lookup (non-fatal, continuing to CASE 1/2): ${sipFallbackError.message}`);
          }
          
          // CASE 1: Outbound campaign/flow agent - create fallback record
          // This handles cases where batch call record wasn't pre-created or phone format mismatch
          if (agent && (agent.type === 'natural' || agent.type === 'flow')) {
            console.log(`   Found campaign agent: ${agent.name} (${agent.type})`);
            
            // Use extracted phone number (already checked all nested locations)
            const webhookPhoneNumber = extractedToNumber || extractedFromNumber;
            
            if (webhookPhoneNumber) {
              console.log(`   Creating fallback outbound call record for: ${webhookPhoneNumber}`);
              
              // Find a campaign using this agent
              let campaignMatch: any = null;
              try {
                const [cm] = await db
                  .select()
                  .from(campaigns)
                  .where(eq(campaigns.agentId, agent.id))
                  .orderBy(sql`${campaigns.startedAt} DESC NULLS LAST`)
                  .limit(1);
                campaignMatch = cm;
              } catch (campaignLookupErr: any) {
                if (isTypeMismatchError(campaignLookupErr)) {
                  console.warn(`[ElevenLabs Webhook] Type mismatch on campaign lookup, retrying with raw SQL`);
                  const cmResult = await db.execute(sql`
                    SELECT * FROM campaigns WHERE agent_id::text = ${agent.id}::text
                    ORDER BY started_at DESC NULLS LAST LIMIT 1
                  `);
                  campaignMatch = cmResult.rows[0] as any;
                } else {
                  console.warn(`[ElevenLabs Webhook] Campaign lookup failed:`, campaignLookupErr.message);
                }
              }
              
              // Use sync service to get combined data
              const { callSyncService } = await import('../services/call-sync');
              const syncedData = await callSyncService.syncFromWebhook({
                conversationId: conversation_id,
                agentId: agent_id,
                transcript: webhookTranscript,
                analysis,
                metadata,
                status,
                callDurationSecs: metadata?.call_duration_secs,
              });
              
              // Create fallback call record with proper user ownership
              const outboundCallValues = {
                userId: campaignMatch?.userId || campaignMatch?.user_id || agent.userId,
                campaignId: campaignMatch?.id || null,
                contactId: null,
                phoneNumber: syncedData.phoneNumber || webhookPhoneNumber,
                fromNumber: extractedFromNumber || null,
                toNumber: extractedToNumber || webhookPhoneNumber || null,
                status: 'completed',
                callDirection: 'outgoing',
                elevenLabsConversationId: conversation_id,
                twilioSid: extractedCallSid || null,
                duration: syncedData.duration,
                transcript: syncedData.transcript,
                aiSummary: syncedData.aiSummary,
                classification: syncedData.classification,
                recordingUrl: syncedData.recordingUrl,
                endedAt: new Date(),
                metadata: {
                  ...syncedData.metadata,
                  agentName: agent.name,
                  agentType: agent.type,
                  createdFromWebhook: true,
                  fallbackRecord: true,
                },
              };
              
              let newCallRecord;
              try {
                [newCallRecord] = await db
                  .insert(calls)
                  .values(outboundCallValues)
                  .returning();
              } catch (insertError: any) {
                if (isTypeMismatchError(insertError)) {
                  console.warn(`[ElevenLabs Webhook] Type mismatch on outbound INSERT, retrying with raw SQL and uuid casting`);
                  const metadataJson = JSON.stringify(outboundCallValues.metadata);
                  const rawResult = await db.execute(sql`
                    INSERT INTO calls (
                      user_id, campaign_id, contact_id, phone_number, from_number, to_number,
                      status, call_direction, elevenlabs_conversation_id, twilio_sid,
                      duration, transcript, ai_summary, classification, recording_url, ended_at, metadata
                    ) VALUES (
                      ${outboundCallValues.userId}::text, ${outboundCallValues.campaignId}::text, NULL,
                      ${outboundCallValues.phoneNumber}, ${outboundCallValues.fromNumber}, ${outboundCallValues.toNumber},
                      ${outboundCallValues.status}, ${outboundCallValues.callDirection},
                      ${outboundCallValues.elevenLabsConversationId}, ${outboundCallValues.twilioSid},
                      ${outboundCallValues.duration}::int, ${outboundCallValues.transcript}, ${outboundCallValues.aiSummary},
                      ${outboundCallValues.classification}, ${outboundCallValues.recordingUrl},
                      ${outboundCallValues.endedAt}, ${metadataJson}::jsonb
                    ) RETURNING *
                  `);
                  newCallRecord = rawResult.rows[0] as any;
                } else {
                  throw insertError;
                }
              }
              
              callRecord = newCallRecord;
              console.log(`✅ [ElevenLabs Webhook] Created fallback outbound call record: ${callRecord.id}`);
              
              // Create flow execution record for flow-based fallback calls
              if (agent.flowId) {
                try {
                  const { nanoid } = await import('nanoid');
                  const executionId = nanoid();
                  await db.insert(flowExecutions).values({
                    id: executionId,
                    callId: callRecord.id,
                    flowId: agent.flowId,
                    currentNodeId: null,
                    status: 'completed', // Fallback calls are already completed
                    variables: analysis?.data_collection || {},
                    pathTaken: [],
                    startedAt: new Date(),
                    completedAt: new Date(),
                    metadata: {
                      campaignId: campaignMatch?.id || null,
                      campaignName: campaignMatch?.name || null,
                      contactPhone: webhookPhoneNumber,
                      nativeExecution: true,
                      telephonyProvider: 'elevenlabs',
                      fallbackRecord: true,
                      conversationId: conversation_id,
                    },
                  });
                  console.log(`🔀 [ElevenLabs Webhook] Created flow execution for fallback call: ${executionId}`);
                } catch (flowExecError: any) {
                  console.warn(`⚠️ [ElevenLabs Webhook] Error creating flow execution for fallback:`, flowExecError.message);
                }
              }
            }
          }
          
          // CASE 2: Incoming agent - create new incoming call record
          if (!callRecord && agent && agent.type === 'incoming') {
            console.log(`   Found incoming agent: ${agent.name}`);
            
            // USE EXTRACTED PHONE NUMBERS (already checked all nested locations: phone_call, batch_call, direct)
            const callerPhoneNumber = extractedFromNumber;
            const calledNumber = extractedToNumber;
            
            console.log(`   Using extracted phone data - From: ${callerPhoneNumber || 'N/A'}, To: ${calledNumber || 'N/A'}`);
            
            // CRITICAL: Find the incoming connection by the CALLED phone number (to_number)
            // This ensures we link to the correct connection when an agent has multiple
            let connection: any = null;
            
            try {
              if (calledNumber) {
                const [matchedConnection] = await db
                  .select({
                    id: incomingConnections.id,
                    phoneNumberId: incomingConnections.phoneNumberId,
                    userId: incomingConnections.userId,
                    phoneNumber: {
                      phoneNumber: phoneNumbers.phoneNumber,
                      friendlyName: phoneNumbers.friendlyName,
                    }
                  })
                  .from(incomingConnections)
                  .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
                  .where(
                    and(
                      eq(incomingConnections.agentId, agent.id),
                      eq(phoneNumbers.phoneNumber, calledNumber)
                    )
                  )
                  .limit(1);
                
                connection = matchedConnection;
              }
              
              if (!connection) {
                const [fallbackConnection] = await db
                  .select({
                    id: incomingConnections.id,
                    phoneNumberId: incomingConnections.phoneNumberId,
                    userId: incomingConnections.userId,
                    phoneNumber: {
                      phoneNumber: phoneNumbers.phoneNumber,
                      friendlyName: phoneNumbers.friendlyName,
                    }
                  })
                  .from(incomingConnections)
                  .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
                  .where(eq(incomingConnections.agentId, agent.id))
                  .limit(1);
                
                connection = fallbackConnection;
                if (connection) {
                  console.warn(`   ⚠️ Using fallback connection - could not match by phone number`);
                }
              }
            } catch (connLookupError: any) {
              if (isTypeMismatchError(connLookupError)) {
                console.warn(`[ElevenLabs Webhook] Type mismatch on connection lookup, retrying with raw SQL and uuid casting`);
                try {
                  const connQuery = calledNumber
                    ? sql`SELECT ic.id, ic.phone_number_id AS "phoneNumberId", ic.user_id AS "userId",
                           pn.phone_number AS "phoneNumber", pn.friendly_name AS "friendlyName"
                         FROM incoming_connections ic
                         LEFT JOIN phone_numbers pn ON ic.phone_number_id::text = pn.id::text
                         WHERE ic.agent_id::text = ${agent.id}::text AND pn.phone_number = ${calledNumber}
                         LIMIT 1`
                    : sql`SELECT ic.id, ic.phone_number_id AS "phoneNumberId", ic.user_id AS "userId",
                           pn.phone_number AS "phoneNumber", pn.friendly_name AS "friendlyName"
                         FROM incoming_connections ic
                         LEFT JOIN phone_numbers pn ON ic.phone_number_id::text = pn.id::text
                         WHERE ic.agent_id::text = ${agent.id}::text
                         LIMIT 1`;
                  const connResult = await db.execute(connQuery);
                  if (connResult.rows.length > 0) {
                    const row = connResult.rows[0] as any;
                    connection = {
                      id: row.id,
                      phoneNumberId: row.phoneNumberId,
                      userId: row.userId,
                      phoneNumber: { phoneNumber: row.phoneNumber, friendlyName: row.friendlyName },
                    };
                  }
                } catch (rawSqlError: any) {
                  console.warn(`[ElevenLabs Webhook] Raw SQL connection lookup also failed:`, rawSqlError.message);
                }
              } else {
                console.warn(`[ElevenLabs Webhook] Connection lookup failed:`, connLookupError.message);
              }
            }
            
            // Use sync service to get combined data from both ElevenLabs and Twilio
            const { callSyncService } = await import('../services/call-sync');
            const syncedData = await callSyncService.syncFromWebhook({
              conversationId: conversation_id,
              agentId: agent_id,
              transcript: webhookTranscript,
              analysis,
              metadata,
              status,
              callDurationSecs: metadata?.call_duration_secs,
            });
            
            // Use synced phone number (from Twilio or ElevenLabs) - fallback to 'Unknown Caller' if not available
            const finalPhoneNumber = syncedData.phoneNumber || callerPhoneNumber || 'Unknown Caller';
            const finalCalledNumber = syncedData.calledNumber || calledNumber || connection?.phoneNumber?.phoneNumber || 'Unknown';
            
            // Create call record even if phone number is unknown - data is valuable
            // CRITICAL: Always ensure userId is populated for proper user data isolation
            // Priority: connection owner > agent owner (never null)
            const resolvedUserId = connection?.userId || agent.userId;
            if (!resolvedUserId) {
              console.warn(`   ⚠️ Cannot determine userId - call will have orphaned ownership`);
            }
            
            console.log(`   Creating incoming call record with:`);
            console.log(`     Phone: ${finalPhoneNumber}`);
            console.log(`     Called: ${finalCalledNumber}`);
            console.log(`     Duration: ${syncedData.duration || metadata?.call_duration_secs || 'N/A'}s`);
            console.log(`     Transcript: ${syncedData.transcript ? 'present' : 'N/A'}`);
            console.log(`     AI Summary: ${syncedData.aiSummary ? 'present' : 'N/A'}`);
            
            let newCallRecord;
            const callValues = {
              userId: resolvedUserId,
              campaignId: null,
              contactId: null,
              incomingConnectionId: connection?.id || null,
              incomingAgentId: null,
              phoneNumber: finalPhoneNumber,
              fromNumber: finalPhoneNumber,
              toNumber: finalCalledNumber,
              status: 'completed',
              callDirection: 'incoming',
              elevenLabsConversationId: conversation_id,
              twilioSid: extractedCallSid || null,
              duration: syncedData.duration || metadata?.call_duration_secs || null,
              transcript: syncedData.transcript,
              aiSummary: syncedData.aiSummary,
              classification: syncedData.classification,
              recordingUrl: syncedData.recordingUrl,
              endedAt: new Date(),
              metadata: {
                ...syncedData.metadata,
                incomingAgentName: agent.name,
                calledNumber: finalCalledNumber,
                agentType: 'incoming',
                createdFromWebhook: true,
                connectionMatched: !!connection && !!calledNumber,
                webhookMetadata: metadata,
              },
            };
            
            try {
              [newCallRecord] = await db
                .insert(calls)
                .values(callValues)
                .returning();
            } catch (insertError: any) {
              if (isTypeMismatchError(insertError)) {
                console.warn(`[ElevenLabs Webhook] Type mismatch on incoming INSERT, retrying with raw SQL and uuid casting`);
                const metadataJson = JSON.stringify(callValues.metadata);
                const rawResult = await db.execute(sql`
                  INSERT INTO calls (
                    user_id, campaign_id, contact_id, incoming_connection_id, incoming_agent_id,
                    phone_number, from_number, to_number, status, call_direction,
                    elevenlabs_conversation_id, twilio_sid, duration, transcript, ai_summary,
                    classification, recording_url, ended_at, metadata
                  ) VALUES (
                    ${callValues.userId}::text, NULL, NULL, ${callValues.incomingConnectionId}::text, NULL,
                    ${callValues.phoneNumber}, ${callValues.fromNumber}, ${callValues.toNumber},
                    ${callValues.status}, ${callValues.callDirection},
                    ${callValues.elevenLabsConversationId}, ${callValues.twilioSid},
                    ${callValues.duration}::int, ${callValues.transcript}, ${callValues.aiSummary},
                    ${callValues.classification}, ${callValues.recordingUrl},
                    ${callValues.endedAt}, ${metadataJson}::jsonb
                  ) RETURNING *
                `);
                newCallRecord = rawResult.rows[0] as any;
              } else {
                throw insertError;
              }
            }
            
            callRecord = newCallRecord;
            console.log(`✅ [ElevenLabs Webhook] Created incoming call record: ${callRecord.id}`);
          }
        }
      } catch (createError: any) {
        console.error(`❌ [ElevenLabs Webhook] Error creating incoming call record:`, createError);
      }
    }
    
    // CASE 3: Failed call tracking - create record for calls that failed immediately (payment errors, etc.)
    // This ensures even failed calls are visible in call history
    if (!callRecord && agent_id && metadata?.error) {
      const errorInfo = metadata.error;
      const terminationReason = metadata.termination_reason || 'Unknown error';
      console.log(`📞 [ElevenLabs Webhook] Creating failed call record for error: ${terminationReason}`);
      
      try {
        // Look up agent fresh for this scope
        const [failedCallAgent] = await db
          .select()
          .from(agents)
          .where(eq(agents.elevenLabsAgentId, agent_id))
          .limit(1);
        
        if (!failedCallAgent) {
          console.warn(`⚠️ [ElevenLabs Webhook] Cannot create failed call record - agent not found: ${agent_id}`);
        } else {
        const callDirection = metadata?.phone_call?.direction || 'inbound';
        const callerPhoneNumber = extractedFromNumber || 'Unknown';
        const calledNumber = extractedToNumber || 'Unknown';
        const callDuration = metadata?.call_duration_secs || 0;
        
        // Try to get sync data even for failed calls
        const { callSyncService } = await import('../services/call-sync');
        const syncedData = await callSyncService.syncFromWebhook({
          conversationId: conversation_id,
          agentId: agent_id,
          transcript: webhookTranscript,
          analysis,
          metadata,
          status: 'failed',
          callDurationSecs: callDuration,
        });
        
        // Check if this is a SIP agent - create SIP call record
        if (failedCallAgent.telephonyProvider === 'elevenlabs-sip') {
          // Look for SIP phone number
          const [sipPhoneNumber] = await db
            .select()
            .from(sipPhoneNumbers)
            .where(eq(sipPhoneNumbers.agentId, failedCallAgent.id))
            .limit(1);
          
          if (sipPhoneNumber) {
            const endedAt = new Date();
            const startedAt = new Date(endedAt.getTime() - (callDuration * 1000));
            
            // FIX: Correct From/To for failed SIP calls
            let failedFrom = callerPhoneNumber;
            let failedTo = calledNumber;
            const failedSipDigits = sipPhoneNumber.phoneNumber.replace(/[^0-9]/g, '');
            const failedFromDigits = failedFrom ? failedFrom.replace(/[^0-9]/g, '') : '';
            const failedToDigits = failedTo ? failedTo.replace(/[^0-9]/g, '') : '';
            const failedFromIsSip = failedFromDigits && (failedSipDigits.endsWith(failedFromDigits) || failedFromDigits.endsWith(failedSipDigits));
            const failedToIsSip = failedToDigits && (failedSipDigits.endsWith(failedToDigits) || failedToDigits.endsWith(failedSipDigits));
            
            if (callDirection === 'inbound' && failedFromIsSip && !failedToIsSip) {
              const temp = failedFrom;
              failedFrom = failedTo;
              failedTo = temp || sipPhoneNumber.phoneNumber;
            } else if (callDirection === 'outbound' && failedToIsSip && !failedFromIsSip) {
              const temp = failedTo;
              failedTo = failedFrom;
              failedFrom = temp || sipPhoneNumber.phoneNumber;
            }
            
            await db.execute(sql`
              INSERT INTO sip_calls (
                user_id, agent_id, sip_trunk_id, sip_phone_number_id,
                engine, elevenlabs_conversation_id, from_number, to_number,
                direction, status, duration_seconds, transcript, metadata,
                ai_summary, started_at, ended_at
              )
              VALUES (
                ${failedCallAgent.userId}, ${failedCallAgent.id}, ${sipPhoneNumber.sipTrunkId}, ${sipPhoneNumber.id},
                'elevenlabs-sip', ${conversation_id}, ${failedFrom}, ${failedTo},
                ${callDirection}, 'failed', ${callDuration},
                ${syncedData.rawTranscript ? JSON.stringify(syncedData.rawTranscript) : null}::jsonb,
                ${JSON.stringify({ 
                  error: errorInfo,
                  terminationReason,
                  agentName: failedCallAgent.name,
                  failedCall: true,
                })}::jsonb,
                ${syncedData.aiSummary || terminationReason},
                ${startedAt}, ${endedAt}
              )
            `);
            console.log(`✅ [ElevenLabs Webhook] Created failed SIP call record for: ${conversation_id}`);
            await recordWebhookReceived('elevenlabs');
            return res.sendStatus(200);
          }
        }
        
        // For non-SIP agents, create regular call record
        const failedCallValues = {
          userId: failedCallAgent.userId,
          campaignId: null,
          contactId: null,
          phoneNumber: calledNumber !== 'Unknown' ? calledNumber : callerPhoneNumber,
          fromNumber: callerPhoneNumber,
          toNumber: calledNumber,
          status: 'failed',
          callDirection: callDirection === 'outbound' ? 'outgoing' : 'incoming',
          elevenLabsConversationId: conversation_id,
          twilioSid: extractedCallSid || null,
          duration: callDuration,
          transcript: syncedData.transcript,
          aiSummary: syncedData.aiSummary || terminationReason,
          classification: 'failed',
          endedAt: new Date(),
          metadata: {
            error: errorInfo,
            terminationReason,
            agentName: failedCallAgent.name,
            failedCall: true,
            createdFromWebhook: true,
          },
        };
        let failedCallRecord;
        try {
          [failedCallRecord] = await db
            .insert(calls)
            .values(failedCallValues)
            .returning();
        } catch (failedInsertErr: any) {
          if (isTypeMismatchError(failedInsertErr)) {
            console.warn(`[ElevenLabs Webhook] Type mismatch on failed call INSERT, retrying with raw SQL`);
            const metaJson = JSON.stringify(failedCallValues.metadata);
            const rawResult = await db.execute(sql`
              INSERT INTO calls (
                user_id, campaign_id, contact_id, phone_number, from_number, to_number,
                status, call_direction, elevenlabs_conversation_id, twilio_sid,
                duration, transcript, ai_summary, classification, ended_at, metadata
              ) VALUES (
                ${failedCallValues.userId}::text, NULL, NULL,
                ${failedCallValues.phoneNumber}, ${failedCallValues.fromNumber}, ${failedCallValues.toNumber},
                ${failedCallValues.status}, ${failedCallValues.callDirection},
                ${failedCallValues.elevenLabsConversationId}, ${failedCallValues.twilioSid},
                ${failedCallValues.duration}::int, ${failedCallValues.transcript}, ${failedCallValues.aiSummary},
                ${failedCallValues.classification}, ${failedCallValues.endedAt}, ${metaJson}::jsonb
              ) RETURNING *
            `);
            failedCallRecord = rawResult.rows[0] as any;
          } else {
            throw failedInsertErr;
          }
        }
        
        callRecord = failedCallRecord;
        console.log(`✅ [ElevenLabs Webhook] Created failed call record: ${callRecord.id}`);
        }
      } catch (failedCallError: any) {
        console.error(`❌ [ElevenLabs Webhook] Error creating failed call record:`, failedCallError.message);
      }
    }
    
    if (!callRecord) {
      console.warn(`⚠️ [ElevenLabs Webhook] No call record found or created — DIAGNOSTIC SUMMARY:`);
      console.warn(`   conversation_id: ${conversation_id}`);
      console.warn(`   agent_id: ${agent_id || 'NOT PROVIDED'}`);
      console.warn(`   extractedFromNumber: ${extractedFromNumber || 'NONE'}`);
      console.warn(`   extractedToNumber: ${extractedToNumber || 'NONE'}`);
      console.warn(`   extractedCallSid: ${extractedCallSid || 'NONE'}`);
      console.warn(`   batch_call_id: ${metadata?.batch_call?.batch_call_id || 'NONE'}`);
      console.warn(`   webhook status: ${status || 'NONE'}`);
      console.warn(`   metadata keys: ${metadata ? Object.keys(metadata).join(', ') : 'NONE'}`);
      console.warn(`   All lookup paths exhausted: conversation_id match, phone+agent match, batch_call_id match, SIP match, outbound fallback, incoming fallback, failed call fallback`);
      return res.sendStatus(200);
    }
    
    console.log(`   Found call record: ${callRecord.id}`);
    
    // Process the post_call_transcription webhook data using unified sync service
    console.log(`📞 [ElevenLabs Webhook] Processing post_call_transcription with unified sync`);
    
    try {
      // Use sync service to get combined data from both ElevenLabs and Twilio
      const { callSyncService } = await import('../services/call-sync');
      const syncedData = await callSyncService.syncFromWebhook({
        conversationId: conversation_id,
        agentId: agent_id,
        transcript: webhookTranscript,
        analysis,
        metadata,
        status,
        callDurationSecs: metadata?.call_duration_secs,
      });
      
      // Update call record with synced data from both sources
      const updates: Record<string, any> = {
        status: 'completed',
        endedAt: new Date(),
        metadata: {
          ...callRecord.metadata as object,
          ...syncedData.metadata,
          webhookProcessed: true,
        }
      };
      
      // ALWAYS prefer fresh webhook data — this is the post_call_transcription webhook (final call result)
      // syncFromWebhook fetches from ElevenLabs API + Twilio, so this is the most complete data available
      // Previous logic skipped updates if call record already had values, causing missing data
      // for outbound batch/campaign calls where records are pre-created with empty fields
      if (syncedData.duration) {
        updates.duration = syncedData.duration;
      }
      if (syncedData.transcript) {
        updates.transcript = syncedData.transcript;
      }
      if (syncedData.aiSummary) {
        updates.aiSummary = syncedData.aiSummary;
      }
      if (syncedData.classification) {
        updates.classification = syncedData.classification;
      }
      if (syncedData.recordingUrl) {
        updates.recordingUrl = syncedData.recordingUrl;
      }
      if (syncedData.phoneNumber && (!callRecord.phoneNumber || callRecord.phoneNumber === 'Unknown')) {
        updates.phoneNumber = syncedData.phoneNumber;
      }
      if (syncedData.calledNumber && (!callRecord.toNumber || callRecord.toNumber === 'Unknown')) {
        updates.toNumber = syncedData.calledNumber;
      }
      // Backfill fromNumber if missing — check multiple sources including the call record's own metadata
      if (!callRecord.fromNumber || callRecord.fromNumber === 'Unknown') {
        const recordMeta = callRecord.metadata as Record<string, any> | null;
        const backfillFrom = extractedFromNumber 
          || syncedData.phoneNumber
          || recordMeta?.fromNumber
          || recordMeta?.twilioFrom;
        if (backfillFrom) {
          updates.fromNumber = backfillFrom;
        }
      }
      // Backfill toNumber if missing — also check call record's own metadata
      if (!callRecord.toNumber || callRecord.toNumber === 'Unknown') {
        const recordMeta = callRecord.metadata as Record<string, any> | null;
        const backfillTo = syncedData.calledNumber
          || extractedToNumber
          || recordMeta?.toNumber
          || recordMeta?.twilioTo;
        if (backfillTo) {
          updates.toNumber = backfillTo;
        }
      }
      // Backfill callDirection if missing — derive from webhook metadata direction or call record metadata
      if (!callRecord.callDirection) {
        const webhookDirection = metadata?.phone_call?.direction;
        const recordMeta = callRecord.metadata as Record<string, any> | null;
        const twilioDirection = recordMeta?.twilioDirection;
        if (webhookDirection === 'inbound') {
          updates.callDirection = 'incoming';
        } else if (webhookDirection === 'outbound') {
          updates.callDirection = 'outgoing';
        } else if (twilioDirection === 'inbound') {
          updates.callDirection = 'incoming';
        } else if (twilioDirection === 'outbound-api' || twilioDirection === 'outbound-dial' || twilioDirection === 'outbound') {
          updates.callDirection = 'outgoing';
        }
      }
      // Store Twilio SID if available
      if (metadata?.call_sid || extractedCallSid) {
        updates.twilioSid = metadata?.call_sid || extractedCallSid;
      }
      
      try {
        await db
          .update(calls)
          .set(updates)
          .where(eq(calls.id, callRecord.id));
      } catch (updateErr: any) {
        if (isTypeMismatchError(updateErr)) {
          console.warn(`[ElevenLabs Webhook] Type mismatch on call UPDATE, retrying with raw SQL`);
          const metaJson = JSON.stringify(updates.metadata || {});
          await db.execute(sql`
            UPDATE calls SET
              status = ${updates.status || 'completed'},
              ended_at = ${updates.endedAt || new Date()},
              duration = COALESCE(${updates.duration || null}::int, duration),
              transcript = COALESCE(${updates.transcript || null}, transcript),
              ai_summary = COALESCE(${updates.aiSummary || null}, ai_summary),
              classification = COALESCE(${updates.classification || null}, classification),
              recording_url = COALESCE(${updates.recordingUrl || null}, recording_url),
              phone_number = COALESCE(${updates.phoneNumber || null}, phone_number),
              from_number = COALESCE(${updates.fromNumber || null}, from_number),
              to_number = COALESCE(${updates.toNumber || null}, to_number),
              call_direction = COALESCE(${updates.callDirection || null}, call_direction),
              twilio_sid = COALESCE(${updates.twilioSid || null}, twilio_sid),
              metadata = ${metaJson}::jsonb
            WHERE id::text = ${callRecord.id}::text
          `);
        } else {
          throw updateErr;
        }
      }
      
      console.log(`✅ [ElevenLabs Webhook] Updated call record with synced data: ${callRecord.id}`);

      // AUTH-RETRY AUTO-RESYNC (post_call path):
      // If the call failed because ElevenLabs had stale Twilio credentials (SID/Token rotated),
      // trigger a background credential resync + campaign retry — mirrors the same logic in
      // the call_initiation_failure handler.
      // "max auth retry attempts reached" can arrive via post_call_transcription when the call
      // gets a conversation ID before the SIP authentication ultimately fails.
      const postCallTerminationReason = metadata?.termination_reason as string | undefined;
      const isPostCallAuthRetryFailure = typeof postCallTerminationReason === 'string' &&
        (/max.*auth/i.test(postCallTerminationReason) || /auth.*retry/i.test(postCallTerminationReason));

      if (isPostCallAuthRetryFailure) {
        console.log(`🔄 [ElevenLabs Webhook] Auth retry failure detected in post_call_transcription — triggering background credential resync`);
        console.log(`   Termination reason: "${postCallTerminationReason}"`);

        const postCallCampaignId = callRecord.campaignId;
        let postCallPhoneDbId: string | null = null;

        if (postCallCampaignId) {
          try {
            const [postCallCampaign] = await db
              .select({ phoneNumberId: campaigns.phoneNumberId })
              .from(campaigns)
              .where(eq(campaigns.id, postCallCampaignId))
              .limit(1);
            if (postCallCampaign?.phoneNumberId) {
              postCallPhoneDbId = postCallCampaign.phoneNumberId;
            } else {
              console.warn(`⚠️ [ElevenLabs Webhook] Campaign ${postCallCampaignId} has no phoneNumberId — skipping post_call resync`);
            }
          } catch (phoneIdErr: any) {
            console.warn(`⚠️ [ElevenLabs Webhook] Could not look up phone DB id for post_call resync: ${phoneIdErr.message}`);
          }
        }

        if (postCallPhoneDbId) {
          (async () => {
            try {
              console.log(`🔄 [ElevenLabs Webhook] Post_call resync — phone DB id: ${postCallPhoneDbId}`);
              const resyncResult = await resyncSinglePhoneCredentials(postCallPhoneDbId!);
              if (resyncResult.success) {
                console.log(`✅ [ElevenLabs Webhook] Credential resync succeeded (post_call path)`);
                if (postCallCampaignId) {
                  console.log(`🔄 [ElevenLabs Webhook] Marking campaign ${postCallCampaignId} for retry after successful resync`);
                  await markCampaignForRetry(postCallCampaignId,
                    `Auto-retry after credential resync (original failure: ${postCallTerminationReason})`);
                }
              } else {
                console.error(`❌ [ElevenLabs Webhook] Credential resync failed (post_call path): ${resyncResult.error}`);
                console.warn(`⚠️ [ElevenLabs Webhook] Campaign retry NOT scheduled — credentials may still be stale`);
              }
            } catch (resyncErr: any) {
              console.error(`❌ [ElevenLabs Webhook] Resync error (post_call path): ${resyncErr.message}`);
            }
          })();
        } else if (!postCallCampaignId) {
          console.warn(`⚠️ [ElevenLabs Webhook] Could not resolve phone for post_call resync — call record has no campaignId; skipping resync`);
        }
      }

      // Check if any appointments were booked during this call and link them
      // This handles the case where appointment is booked during call but call record
      // doesn't exist yet when the appointment webhook fires
      try {
        const callPhone = syncedData.phoneNumber || callRecord.phoneNumber;
        if (callPhone && agent_id && callRecord.userId) {
          // Helper to normalize phone for comparison (last 10 digits)
          const normalizePhone = (phone: string | null | undefined): string | null => {
            if (!phone) return null;
            const digits = phone.replace(/[^0-9]/g, '');
            if (digits.length < 6) return null;
            return digits.slice(-10);
          };
          
          const normalizedCallPhone = normalizePhone(callPhone);
          
          // Get the database agent ID from the ElevenLabs agent ID
          const [agentRecord] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.elevenLabsAgentId, agent_id))
            .limit(1);
          
          // Look for appointments created in the last 10 minutes for this user
          // that haven't been linked to a call yet
          const recentAppointments = await db
            .select()
            .from(appointments)
            .where(and(
              eq(appointments.userId, callRecord.userId),
              sql`${appointments.callId} IS NULL`,
              sql`${appointments.createdAt} > NOW() - INTERVAL '10 minutes'`
            ));
          
          console.log(`📅 [ElevenLabs Webhook] Checking ${recentAppointments.length} recent appointments for linking to call ${callRecord.id}`);
          
          for (const appointment of recentAppointments) {
            // Match by normalized phone number (last 10 digits)
            // This handles cases where AI might transcribe phone slightly differently
            const appointmentPhone = normalizePhone(appointment.contactPhone);
            const phoneMatches = appointmentPhone && normalizedCallPhone && appointmentPhone === normalizedCallPhone;
            
            // Also accept fuzzy match: if 9 of 10 digits match (allows for 1 transcription error)
            const fuzzyPhoneMatch = appointmentPhone && normalizedCallPhone && 
              appointmentPhone.length === 10 && normalizedCallPhone.length === 10 &&
              appointmentPhone.split('').filter((d, i) => d === normalizedCallPhone[i]).length >= 9;
            
            if (phoneMatches || fuzzyPhoneMatch) {
              console.log(`📅 [ElevenLabs Webhook] Found appointment ${appointment.id} booked during call - linking and updating metadata`);
              console.log(`   Phone match: exact=${phoneMatches}, fuzzy=${fuzzyPhoneMatch}`);
              console.log(`   Call phone: ${normalizedCallPhone}, Appointment phone: ${appointmentPhone}`);
              
              // Link appointment to this call
              await db
                .update(appointments)
                .set({ callId: callRecord.id })
                .where(eq(appointments.id, appointment.id));
              
              // Update call metadata to indicate appointment was booked (deep merge)
              const existingMetadata = (callRecord.metadata as Record<string, unknown>) || {};
              const existingAiInsights = (existingMetadata.aiInsights as Record<string, unknown>) || {};
              
              const appointmentMetadata = {
                ...existingMetadata,
                appointmentBooked: true,
                hasAppointment: true,
                appointmentData: {
                  appointmentId: appointment.id,
                  contactName: appointment.contactName,
                  contactPhone: appointment.contactPhone,
                  date: appointment.appointmentDate,
                  time: appointment.appointmentTime,
                  bookedAt: appointment.createdAt?.toISOString(),
                },
                aiInsights: {
                  ...existingAiInsights,
                  primaryOutcome: 'appointment_booked',
                  appointmentBooked: true,
                },
              };
              
              await db
                .update(calls)
                .set({ metadata: appointmentMetadata })
                .where(eq(calls.id, callRecord.id));
              
              // Update our local reference so CRM processor sees the updated metadata
              callRecord.metadata = appointmentMetadata;
              
              console.log(`✅ [ElevenLabs Webhook] Linked appointment ${appointment.id} to call ${callRecord.id}`);
              break; // Only link one appointment per call
            }
          }
        }
      } catch (appointmentLinkError: any) {
        console.error(`⚠️ [ElevenLabs Webhook] Error checking for appointments:`, appointmentLinkError.message);
        // Don't fail the webhook - this is a non-critical enhancement
      }
      
      // Run violation detection in the background (don't await to avoid slowing webhook response)
      const transcriptToScan = syncedData.transcript || callRecord.transcript;
      if (transcriptToScan && callRecord.userId) {
        // Run both banned word detection and AI analysis in background
        Promise.all([
          import('../services/violation-detection').then(({ detectViolations }) =>
            detectViolations(callRecord.id, callRecord.userId!, transcriptToScan)
          ),
          import('../services/ai-violation-detection').then(({ analyzeTranscriptWithAI }) =>
            analyzeTranscriptWithAI(callRecord.id, callRecord.userId!, transcriptToScan)
          )
        ]).then(([bannedWordViolations, aiViolations]) => {
          const totalViolations = bannedWordViolations.length + aiViolations.length;
          if (totalViolations > 0) {
            console.log(`🔍 [Violation Detection] Call ${callRecord.id}: ${bannedWordViolations.length} banned word + ${aiViolations.length} AI violations detected`);
          }
        }).catch((err) => {
          console.error(`❌ [Violation Detection] Error scanning call ${callRecord.id}:`, err.message);
        });
      }
      
      // CRITICAL: Deduct credits for the completed call
      const callDuration = syncedData.duration || metadata?.call_duration_secs || 0;
      if (callDuration > 0) {
        try {
          const creditResult = await deductCallCreditsForElevenLabs(callRecord.id, callDuration);
          
          if (creditResult.success || creditResult.alreadyDeducted) {
            console.log(`💳 [ElevenLabs Webhook] Credit deduction processed for call: ${callRecord.id}`);
            
            // Process call for CRM lead creation (run in background)
            import('../engines/crm/lead-processor.service').then(({ CRMLeadProcessor }) => {
              CRMLeadProcessor.processElevenLabsTwilioCall(callRecord.id)
                .then((result) => {
                  if (result?.leadId) {
                    console.log(`📋 [CRM] Lead created from call ${callRecord.id}: ${result.leadId} (${result.qualification.category})`);
                  } else if (result) {
                    console.log(`📋 [CRM] Call ${callRecord.id} did not qualify for CRM lead`);
                  }
                })
                .catch((err) => {
                  console.error(`❌ [CRM] Error processing call ${callRecord.id} for lead:`, err.message);
                });
            }).catch((err) => {
              console.error(`❌ [CRM] Failed to import lead processor:`, err.message);
            });

          } else {
            console.error(`❌ [ElevenLabs Webhook] Credit deduction failed for call ${callRecord.id}: ${creditResult.error}`);
            
            // Mark call as failed due to insufficient credits
            await db.update(calls)
              .set({ 
                status: 'failed',
                metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditDeductionFailed: true, creditError: creditResult.error })}`
              })
              .where(eq(calls.id, callRecord.id));
            
            console.warn(`⚠️ [ElevenLabs Webhook] Call ${callRecord.id} marked as failed due to credit deduction failure`);
            
            // CRITICAL: Stop all downstream processing when credits fail
            return res.status(200).json({ 
              success: false, 
              error: 'Credit deduction failed',
              callId: callRecord.id 
            });
          }
        } catch (creditError: any) {
          console.error(`❌ [ElevenLabs Webhook] Credit deduction error:`, creditError.message);
        }
      } else {
        console.log(`⚠️ [ElevenLabs Webhook] Skipping credit deduction - no duration available`);
      }
      
      // Update flow execution status if one exists for this call
      try {
        const [flowExecution] = await db
          .select()
          .from(flowExecutions)
          .where(eq(flowExecutions.callId, callRecord.id))
          .limit(1);
        
        if (flowExecution) {
          // Extract collected variables from transcript analysis if available
          let collectedVariables = flowExecution.variables as Record<string, any> || {};
          
          // Try to extract variables from data_collection (ElevenLabs primary field)
          if (analysis?.data_collection && typeof analysis.data_collection === 'object') {
            collectedVariables = {
              ...collectedVariables,
              ...analysis.data_collection
            };
          }
          
          // Try to extract variables from data_collection_results if present (alternate field)
          if (analysis?.data_collection_results && typeof analysis.data_collection_results === 'object') {
            collectedVariables = {
              ...collectedVariables,
              ...analysis.data_collection_results
            };
          }
          
          // Try to extract variables from call_successful_data_collection if present
          if (analysis?.call_successful_data_collection && typeof analysis.call_successful_data_collection === 'object') {
            collectedVariables = {
              ...collectedVariables,
              ...analysis.call_successful_data_collection
            };
          }
          
          // Also check for collected_data at root level of webhook payload
          if (data?.collected_data && typeof data.collected_data === 'object') {
            collectedVariables = {
              ...collectedVariables,
              ...data.collected_data
            };
          }
          
          // Determine status based on call outcome
          let executionStatus = 'completed';
          let executionError: string | null = null;
          
          // Check if call was successful or failed
          if (analysis?.call_successful === false) {
            executionStatus = 'failed';
            executionError = analysis?.error_message || 'Call did not complete successfully';
          }
          
          // Update flow execution with collected data
          // Note: pathTaken is NOT updated - ElevenLabs runs flows natively and doesn't provide step-by-step path data
          // The path can only be reliably tracked when we control the flow execution (not implemented)
          await db
            .update(flowExecutions)
            .set({
              status: executionStatus,
              completedAt: new Date(),
              variables: collectedVariables,
              error: executionError,
              metadata: {
                ...(flowExecution.metadata as object || {}),
                callDuration: syncedData.duration || metadata?.call_duration_secs,
                callSuccessful: analysis?.call_successful,
                conversationId: callRecord.elevenLabsConversationId,
              },
            })
            .where(eq(flowExecutions.id, flowExecution.id));
          
          console.log(`✅ [ElevenLabs Webhook] Updated flow execution: ${flowExecution.id} -> ${executionStatus}`);
        }
      } catch (flowExecError: any) {
        console.error(`⚠️ [ElevenLabs Webhook] Error updating flow execution:`, flowExecError.message);
      }

      // Trigger post-call messaging for ALL completed calls regardless of credit path (fire-and-forget)
      {
        // For outbound calls the agent's own number is the FROM; send message to the customer (TO number).
        // IMPORTANT: for outbound we ONLY use the TO number; if it is unavailable we skip messaging
        // entirely rather than falling back to the FROM/agent number.
        const isOutboundCall = (callRecord.callDirection || '').includes('out');
        const agentFromNumber = syncedData.phoneNumber || callRecord.fromNumber || callRecord.phoneNumber;
        let callerPhone: string | null | undefined;
        if (isOutboundCall) {
          const toNumber = syncedData.calledNumber || callRecord.toNumber;
          // Guard: skip if TO resolves to the same number as FROM (agent's own line).
          // Normalize both to digits-only before comparing so "+1555…" ≡ "1555…".
          const toDigits = (toNumber || '').replace(/[^0-9]/g, '');
          const fromDigits = (agentFromNumber || '').replace(/[^0-9]/g, '');
          if (toNumber && toDigits.length >= 6 && toDigits !== fromDigits) {
            callerPhone = toNumber;
          } else {
            callerPhone = null; // Suppress to prevent messaging the agent's own number.
          }
        } else {
          callerPhone = syncedData.phoneNumber || callRecord.phoneNumber || callRecord.fromNumber;
        }
        if (callerPhone && callRecord.userId) {
          import('../services/post-call-messaging').then(({ triggerPostCallMessaging }) => {
            triggerPostCallMessaging({
              elevenLabsAgentId: agent_id,
              userId: callRecord.userId!,
              callerPhone,
              callId: callRecord.id,
            }).catch(err => console.error(`❌ [Post-Call Messaging] Regular call error: ${err.message}`));
          }).catch(err => console.error(`❌ [Post-Call Messaging] Import error: ${err.message}`));

          // If an appointment was booked during this call, send WhatsApp confirmation now that the call has ended
          if (callRecord.metadata?.appointmentBooked && callRecord.metadata?.appointmentData) {
            const apptData = callRecord.metadata.appointmentData as any;
            if (apptData?.date && apptData?.time) {
              import('../services/appointment-whatsapp').then(({ sendAppointmentWhatsAppConfirmation }) => {
                sendAppointmentWhatsAppConfirmation({
                  userId: callRecord.userId!,
                  elevenLabsAgentId: agent_id,
                  callerPhone: callerPhone!,
                  appointmentDate: apptData.date,
                  appointmentTime: apptData.time || apptData.appointmentTime,
                  appointmentId: apptData.appointmentId,
                  callId: callRecord.id,
                }).catch(err => console.error(`❌ [Call End] Appointment WhatsApp error: ${err.message}`));
              }).catch(() => {});
            }
          }
        }
      }

    } catch (syncError: any) {
      console.error(`❌ [ElevenLabs Webhook] Error syncing call data:`, syncError);
      
      // Still update the call as completed even if sync failed
      await db
        .update(calls)
        .set({
          status: 'completed',
          endedAt: new Date(),
          metadata: {
            ...callRecord.metadata as object,
            webhookProcessingError: syncError.message,
          }
        })
        .where(eq(calls.id, callRecord.id));
    }
    
    await recordWebhookReceived('elevenlabs');
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ [ElevenLabs Webhook] Error:', error);
    // Return 200 to prevent webhook retries
    res.sendStatus(200);
  }
}

/**
 * Fetch conversation details from ElevenLabs for a specific call
 * API endpoint for manual refresh or on-demand fetch
 */
export async function fetchElevenLabsConversation(req: Request, res: Response) {
  try {
    const { callId } = req.params;
    
    if (!callId) {
      return res.status(400).json({ error: 'Call ID is required' });
    }
    
    // Get call record - check main calls table first, then sip_calls table
    let callRecord: any = null;
    let isSipCall = false;

    const [mainCallRecord] = await db
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    
    if (mainCallRecord) {
      callRecord = mainCallRecord;
    } else {
      const [sipCallRecord] = await db
        .select()
        .from(sipCalls)
        .where(eq(sipCalls.id, callId))
        .limit(1);
      
      if (sipCallRecord) {
        callRecord = sipCallRecord;
        isSipCall = true;
      }
    }

    if (!callRecord) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    const conversationId = isSipCall ? callRecord.elevenlabsConversationId : callRecord.elevenLabsConversationId;
    
    if (!conversationId) {
      return res.status(400).json({ error: 'Call does not have an ElevenLabs conversation ID' });
    }
    
    console.log(`📞 [Fetch Conversation] Fetching details for call: ${callId} (${isSipCall ? 'SIP' : 'standard'})`);
    console.log(`   Conversation ID: ${conversationId}`);
    
    // Find the agent and credential for this call
    let agentElevenLabsService: ElevenLabsService = elevenLabsService;
    
    if (callRecord.agentId) {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, callRecord.agentId))
        .limit(1);
      
      if (agent?.elevenLabsCredentialId) {
        const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
        if (credential) {
          agentElevenLabsService = new ElevenLabsService(credential.apiKey);
        }
      }
    } else if (callRecord.campaignId) {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, callRecord.campaignId))
        .limit(1);
      
      if (campaign?.agentId) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, campaign.agentId))
          .limit(1);
        
        if (agent?.elevenLabsCredentialId) {
          const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
          if (credential) {
            agentElevenLabsService = new ElevenLabsService(credential.apiKey);
          }
        }
      }
    }
    
    // Fetch conversation details
    const conversationDetails = await agentElevenLabsService.getConversationDetails(
      conversationId
    );
    
    // Format transcript
    const transcriptText = conversationDetails.transcript?.map((entry: any) => 
      `${entry.role.toUpperCase()} (${entry.time_in_call_secs}s): ${entry.message}`
    ).join('\n') || '';
    
    if (isSipCall) {
      // Update sip_calls table
      await db
        .update(sipCalls)
        .set({
          durationSeconds: conversationDetails.call_duration_secs || callRecord.durationSeconds,
          transcript: transcriptText || callRecord.transcript,
          aiSummary: conversationDetails.analysis?.summary || callRecord.aiSummary,
          recordingUrl: conversationDetails.recording_url || callRecord.recordingUrl,
          status: conversationDetails.status === 'done' ? 'completed' : callRecord.status,
          metadata: {
            ...callRecord.metadata as object,
            elevenLabsStatus: conversationDetails.status,
            elevenLabsAnalysis: conversationDetails.analysis,
            lastFetchedAt: new Date().toISOString(),
          }
        })
        .where(eq(sipCalls.id, callId));
    } else {
      // Update main calls table (existing behavior)
      await db
        .update(calls)
        .set({
          duration: conversationDetails.call_duration_secs || callRecord.duration,
          transcript: transcriptText || callRecord.transcript,
          aiSummary: conversationDetails.analysis?.summary || callRecord.aiSummary,
          recordingUrl: conversationDetails.recording_url || callRecord.recordingUrl,
          status: conversationDetails.status === 'done' ? 'completed' : callRecord.status,
          metadata: {
            ...callRecord.metadata as object,
            elevenLabsStatus: conversationDetails.status,
            elevenLabsAnalysis: conversationDetails.analysis,
            lastFetchedAt: new Date().toISOString(),
          }
        })
        .where(eq(calls.id, callId));
    }
    
    console.log(`✅ [Fetch Conversation] Updated ${isSipCall ? 'SIP' : 'standard'} call record`);
    
    res.json({
      success: true,
      conversation: conversationDetails,
    });
  } catch (error: any) {
    console.error('❌ [Fetch Conversation] Error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
}

/**
 * Get conversation audio/recording URL from ElevenLabs
 */
export async function getElevenLabsRecording(req: Request, res: Response) {
  try {
    const { callId } = req.params;
    
    if (!callId) {
      return res.status(400).json({ error: 'Call ID is required' });
    }
    
    // Get call record - check main calls table first, then sip_calls table
    let callRecord: any = null;
    let isSipCall = false;

    const [mainCallRecord] = await db
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    
    if (mainCallRecord) {
      callRecord = mainCallRecord;
    } else {
      const [sipCallRecord] = await db
        .select()
        .from(sipCalls)
        .where(eq(sipCalls.id, callId))
        .limit(1);
      
      if (sipCallRecord) {
        callRecord = sipCallRecord;
        isSipCall = true;
      }
    }

    if (!callRecord) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // If we already have a recording URL, return it
    if (callRecord.recordingUrl) {
      return res.json({
        success: true,
        recordingUrl: callRecord.recordingUrl,
        source: 'cached',
      });
    }
    
    const conversationId = isSipCall ? callRecord.elevenlabsConversationId : callRecord.elevenLabsConversationId;
    
    if (!conversationId) {
      return res.status(400).json({ error: 'Call does not have an ElevenLabs conversation ID' });
    }
    
    console.log(`🎙️ [Get Recording] Fetching audio for call: ${callId} (${isSipCall ? 'SIP' : 'standard'})`);
    
    // Find the agent and credential
    let agentElevenLabsService: ElevenLabsService = elevenLabsService;
    
    if (callRecord.agentId) {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, callRecord.agentId))
        .limit(1);
      
      if (agent?.elevenLabsCredentialId) {
        const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
        if (credential) {
          agentElevenLabsService = new ElevenLabsService(credential.apiKey);
        }
      }
    } else if (callRecord.campaignId) {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, callRecord.campaignId))
        .limit(1);
      
      if (campaign?.agentId) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, campaign.agentId))
          .limit(1);
        
        if (agent?.elevenLabsCredentialId) {
          const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
          if (credential) {
            agentElevenLabsService = new ElevenLabsService(credential.apiKey);
          }
        }
      }
    }
    
    // Try to get audio from ElevenLabs
    const audioResult = await agentElevenLabsService.getConversationAudio(
      conversationId
    );
    
    if (audioResult.audioBuffer) {
      res.json({
        success: true,
        hasRecording: true,
        contentType: audioResult.contentType,
        source: 'elevenlabs',
      });
    } else {
      // Try Twilio fallback if we have a call SID (only for non-SIP calls)
      if (!isSipCall && callRecord.twilioSid) {
        const twilioData = await twilioService.getCallDetails(callRecord.twilioSid);
        if (twilioData?.recordingUrl) {
          await db
            .update(calls)
            .set({
              recordingUrl: twilioData.recordingUrl,
            })
            .where(eq(calls.id, callId));
          
          res.json({
            success: true,
            hasRecording: true,
            recordingUrl: twilioData.recordingUrl,
            source: 'twilio',
          });
        } else {
          res.json({
            success: false,
            hasRecording: false,
            error: 'Recording not available from either source',
          });
        }
      } else {
        res.json({
          success: false,
          hasRecording: false,
          error: audioResult.error || 'Recording not available',
        });
      }
    }
  } catch (error: any) {
    console.error('❌ [Get Recording] Error:', error);
    res.status(500).json({ error: 'Failed to get recording' });
  }
}

/**
 * Appointment Booking Tool Webhook Handler
 * 
 * This endpoint is called by ElevenLabs when a Flow Agent uses the book_appointment tool.
 * It saves the appointment to the database.
 * 
 * Features:
 * - Parses natural language dates (e.g., "tomorrow", "next Monday", "Oct 3")
 * - Uses actual caller phone number from call record as verified source
 * - Stores both AI-collected and verified phone numbers for discrepancy detection
 * 
 * Security: Validates token via URL path
 * 
 * Endpoint: POST /api/webhooks/elevenlabs/appointment/:token/:elevenLabsAgentId
 */
export async function handleAppointmentToolWebhook(req: Request, res: Response) {
  // CRITICAL: Log immediately on entry - before ANY async operations
  // This confirms whether ElevenLabs is reaching our endpoint at all
  const startTime = Date.now();
  console.log(`📅 [Appointment Webhook] ===== WEBHOOK HIT =====`);
  console.log(`📅 [Appointment Webhook] Timestamp: ${new Date().toISOString()}`);
  
  const { token: urlToken, agentId: elevenLabsAgentId } = req.params;
  const { callId } = req.query;
  
  console.log(`📅 [Appointment Webhook] Agent: ${elevenLabsAgentId}, CallId: ${callId || 'none'}`);
  
  try {
    // NOTE: Using static imports (at top of file) instead of dynamic imports
    // Dynamic imports added 200-500ms latency causing ElevenLabs timeouts
    
    if (!validateAppointmentWebhookToken(urlToken)) {
      console.warn(`📅 [Appointment Webhook] Invalid authentication token`);
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid authentication token"
      });
    }
    
    console.log(`📅 [Appointment Webhook] Authentication successful`);
    console.log(`   Request body:`, JSON.stringify(req.body, null, 2));
    
    const {
      contactName,
      contactPhone: rawContactPhone,
      contactEmail,
      appointmentDate,
      appointmentTime,
      duration,
      serviceName,
      notes
    } = req.body;
    
    // Normalize contactPhone - resolve system variables, sentinel values, and invalid text
    // Priority: 
    // 1. ElevenLabs system__caller_id (auto-resolved to actual phone by ElevenLabs before webhook)
    // 2. Explicit phone number provided by the caller
    // 3. Legacy USE_CALLER_NUMBER sentinel (fallback to call record lookup)
    let contactPhone: string | null = null;
    
    if (rawContactPhone) {
      const digits = rawContactPhone.replace(/[^0-9+]/g, '');
      const digitCount = rawContactPhone.replace(/[^0-9]/g, '').length;
      
      if (digitCount >= 6) {
        // Looks like a real phone number (either from system__caller_id resolution or caller-provided)
        contactPhone = rawContactPhone;
        console.log(`📅 [Appointment Webhook] Using phone number: ${contactPhone}`);
      } else if (rawContactPhone === 'USE_CALLER_NUMBER' || 
                 rawContactPhone === '{{system__caller_id}}' ||
                 rawContactPhone?.toLowerCase()?.includes('same') ||
                 rawContactPhone?.toLowerCase()?.includes('calling') ||
                 rawContactPhone?.toLowerCase()?.includes('called') ||
                 rawContactPhone?.toLowerCase()?.includes('system__caller')) {
        console.log(`📅 [Appointment Webhook] Caller number placeholder detected: "${rawContactPhone}" - will resolve from call record`);
      } else {
        console.log(`📅 [Appointment Webhook] AI sent invalid phone text: "${rawContactPhone}" - will resolve from call record`);
      }
    } else {
      console.log(`📅 [Appointment Webhook] No phone provided - will resolve from call record`);
    }
    
    // Look up agent by ElevenLabs agent ID to get database agent ID and userId
    let agent = await db
      .select({ id: agents.id, userId: agents.userId, flowId: agents.flowId })
      .from(agents)
      .where(eq(agents.elevenLabsAgentId, elevenLabsAgentId))
      .limit(1);
    
    // Fallback: If agent not found by ElevenLabs ID, try to find via SIP call record using callId
    // This is a safe, deterministic lookup using the callId parameter
    if (agent.length === 0 && callId) {
      console.log(`📅 [Appointment Webhook] Agent not found by ElevenLabs ID, trying callId fallback...`);
      
      // Look up SIP call by external call ID or call ID to find the correct agent
      // This is safe because we're using the callId from the request, not guessing
      const sipCallByCallId = await db.execute(sql`
        SELECT sc.agent_id, a.id as agent_id_verified, a.user_id, a.flow_id, sc.id as call_id
        FROM sip_calls sc
        JOIN agents a ON sc.agent_id = a.id
        WHERE (sc.external_call_id = ${callId} OR sc.id = ${callId} OR sc.elevenlabs_conversation_id = ${callId})
          AND sc.engine = 'elevenlabs-sip'
        LIMIT 1
      `);
      
      if (sipCallByCallId.rows.length > 0) {
        const sipCallAgent = sipCallByCallId.rows[0] as any;
        console.log(`📅 [Appointment Webhook] Found agent via SIP call record ${sipCallAgent.call_id}: ${sipCallAgent.agent_id_verified}`);
        agent = [{
          id: sipCallAgent.agent_id_verified,
          userId: sipCallAgent.user_id,
          flowId: sipCallAgent.flow_id
        }];
      }
    }
    
    // If still no agent found, log detailed error for debugging
    // NOTE: We intentionally do NOT use global/unscoped fallbacks as they could cause cross-tenant issues
    if (agent.length === 0) {
      console.warn(`📅 [Appointment Webhook] ⚠️ STALE AGENT ID DETECTED`);
      console.warn(`   ElevenLabs is using agent ID: ${elevenLabsAgentId}`);
      console.warn(`   This ID does not exist in our database.`);
      console.warn(`   CallId provided: ${callId || 'none'}`);
      console.warn(`   To fix: Re-assign the agent to the SIP phone number. This will refresh the webhook URL on ElevenLabs.`);
    }
    
    if (agent.length === 0) {
      console.warn(`📅 [Appointment Webhook] No agent found with ElevenLabs ID ${elevenLabsAgentId} (including SIP fallback)`);
      return res.json({
        success: false,
        message: "Could not find the agent to book the appointment."
      });
    }
    
    const dbAgentId = agent[0].id;
    const userId = agent[0].userId;
    const flowId = agent[0].flowId;
    
    console.log(`📅 [Appointment Webhook] Found database agent ${dbAgentId} for user ${userId}`);
    
    // Get call record to extract verified caller phone number
    // Strategy: Try explicit callId first, then use call matcher to find recent calls for this agent
    let validatedCallId: string | null = null;
    let verifiedCallerPhone: string | null = null;
    let verifiedCallerName: string | null = null;
    
    // Try explicit callId if provided (legacy support)
    if (callId) {
      const callRecord = await db
        .select({ 
          id: calls.id, 
          userId: calls.userId,
          phoneNumber: calls.phoneNumber,
          callDirection: calls.callDirection,
          contactId: calls.contactId
        })
        .from(calls)
        .where(and(
          eq(calls.id, callId as string),
          eq(calls.userId, userId)
        ))
        .limit(1);
      
      if (callRecord.length > 0) {
        validatedCallId = callRecord[0].id;
        verifiedCallerPhone = callRecord[0].phoneNumber;
        console.log(`📅 [Appointment Webhook] Found call by explicit ID: ${validatedCallId}`);
        
        if (callRecord[0].contactId) {
          const contactRecord = await db
            .select({ 
              firstName: contacts.firstName,
              lastName: contacts.lastName,
              phone: contacts.phone
            })
            .from(contacts)
            .where(eq(contacts.id, callRecord[0].contactId))
            .limit(1);
          if (contactRecord.length > 0) {
            verifiedCallerName = [contactRecord[0].firstName, contactRecord[0].lastName].filter(Boolean).join(' ');
            verifiedCallerPhone = contactRecord[0].phone || verifiedCallerPhone;
            console.log(`📅 [Appointment Webhook] Verified contact: ${verifiedCallerName} (${verifiedCallerPhone})`);
          }
        }
      }
    }
    
    // If no explicit callId, use call matcher to find recent calls for this agent/phone
    if (!validatedCallId) {
      const matchedCall = await findCallForWebhook(elevenLabsAgentId, contactPhone, userId);
      
      if (matchedCall) {
        validatedCallId = matchedCall.callId;
        verifiedCallerPhone = matchedCall.verifiedContactPhone || matchedCall.phoneNumber;
        verifiedCallerName = matchedCall.contactName;
        console.log(`📅 [Appointment Webhook] Matched call via call-matcher: ${validatedCallId}`);
      } else {
        console.log(`📅 [Appointment Webhook] No call match found - appointment will be saved without call link`);
      }
    }
    
    // Use verified phone from call record as primary, AI-collected as fallback
    // When AI doesn't provide contactPhone (because caller confirmed using their calling number),
    // we MUST have a verified phone from the call record
    const finalContactPhone = verifiedCallerPhone || contactPhone;
    const finalContactName = verifiedCallerName || contactName || 'Unknown Caller';
    
    // Log which phone source we're using
    if (verifiedCallerPhone && !contactPhone) {
      console.log(`📅 [Appointment Webhook] Using verified caller phone from call record: ${verifiedCallerPhone}`);
    } else if (verifiedCallerPhone && contactPhone && verifiedCallerPhone !== contactPhone) {
      console.log(`📅 [Appointment Webhook] Caller provided different phone: ${contactPhone} (call record: ${verifiedCallerPhone})`);
    }
    
    if (!finalContactPhone) {
      console.warn(`📅 [Appointment Webhook] No phone number available - call not matched and AI didn't collect phone`);
      return res.json({
        success: false,
        message: "I couldn't identify your phone number. Could you please provide a contact number for the appointment?"
      });
    }
    
    if (!appointmentDate || !appointmentTime) {
      console.warn(`📅 [Appointment Webhook] Missing date/time`);
      return res.json({
        success: false,
        message: "I need both the date and time to schedule the appointment."
      });
    }
    
    // Parse natural language date using chrono-node
    let parsedDate: Date | null = null;
    let parsedTime: string = appointmentTime;
    
    // First, try to parse date as-is (might be YYYY-MM-DD already)
    const isoDateMatch = appointmentDate.match(/^\d{4}-\d{2}-\d{2}$/);
    if (isoDateMatch) {
      parsedDate = new Date(appointmentDate + 'T12:00:00');
      console.log(`📅 [Appointment Webhook] Date already in ISO format: ${appointmentDate}`);
    } else {
      // Parse natural language date (e.g., "tomorrow", "next Monday", "Oct 3")
      const dateTimeString = `${appointmentDate} ${appointmentTime}`;
      const chronoResult = chrono.parseDate(dateTimeString, new Date(), { forwardDate: true });
      
      if (chronoResult) {
        parsedDate = chronoResult;
        console.log(`📅 [Appointment Webhook] Parsed natural language date: "${appointmentDate}" -> ${parsedDate.toISOString()}`);
      } else {
        // Try parsing just the date
        const dateOnlyResult = chrono.parseDate(appointmentDate, new Date(), { forwardDate: true });
        if (dateOnlyResult) {
          parsedDate = dateOnlyResult;
          console.log(`📅 [Appointment Webhook] Parsed date only: "${appointmentDate}" -> ${parsedDate.toISOString()}`);
        }
      }
    }
    
    // If still couldn't parse, try common patterns
    if (!parsedDate) {
      // Handle common relative terms
      const lowerDate = appointmentDate.toLowerCase().trim();
      const now = new Date();
      
      if (lowerDate === 'tomorrow') {
        parsedDate = addDays(now, 1);
      } else if (lowerDate === 'today') {
        parsedDate = now;
      } else if (lowerDate === 'day after tomorrow') {
        parsedDate = addDays(now, 2);
      } else if (lowerDate.includes('next week')) {
        parsedDate = addDays(now, 7);
      }
      
      if (parsedDate) {
        console.log(`📅 [Appointment Webhook] Parsed relative date: "${appointmentDate}" -> ${parsedDate.toISOString()}`);
      }
    }
    
    if (!parsedDate) {
      console.warn(`📅 [Appointment Webhook] Could not parse date: "${appointmentDate}"`);
      return res.json({
        success: false,
        message: `I couldn't understand the date "${appointmentDate}". Please provide a specific date like "tomorrow", "December 5th", or "next Monday".`
      });
    }
    
    // Validate that the date is not in the past
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const appointmentDay = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
    
    if (appointmentDay < today) {
      console.warn(`📅 [Appointment Webhook] Date is in the past: ${appointmentDate} -> ${parsedDate.toISOString()}`);
      const currentYear = now.getFullYear();
      return res.json({
        success: false,
        message: `That date appears to be in the past. Please provide a future date. We're currently in ${currentYear}.`
      });
    }
    
    // Format date and time for database
    const finalDate = formatDate(parsedDate, 'yyyy-MM-dd');
    
    // Parse time - try to extract from chrono result or use provided time
    let finalTime = '10:00'; // Default fallback
    const timeMatch = appointmentTime.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3]?.toLowerCase();
      
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      finalTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    } else if (appointmentTime.match(/^\d{2}:\d{2}$/)) {
      finalTime = appointmentTime;
    }
    
    console.log(`📅 [Appointment Webhook] Final parsed date/time: ${finalDate} at ${finalTime}`);
    
    // Validate against user's working hours settings
    const [userSettings] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.userId, userId));
    
    // Default working hours - used when user hasn't configured settings or individual days are missing
    const defaultWorkingHours: Record<string, { start: string; end: string; enabled: boolean }> = {
      monday: { start: "09:00", end: "17:00", enabled: true },
      tuesday: { start: "09:00", end: "17:00", enabled: true },
      wednesday: { start: "09:00", end: "17:00", enabled: true },
      thursday: { start: "09:00", end: "17:00", enabled: true },
      friday: { start: "09:00", end: "17:00", enabled: true },
      saturday: { start: "09:00", end: "17:00", enabled: false },
      sunday: { start: "09:00", end: "17:00", enabled: false },
    };
    
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    const dayOfWeek = parsedDate.getDay();
    const dayName = dayNames[dayOfWeek];
    
    // Merge user settings with defaults per-day to handle missing keys in stored data
    const userWorkingHours = userSettings?.workingHours as Record<string, { start: string; end: string; enabled: boolean }> | undefined;
    const daySettings = userWorkingHours?.[dayName] 
      ? { ...defaultWorkingHours[dayName], ...userWorkingHours[dayName] }
      : defaultWorkingHours[dayName];
    
    console.log(`📅 [Appointment Webhook] Working hours for ${dayName}:`, daySettings);
    
    if (!daySettings?.enabled) {
      console.log(`📅 [Appointment Webhook] Rejected: ${dayName} is not available for appointments`);
      return res.json({
        success: false,
        message: `I'm sorry, but we're not available on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}s. Please choose a different day.`
      });
    }
    
    // Check if the time is within working hours (with defensive parsing)
    try {
      const parseTimeToMinutes = (timeStr: string): number => {
        const parts = timeStr.split(':');
        if (parts.length !== 2) throw new Error(`Invalid time format: ${timeStr}`);
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(minutes)) throw new Error(`Invalid time values: ${timeStr}`);
        return hours * 60 + minutes;
      };
      
      const requestedMinutes = parseTimeToMinutes(finalTime);
      const startMinutes = parseTimeToMinutes(daySettings.start || "09:00");
      const endMinutes = parseTimeToMinutes(daySettings.end || "17:00");
      const appointmentDuration = duration || 30;
      
      // Check if appointment START is within working hours (inclusive of end time for start)
      // and appointment END doesn't exceed working hours
      const appointmentEndMinutes = requestedMinutes + appointmentDuration;
      
      if (requestedMinutes < startMinutes || appointmentEndMinutes > endMinutes) {
        console.log(`📅 [Appointment Webhook] Rejected: ${finalTime} (duration: ${appointmentDuration}min) is outside working hours (${daySettings.start} - ${daySettings.end})`);
        return res.json({
          success: false,
          message: `I'm sorry, but ${finalTime} is outside our available hours on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}. We're available from ${daySettings.start} to ${daySettings.end}. Would you like to choose a different time?`
        });
      }
      
      console.log(`📅 [Appointment Webhook] Time validation passed: ${finalTime} is within ${daySettings.start} - ${daySettings.end}`);
    } catch (parseError: any) {
      console.error(`📅 [Appointment Webhook] Time parsing error:`, parseError.message);
      console.error(`📅 [Appointment Webhook] daySettings:`, JSON.stringify(daySettings));
      console.error(`📅 [Appointment Webhook] finalTime:`, finalTime);
      // Reject the booking with a helpful message rather than silently allowing
      return res.json({
        success: false,
        message: `I'm having trouble understanding the appointment time. Could you please specify the time again, like "2 PM" or "14:00"?`
      });
    }
    
    // Build metadata to track phone number discrepancies
    const metadata: Record<string, any> = {};
    if (contactPhone && verifiedCallerPhone && contactPhone !== verifiedCallerPhone) {
      metadata.aiCollectedPhone = contactPhone;
      metadata.verifiedPhone = verifiedCallerPhone;
      metadata.phoneDiscrepancy = true;
      console.log(`📅 [Appointment Webhook] Phone discrepancy detected:`);
      console.log(`   AI collected: ${contactPhone}`);
      console.log(`   Verified (call): ${verifiedCallerPhone}`);
    }
    if (contactName && verifiedCallerName && contactName !== verifiedCallerName) {
      metadata.aiCollectedName = contactName;
      metadata.verifiedName = verifiedCallerName;
    }
    
    const appointmentId = nanoid();
    const [newAppointment] = await db
      .insert(appointments)
      .values({
        id: appointmentId,
        userId,
        callId: validatedCallId,
        flowId: flowId || null,
        contactName: finalContactName,
        contactPhone: finalContactPhone,
        contactEmail: contactEmail || null,
        appointmentDate: finalDate,
        appointmentTime: finalTime,
        duration: duration || 30,
        serviceName: serviceName || null,
        notes: notes || null,
        status: "scheduled",
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      })
      .returning();
    
    console.log(`📅 [Appointment Webhook] Created appointment ${appointmentId}`);
    console.log(`   Contact: ${finalContactName} (${finalContactPhone})`);
    console.log(`   Date/Time: ${finalDate} at ${finalTime}`);

    // Auto-sync to Google Calendar if enabled
    try {
      const syncEnabled = await isCalendarSyncEnabled(userId);
      if (syncEnabled) {
        const calendarApt = {
          id: appointmentId,
          contactName: finalContactName,
          contactPhone: finalContactPhone,
          contactEmail: contactEmail || null,
          appointmentDate: finalDate,
          appointmentTime: finalTime,
          duration: duration || 30,
          serviceName: serviceName || null,
          notes: notes || null,
          status: "scheduled",
        };
        const eventId = await createCalendarEvent(userId, calendarApt);
        if (eventId) {
          await db
            .update(appointments)
            .set({ googleCalendarEventId: eventId, updatedAt: new Date() })
            .where(eq(appointments.id, appointmentId));
          console.log(`📅 [GoogleCalendar] Auto-synced appointment ${appointmentId} → event ${eventId}`);
        }
      }
    } catch (calErr: any) {
      console.error(`📅 [GoogleCalendar] Auto-sync error for ${appointmentId}:`, calErr.message);
    }

    // Trigger appointment.booked webhook event
    try {
      await webhookDeliveryService.triggerEvent(userId, 'appointment.booked', {
        appointment: {
          id: appointmentId,
          contactName: finalContactName,
          contactPhone: finalContactPhone,
          contactEmail: contactEmail || null,
          date: finalDate,
          time: finalTime,
          duration: duration || 30,
          serviceName: serviceName || null,
          notes: notes || null,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
        },
        call: {
          id: validatedCallId || null,
        },
        flow: {
          id: flowId || null,
        },
      });
      console.log(`📅 [Appointment Webhook] Triggered appointment.booked webhook event`);
    } catch (webhookError: any) {
      console.error(`📅 [Appointment Webhook] Failed to trigger webhook:`, webhookError.message);
    }
    
    // Update call metadata for CRM Lead Processor detection
    if (validatedCallId) {
      try {
        const [existingCall] = await db
          .select()
          .from(calls)
          .where(eq(calls.id, validatedCallId))
          .limit(1);
        
        if (existingCall) {
          const existingMetadata = (existingCall.metadata as Record<string, unknown>) || {};
          const existingAiInsights = (existingMetadata.aiInsights as Record<string, unknown>) || {};
          
          const updatedMetadata = {
            ...existingMetadata,
            appointmentBooked: true,
            hasAppointment: true,
            appointmentData: {
              appointmentId,
              contactName: finalContactName,
              contactPhone: finalContactPhone,
              date: finalDate,
              time: finalTime,
              bookedAt: new Date().toISOString(),
            },
            aiInsights: {
              ...existingAiInsights,
              primaryOutcome: 'appointment_booked',
              appointmentBooked: true,
            },
          };
          
          await db
            .update(calls)
            .set({ metadata: updatedMetadata })
            .where(eq(calls.id, validatedCallId));
          
          console.log(`📅 [Appointment Webhook] Updated call metadata for CRM detection`);
        }
      } catch (metadataError: any) {
        console.error(`📅 [Appointment Webhook] Failed to update call metadata:`, metadataError.message);
      }
    }
    
    // Format response date for human readability
    const readableDate = formatDate(parsedDate, 'EEEE, MMMM d, yyyy');
    const readableTime = formatDate(new Date(`2000-01-01T${finalTime}`), 'h:mm a');

    const responseTime = Date.now() - startTime;
    console.log(`📅 [Appointment Webhook] ✅ SUCCESS - Response time: ${responseTime}ms`);

    return res.json({
      success: true,
      message: `Great! I've booked your appointment for ${readableDate} at ${readableTime}. You'll receive a confirmation shortly.`,
      appointmentId: appointmentId
    });
    
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    console.error(`❌ [Appointment Webhook] Error after ${responseTime}ms:`, error.message);
    console.error(`   Stack:`, error.stack);
    return res.json({
      success: false,
      message: "I encountered an error while booking the appointment. Please try again."
    });
  }
}

/**
 * Form Submission Tool Webhook Handler
 * 
 * This endpoint is called by ElevenLabs when a Flow Agent uses the submit_form tool.
 * It saves the form submission to the database.
 * 
 * Security: Validates token via URL path
 * 
 * Endpoint: POST /api/webhooks/elevenlabs/form/:token/:formId/:elevenLabsAgentId
 */
export async function handleFormSubmissionWebhook(req: Request, res: Response) {
  const { token: urlToken, formId, agentId: elevenLabsAgentId } = req.params;
  const { callId } = req.query;
  
  console.log(`📋 [Form Webhook] Received submission for form: ${formId}, agent: ${elevenLabsAgentId}`);
  
  try {
    const { formSubmissions, forms, formFields } = await import('../../shared/schema');
    
    if (!validateFormWebhookToken(urlToken)) {
      console.warn(`📋 [Form Webhook] Invalid authentication token`);
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid authentication token"
      });
    }
    
    console.log(`📋 [Form Webhook] Authentication successful`);
    console.log(`   Request body:`, JSON.stringify(req.body, null, 2));
    
    const { contactName, contactPhone, ...fieldResponses } = req.body;
    
    // Look up agent by ElevenLabs agent ID to get database agent ID and userId
    const agent = await db
      .select({ id: agents.id, userId: agents.userId, flowId: agents.flowId })
      .from(agents)
      .where(eq(agents.elevenLabsAgentId, elevenLabsAgentId))
      .limit(1);
    
    if (agent.length === 0) {
      console.warn(`📋 [Form Webhook] No agent found with ElevenLabs ID ${elevenLabsAgentId}`);
      return res.json({
        success: false,
        message: "Could not find the agent to submit the form."
      });
    }
    
    const userId = agent[0].userId;
    // Note: agent.flowId is the flow template ID, not a flow execution ID
    // We set flowExecutionId to null since we don't have the execution ID in webhook context
    // The callId still provides traceability to the specific call
    
    console.log(`📋 [Form Webhook] Found database agent for user ${userId}`);
    
    // Verify form exists and belongs to user
    const [form] = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.userId, userId)))
      .limit(1);
    
    if (!form) {
      console.warn(`📋 [Form Webhook] Form ${formId} not found for user ${userId}`);
      return res.json({
        success: false,
        message: "Could not find the form to submit."
      });
    }
    
    // Get form fields for response mapping
    const fields = await db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, formId))
      .orderBy(formFields.order);
    
    // Build responses array from field responses
    const responses: { fieldId: string; question: string; answer: string }[] = [];
    
    for (const field of fields) {
      // Use sanitized field ID to match the webhook schema (hyphens → underscores)
      const fieldKey = `field_${sanitizeFieldId(field.id)}`;
      if (fieldResponses[fieldKey] !== undefined) {
        responses.push({
          fieldId: field.id,
          question: field.question,
          answer: String(fieldResponses[fieldKey])
        });
      }
    }
    
    // If contactPhone was not supplied (e.g. form has a dedicated phone/tel field and
    // contactPhone was not marked required in the schema), resolve it from the field response
    // BEFORE the call matcher runs so the matcher can use the resolved phone for lookup.
    let resolvedContactPhone = contactPhone;
    if (!resolvedContactPhone) {
      const phoneField = fields.find((f: any) => f.fieldType === 'phone' || f.fieldType === 'tel');
      if (phoneField) {
        const phoneKey = `field_${sanitizeFieldId(phoneField.id)}`;
        if (fieldResponses[phoneKey]) {
          resolvedContactPhone = String(fieldResponses[phoneKey]);
          console.log(`📋 [Form Webhook] Extracted contactPhone from phone field "${phoneField.id}": ${resolvedContactPhone}`);
        }
      }
    }

    // Get verified caller info from call record
    // Strategy: Try explicit callId first, then use call matcher to find recent calls for this agent
    let validatedCallId: string | null = null;
    let verifiedCallerPhone: string | null = null;
    let verifiedCallerName: string | null = null;
    
    // Try explicit callId if provided (legacy support)
    if (callId) {
      const callRecord = await db
        .select({ 
          id: calls.id, 
          userId: calls.userId,
          phoneNumber: calls.phoneNumber,
          contactId: calls.contactId
        })
        .from(calls)
        .where(and(
          eq(calls.id, callId as string),
          eq(calls.userId, userId)
        ))
        .limit(1);
      
      if (callRecord.length > 0) {
        validatedCallId = callRecord[0].id;
        verifiedCallerPhone = callRecord[0].phoneNumber;
        
        if (callRecord[0].contactId) {
          const contactRecord = await db
            .select({ 
              firstName: contacts.firstName,
              lastName: contacts.lastName,
              phone: contacts.phone
            })
            .from(contacts)
            .where(eq(contacts.id, callRecord[0].contactId))
            .limit(1);
          if (contactRecord.length > 0) {
            verifiedCallerName = [contactRecord[0].firstName, contactRecord[0].lastName].filter(Boolean).join(' ');
            verifiedCallerPhone = contactRecord[0].phone || verifiedCallerPhone;
          }
        }
        console.log(`📋 [Form Webhook] Found call by explicit ID: ${validatedCallId}`);
      }
    }
    
    // If no explicit callId, use call matcher to find recent calls for this agent/phone
    // Pass resolvedContactPhone (which includes phone-field fallback) for better matching
    if (!validatedCallId) {
      const matchedCall = await findCallForWebhook(elevenLabsAgentId, resolvedContactPhone, userId);
      
      if (matchedCall) {
        validatedCallId = matchedCall.callId;
        verifiedCallerPhone = matchedCall.verifiedContactPhone || matchedCall.phoneNumber;
        verifiedCallerName = matchedCall.contactName;
        console.log(`📋 [Form Webhook] Matched call via call-matcher: ${validatedCallId}`);
      } else {
        console.log(`📋 [Form Webhook] No call match found - submission will be saved without call link`);
      }
    }

    const finalContactPhone = verifiedCallerPhone || resolvedContactPhone || null;
    const finalContactName = verifiedCallerName || contactName || 'Unknown Caller';
    
    // Create form submission
    const submissionId = nanoid();
    const [newSubmission] = await db
      .insert(formSubmissions)
      .values({
        id: submissionId,
        formId,
        callId: validatedCallId,
        flowExecutionId: null, // Set to null - we don't have execution ID in webhook context
        contactName: finalContactName,
        contactPhone: finalContactPhone,
        responses,
      })
      .returning();
    
    console.log(`📋 [Form Webhook] Created submission ${submissionId}`);
    console.log(`   Contact: ${finalContactName} (${finalContactPhone})`);
    console.log(`   Responses: ${responses.length} fields`);

    // Push form data to Google Sheets if the flow node has a sheet configured
    try {
      const agentFlowId = agent[0].flowId;
      if (agentFlowId) {
        const [flowRecord] = await db
          .select({ nodes: flows.nodes })
          .from(flows)
          .where(eq(flows.id, agentFlowId))
          .limit(1);

        if (flowRecord) {
          const flowNodes: any[] = (flowRecord.nodes as any[]) || [];

          // Try to match the exact flow node using nodeId (passed as query param from the webhook URL).
          // This avoids picking the wrong node when the same formId is used in multiple branches.
          const incomingNodeId = req.query.nodeId as string | undefined;
          let formFlowNode: any = undefined;

          if (incomingNodeId) {
            // Match by nodeId AND verify the node's formId matches — prevents misrouted sheet config
            // when a stale/spoofed nodeId points to a different form node in the same flow.
            const candidate = flowNodes.find((n: any) => n.id === incomingNodeId);
            if (candidate) {
              const candidateCfg = candidate.data?.config || candidate.data || {};
              if (candidateCfg.formId === formId) {
                formFlowNode = candidate;
                console.log(`📋 [Form Webhook] Matched flow node by nodeId ${incomingNodeId} + formId ${formId}`);
              } else {
                console.warn(
                  `📋 [Form Webhook] nodeId "${incomingNodeId}" found but formId mismatch ` +
                  `(node has "${candidateCfg.formId}", expected "${formId}") — falling back to formId match`
                );
              }
            } else {
              console.warn(`📋 [Form Webhook] nodeId "${incomingNodeId}" not found in flow; falling back to formId match`);
            }
          }

          // Fallback: match by formId (backward-compat with agents that have no nodeId in URL)
          if (!formFlowNode) {
            formFlowNode = flowNodes.find((n: any) => {
              const cfg = n.data?.config || n.data || {};
              return cfg.formId === formId;
            });
            if (formFlowNode) {
              console.log(`📋 [Form Webhook] Matched flow node by formId (fallback)`);
            }
          }

          if (formFlowNode) {
            const cfg = formFlowNode.data?.config || formFlowNode.data || {};
            const sheetId: string | undefined = cfg.googleSheetId;
            let sheetName: string = cfg.googleSheetName || '';

            if (sheetId) {
              const { appendRowToSheet, listSheetTabs, ensureSheetHeaders } = await import('../services/google-sheets/google-sheets.service');

              // When no tab name is configured, detect the first tab dynamically.
              // This prevents silent failures when the spreadsheet doesn't have a "Sheet1" tab.
              if (!sheetName) {
                try {
                  const tabs = await listSheetTabs(userId, sheetId);
                  if (tabs.length > 0) {
                    sheetName = tabs[0].title;
                    console.log(`📋 [Form Webhook] Auto-detected sheet tab: "${sheetName}"`);
                  } else {
                    sheetName = 'Sheet1'; // absolute last-resort fallback
                    console.warn(`📋 [Form Webhook] Could not detect sheet tabs; falling back to "Sheet1"`);
                  }
                } catch (tabErr: any) {
                  sheetName = 'Sheet1';
                  console.warn(`📋 [Form Webhook] Tab detection failed (${tabErr.message}); falling back to "Sheet1"`);
                }
              }

              // Safety-net: write header row if not already present (in case flow-save didn't run it).
              // responses already carry the question text for each field.
              try {
                const headerRow = [
                  'Contact Name',
                  'Contact Phone',
                  ...responses.map((r: any) => r.question || r.fieldId || ''),
                  'Call ID',
                  'Submitted At',
                ];
                const wroteHeaders = await ensureSheetHeaders(userId, sheetId, sheetName, headerRow);
                if (wroteHeaders) {
                  console.log(`📋 [Form Webhook] Safety-net: wrote missing header row to Google Sheet "${sheetName}" (${sheetId})`);
                }
              } catch (headerErr: any) {
                console.warn(`📋 [Form Webhook] Safety-net header write failed (non-fatal):`, headerErr.message);
              }

              const answerValues = responses.map((r: any) => r.answer ?? '');
              const sheetRow: (string | null)[] = [
                finalContactName,
                finalContactPhone,
                ...answerValues,
                validatedCallId,
                new Date().toISOString(),
              ];
              const pushed = await appendRowToSheet(userId, sheetId, sheetName, sheetRow);
              if (pushed) {
                console.log(`📋 [Form Webhook] Appended row to Google Sheet "${sheetName}" (${sheetId})`);
              } else {
                const errMsg = `appendRowToSheet returned false for sheet ${sheetId} tab "${sheetName}"`;
                console.error(`📋 [Form Webhook] Google Sheets append FAILED — form data saved locally but NOT in Google Sheets. ${errMsg}`);
                // Persist a structured warning on the call record so the failure is visible in the UI call log
                if (validatedCallId) {
                  try {
                    const { sql: drizzleSql } = await import('drizzle-orm');
                    const warning = JSON.stringify({
                      googleSheetsWarning: true,
                      googleSheetsSheetId: sheetId,
                      googleSheetsTab: sheetName,
                      googleSheetsErrorMessage: errMsg,
                      googleSheetsErrorAt: new Date().toISOString(),
                    });
                    const callTables = ['calls', 'twilio_openai_calls', 'plivo_calls', 'sip_calls'] as const;
                    for (const table of callTables) {
                      const rows = await db.execute(drizzleSql.raw(`SELECT id FROM ${table} WHERE id = `).append(drizzleSql`${validatedCallId}`).append(drizzleSql.raw(` LIMIT 1`)));
                      if ((Array.isArray(rows) ? rows : (rows as any).rows || []).length > 0) {
                        await db.execute(drizzleSql.raw(`UPDATE ${table} SET metadata = COALESCE(metadata, '{}'::jsonb) || `).append(drizzleSql`${warning}::jsonb`).append(drizzleSql.raw(` WHERE id = `)).append(drizzleSql`${validatedCallId}`));
                        console.log(`📋 [Form Webhook] Wrote googleSheetsWarning to ${table} call ${validatedCallId}`);
                        break;
                      }
                    }
                  } catch (warnErr: any) {
                    console.warn(`📋 [Form Webhook] Could not write googleSheetsWarning to call record:`, warnErr.message);
                  }
                }
              }
            }
          } else {
            console.warn(`📋 [Form Webhook] No matching flow node found for formId ${formId} — Google Sheets push skipped`);
          }
        }
      }
    } catch (sheetError: any) {
      console.error(`📋 [Form Webhook] Google Sheets push failed (non-fatal):`, sheetError.message);
    }

    // Trigger form.submitted webhook event
    try {
      await webhookDeliveryService.triggerEvent(userId, 'form.submitted', {
        submission: {
          id: submissionId,
          formId: formId,
          formName: form.name,
          contactName: finalContactName,
          contactPhone: finalContactPhone,
          responses: responses,
          submittedAt: new Date().toISOString(),
        },
        call: {
          id: validatedCallId || null,
        },
        form: {
          id: form.id,
          name: form.name,
          description: form.description || null,
        },
      });
      console.log(`📋 [Form Webhook] Triggered form.submitted webhook event`);
    } catch (webhookError: any) {
      console.error(`📋 [Form Webhook] Failed to trigger webhook:`, webhookError.message);
    }
    
    // Update call metadata for CRM Lead Processor detection
    if (validatedCallId) {
      try {
        const [existingCall] = await db
          .select()
          .from(calls)
          .where(eq(calls.id, validatedCallId))
          .limit(1);
        
        if (existingCall) {
          const existingMetadata = (existingCall.metadata as Record<string, unknown>) || {};
          const existingAiInsights = (existingMetadata.aiInsights as Record<string, unknown>) || {};
          
          const updatedMetadata = {
            ...existingMetadata,
            formSubmitted: true,
            hasFormSubmission: true,
            formData: {
              submissionId,
              formId,
              formName: form.name,
              contactName: finalContactName,
              contactPhone: finalContactPhone,
              submittedAt: new Date().toISOString(),
            },
            aiInsights: {
              ...existingAiInsights,
              primaryOutcome: 'form_submitted',
              formSubmitted: true,
            },
          };
          
          await db
            .update(calls)
            .set({ metadata: updatedMetadata })
            .where(eq(calls.id, validatedCallId));
          
          console.log(`📋 [Form Webhook] Updated call metadata for CRM detection`);
        }
      } catch (metadataError: any) {
        console.error(`📋 [Form Webhook] Failed to update call metadata:`, metadataError.message);
      }
    }
    
    return res.json({
      success: true,
      message: `Thank you! Your responses have been recorded successfully.`,
      submissionId: submissionId
    });
    
  } catch (error: any) {
    console.error(`❌ [Form Webhook] Error:`, error.message);
    return res.json({
      success: false,
      message: "I encountered an error while saving your responses. Please try again."
    });
  }
}

/**
 * RAG Knowledge Base Tool Webhook Handler
 * 
 * This endpoint is called by ElevenLabs when an agent uses the ask_knowledge tool.
 * It searches the RAG knowledge base and returns relevant information.
 * 
 * Security: Validates token via URL path (primary) or X-RAG-Token header (fallback)
 * 
 * Endpoint: POST /api/webhooks/elevenlabs/rag-tool/:token/:elevenLabsAgentId
 */
export async function handleRAGToolWebhook(req: Request, res: Response) {
  // Support both URL patterns:
  // - New: /api/webhooks/elevenlabs/rag-tool/:token/:agentId
  // - Legacy: /api/webhooks/elevenlabs/rag-tool/:agentId (with header auth)
  const { token: urlToken, agentId: elevenLabsAgentId } = req.params;
  
  console.log(`📚 [RAG Webhook] Received tool call for ElevenLabs agent: ${elevenLabsAgentId}`);
  
  // Debug: Log all headers to see what ElevenLabs sends
  console.log(`📚 [RAG Webhook] Request headers:`, JSON.stringify(req.headers, null, 2));
  
  try {
    // Validate authentication token - try URL token first, then header
    const { validateRAGWebhookToken } = await import('../services/rag-elevenlabs-tool');
    const headerToken = req.headers['x-rag-token'] as string | undefined;
    const providedToken = urlToken || headerToken;
    
    console.log(`📚 [RAG Webhook] Token sources - URL: ${urlToken ? 'present' : 'missing'}, Header: ${headerToken ? 'present' : 'missing'}`);
    
    if (!validateRAGWebhookToken(providedToken)) {
      console.warn(`📚 [RAG Webhook] Invalid or missing authentication token`);
      console.warn(`   URL token: ${urlToken ? urlToken.substring(0, 10) + '...' : 'none'}`);
      console.warn(`   Header token: ${headerToken ? headerToken.substring(0, 10) + '...' : 'none'}`);
      return res.status(401).json({
        response: "Unauthorized: Invalid authentication token",
        sources: []
      });
    }
    
    console.log(`📚 [RAG Webhook] Authentication successful via ${urlToken ? 'URL' : 'header'} token`);
    
    console.log(`   Request body:`, JSON.stringify(req.body, null, 2));
    
    // Extract the query from the request body
    // ElevenLabs sends the tool parameters in the body
    const query = req.body?.query || req.body?.parameters?.query || '';
    
    if (!query || typeof query !== 'string') {
      console.warn(`📚 [RAG Webhook] Invalid query received`);
      return res.json({
        response: "I need a search query to look up information in the knowledge base.",
        sources: []
      });
    }
    
    console.log(`📚 [RAG Webhook] Query: "${query.substring(0, 100)}..."`);
    
    // Look up the agent by ElevenLabs agent ID to get user ID and knowledge base IDs
    // First try incoming agents table
    let agent = await db
      .select()
      .from(incomingAgents)
      .where(eq(incomingAgents.elevenLabsAgentId, elevenLabsAgentId))
      .limit(1);
    
    let userId: string | null = null;
    let knowledgeBaseIds: string[] = [];
    
    if (agent.length > 0) {
      userId = agent[0].userId;
      knowledgeBaseIds = agent[0].knowledgeBaseIds || [];
      console.log(`📚 [RAG Webhook] Found incoming agent, user: ${userId}, KBs: ${knowledgeBaseIds.length}`);
    } else {
      // Try the regular agents table
      const regularAgent = await db
        .select()
        .from(agents)
        .where(eq(agents.elevenLabsAgentId, elevenLabsAgentId))
        .limit(1);
      
      if (regularAgent.length > 0) {
        userId = regularAgent[0].userId;
        knowledgeBaseIds = regularAgent[0].knowledgeBaseIds || [];
        console.log(`📚 [RAG Webhook] Found regular agent, user: ${userId}, KBs: ${knowledgeBaseIds.length}`);
      }
    }
    
    if (!userId) {
      console.warn(`📚 [RAG Webhook] ElevenLabs agent ${elevenLabsAgentId} not found`);
      return res.json({
        response: "I couldn't find the knowledge base for this agent.",
        sources: []
      });
    }
    
    if (knowledgeBaseIds.length === 0) {
      console.warn(`📚 [RAG Webhook] No knowledge bases assigned to agent ${elevenLabsAgentId}`);
      return res.json({
        response: "This agent doesn't have a knowledge base configured yet.",
        sources: []
      });
    }
    
    // Import the RAG tool handler
    const { handleAskKnowledgeToolCall } = await import('../services/rag-elevenlabs-tool');
    
    // Process the query through RAG
    const result = await handleAskKnowledgeToolCall(query, knowledgeBaseIds, userId);
    
    console.log(`📚 [RAG Webhook] Returning result with ${result.sources.length} sources`);
    console.log(`   Response preview: "${result.response.substring(0, 100)}..."`);
    
    // Return the result in a format ElevenLabs expects
    // For webhook tools, ElevenLabs expects a JSON response that becomes the tool result
    return res.json({
      response: result.response,
      sources: result.sources
    });
    
  } catch (error: any) {
    console.error(`❌ [RAG Webhook] Error:`, error.message);
    return res.json({
      response: "I encountered an error while searching the knowledge base. Please try again.",
      sources: []
    });
  }
}

/**
 * Handle Play Audio tool webhook - called by ElevenLabs when play_audio node executes
 * Uses Twilio REST API to play audio on the active call
 * 
 * URL format: /api/elevenlabs/tools/play-audio/:agentId
 * The agentId is the ElevenLabs agent ID, used to look up the active call
 * The audioUrl comes from the webhook payload configured in the flow
 */
export async function handlePlayAudioToolWebhook(req: Request, res: Response): Promise<void> {
  const { agentId: elevenLabsAgentId } = req.params;
  
  try {
    console.log('[PlayAudio Webhook] Received request for agent:', elevenLabsAgentId);
    console.log('[PlayAudio Webhook] Request body:', JSON.stringify(req.body));
    
    const { audioUrl, interruptible, waitForComplete } = req.body;
    
    if (!audioUrl) {
      console.error('[PlayAudio Webhook] Missing audioUrl');
      res.status(400).json({ error: 'Missing audioUrl' });
      return;
    }
    
    // Look up the agent by ElevenLabs agent ID to find the active call
    const agent = await db
      .select({ id: agents.id, userId: agents.userId })
      .from(agents)
      .where(eq(agents.elevenLabsAgentId, elevenLabsAgentId))
      .limit(1);
    
    if (agent.length === 0) {
      console.warn(`[PlayAudio Webhook] No agent found with ElevenLabs ID ${elevenLabsAgentId}`);
      res.json({
        success: false,
        message: "Could not find the agent to play audio."
      });
      return;
    }
    
    const dbAgentId = agent[0].id;
    const userId = agent[0].userId;
    
    // ========================================
    // CHECK FOR ELEVENLABS SIP CALLS FIRST
    // ElevenLabs SIP calls are managed by ElevenLabs natively - audio is handled
    // through the ElevenLabs workflow, not via Twilio
    // Only match calls with engine 'elevenlabs-sip' to avoid false positives
    // ========================================
    const [activeSipCall] = await db
      .select({
        id: sipCalls.id,
        engine: sipCalls.engine,
        status: sipCalls.status,
        externalCallId: sipCalls.externalCallId
      })
      .from(sipCalls)
      .where(
        and(
          eq(sipCalls.agentId, dbAgentId),
          eq(sipCalls.engine, 'elevenlabs-sip'),
          inArray(sipCalls.status, ['initiated', 'ringing', 'in-progress', 'connected'])
        )
      )
      .orderBy(sql`${sipCalls.startedAt} DESC`)
      .limit(1);
    
    if (activeSipCall) {
      // SIP call found - ElevenLabs handles audio natively through the workflow
      // For ElevenLabs SIP, the audio URL is already configured in the workflow tool
      // The webhook acknowledgment allows the flow to continue
      const domain = getDomain();
      // Handle various audio URL formats
      let resolvedUrl = audioUrl;
      if (!audioUrl.startsWith('http')) {
        if (!audioUrl.startsWith('/')) {
          resolvedUrl = `/audio/${audioUrl}`;
        }
      }
      const fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${domain}${resolvedUrl}`;
      
      console.log(`[PlayAudio Webhook] SIP call detected (${activeSipCall.engine})`);
      console.log(`   Call ID: ${activeSipCall.id}`);
      console.log(`   Audio URL: ${fullAudioUrl}`);
      console.log(`   Note: ElevenLabs SIP handles audio natively through the workflow`);
      
      // Return success so ElevenLabs workflow continues
      // The audio playback is handled by ElevenLabs through its native workflow execution
      res.json({ 
        success: true, 
        message: 'Audio acknowledged for SIP call - ElevenLabs handles playback natively',
        audioUrl: fullAudioUrl,
        engine: activeSipCall.engine,
        callId: activeSipCall.id
      });
      return;
    }
    
    // ========================================
    // REGULAR TWILIO-BASED CALLS
    // ========================================
    
    // Find the most recent in-progress call for this specific agent
    // Strategy: Query calls through campaigns that use this agent
    // This ensures we target the correct call even with concurrent calls
    const [activeCall] = await db
      .select({
        id: calls.id,
        twilioSid: calls.twilioSid,
        status: calls.status,
        campaignId: calls.campaignId
      })
      .from(calls)
      .innerJoin(campaigns, eq(calls.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.agentId, dbAgentId),
          eq(calls.status, 'in-progress')
        )
      )
      .orderBy(sql`${calls.createdAt} DESC`)
      .limit(1);
    
    // If no campaign-based call found, try incoming connections for this agent
    let callSid: string | null = activeCall?.twilioSid || null;
    
    if (!callSid) {
      // Check incoming connections for this agent
      const [incomingCall] = await db
        .select({
          id: calls.id,
          twilioSid: calls.twilioSid,
          status: calls.status
        })
        .from(calls)
        .innerJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id))
        .where(
          and(
            eq(incomingConnections.agentId, dbAgentId),
            eq(calls.status, 'in-progress')
          )
        )
        .orderBy(sql`${calls.createdAt} DESC`)
        .limit(1);
      
      callSid = incomingCall?.twilioSid || null;
    }
    
    // If still no call found, check for flow test calls via flowExecutions
    // Flow test calls link: agent.flowId -> flowExecutions.flowId -> flowExecutions.callId -> calls.twilioSid
    if (!callSid) {
      // Get the agent's flowId to find associated flow executions
      const [agentFlow] = await db
        .select({ flowId: agents.flowId })
        .from(agents)
        .where(eq(agents.id, dbAgentId));
      
      if (agentFlow?.flowId) {
        // Find in-progress flow executions for this flow
        const [flowTestCall] = await db
          .select({
            id: calls.id,
            twilioSid: calls.twilioSid,
            status: calls.status
          })
          .from(calls)
          .innerJoin(flowExecutions, eq(flowExecutions.callId, calls.id))
          .where(
            and(
              eq(flowExecutions.flowId, agentFlow.flowId),
              eq(calls.status, 'in-progress'),
              eq(calls.userId, userId)
            )
          )
          .orderBy(sql`${calls.createdAt} DESC`)
          .limit(1);
        
        if (flowTestCall?.twilioSid) {
          callSid = flowTestCall.twilioSid;
          console.log(`[PlayAudio Webhook] Found flow test call: ${callSid}`);
        }
      }
    }
    
    if (!callSid) {
      console.warn(`[PlayAudio Webhook] No active call with Twilio SID found for agent ${dbAgentId}`);
      // Don't fail - the audio might have been requested but call ended
      res.json({
        success: false,
        message: "No active call found. Audio playback skipped."
      });
      return;
    }
    
    // Get the base URL for audio files
    const domain = getDomain();
    // Handle various audio URL formats:
    // - Full URL: https://domain.com/audio/file.mp3
    // - Path: /audio/file.mp3
    // - Filename only: file.mp3 (assume it's in /audio/)
    let resolvedAudioUrl = audioUrl;
    if (!audioUrl.startsWith('http')) {
      if (!audioUrl.startsWith('/')) {
        resolvedAudioUrl = `/audio/${audioUrl}`;
      }
    }
    const fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${domain}${resolvedAudioUrl}`;
    
    console.log(`[PlayAudio Webhook] Playing audio on call ${callSid}: ${fullAudioUrl}`);
    
    // Use Twilio REST API to play audio on the call
    const twilioClient = await getTwilioClient();
    if (!twilioClient) {
      console.error('[PlayAudio Webhook] Twilio client not available');
      res.status(500).json({ error: 'Twilio client not configured' });
      return;
    }
    
    try {
      // Create TwiML to play the audio
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.play({ loop: 1 }, fullAudioUrl);
      
      // Update the call with the new TwiML
      await twilioClient.calls(callSid).update({
        twiml: twiml.toString()
      });
      
      console.log(`[PlayAudio Webhook] Audio playback initiated on call ${callSid}`);
      res.json({ 
        success: true, 
        message: 'Audio playback initiated',
        audioUrl: fullAudioUrl,
        callSid
      });
    } catch (twilioError: any) {
      console.error('[PlayAudio Webhook] Twilio API error:', twilioError.message);
      res.status(500).json({ 
        error: 'Failed to play audio',
        details: 'An error occurred while initiating audio playback'
      });
    }
  } catch (error: any) {
    console.error('[PlayAudio Webhook] Error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
}
