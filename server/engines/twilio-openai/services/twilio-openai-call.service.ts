'use strict';
/**
 * ============================================================
 * Twilio-OpenAI Call Service
 * 
 * Handles outbound calls using Twilio with OpenAI Realtime API.
 * Uses existing Twilio credentials from the database.
 * ============================================================
 */

import twilio from 'twilio';
import { db } from '../../../db';
import { 
  twilioOpenaiCalls, 
  agents, 
  phoneNumbers,
  flows,
  users 
} from '@shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { logger } from '../../../utils/logger';
import { 
  getAnswerWebhookUrl, 
  getStatusWebhookUrl,
  getStreamWebhookUrl 
} from '../config/twilio-openai-config';
import { OpenAIPoolService } from '../../plivo/services/openai-pool.service';
import { OpenAIAgentFactory } from './openai-agent-factory';
import { TwilioOpenAIAudioBridge } from './audio-bridge.service';
import { getTwilioClient } from '../../../services/twilio-connector';
import { 
  hydrateCompiledTools, 
  hydrateCompiledFlow,
  OpenAIVoiceAgentCompiler 
} from '../../../services/openai-voice-agent';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import type { AgentConfig, OpenAIVoice, CompiledFlowConfig } from '../types';
import type { CompiledFunctionTool, CompiledConversationState } from '@shared/schema';

export interface InitiateCallParams {
  userId: string;
  agentId: string;
  toNumber: string;
  fromNumberId: string;
  campaignId?: string;
  contactId?: string;
  flowId?: string;
  metadata?: Record<string, unknown>;
}

export interface CallResult {
  success: boolean;
  callId?: string;
  twilioCallSid?: string;
  error?: string;
}

export class TwilioOpenAICallService {
  static async initiateCall(params: InitiateCallParams): Promise<CallResult> {
    const { userId, agentId, toNumber, fromNumberId, campaignId, contactId, flowId: overrideFlowId, metadata } = params;

    logger.info(`Initiating call to ${toNumber} from number ${fromNumberId}`, undefined, 'TwilioOpenAICall');

    try {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const [phoneNumber] = await db
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, fromNumberId))
        .limit(1);

      if (!phoneNumber) {
        return { success: false, error: 'Phone number not found' };
      }

      // Check user has sufficient credits before making call
      const [user] = await db
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || user.credits < 1) {
        logger.warn(`Insufficient credits for user ${userId}`, undefined, 'TwilioOpenAICall');
        return { success: false, error: 'Insufficient credits to make a call' };
      }

      const openaiCredential = await OpenAIPoolService.reserveSlot();
      if (!openaiCredential) {
        return { success: false, error: 'No OpenAI capacity available' };
      }

      const callId = nanoid();
      
      let agentConfig;
      
      const effectiveFlowId = overrideFlowId || agent.flowId;
      
      if (agent.type === 'flow' && effectiveFlowId) {
        logger.info(`Agent is flow-based, fetching flow ${effectiveFlowId}${overrideFlowId ? ' (override from test)' : ''}`, undefined, 'TwilioOpenAICall');
        const [flow] = await db
          .select()
          .from(flows)
          .where(eq(flows.id, effectiveFlowId))
          .limit(1);
        
        if (flow) {
          // Use agent language (flows don't have language column)
          const language = agent.language || 'en';
          
          // Use custom prompts from metadata if provided (batch calls with contact variable substitution)
          const customSystemPrompt = metadata?.customSystemPrompt as string | undefined;
          const customFirstMessage = metadata?.customFirstMessage as string | undefined;
          
          // Check if flow has pre-compiled data (compiled at save time)
          if (flow.compiledSystemPrompt && flow.compiledTools) {
            logger.info(`Using pre-compiled flow data (${(flow.compiledTools as any[]).length} tools)`, undefined, 'TwilioOpenAICall');
            
            // Use custom prompts if provided (batch calls), otherwise use pre-compiled prompts
            const systemPrompt = customSystemPrompt || flow.compiledSystemPrompt;
            const firstMessage = customFirstMessage || flow.compiledFirstMessage || undefined;
            
            // Hydrate compiled tools with proper handlers using shared hydrator
            const compiledTools = flow.compiledTools as CompiledFunctionTool[];
            const hydratedTools = hydrateCompiledTools(compiledTools, {
              userId,
              agentId,
              callId,
              knowledgeBaseIds: agent.knowledgeBaseIds || [],
              transferPhoneNumber: agent.transferPhoneNumber || undefined,
            });
            
            // Build config with pre-compiled data and hydrated tools
            agentConfig = {
              voice: (agent.openaiVoice as OpenAIVoice) || 'alloy',
              model: (agent.openaiModel as OpenAIRealtimeModel) || 'gpt-realtime-1.5',
              systemPrompt,
              firstMessage,
              temperature: agent.temperature ?? 0.7,
              tools: hydratedTools,
            };
          } else {
            // Fall back to runtime compilation using shared services
            logger.info(`Flow loaded with ${(flow.nodes as any[]).length} nodes, language: ${language}, compiling at runtime`, undefined, 'TwilioOpenAICall');
            
            // Compile the flow using shared compiler
            const compiledResult = OpenAIVoiceAgentCompiler.compileFlow(
              flow.nodes as any[],
              flow.edges as any[],
              {
                language,
                voice: (agent.openaiVoice as string) || 'alloy',
                model: (agent.openaiModel as string) || 'gpt-realtime-1.5',
                knowledgeBaseIds: agent.knowledgeBaseIds || [],
                transferEnabled: agent.transferEnabled || false,
                transferPhoneNumber: agent.transferPhoneNumber || undefined,
                endConversationEnabled: agent.endConversationEnabled ?? true,
              }
            );
            
            // Hydrate the compiled flow using shared hydrator
            // Use custom prompts if provided (batch calls), otherwise use compiled prompts
            agentConfig = hydrateCompiledFlow({
              compiledSystemPrompt: customSystemPrompt || compiledResult.systemPrompt,
              compiledFirstMessage: customFirstMessage || (compiledResult.firstMessage ?? null),
              compiledTools: compiledResult.tools as CompiledFunctionTool[],
              compiledStates: compiledResult.conversationStates as CompiledConversationState[],
              voice: (agent.openaiVoice as OpenAIVoice) || 'alloy',
              model: (agent.openaiModel as OpenAIRealtimeModel) || 'gpt-realtime-1.5',
              temperature: agent.temperature ?? 0.7,
              toolContext: {
                userId,
                agentId,
                callId,
              },
              language,
              knowledgeBaseIds: agent.knowledgeBaseIds || [],
              transferPhoneNumber: agent.transferPhoneNumber || undefined,
              transferEnabled: agent.transferEnabled || false,
            });
          }
        }
      }
      
      // Track if we used a flow-based config (tools already included)
      const isFlowAgent = agentConfig !== undefined;

      // Add messaging tools for flow agents if enabled
      if (isFlowAgent && agentConfig) {
        if (agent.messagingEmailEnabled) {
          const emailToolConfig = OpenAIAgentFactory.addMessagingEmailTool(
            { ...agentConfig, tools: agentConfig.tools || [] } as any,
            userId, agentId, callId, agent.messagingEmailTemplate
          );
          agentConfig.tools = emailToolConfig.tools || agentConfig.tools;
        }
        if (agent.messagingWhatsappEnabled) {
          const whatsappToolConfig = OpenAIAgentFactory.addMessagingWhatsAppTool(
            { ...agentConfig, tools: agentConfig.tools || [] } as any,
            userId, agentId, callId, agent.messagingWhatsappTemplate, [], agent.messagingWhatsappVariables
          );
          agentConfig.tools = whatsappToolConfig.tools || agentConfig.tools;
        }
      }
      
      if (!agentConfig) {
        // Natural agent - create base config and add tools
        // Use custom prompts from metadata if provided (batch calls with contact variable substitution)
        const customSystemPrompt = metadata?.customSystemPrompt as string | undefined;
        const customFirstMessage = metadata?.customFirstMessage as string | undefined;
        
        let naturalConfig = OpenAIAgentFactory.createAgentConfig({
          voice: (agent.openaiVoice as OpenAIVoice) || 'alloy',
          model: (agent.openaiModel as OpenAIRealtimeModel) || 'gpt-realtime-1.5',
          systemPrompt: customSystemPrompt || agent.systemPrompt || 'You are a helpful AI assistant.',
          firstMessage: customFirstMessage || agent.firstMessage || undefined,
          temperature: agent.temperature ?? 0.7,
          toolContext: {
            userId,
            agentId,
            callId,
          },
        });

        // Add supplemental tools only for natural agents
        if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
          naturalConfig = OpenAIAgentFactory.addKnowledgeBaseTool(
            naturalConfig, 
            agent.knowledgeBaseIds, 
            userId
          );
        }

        if (agent.appointmentBookingEnabled) {
          naturalConfig = OpenAIAgentFactory.addAppointmentTool(naturalConfig, userId, agentId, callId, toNumber);
        }

        if (agent.transferEnabled && agent.transferPhoneNumber) {
          naturalConfig = OpenAIAgentFactory.addTransferTool(
            naturalConfig,
            agent.transferPhoneNumber,
            undefined
          );
        }

        if (agent.endConversationEnabled) {
          naturalConfig = OpenAIAgentFactory.addEndCallTool(naturalConfig);
        }

        if (agent.detectLanguageEnabled) {
          naturalConfig = OpenAIAgentFactory.enableLanguageDetection(naturalConfig);
        }

        if (agent.messagingEmailEnabled) {
          naturalConfig = OpenAIAgentFactory.addMessagingEmailTool(
            naturalConfig,
            userId,
            agentId,
            callId,
            agent.messagingEmailTemplate
          );
        }

        if (agent.messagingWhatsappEnabled) {
          naturalConfig = OpenAIAgentFactory.addMessagingWhatsAppTool(
            naturalConfig,
            userId,
            agentId,
            callId,
            agent.messagingWhatsappTemplate,
            [],
            agent.messagingWhatsappVariables
          );
        }
        
        agentConfig = naturalConfig;
      }

      // Normalize phone numbers early - preserve + prefix for proper E.164 format display
      const normalizedFromNumber = phoneNumber.phoneNumber.replace(/[\s\-\(\)]/g, '').replace(/^\+?/, '+');
      const normalizedToNumber = toNumber.replace(/[\s\-\(\)]/g, '').replace(/^\+?/, '+');

      await TwilioOpenAIAudioBridge.createSession({
        callSid: callId,
        openaiApiKey: openaiCredential.apiKey,
        agentConfig: agentConfig as any,
        fromNumber: normalizedFromNumber,
        toNumber: normalizedToNumber,
        callDirection: 'outbound',
      });

      const client = await getTwilioClient();
      
      const call = await client.calls.create({
        to: toNumber.startsWith('+') ? toNumber : `+${toNumber}`,
        from: phoneNumber.phoneNumber.startsWith('+') 
          ? phoneNumber.phoneNumber 
          : `+${phoneNumber.phoneNumber}`,
        url: getAnswerWebhookUrl(),
        statusCallback: getStatusWebhookUrl(),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });

      // Remap session from internal callId to Twilio CallSid so answer webhook can find it
      TwilioOpenAIAudioBridge.remapSession(callId, call.sid);

      await db.insert(twilioOpenaiCalls).values({
        id: callId,
        userId,
        agentId,
        campaignId,
        contactId,
        twilioPhoneNumberId: phoneNumber.id,
        openaiCredentialId: openaiCredential.id,
        twilioCallSid: call.sid,
        fromNumber: normalizedFromNumber,
        toNumber: normalizedToNumber,
        openaiVoice: (agent.openaiVoice as any) || 'alloy',
        openaiModel: (agent.openaiModel as string) || 'gpt-realtime-1.5',
        status: 'initiated',
        callDirection: 'outbound',
        startedAt: new Date(),
        metadata,
      });

      TwilioOpenAIAudioBridge.onSessionEnd(call.sid, async () => {
        await OpenAIPoolService.releaseSlot(openaiCredential.id);
      });

      logger.info(`Call initiated: ${callId} -> Twilio SID: ${call.sid}`, undefined, 'TwilioOpenAICall');

      // Trigger call.started webhook event
      try {
        await webhookDeliveryService.triggerEvent(userId, 'call.started', {
          call: {
            id: callId,
            callSid: call.sid,
            direction: 'outbound',
            status: 'initiated',
            startedAt: new Date().toISOString(),
            fromNumber: normalizedFromNumber,
            toNumber: normalizedToNumber,
          },
          agent: {
            id: agentId,
            name: agent.name || null,
          },
          campaign: campaignId ? { id: campaignId } : null,
        });
        logger.info(`Triggered call.started webhook for call ${callId}`, undefined, 'TwilioOpenAICall');
      } catch (webhookError: any) {
        logger.error(`Failed to trigger call.started webhook: ${webhookError.message}`, undefined, 'TwilioOpenAICall');
      }

      // Trigger flow.started webhook for flow-based agents
      if (isFlowAgent && effectiveFlowId) {
        try {
          const [flow] = await db
            .select()
            .from(flows)
            .where(eq(flows.id, effectiveFlowId))
            .limit(1);
          
          if (flow) {
            await webhookDeliveryService.triggerEvent(userId, 'flow.started', {
              flowId: flow.id,
              flowName: flow.name,
              callId: callId,
              callSid: call.sid,
              agentId: agentId,
              userId: userId,
            }, campaignId);
            logger.info(`Triggered flow.started webhook for call ${callId}, flow ${flow.name}`, undefined, 'TwilioOpenAICall');
          }
        } catch (flowWebhookError: any) {
          logger.error(`Failed to trigger flow.started webhook: ${flowWebhookError.message}`, undefined, 'TwilioOpenAICall');
        }
      }

      return {
        success: true,
        callId,
        twilioCallSid: call.sid,
      };

    } catch (error: any) {
      logger.error('Error initiating call', error.message, 'TwilioOpenAICall');
      return { success: false, error: error.message };
    }
  }

  static async hangupCall(callSid: string): Promise<boolean> {
    try {
      const [callRecord] = await db
        .select()
        .from(twilioOpenaiCalls)
        .where(eq(twilioOpenaiCalls.twilioCallSid, callSid))
        .limit(1);

      if (!callRecord) {
        logger.warn(`Call not found: ${callSid}`, undefined, 'TwilioOpenAICall');
        return false;
      }

      const client = await getTwilioClient();
      await client.calls(callSid).update({ status: 'completed' });

      await TwilioOpenAIAudioBridge.endSession(callSid);

      logger.info(`Call hung up: ${callSid}`, undefined, 'TwilioOpenAICall');
      return true;

    } catch (error: any) {
      logger.error('Error hanging up call', error.message, 'TwilioOpenAICall');
      return false;
    }
  }

  static async getCallStatus(callId: string): Promise<any> {
    const [call] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(eq(twilioOpenaiCalls.id, callId))
      .limit(1);

    return call || null;
  }
}
