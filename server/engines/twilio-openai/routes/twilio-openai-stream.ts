'use strict';
/**
 * ============================================================
 * Twilio-OpenAI WebSocket Stream Handler
 * 
 * Handles bidirectional WebSocket connection from Twilio Media Streams.
 * Bridges audio between Twilio and OpenAI Realtime API.
 * 
 * For incoming calls, the session is initialized here (on 'start' event)
 * to ensure the Twilio WebSocket is ready before OpenAI starts sending audio.
 * This prevents the 5-8 second delay that occurred when session was created
 * in the webhook before the stream connected.
 * ============================================================
 */

import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TwilioOpenAIAudioBridge } from '../services/audio-bridge.service';
import { OpenAIPoolService } from '../../plivo/services/openai-pool.service';
import { OpenAIAgentFactory } from '../services/openai-agent-factory';
import { hydrateCompiledTools, type CompiledFunctionTool } from '../../../services/openai-voice-agent';
import { db } from '../../../db';
import { twilioOpenaiCalls, calls, users, creditTransactions, flowExecutions } from '@shared/schema';
import { eq, sql, and, desc } from 'drizzle-orm';
import { logger } from '../../../utils/logger';
import { TWILIO_OPENAI_CONFIG, getRecordingWebhookUrl } from '../config/twilio-openai-config';
import { getTwilioClient } from '../../../services/twilio-connector';
import { CallInsightsService } from '../../../services/call-insights.service';
import type { TwilioMediaStreamEvent } from '../types';
import type { OpenAIVoice, OpenAIRealtimeModel, AgentTool } from '../types';

let sharedWss: WebSocketServer | null = null;

export function setupTwilioOpenAIStreamHandler(httpServer: HttpServer): void {
  if (!sharedWss) {
    sharedWss = new WebSocketServer({ noServer: true });
  }

  httpServer.on('upgrade', async (request, socket, head) => {
    const pathname = request.url?.split('?')[0] || '';
    
    if (pathname.startsWith('/api/twilio-openai/stream/')) {
      const callSid = pathname.split('/api/twilio-openai/stream/')[1];
      
      if (!callSid) {
        console.error(`[TwilioOpenAI Stream] Invalid stream URL: ${pathname}`);
        socket.destroy();
        return;
      }
      
      // Security: Verify the call exists in our database before accepting the stream
      // This prevents unauthorized WebSocket connections with arbitrary call SIDs
      try {
        const [existingCall] = await db
          .select({ id: twilioOpenaiCalls.id })
          .from(twilioOpenaiCalls)
          .where(eq(twilioOpenaiCalls.twilioCallSid, callSid))
          .limit(1);
        
        if (!existingCall) {
          console.error(`[TwilioOpenAI Stream] Security: Rejecting stream for unknown call SID: ${callSid}`);
          socket.destroy();
          return;
        }
      } catch (err: any) {
        console.error(`[TwilioOpenAI Stream] Security: Database error validating call SID: ${err.message}`);
        socket.destroy();
        return;
      }
      
      console.log(`[TwilioOpenAI Stream] Handling WebSocket upgrade for call: ${callSid}`);
      
      sharedWss!.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        console.log(`[TwilioOpenAI Stream] WebSocket connected for call: ${callSid}`);
        handleTwilioStreamConnection(ws, callSid);
      });
    }
  });

  console.log('✅ Twilio-OpenAI WebSocket stream endpoint registered');
}

function handleTwilioStreamConnection(ws: WebSocket, callSid: string): void {
  let streamSid: string | null = null;
  let sessionInitialized = false;

  ws.on('message', async (message: Buffer | string) => {
    try {
      const data = typeof message === 'string' ? message : message.toString();
      const event: TwilioMediaStreamEvent = JSON.parse(data);

      if (event.event === 'connected') {
        console.log(`[TwilioOpenAI Stream] Connected event for ${callSid}`);
      }

      if (event.event === 'start' && event.start) {
        streamSid = event.start.streamSid;
        console.log(`[TwilioOpenAI Stream] Stream started: ${streamSid}`);
        
        // Check if session already exists (outbound calls create session before call)
        const existingSession = TwilioOpenAIAudioBridge.getSession(callSid);
        if (existingSession) {
          // Outbound call - session already exists, just set the WebSocket
          TwilioOpenAIAudioBridge.setTwilioWebSocket(callSid, ws, streamSid);
          sessionInitialized = true;
        } else {
          // Incoming call - session needs to be created now that stream is connected
          console.log(`[TwilioOpenAI Stream] No existing session for ${callSid}, initializing for incoming call`);
          await initializeSession(callSid, ws, streamSid);
          sessionInitialized = true;
        }

        // Start recording now that the stream is live (works for both inbound and outbound).
        // This is more reliable than the /voice/status callback approach because Twilio only
        // fires status callbacks for inbound calls when the phone number has a Status Callback
        // URL configured at the account level, which we don't set. The stream start event fires
        // unconditionally as soon as Twilio begins sending audio.
        if (TWILIO_OPENAI_CONFIG.recordCalls) {
          try {
            const twilioClient = await getTwilioClient();
            const recordingCallback = getRecordingWebhookUrl();
            await twilioClient.calls(callSid).recordings.create({
              recordingStatusCallback: recordingCallback,
              recordingStatusCallbackEvent: ['completed'],
              recordingChannels: 'dual',
            });
            logger.info(`Recording started for call ${callSid} (stream start)`, undefined, 'TwilioOpenAI');
          } catch (recordError: any) {
            logger.warn(`Recording start failed for call ${callSid}: ${recordError.message} (non-critical)`, undefined, 'TwilioOpenAI');
          }
        }
      }

      // Only forward media after session is initialized
      if (sessionInitialized) {
        TwilioOpenAIAudioBridge.handleTwilioMedia(callSid, event);
      }

    } catch (error: any) {
      console.error(`[TwilioOpenAI Stream] Error processing message:`, error.message);
    }
  });

  ws.on('close', async (code: number, reason: Buffer) => {
    console.log(`[TwilioOpenAI Stream] WebSocket closed for ${callSid}: ${code} ${reason?.toString() || ''}`);
    
    try {
      const result = await TwilioOpenAIAudioBridge.endSession(callSid);
      logger.info(`Session ended: duration ${result.duration}s, transcript length: ${result.transcript?.length || 0}`, undefined, 'TwilioOpenAI Stream');
      
      // Get call record by Twilio CallSid
      const [callRecord] = await db
        .select()
        .from(twilioOpenaiCalls)
        .where(eq(twilioOpenaiCalls.twilioCallSid, callSid))
        .limit(1);
      
      if (callRecord) {
        // Note: Credit deduction for outbound Twilio+OpenAI calls is handled by
        // the /voice/status webhook (twilio-openai-webhooks.ts) using Twilio's
        // authoritative `CallDuration` (answered duration only — excludes
        // ringing/setup time). Inbound calls bill via the `onSessionEnd`
        // callback registered in `initializeSession` below. `deductCallCredits`
        // is idempotent (advisory lock + reference uniqueness on
        // `credit_transactions.reference = 'twilio-openai:<callId>'`) so any
        // overlap between paths is a safe no-op.

        // Save transcript to database
        if (result.transcript) {
          await db
            .update(twilioOpenaiCalls)
            .set({ transcript: result.transcript })
            .where(eq(twilioOpenaiCalls.id, callRecord.id));
          logger.info(`Saved transcript for call ${callRecord.id}`, undefined, 'TwilioOpenAI Stream');
        }
        
        // Generate AI insights from transcript if available
        if (result.transcript && result.transcript.length > 50 && callRecord.openaiCredentialId) {
          try {
            const credential = await OpenAIPoolService.getCredentialById(callRecord.openaiCredentialId);
            
            if (credential?.apiKey) {
              logger.info(`Generating AI insights for call ${callRecord.id}`, undefined, 'TwilioOpenAI Stream');
              const insights = await CallInsightsService.analyzeTranscript(
                result.transcript,
                {
                  callId: callRecord.id,
                  fromNumber: callRecord.fromNumber || undefined,
                  toNumber: callRecord.toNumber || undefined,
                  duration: result.duration
                },
                credential.apiKey
              );
              
              if (insights) {
                await db
                  .update(twilioOpenaiCalls)
                  .set({
                    aiSummary: insights.aiSummary,
                    sentiment: insights.sentiment,
                    classification: insights.classification,
                  })
                  .where(eq(twilioOpenaiCalls.id, callRecord.id));
                logger.info(`Generated AI insights for call ${callRecord.id}: sentiment=${insights.sentiment}, classification=${insights.classification}`, undefined, 'TwilioOpenAI Stream');

                // Also sync insights to canonical calls table for campaign UI display.
                // Use the most recently created calls row to avoid overwriting the initial call.
                if (callRecord.campaignId && callRecord.contactId) {
                  try {
                    const [latestRow] = await db
                      .select({ id: calls.id })
                      .from(calls)
                      .where(and(
                        eq(calls.campaignId, callRecord.campaignId),
                        eq(calls.contactId, callRecord.contactId)
                      ))
                      .orderBy(desc(calls.createdAt))
                      .limit(1);
                    if (latestRow) {
                      await db
                        .update(calls)
                        .set({
                          ...(insights.aiSummary ? { aiSummary: insights.aiSummary } : {}),
                          ...(insights.sentiment ? { sentiment: insights.sentiment } : {}),
                          ...(insights.classification ? { classification: insights.classification } : {}),
                        })
                        .where(eq(calls.id, latestRow.id));
                    }
                  } catch (syncErr: any) {
                    logger.error(`Failed to sync insights to calls table for ${callRecord.id}: ${syncErr.message}`, undefined, 'TwilioOpenAI Stream');
                  }
                }
              }
            } else {
              logger.warn(`No OpenAI credential available for AI analysis on call ${callRecord.id}`, undefined, 'TwilioOpenAI Stream');
            }
          } catch (insightError: any) {
            logger.error(`Failed to generate call insights for ${callRecord.id}`, insightError, 'TwilioOpenAI Stream');
          }
        }
        
        // Update flow execution status to completed
        try {
          const [flowExec] = await db
            .select()
            .from(flowExecutions)
            .where(eq(flowExecutions.callId, callRecord.id))
            .limit(1);
          
          if (flowExec && flowExec.status === 'running') {
            await db
              .update(flowExecutions)
              .set({
                status: 'completed',
                completedAt: new Date(),
              })
              .where(eq(flowExecutions.id, flowExec.id));
            logger.info(`Updated flow execution ${flowExec.id} to completed`, undefined, 'TwilioOpenAI Stream');
          }
        } catch (flowExecError: any) {
          logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'TwilioOpenAI Stream');
        }
      }
    } catch (err: any) {
      console.error(`[TwilioOpenAI Stream] Error ending session:`, err.message);
    }
  });

  ws.on('error', (error: Error) => {
    console.error(`[TwilioOpenAI Stream] WebSocket error for ${callSid}:`, error.message);
  });
}

/**
 * Initialize the audio bridge session for incoming calls
 * This is called when the Twilio stream 'start' event fires and no session exists
 */
async function initializeSession(
  callSid: string,
  twilioWs: WebSocket,
  streamSid: string | null
): Promise<void> {
  try {
    logger.info(`Initializing session for incoming call ${callSid}`, undefined, 'TwilioOpenAI Stream');

    // Get call record by Twilio CallSid
    const [callRecord] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(eq(twilioOpenaiCalls.twilioCallSid, callSid))
      .limit(1);

    if (!callRecord) {
      logger.error(`Call record not found for: ${callSid}`, undefined, 'TwilioOpenAI Stream');
      twilioWs.close();
      return;
    }

    // Get OpenAI API key from the reserved credential
    if (!callRecord.openaiCredentialId) {
      logger.error(`No OpenAI credential attached to call ${callSid}`, undefined, 'TwilioOpenAI Stream');
      twilioWs.close();
      return;
    }

    const credential = await OpenAIPoolService.getCredentialById(callRecord.openaiCredentialId);
    if (!credential?.apiKey) {
      logger.error(`OpenAI credential not found for ${callSid}`, undefined, 'TwilioOpenAI Stream');
      twilioWs.close();
      return;
    }

    // Get user's subscription tier for model validation
    let userTier: 'free' | 'pro' = 'free';
    if (callRecord.userId) {
      const [user] = await db
        .select({ planType: users.planType })
        .from(users)
        .where(eq(users.id, callRecord.userId))
        .limit(1);
      if (user) {
        userTier = OpenAIPoolService.getModelTierForUser(user.planType);
      }
    }

    // Get agent config from call metadata (stored during webhook)
    const metadata = callRecord.metadata as Record<string, unknown> | null;
    
    // Check if this is a flow agent with pre-compiled tools
    const isFlowAgent = metadata?.isFlowAgent === true;
    const compiledTools = metadata?.compiledTools as CompiledFunctionTool[] | undefined;
    
    let agentConfig;
    
    if (isFlowAgent && compiledTools && compiledTools.length > 0) {
      // Flow agent - use pre-compiled tools and system prompt
      logger.info(`Initializing flow agent with ${compiledTools.length} compiled tools`, undefined, 'TwilioOpenAI Stream');
      
      // Hydrate compiled tools with proper handlers (including play_audio metadata)
      const hydratedTools = hydrateCompiledTools(compiledTools, {
        userId: callRecord.userId || '',
        agentId: callRecord.agentId || '',
        callId: callRecord.id,
        knowledgeBaseIds: metadata?.knowledgeBaseIds as string[] || [],
        transferPhoneNumber: metadata?.transferPhoneNumber as string || undefined,
      });
      
      // Build agent config with hydrated flow tools, using factory for tier-validated model
      const flowConfig = OpenAIAgentFactory.createAgentConfig({
        voice: (callRecord.openaiVoice as OpenAIVoice) || TWILIO_OPENAI_CONFIG.defaultVoice,
        model: (callRecord.openaiModel as OpenAIRealtimeModel) || TWILIO_OPENAI_CONFIG.openaiRealtimeModel,
        systemPrompt: (metadata?.systemPrompt as string) || 'You are a helpful AI assistant.',
        firstMessage: (metadata?.firstMessage as string) || undefined,
        temperature: (metadata?.temperature as number) ?? 0.7,
        userTier,
      });
      agentConfig = {
        ...flowConfig,
        tools: hydratedTools,
      };

      // Inject collect-email tool into flow agents when email messaging is enabled
      if (metadata?.messagingEmailEnabled && callRecord.userId && callRecord.agentId) {
        agentConfig = OpenAIAgentFactory.addCollectCallerEmailTool(
          agentConfig,
          callRecord.userId,
          callRecord.agentId,
          callRecord.id
        );
        logger.info(`Flow agent: collect_caller_email tool added (email messaging enabled)`, undefined, 'TwilioOpenAI Stream');
      }

      logger.info(`Flow agent initialized with ${agentConfig.tools?.length ?? hydratedTools.length} tools including play_audio support`, undefined, 'TwilioOpenAI Stream');
    } else {
      // Natural agent - build agent config from scratch
      agentConfig = OpenAIAgentFactory.createAgentConfig({
        voice: (callRecord.openaiVoice as OpenAIVoice) || TWILIO_OPENAI_CONFIG.defaultVoice,
        model: (callRecord.openaiModel as OpenAIRealtimeModel) || TWILIO_OPENAI_CONFIG.openaiRealtimeModel as OpenAIRealtimeModel,
        systemPrompt: (metadata?.systemPrompt as string) || 'You are a helpful AI assistant.',
        firstMessage: (metadata?.firstMessage as string) || undefined,
        temperature: (metadata?.temperature as number) ?? 0.7,
        userTier,
        toolContext: {
          userId: callRecord.userId || '',
          agentId: callRecord.agentId || '',
          callId: callRecord.id,
        },
        language: (metadata?.language as string) || 'en',
      });

      // Add knowledge base tool if configured
      const knowledgeBaseIds = metadata?.knowledgeBaseIds as string[] | undefined;
      if (knowledgeBaseIds && knowledgeBaseIds.length > 0 && callRecord.userId) {
        agentConfig = OpenAIAgentFactory.addKnowledgeBaseTool(
          agentConfig,
          knowledgeBaseIds,
          callRecord.userId
        );
      }

      // Add appointment tool if enabled
      if (metadata?.appointmentBookingEnabled && callRecord.userId && callRecord.agentId) {
        const callerPhone = callRecord.callDirection === 'inbound' ? callRecord.fromNumber : callRecord.toNumber;
        agentConfig = OpenAIAgentFactory.addAppointmentTool(
          agentConfig,
          callRecord.userId,
          callRecord.agentId,
          callRecord.id,
          callerPhone || undefined
        );
      }

      // Add transfer tool if configured
      if (metadata?.transferEnabled && metadata?.transferPhoneNumber) {
        agentConfig = OpenAIAgentFactory.addTransferTool(
          agentConfig,
          metadata.transferPhoneNumber as string,
          undefined
        );
      }

      // Add end call tool if enabled
      if (metadata?.endConversationEnabled) {
        agentConfig = OpenAIAgentFactory.addEndCallTool(agentConfig);
      }

      // Enable language detection if enabled
      if (metadata?.detectLanguageEnabled) {
        agentConfig = OpenAIAgentFactory.enableLanguageDetection(agentConfig);
      }

      // Add collect caller email tool if email messaging is enabled (for post-call follow-up)
      if (metadata?.messagingEmailEnabled && callRecord.userId && callRecord.agentId) {
        agentConfig = OpenAIAgentFactory.addCollectCallerEmailTool(
          agentConfig,
          callRecord.userId,
          callRecord.agentId,
          callRecord.id
        );
      }

      // Add messaging email tool if enabled
      if (metadata?.messagingEmailEnabled && callRecord.userId && callRecord.agentId) {
        agentConfig = OpenAIAgentFactory.addMessagingEmailTool(
          agentConfig,
          callRecord.userId,
          callRecord.agentId,
          callRecord.id,
          metadata.messagingEmailTemplate as string | undefined
        );
      }

      // Add messaging WhatsApp tool if enabled
      if (metadata?.messagingWhatsappEnabled && callRecord.userId && callRecord.agentId) {
        agentConfig = OpenAIAgentFactory.addMessagingWhatsAppTool(
          agentConfig,
          callRecord.userId,
          callRecord.agentId,
          callRecord.id,
          metadata.messagingWhatsappTemplate as string | undefined,
          [],
          metadata.messagingWhatsappVariables as string | undefined
        );
      }
    }

    // ALWAYS ensure end_call tool is available for flow agents
    // This ensures the agent can properly end calls after completing conversations
    const hasFlowPrompt = metadata?.systemPrompt && (metadata.systemPrompt as string).includes('Conversation States');
    if (hasFlowPrompt && !agentConfig.tools?.some((t: AgentTool) => t.name === 'end_call')) {
      agentConfig = OpenAIAgentFactory.addEndCallTool(agentConfig);
      logger.info(`Added end_call tool to flow agent for ${callSid}`, undefined, 'TwilioOpenAI Stream');
    }

    logger.info(`Creating session with ${agentConfig.tools?.length || 0} tools for ${callSid}`, undefined, 'TwilioOpenAI Stream');

    // Create the session with the Twilio WebSocket already connected
    await TwilioOpenAIAudioBridge.createSession({
      callSid,
      openaiApiKey: credential.apiKey,
      agentConfig,
      twilioWs,
      streamSid: streamSid || undefined,
      fromNumber: callRecord.fromNumber || undefined,
      toNumber: callRecord.toNumber || undefined,
      callDirection: callRecord.callDirection as 'inbound' | 'outbound' || 'inbound',
    });

    logger.info(`Session created for incoming call ${callSid}`, undefined, 'TwilioOpenAI Stream');

    // Set up the onSessionEnd callback for credit deduction and cleanup
    const callUserId = callRecord.userId;
    const callId = callRecord.id;
    const credentialId = callRecord.openaiCredentialId;
    const fromNumber = callRecord.fromNumber;
    const toNumber = callRecord.toNumber;
    const openaiApiKey = credential.apiKey; // Capture for AI analysis
    const callCampaignId = callRecord.campaignId; // Captured for calls table sync
    const callContactId = callRecord.contactId;   // Captured for calls table sync

    TwilioOpenAIAudioBridge.onSessionEnd(callSid, async (sessionData) => {
      try {
        const updates: Record<string, unknown> = {
          status: 'completed',
          endedAt: new Date(),
        };
        
        if (sessionData?.transcript) {
          updates.transcript = sessionData.transcript;
          
          // Generate AI insights from transcript using CallInsightsService
          if (sessionData.transcript.length > 50) {
            try {
              const toNumber = callRecord.toNumber;
              const insights = await CallInsightsService.analyzeTranscript(
                sessionData.transcript,
                {
                  callId: callId,
                  fromNumber: fromNumber || undefined,
                  toNumber: toNumber || undefined,
                  duration: sessionData?.duration
                },
                openaiApiKey // Pass the API key from the call's credential
              );
              
              if (insights) {
                updates.aiSummary = insights.aiSummary;
                updates.sentiment = insights.sentiment;
                updates.classification = insights.classification;
                if (insights.keyPoints) updates.keyPoints = insights.keyPoints;
                if (insights.nextActions) updates.nextActions = insights.nextActions;
                logger.info(`Generated AI insights for call ${callId}`, { 
                  sentiment: insights.sentiment, 
                  classification: insights.classification 
                }, 'TwilioOpenAI Stream');
              }
            } catch (insightError: any) {
              logger.error('Failed to generate call insights', insightError, 'TwilioOpenAI Stream');
            }
          }
        }
        if (sessionData?.duration) {
          updates.duration = sessionData.duration;
        }
        if (sessionData?.openaiSessionId) {
          updates.openaiSessionId = sessionData.openaiSessionId;
        }
        
        await db
          .update(twilioOpenaiCalls)
          .set(updates)
          .where(eq(twilioOpenaiCalls.id, callId));
          
        logger.info(`Call ${callId} record updated (${updates.duration || 0}s, session: ${sessionData?.openaiSessionId || 'N/A'})`, undefined, 'TwilioOpenAI Stream');

        // Sync AI insights and call data to canonical calls table for campaign UI display.
        // This is the definitive sync point: by the time onSessionEnd fires, all
        // insights (sentiment, classification, transcript, duration) are already in `updates`.
        // We target the MOST RECENTLY CREATED calls row to avoid overwriting the initial call
        // row when a retry fires for the same contact.
        if (callCampaignId && callContactId) {
          try {
            const callsSync: Record<string, unknown> = {};
            if (updates.transcript) callsSync.transcript = updates.transcript;
            if (updates.aiSummary) callsSync.aiSummary = updates.aiSummary;
            if (updates.sentiment) callsSync.sentiment = updates.sentiment;
            if (updates.classification) callsSync.classification = updates.classification;
            if (updates.duration) callsSync.duration = updates.duration;
            if (Object.keys(callsSync).length > 0) {
              const [latestCallsRow] = await db
                .select({ id: calls.id })
                .from(calls)
                .where(and(
                  eq(calls.campaignId, callCampaignId),
                  eq(calls.contactId, callContactId)
                ))
                .orderBy(desc(calls.createdAt))
                .limit(1);
              if (latestCallsRow) {
                await db
                  .update(calls)
                  .set(callsSync)
                  .where(eq(calls.id, latestCallsRow.id));
                logger.info(`Synced insights to calls table for contact ${callContactId} (campaign ${callCampaignId})`, undefined, 'TwilioOpenAI Stream');
              }
            }
          } catch (syncErr: any) {
            logger.error(`Failed to sync insights to calls table for call ${callId}: ${syncErr.message}`, undefined, 'TwilioOpenAI Stream');
          }
        }

        // Deduct credits based on call duration (1 credit = 1 minute, minimum 1 second)
        if (callUserId && sessionData?.duration && sessionData.duration >= 1) {
          const creditsToDeduct = Math.ceil(sessionData.duration / 60);
          
          if (creditsToDeduct > 0) {
            // Use centralized credit service for atomic, idempotent deduction
            const { deductCallCredits } = await import('../../../services/credit-service');
            const creditResult = await deductCallCredits({
              userId: callUserId,
              creditsToDeduct,
              callId,
              fromNumber: fromNumber || 'Unknown',
              toNumber: toNumber || 'Unknown',
              durationSeconds: sessionData.duration,
              engine: 'twilio-openai',
            });
            
            // Handle credit deduction failure
            if (!creditResult.success && !creditResult.alreadyDeducted) {
              logger.error(`Credit deduction failed for call ${callId}: ${creditResult.error}`, undefined, 'TwilioOpenAI Stream');
              
              // Update call status to reflect credit deduction failure
              try {
                await db
                  .update(twilioOpenaiCalls)
                  .set({ 
                    status: 'credit_failed',
                    metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditError: creditResult.error, creditsRequired: creditsToDeduct })}::jsonb`
                  })
                  .where(eq(twilioOpenaiCalls.id, callId));
                logger.warn(`Call ${callId} marked as credit_failed - insufficient credits (required: ${creditsToDeduct})`, undefined, 'TwilioOpenAI Stream');
              } catch (updateError: any) {
                logger.error(`Failed to update call status for credit failure: ${updateError.message}`, updateError, 'TwilioOpenAI Stream');
              }
              
              // Release OpenAI slot and halt further processing - no success workflows should run after credit failure
              if (credentialId) {
                await OpenAIPoolService.releaseSlot(credentialId);
              }
              return;
            } else if (creditResult.success && creditResult.creditsDeducted > 0) {
              logger.info(`Credits deducted for call ${callId}: ${creditResult.creditsDeducted} credits, new balance: ${creditResult.newBalance}`, undefined, 'TwilioOpenAI Stream');
            }
          }
        }
        // CRM Lead Creation - Process call for qualified lead creation
        if (callUserId) {
          try {
            const { CRMLeadProcessor } = await import('../../crm/lead-processor.service');
            const result = await CRMLeadProcessor.processTwilioOpenAICall(callId);
            if (result?.leadId) {
              logger.info(`CRM lead created: ${result.leadId} (${result.qualification.category})`, undefined, 'TwilioOpenAI Stream');
            } else if (result) {
              logger.info(`Call did not qualify for CRM lead`, undefined, 'TwilioOpenAI Stream');
            }
          } catch (crmError: any) {
            logger.error(`Failed to create CRM lead: ${crmError.message}`, crmError, 'TwilioOpenAI Stream');
          }
        }

        // Post-call messaging trigger for Twilio-OpenAI engine
        if (callUserId && callRecord?.agentId) {
          try {
            const callerPhone = callRecord.callDirection === 'inbound'
              ? (callRecord.fromNumber || '')
              : (callRecord.toNumber || '');
            const { triggerPostCallMessaging } = await import('../../../services/post-call-messaging');
            await triggerPostCallMessaging({
              elevenLabsAgentId: callRecord.agentId,
              userId: callUserId,
              callerPhone,
              callId,
            });
          } catch (msgErr: any) {
            logger.error(`Post-call messaging error: ${msgErr.message}`, msgErr, 'TwilioOpenAI Stream');
          }
        }
      } catch (error: any) {
        logger.error('Error updating call record', error, 'TwilioOpenAI Stream');
      }
      
      // Release the OpenAI slot
      if (credentialId) {
        await OpenAIPoolService.releaseSlot(credentialId);
      }
    });

    // Update call with session ID
    const session = TwilioOpenAIAudioBridge.getSession(callSid);
    if (session?.openaiSessionId) {
      await db
        .update(twilioOpenaiCalls)
        .set({ openaiSessionId: session.openaiSessionId })
        .where(eq(twilioOpenaiCalls.id, callId));
    }

  } catch (error: any) {
    logger.error(`Failed to initialize session for ${callSid}: ${error.message}`, error, 'TwilioOpenAI Stream');
  }
}
