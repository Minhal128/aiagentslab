'use strict';
/**
 * ============================================================
 * Plivo WebSocket Stream Endpoint
 * 
 * Handles bidirectional audio streaming:
 * - Receives mulaw audio from Plivo
 * - Bridges to OpenAI Realtime API
 * - Sends agent audio back to Plivo
 * ============================================================
 */

import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AudioBridgeService } from '../services/audio-bridge.service';
import { PlivoCallService } from '../services/plivo-call.service';
import { OpenAIPoolService } from '../services/openai-pool.service';
import { OpenAIAgentFactory } from '../services/openai-agent-factory';
import { CallInsightsService } from '../../../services/call-insights.service';
import { db } from '../../../db';
import { plivoCalls, agents, users, flowExecutions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../../../utils/logger';
import type { OpenAIVoice, OpenAIRealtimeModel, AgentTool } from '../types';

interface PlivoStreamMessage {
  event: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    tracks: string[];
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    callSid: string;
  };
}

/**
 * Setup Plivo WebSocket stream handler on the HTTP server
 * Uses the same pattern as other WebSocket handlers in the codebase
 */
export function setupPlivoStream(httpServer: HttpServer): void {
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0] || '';
    
    // Only handle Plivo stream WebSocket upgrades
    // URL pattern: /api/plivo/stream/:callUuid
    if (pathname.startsWith('/api/plivo/stream/')) {
      const callUuid = pathname.split('/api/plivo/stream/')[1];
      
      if (!callUuid) {
        logger.error(`Invalid stream URL: ${pathname}`, undefined, 'PlivoStream');
        socket.destroy();
        return;
      }
      
      logger.info(`Handling WebSocket upgrade for call: ${callUuid}`, undefined, 'PlivoStream');
      
      const wss = new WebSocketServer({ noServer: true });
      
      wss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        logger.info(`WebSocket connected for call: ${callUuid}`, undefined, 'PlivoStream');
        handlePlivoStreamConnection(ws, callUuid);
      });
    }
    // Let other handlers process non-Plivo stream requests
  });

  logger.info('Plivo WebSocket stream endpoint registered', undefined, 'PlivoStream');
}

/**
 * Handle Plivo stream WebSocket connection
 */
function handlePlivoStreamConnection(ws: WebSocket, callUuid: string): void {
  let streamSid: string | null = null;
  let sessionInitialized = false;

  ws.on('message', async (data: Buffer | string) => {
    try {
      const rawData = typeof data === 'string' ? data : data.toString('utf8');
      const message: PlivoStreamMessage = JSON.parse(rawData);
      
      if (message.event === 'connected') {
        logger.info(`Stream connected for ${callUuid}`, undefined, 'PlivoStream');
      } else if (message.event === 'start') {
        logger.info('Plivo start message received', message, 'PlivoStream');
        // Plivo uses streamId, Twilio uses streamSid - check both for compatibility
        const startData = message.start as Record<string, unknown> | undefined;
        streamSid = (startData?.streamId as string) || (startData?.streamSid as string) || message.streamSid || null;
        logger.info(`Stream started for ${callUuid}, streamId: ${streamSid}`, undefined, 'PlivoStream');
        
        // Initialize audio bridge session when stream starts
        if (!sessionInitialized) {
          await initializeSession(callUuid, ws, streamSid);
          sessionInitialized = true;
          // Mark the Plivo stream as ready AFTER session is initialized
          // This triggers the first message to be sent to OpenAI
          AudioBridgeService.markStreamReady(callUuid);
        }
      } else if (message.event === 'media') {
        // Forward audio to OpenAI via audio bridge
        // Only process if session is initialized (fixes race condition)
        if (sessionInitialized && message.media?.payload) {
          await AudioBridgeService.handlePlivoAudio(callUuid, message.media.payload);
        }
      } else if (message.event === 'stop') {
        logger.info(`Stream stopped for ${callUuid}`, undefined, 'PlivoStream');
      }
    } catch (error) {
      logger.error(`Error processing message for ${callUuid}`, error, 'PlivoStream');
    }
  });

  ws.on('close', async () => {
    logger.info(`Connection closed for ${callUuid}`, undefined, 'PlivoStream');
    
    try {
      const result = await AudioBridgeService.endSession(callUuid);
      logger.info(`Session ended: duration ${result.duration}s, transcript length: ${result.transcript?.length || 0}`, undefined, 'PlivoStream');
      
      // Get call to update transcript and trigger credit deduction
      const call = await PlivoCallService.getCallByUuid(callUuid);
      if (call) {
        // Update call with transcript first
        if (result.transcript) {
          await db
            .update(plivoCalls)
            .set({ transcript: result.transcript })
            .where(eq(plivoCalls.id, call.id));
          logger.info(`Saved transcript for call ${call.id}`, undefined, 'PlivoStream');
        }
        
        // Generate AI insights from transcript if available
        if (result.transcript && result.transcript.length > 50) {
          try {
            const openaiCredential = call.openaiCredentialId
              ? await OpenAIPoolService.getCredentialById(call.openaiCredentialId)
              : null;
            
            if (openaiCredential?.apiKey) {
              logger.info(`Generating AI insights for call ${call.id}`, undefined, 'PlivoStream');
              const insights = await CallInsightsService.analyzeTranscript(
                result.transcript,
                {
                  callId: call.id,
                  fromNumber: call.fromNumber || undefined,
                  toNumber: call.toNumber || undefined,
                  duration: result.duration
                },
                openaiCredential.apiKey
              );
              
              if (insights) {
                await db
                  .update(plivoCalls)
                  .set({
                    aiSummary: insights.aiSummary,
                    sentiment: insights.sentiment,
                    classification: insights.classification,
                    keyPoints: insights.keyPoints || null,
                    nextActions: insights.nextActions || null,
                  })
                  .where(eq(plivoCalls.id, call.id));
                logger.info(`Generated AI insights for call ${call.id}: sentiment=${insights.sentiment}, classification=${insights.classification}`, undefined, 'PlivoStream');
              }
            } else {
              logger.warn(`No OpenAI credential available for AI analysis on call ${call.id}`, undefined, 'PlivoStream');
            }
          } catch (insightError: any) {
            logger.error(`Failed to generate call insights for ${call.id}`, insightError, 'PlivoStream');
          }
        }
        
        // For incoming calls, set answeredAt if not already set (stream start = answered)
        if (call.callDirection === 'inbound' && !call.answeredAt) {
          await db
            .update(plivoCalls)
            .set({ answeredAt: call.startedAt || new Date() })
            .where(eq(plivoCalls.id, call.id));
          logger.info(`Set answeredAt for incoming call ${call.id}`, undefined, 'PlivoStream');
        }
        
        // Trigger call completion which handles credit deduction
        // This is essential for incoming calls that don't receive status callbacks
        if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(call.status)) {
          // If call is still 'initiated' or 'pending', query Plivo API for actual status
          if (call.status === 'initiated' || call.status === 'pending') {
            logger.info(`Call ${call.id} still at '${call.status}', querying Plivo API for actual status`, undefined, 'PlivoStream');
            const plivoStatus = await PlivoCallService.getCallStatusFromPlivo(call.id);
            
            if (plivoStatus) {
              logger.info(`Plivo API returned status '${plivoStatus.status}' for call ${call.id}`, undefined, 'PlivoStream');
              await PlivoCallService.handleCallStatus(
                call.id,
                plivoStatus.status,
                { source: 'stream_close_plivo_fallback', hangupCause: plivoStatus.hangupCause },
                plivoStatus.duration || result.duration
              );
            } else {
              // Fallback: if Plivo API fails, use session duration and mark completed
              logger.info(`Plivo API failed, using session data for call ${call.id}`, undefined, 'PlivoStream');
              await PlivoCallService.handleCallStatus(
                call.id,
                result.duration > 0 ? 'completed' : 'failed',
                { source: 'stream_close_fallback' },
                result.duration
              );
            }
          } else {
            logger.info(`Triggering call completion for ${call.id} with duration ${result.duration}s`, undefined, 'PlivoStream');
            await PlivoCallService.handleCallStatus(
              call.id, 
              'completed', 
              { source: 'stream_close' },
              result.duration
            );
          }
        }
        
        // Update flow execution status if this call has an associated flow execution
        // Re-fetch the call to get the latest status after handleCallStatus was called
        try {
          const [updatedCall] = await db
            .select({ status: plivoCalls.status })
            .from(plivoCalls)
            .where(eq(plivoCalls.id, call.id))
            .limit(1);
          
          const callStatus = updatedCall?.status || 'completed';
          
          const [flowExec] = await db
            .select()
            .from(flowExecutions)
            .where(eq(flowExecutions.callId, call.id))
            .limit(1);
          
          if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
            // Map call status to execution status - only 'completed' means success
            const execStatus = callStatus === 'completed' ? 'completed' : 'failed';
            await db
              .update(flowExecutions)
              .set({
                status: execStatus,
                completedAt: new Date(),
                error: callStatus !== 'completed' ? `Call ended with status: ${callStatus}` : null,
              })
              .where(eq(flowExecutions.id, flowExec.id));
            logger.info(`Updated flow execution ${flowExec.id} to ${execStatus} (call status: ${callStatus})`, undefined, 'PlivoStream');
          }
        } catch (flowExecError: any) {
          logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'PlivoStream');
        }
        
        // Note: OpenAI slot release is now handled in handleCallStatus
      }
    } catch (error) {
      logger.error(`Error ending session`, error, 'PlivoStream');
    }
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error for ${callUuid}`, error, 'PlivoStream');
  });
}

/**
 * Initialize the audio bridge session with OpenAI
 */
async function initializeSession(
  callUuid: string, 
  plivoWs: WebSocket, 
  streamSid: string | null
): Promise<void> {
  try {
    logger.info(`Initializing session for ${callUuid}`, undefined, 'PlivoStream');

    // Get call details
    const call = await PlivoCallService.getCallByUuid(callUuid);
    if (!call) {
      logger.error(`Call not found: ${callUuid}`, undefined, 'PlivoStream');
      return;
    }

    // Get OpenAI API key - use the one already reserved for this call
    let openaiApiKey: string | null = null;
    let openaiCredentialId: string | null = call.openaiCredentialId;
    
    if (openaiCredentialId) {
      // Use existing reserved credential
      const credential = await OpenAIPoolService.getCredentialById(openaiCredentialId);
      openaiApiKey = credential?.apiKey || null;
    }
    
    // If no credential was reserved during call setup (shouldn't happen normally),
    // the call cannot proceed - we should not reserve new slots here as they won't
    // be properly tracked and released
    if (!openaiApiKey) {
      logger.error(`No OpenAI credential attached to call ${callUuid} - call was not properly set up`, undefined, 'PlivoStream');
      plivoWs.close();
      return;
    }

    // Get user's subscription tier for model validation
    let userTier: 'free' | 'pro' = 'free';
    if (call.userId) {
      const [user] = await db
        .select({ planType: users.planType })
        .from(users)
        .where(eq(users.id, call.userId))
        .limit(1);
      if (user) {
        userTier = OpenAIPoolService.getModelTierForUser(user.planType);
      }
    }

    // Get agent configuration
    let agentConfig = {
      voice: call.openaiVoice || 'alloy',
      model: call.openaiModel || 'gpt-realtime-1.5',
      systemPrompt: 'You are a helpful voice assistant.',
      firstMessage: undefined as string | undefined,
      tools: [] as AgentTool[],
    };

    // Check if call metadata has a compiled flow (from flow agent or flow test)
    // This takes priority over agent table data
    const callMetadata = call.metadata as Record<string, unknown> | null;
    const hasCompiledFlow = callMetadata?.systemPrompt || callMetadata?.firstMessage;
    
    if (hasCompiledFlow) {
      // Use compiled flow config from metadata (flow agents)
      // The flow's systemPrompt contains all the conversation logic
      // The flow's tools contain webhooks, API calls, end_call, transfer, etc.
      logger.info(`Using compiled flow config from metadata for ${callUuid}`, undefined, 'PlivoStream');
      
      // Fetch agent early to get language setting for all createAgentConfig calls
      let flowAgent: typeof agents.$inferSelect | undefined;
      if (call.agentId) {
        const [fetchedAgent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, call.agentId))
          .limit(1);
        flowAgent = fetchedAgent;
      }
      const flowAgentLanguage = flowAgent?.language || 'en';
      
      // Store the compiled flow's systemPrompt and firstMessage
      const flowSystemPrompt = callMetadata?.systemPrompt as string || agentConfig.systemPrompt;
      const flowFirstMessage = callMetadata?.firstMessage as string || undefined;
      
      agentConfig.systemPrompt = flowSystemPrompt;
      agentConfig.firstMessage = flowFirstMessage;
      
      // Get tools from metadata (serialized during call initiation)
      // These include webhook, API call, end_call, transfer, appointment, form tools
      const serializedTools = callMetadata?.tools as Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      }> | undefined;
      
      if (serializedTools && serializedTools.length > 0) {
        // Recreate tool handlers using OpenAIAgentFactory
        // Start with base config containing the flow's systemPrompt
        let config = OpenAIAgentFactory.createAgentConfig({
          voice: agentConfig.voice as OpenAIVoice,
          model: agentConfig.model as OpenAIRealtimeModel,
          systemPrompt: flowSystemPrompt,
          firstMessage: flowFirstMessage,
          userTier,
          toolContext: {
            userId: call.userId || '',
            agentId: call.agentId || '',
            callId: call.id,
          },
          language: flowAgentLanguage,
        });
        
        // Recreate each tool with proper handlers using serialized config
        for (const tool of serializedTools) {
          const toolAny = tool as Record<string, unknown>;
          
          if (tool.name === 'end_call') {
            config = OpenAIAgentFactory.addEndCallTool(config);
          } else if (tool.name === 'transfer_call' || tool.name.startsWith('transfer_')) {
            // Handle both 'transfer_call' and flow node transfer tools like 'transfer_{nodeId}'
            // Use stored transfer number from serialization
            const transferNumber = toolAny._transferNumber as string || 
                                  (toolAny._metadata as Record<string, unknown>)?.phoneNumber as string;
            if (transferNumber) {
              // Add the transfer tool with the correct name (keep original name for flow tools)
              config = OpenAIAgentFactory.addTransferTool(config, transferNumber);
              logger.info(`[PlivoStream] Added transfer tool: ${tool.name} -> ${transferNumber}`, undefined, 'PlivoStream');
            } else {
              logger.warn(`[PlivoStream] Transfer tool ${tool.name} has no phone number`, undefined, 'PlivoStream');
            }
          } else if (tool.name === 'book_appointment') {
            const appointmentCallerPhone = call.callDirection === 'inbound' ? call.fromNumber : call.toNumber;
            config = OpenAIAgentFactory.addAppointmentTool(
              config,
              call.userId || '',
              call.agentId || '',
              call.id,
              appointmentCallerPhone || undefined
            );
          } else if (tool.name.startsWith('submit_form')) {
            // Use stored form config from serialization
            // Form tool names are like "submit_form_node_2" (with node ID suffix)
            const formId = toolAny._formId as string;
            const formName = toolAny._formName as string;
            let formFields = toolAny._formFields as Array<{ id: string; question: string; fieldType: string; isRequired: boolean }>;
            
            // If formId exists but fields are missing, fetch from database
            if (formId && (!formFields || formFields.length === 0)) {
              try {
                const { db } = await import('../../../db');
                const { formFields: formFieldsTable } = await import('@shared/schema');
                const { eq, asc } = await import('drizzle-orm');
                
                const dbFields = await db
                  .select()
                  .from(formFieldsTable)
                  .where(eq(formFieldsTable.formId, formId))
                  .orderBy(asc(formFieldsTable.order));
                
                if (dbFields && dbFields.length > 0) {
                  formFields = dbFields.map(f => ({
                    id: f.id,
                    question: f.question,
                    fieldType: f.fieldType,
                    isRequired: f.isRequired,
                  }));
                  logger.info(`[PlivoStream] Fetched ${formFields.length} fields from database for form ${formId}`, undefined, 'PlivoStream');
                }
              } catch (err: any) {
                logger.error(`[PlivoStream] Failed to fetch form fields: ${err.message}`, undefined, 'PlivoStream');
              }
            }
            
            if (formId && formFields && formFields.length > 0) {
              config = OpenAIAgentFactory.addFormTool(
                config,
                formId,
                formName || 'Form',
                formFields,
                call.userId || '',
                call.id
              );
              logger.info(`[PlivoStream] Recreated form tool: ${tool.name}`, undefined, 'PlivoStream');
            } else {
              logger.info(`[PlivoStream] Skipping form tool ${tool.name} - missing stored config (formId: ${formId}, formFields: ${formFields?.length || 0})`, undefined, 'PlivoStream');
            }
          } else if (tool.name.startsWith('api_call_')) {
            // Use stored API config from serialization
            const webhookUrl = toolAny._webhookUrl as string;
            const webhookMethod = toolAny._webhookMethod as string;
            const webhookHeaders = toolAny._webhookHeaders as Record<string, string> | undefined;
            const bodyTemplate = toolAny._bodyTemplate as string | undefined;
            const responseMapping = toolAny._responseMapping as Record<string, string> | undefined;
            
            if (webhookUrl) {
              config = OpenAIAgentFactory.addApiCallTool(config, tool.name.replace('api_call_', ''), {
                url: webhookUrl,
                method: webhookMethod || 'GET',
                headers: webhookHeaders,
                bodyTemplate: bodyTemplate,
                responseMapping: responseMapping,
                description: tool.description,
              });
            }
          } else if (tool.name.startsWith('webhook_')) {
            // Use stored webhook URL and method from serialization
            const webhookUrl = toolAny._webhookUrl as string;
            const webhookMethod = toolAny._webhookMethod as string || 'POST';
            if (webhookUrl) {
              config = OpenAIAgentFactory.addWebhookTool(
                config,
                webhookUrl,
                tool.name,
                tool.description,
                tool.parameters as Record<string, any>,
                webhookMethod
              );
            }
          } else if (tool.name.startsWith('play_audio_')) {
            // Play audio tools - pass through with _metadata intact for audio bridge to use
            const metadata = toolAny._metadata as Record<string, unknown>;
            if (metadata?.audioUrl) {
              // Add the tool directly with its metadata preserved
              config.tools = config.tools || [];
              config.tools.push({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as Record<string, unknown>,
                _metadata: metadata, // Preserve metadata for audio bridge
              } as any);
              logger.info(`[PlivoStream] Added play_audio tool: ${tool.name} -> ${metadata.audioUrl}`, undefined, 'PlivoStream');
            } else {
              logger.warn(`[PlivoStream] Play audio tool ${tool.name} has no audioUrl in metadata`, undefined, 'PlivoStream');
            }
          }
        }
        
        // Always ensure end_call tool is available for flow agents
        // (even if not explicitly in serializedTools)
        if (!config.tools?.some(t => t.name === 'end_call')) {
          config = OpenAIAgentFactory.addEndCallTool(config);
          logger.info(`Added end_call tool to flow agent`, undefined, 'PlivoStream');
        }
        
        agentConfig.tools = config.tools || [];
        agentConfig.model = config.model; // Use tier-validated model
        logger.info(`Flow agent configured with ${agentConfig.tools.length} tools from compiled flow`, undefined, 'PlivoStream');
      } else {
        // No tools in metadata - add basic end_call tool
        let config = OpenAIAgentFactory.createAgentConfig({
          voice: agentConfig.voice as OpenAIVoice,
          model: agentConfig.model as OpenAIRealtimeModel,
          systemPrompt: flowSystemPrompt,
          firstMessage: flowFirstMessage,
          userTier,
          toolContext: {
            userId: call.userId || '',
            agentId: call.agentId || '',
            callId: call.id,
          },
          language: flowAgentLanguage,
        });
        config = OpenAIAgentFactory.addEndCallTool(config);
        agentConfig.tools = config.tools || [];
        agentConfig.model = config.model; // Use tier-validated model
        logger.info(`Flow agent configured with ${agentConfig.tools.length} tools (basic end_call only)`, undefined, 'PlivoStream');
      }
      
      // Additionally add knowledge base tool if configured (using already-fetched flowAgent)
      if (flowAgent && flowAgent.knowledgeBaseIds && flowAgent.knowledgeBaseIds.length > 0) {
        let config = OpenAIAgentFactory.createAgentConfig({
          voice: agentConfig.voice as OpenAIVoice,
          model: agentConfig.model as OpenAIRealtimeModel,
          systemPrompt: agentConfig.systemPrompt,
          firstMessage: agentConfig.firstMessage,
          userTier,
          toolContext: {
            userId: flowAgent.userId,
            agentId: flowAgent.id,
            callId: call.id,
          },
          language: flowAgentLanguage,
        });
        config.tools = agentConfig.tools; // Preserve existing tools
        config = OpenAIAgentFactory.addKnowledgeBaseTool(
          config,
          flowAgent.knowledgeBaseIds,
          flowAgent.userId
        );
        agentConfig.systemPrompt = config.systemPrompt;
        agentConfig.model = config.model; // Use tier-validated model
        agentConfig.tools = config.tools || [];
        logger.info(`Added KB tool, total tools: ${agentConfig.tools.length}`, undefined, 'PlivoStream');
      }

      // Add messaging tools for flow agents if enabled
      if (flowAgent) {
        if (flowAgent.messagingEmailEnabled) {
          let config = OpenAIAgentFactory.createAgentConfig({
            voice: agentConfig.voice as OpenAIVoice,
            model: agentConfig.model as OpenAIRealtimeModel,
            systemPrompt: agentConfig.systemPrompt,
            firstMessage: agentConfig.firstMessage,
            userTier,
            toolContext: { userId: flowAgent.userId, agentId: flowAgent.id, callId: call.id },
            language: flowAgentLanguage,
          });
          config.tools = agentConfig.tools;
          config = OpenAIAgentFactory.addCollectCallerEmailTool(config, flowAgent.userId, flowAgent.id, call.id);
          config = OpenAIAgentFactory.addMessagingEmailTool(config, flowAgent.userId, flowAgent.id, call.id, flowAgent.messagingEmailTemplate);
          agentConfig.tools = config.tools || [];
        }
        if (flowAgent.messagingWhatsappEnabled) {
          let config = OpenAIAgentFactory.createAgentConfig({
            voice: agentConfig.voice as OpenAIVoice,
            model: agentConfig.model as OpenAIRealtimeModel,
            systemPrompt: agentConfig.systemPrompt,
            firstMessage: agentConfig.firstMessage,
            userTier,
            toolContext: { userId: flowAgent.userId, agentId: flowAgent.id, callId: call.id },
            language: flowAgentLanguage,
          });
          config.tools = agentConfig.tools;
          config = OpenAIAgentFactory.addMessagingWhatsAppTool(config, flowAgent.userId, flowAgent.id, call.id, flowAgent.messagingWhatsappTemplate, [], flowAgent.messagingWhatsappVariables);
          agentConfig.tools = config.tools || [];
        }
      }
    } else if (call.agentId) {
      // No compiled flow - use agent table data (natural agents)
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, call.agentId))
        .limit(1);

      if (agent) {
        agentConfig = {
          voice: call.openaiVoice || 'alloy',
          model: call.openaiModel || 'gpt-realtime-1.5',
          systemPrompt: agent.systemPrompt || 'You are a helpful voice assistant.',
          firstMessage: agent.firstMessage || undefined,
          tools: [],
        };

        // Build tools using OpenAI Agent Factory if user has context
        if (call.userId && agent.userId) {
          let config = OpenAIAgentFactory.createAgentConfig({
            voice: agentConfig.voice as OpenAIVoice,
            model: agentConfig.model as OpenAIRealtimeModel,
            systemPrompt: agentConfig.systemPrompt,
            firstMessage: agentConfig.firstMessage,
            userTier,
            toolContext: {
              userId: agent.userId,
              agentId: agent.id,
              callId: call.id,
            },
            language: agent.language || 'en',
          });

          // Add knowledge base tool if configured
          if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
            config = OpenAIAgentFactory.addKnowledgeBaseTool(
              config,
              agent.knowledgeBaseIds,
              agent.userId
            );
          }

          // Add appointment tool if enabled
          if (agent.appointmentBookingEnabled) {
            const appointmentCallerPhone = call.callDirection === 'inbound' ? call.fromNumber : call.toNumber;
            config = OpenAIAgentFactory.addAppointmentTool(
              config,
              agent.userId,
              agent.id,
              call.id,
              appointmentCallerPhone || undefined
            );
          }

          // Add transfer tool if configured
          if (agent.transferEnabled && agent.transferPhoneNumber) {
            config = OpenAIAgentFactory.addTransferTool(
              config,
              agent.transferPhoneNumber,
              'Transfer the call to a human agent when needed.'
            );
          }

          // Add end call tool if enabled
          if (agent.endConversationEnabled) {
            config = OpenAIAgentFactory.addEndCallTool(config);
          }

          // Enable language detection if enabled
          if (agent.detectLanguageEnabled) {
            config = OpenAIAgentFactory.enableLanguageDetection(config);
          }

          // Add collect caller email tool if email messaging is enabled (for post-call follow-up)
          if (agent.messagingEmailEnabled) {
            config = OpenAIAgentFactory.addCollectCallerEmailTool(config, agent.userId, agent.id, call.id);
          }

          // Add messaging email tool if enabled
          if (agent.messagingEmailEnabled) {
            config = OpenAIAgentFactory.addMessagingEmailTool(
              config,
              agent.userId,
              agent.id,
              call.id,
              agent.messagingEmailTemplate
            );
          }

          // Add messaging WhatsApp tool if enabled
          if (agent.messagingWhatsappEnabled) {
            config = OpenAIAgentFactory.addMessagingWhatsAppTool(
              config,
              agent.userId,
              agent.id,
              call.id,
              agent.messagingWhatsappTemplate,
              [],
              agent.messagingWhatsappVariables
            );
          }

          agentConfig.tools = config.tools || [];
          agentConfig.model = config.model; // Use tier-validated model
          agentConfig.systemPrompt = config.systemPrompt; // Include language detection modifications
        }
      }
    }

    // Get Plivo credential ID from metadata for transfer functionality
    const metadata = call.metadata as Record<string, unknown> | null;
    const plivoCredentialId = metadata?.plivoCredentialId as string | undefined;

    // Create audio bridge session with phone numbers for transfer support
    const session = await AudioBridgeService.createSession({
      callUuid,
      openaiApiKey,
      agentConfig: {
        voice: agentConfig.voice as OpenAIVoice,
        model: agentConfig.model as OpenAIRealtimeModel,
        systemPrompt: agentConfig.systemPrompt,
        firstMessage: agentConfig.firstMessage,
        tools: agentConfig.tools,
      },
      plivoWs,
      streamSid: streamSid || undefined,
      fromNumber: call.fromNumber || undefined,
      toNumber: call.toNumber || undefined,
      plivoCredentialId,
      callDirection: (call.callDirection as 'inbound' | 'outbound') || 'outbound',
      callRecordId: call.id, // Pass call record ID for recording functionality
    });

    logger.info(`Session initialized for ${callUuid}, OpenAI session: ${session.openaiSessionId}`, undefined, 'PlivoStream');

    // Update call with session ID
    await db
      .update(plivoCalls)
      .set({ openaiSessionId: session.openaiSessionId })
      .where(eq(plivoCalls.id, call.id));

  } catch (error: any) {
    logger.error(`Failed to initialize session for ${callUuid}: ${error.message}`, error, 'PlivoStream');
  }
}
