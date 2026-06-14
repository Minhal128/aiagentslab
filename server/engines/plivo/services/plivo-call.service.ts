'use strict';
/**
 * ============================================================
 * Plivo Call Service
 * 
 * Manages outbound and inbound calls via Plivo:
 * - Initiate outbound calls
 * - Handle incoming call webhooks
 * - Track call status and duration
 * - Store recordings
 * - Credit management integration
 * ============================================================
 */

import * as plivo from 'plivo';
import { db } from "../../../db";
import { plivoCalls, plivoCredentials, plivoPhoneNumbers, users, creditTransactions, contacts, campaigns, agents, flows, flowExecutions, calls } from "@shared/schema";
import { logger } from '../../../utils/logger';
import { eq, and, desc, sql } from "drizzle-orm";
import type { PlivoCall, PlivoCallStatus, OpenAIVoice, OpenAIRealtimeModel, PlivoCallSentiment, PlivoCallInitiateResponse } from '../types';
import { PlivoEngineConfig, getWebhookUrl, getStreamUrl } from '../config/plivo-config';
import { OpenAIPoolService } from './openai-pool.service';
import { CallInsightsService } from '../../../services/call-insights.service';
import { getDomain } from '../../../utils/domain';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { CRMLeadService } from '../../../services/crm-lead.service';

type InsertPlivoCall = typeof plivoCalls.$inferInsert;
type PlivoCallRecord = typeof plivoCalls.$inferSelect;

interface PlivoCredentialRecord {
  id: string;
  authId: string;
  authToken: string;
  isActive: boolean;
  isPrimary: boolean;
}

export class PlivoCallService {
  private static plivoClients: Map<string, plivo.Client> = new Map();

  /**
   * Get or create a Plivo client for a given credential
   */
  private static async getPlivoClient(credentialId?: string): Promise<{ client: plivo.Client; credential: PlivoCredentialRecord }> {
    let credential: PlivoCredentialRecord | undefined;

    if (credentialId) {
      const [cred] = await db
        .select()
        .from(plivoCredentials)
        .where(and(eq(plivoCredentials.id, credentialId), eq(plivoCredentials.isActive, true)))
        .limit(1);
      credential = cred;
    }

    if (!credential) {
      const [primaryCred] = await db
        .select()
        .from(plivoCredentials)
        .where(and(eq(plivoCredentials.isPrimary, true), eq(plivoCredentials.isActive, true)))
        .limit(1);
      credential = primaryCred;
    }

    if (!credential) {
      const [anyCred] = await db
        .select()
        .from(plivoCredentials)
        .where(eq(plivoCredentials.isActive, true))
        .limit(1);
      credential = anyCred;
    }

    if (!credential) {
      throw new Error('No active Plivo credentials found. Please configure Plivo credentials in admin settings.');
    }

    if (!this.plivoClients.has(credential.id)) {
      const client = new plivo.Client(credential.authId, credential.authToken);
      this.plivoClients.set(credential.id, client);
    }

    return {
      client: this.plivoClients.get(credential.id)!,
      credential,
    };
  }

  /**
   * Initiate an outbound call
   */
  static async initiateCall(params: {
    fromNumber: string;
    toNumber: string;
    userId: string;
    campaignId?: string;
    contactId?: string;
    agentId?: string;
    plivoPhoneNumberId?: string;
    flowId?: string; // Override flowId for test calls (uses agent.flowId if not provided)
    agentConfig: {
      voice: OpenAIVoice;
      model: OpenAIRealtimeModel;
      systemPrompt: string;
      firstMessage?: string;
      tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        handler?: (params: Record<string, unknown>) => Promise<unknown>;
      }>;
    };
  }): Promise<{ callUuid: string; plivoCall: PlivoCallRecord }> {
    logger.info(`Initiating call ${params.fromNumber} -> ${params.toNumber}`, undefined, 'PlivoCall');

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.credits < 1) {
      throw new Error('Insufficient credits to make a call');
    }

    const openaiCredential = await OpenAIPoolService.reserveSlot(
      OpenAIPoolService.getModelTierForUser(user.planType)
    );

    if (!openaiCredential) {
      throw new Error('No OpenAI capacity available. Please try again later.');
    }

    let plivoCredentialId: string | null = null;
    if (params.plivoPhoneNumberId) {
      const [phoneNum] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(eq(plivoPhoneNumbers.id, params.plivoPhoneNumberId))
        .limit(1);
      plivoCredentialId = phoneNum?.plivoCredentialId || null;
    }

    const { client, credential } = await this.getPlivoClient(plivoCredentialId || undefined);

    // Serialize tools for storage with full configuration for handler recreation
    // Handlers cannot be serialized - we store config data to recreate them later
    const serializedTools = params.agentConfig.tools?.map(tool => {
      const serialized: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      };
      
      // Extract additional config from the tool for recreation
      // These are stored on the tool object by OpenAIAgentFactory
      const toolAny = tool as Record<string, unknown>;
      if (toolAny._transferNumber) serialized._transferNumber = toolAny._transferNumber;
      if (toolAny._metadata) serialized._metadata = toolAny._metadata; // For flow transfer nodes
      if (toolAny._webhookUrl) serialized._webhookUrl = toolAny._webhookUrl;
      if (toolAny._webhookMethod) serialized._webhookMethod = toolAny._webhookMethod;
      if (toolAny._webhookHeaders) serialized._webhookHeaders = toolAny._webhookHeaders;
      if (toolAny._bodyTemplate) serialized._bodyTemplate = toolAny._bodyTemplate;
      if (toolAny._responseMapping) serialized._responseMapping = toolAny._responseMapping;
      if (toolAny._formId) serialized._formId = toolAny._formId;
      if (toolAny._formName) serialized._formName = toolAny._formName;
      if (toolAny._formFields) serialized._formFields = toolAny._formFields;
      if (toolAny._action) serialized._action = toolAny._action;
      
      return serialized;
    }) || [];

    const [callRecord] = await db
      .insert(plivoCalls)
      .values({
        userId: params.userId,
        campaignId: params.campaignId || null,
        contactId: params.contactId || null,
        agentId: params.agentId || null,
        plivoPhoneNumberId: params.plivoPhoneNumberId || null,
        openaiCredentialId: openaiCredential.id,
        fromNumber: params.fromNumber,
        toNumber: params.toNumber,
        openaiVoice: params.agentConfig.voice,
        openaiModel: params.agentConfig.model,
        status: 'pending',
        callDirection: 'outbound',
        metadata: {
          systemPrompt: params.agentConfig.systemPrompt,
          firstMessage: params.agentConfig.firstMessage,
          tools: serializedTools,
          plivoCredentialId: credential.id,
        },
      } as InsertPlivoCall)
      .returning();

    try {
      const baseUrl = getDomain();

      logger.info(`Using base URL: ${baseUrl}`, undefined, 'PlivoCall');
      const answerUrl = getWebhookUrl(baseUrl, `/voice/${callRecord.id}`);
      const statusCallbackUrl = getWebhookUrl(baseUrl, `/status/${callRecord.id}`);

      const response = await client.calls.create(
        params.fromNumber,
        params.toNumber,
        answerUrl,
        {
          answerMethod: 'POST',
          statusCallback: statusCallbackUrl,
          statusCallbackMethod: 'POST',
          statusCallbackEvents: 'ringing,answered,completed,busy,failed,no-answer,canceled',
          record: PlivoEngineConfig.recording.enabled,
          recordingCallbackUrl: getWebhookUrl(baseUrl, `/recording/${callRecord.id}`),
          recordingCallbackMethod: 'POST',
          maxDuration: PlivoEngineConfig.defaults.maxCallDuration,
          maxRingingDuration: 45,
          hangupOnRingTimeout: true,
        }
      );

      const typedResponse = response as PlivoCallInitiateResponse;
      const callUuid = typedResponse.requestUuid || typedResponse.request_uuid || '';

      if (!callUuid) {
        throw new Error('No call UUID returned from Plivo');
      }

      const [updatedCall] = await db
        .update(plivoCalls)
        .set({
          plivoCallUuid: callUuid,
          status: 'initiated',
          startedAt: new Date(),
        })
        .where(eq(plivoCalls.id, callRecord.id))
        .returning();

      logger.info(`Call initiated: ${callUuid}`, undefined, 'PlivoCall');

      // Trigger call.started webhook event
      try {
        // Get contact info if available
        let contactInfo: { id: string; firstName: string | null; lastName: string | null; phone: string; email: string | null; customFields: any } | null = null;
        if (params.contactId) {
          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, params.contactId))
            .limit(1);
          if (contact) {
            contactInfo = {
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              phone: contact.phone,
              email: contact.email,
              customFields: contact.customFields,
            };
          }
        }

        // Get campaign info if available
        let campaignInfo: { id: string; name: string; type: string } | null = null;
        if (params.campaignId) {
          const [campaign] = await db
            .select()
            .from(campaigns)
            .where(eq(campaigns.id, params.campaignId))
            .limit(1);
          if (campaign) {
            campaignInfo = { id: campaign.id, name: campaign.name, type: campaign.type };
          }
        }

        // Get agent info if available (including flowId for flow-based agents)
        let agentInfo: { id: string; name: string; type?: string; flowId?: string | null } | null = null;
        if (params.agentId) {
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, params.agentId))
            .limit(1);
          if (agent) {
            // Use override flowId if provided (for test calls), otherwise use agent's configured flowId
            const effectiveFlowId = params.flowId || agent.flowId;
            agentInfo = { id: agent.id, name: agent.name, type: agent.type || undefined, flowId: effectiveFlowId };
          }
        }

        await webhookDeliveryService.triggerEvent(params.userId, 'call.started', {
          campaign: campaignInfo,
          contact: contactInfo || { phone: params.toNumber },
          agent: agentInfo,
          call: {
            id: updatedCall.id,
            status: updatedCall.status,
            phoneNumber: updatedCall.toNumber,
            startedAt: updatedCall.startedAt,
          }
        }, params.campaignId).catch(err => {
          logger.error(`Failed to trigger call.started webhook: ${err.message}`, err, 'PlivoCall');
        });

        // Trigger flow.started webhook for flow-based agents
        // Use override flowId if provided (for test calls), otherwise use agent's configured flowId
        const effectiveFlowId = params.flowId || agentInfo?.flowId;
        if (agentInfo?.type === 'flow' && effectiveFlowId) {
          try {
            const [flow] = await db
              .select()
              .from(flows)
              .where(eq(flows.id, effectiveFlowId))
              .limit(1);
            
            if (flow) {
              await webhookDeliveryService.triggerEvent(params.userId, 'flow.started', {
                flowId: flow.id,
                flowName: flow.name,
                callId: updatedCall.id,
                callSid: updatedCall.plivoCallUuid,
                agentId: agentInfo.id,
                userId: params.userId,
              }, params.campaignId);
              logger.info(`Triggered flow.started webhook for call ${updatedCall.id}, flow ${flow.name}`, undefined, 'PlivoCall');
            }
          } catch (flowWebhookError: any) {
            logger.error(`Failed to trigger flow.started webhook: ${flowWebhookError.message}`, flowWebhookError, 'PlivoCall');
          }
        }
      } catch (webhookError: any) {
        logger.error(`Failed to trigger call.started webhook: ${webhookError.message}`, webhookError, 'PlivoCall');
      }

      return { callUuid, plivoCall: updatedCall };

    } catch (error: any) {
      logger.error('Failed to initiate call', error, 'PlivoCall');

      await OpenAIPoolService.releaseSlot(openaiCredential.id);

      await db
        .update(plivoCalls)
        .set({
          status: 'failed',
          endedAt: new Date(),
          metadata: {
            ...(callRecord.metadata as Record<string, unknown> || {}),
            error: error.message,
          },
        })
        .where(eq(plivoCalls.id, callRecord.id));

      throw new Error(`Failed to initiate call: ${error.message}`);
    }
  }

  /**
   * Handle call status webhook from Plivo
   * @param callId - The call record ID
   * @param status - The new call status
   * @param metadata - Optional metadata from the webhook
   * @param durationSeconds - Optional duration in seconds (from WebSocket session)
   */
  static async handleCallStatus(
    callId: string,
    status: PlivoCallStatus,
    metadata?: Record<string, unknown>,
    durationSeconds?: number
  ): Promise<PlivoCallRecord | null> {
    logger.info(`Status update for call ${callId}: ${status}`, { durationSeconds }, 'PlivoCall');

    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.id, callId))
      .limit(1);

    if (!call) {
      logger.error(`Call not found: ${callId}`, undefined, 'PlivoCall');
      return null;
    }

    // Trigger webhook events for specific call statuses
    if (call.userId) {
      try {
        const webhookPayload = {
          callId: call.id,
          callSid: call.plivoCallUuid,
          direction: call.callDirection,
          status: status,
          fromNumber: call.fromNumber,
          toNumber: call.toNumber,
          contactId: call.contactId,
          campaignId: call.campaignId,
        };

        if (status === 'ringing') {
          await webhookDeliveryService.triggerEvent(call.userId, 'call.ringing', webhookPayload, call.campaignId);
          logger.info(`Triggered call.ringing webhook for call ${callId}`, undefined, 'PlivoCall');
        } else if (status === 'in-progress') {
          await webhookDeliveryService.triggerEvent(call.userId, 'call.answered', webhookPayload, call.campaignId);
          logger.info(`Triggered call.answered webhook for call ${callId}`, undefined, 'PlivoCall');
        } else if (status === 'no-answer') {
          await webhookDeliveryService.triggerEvent(call.userId, 'call.no_answer', webhookPayload, call.campaignId);
          logger.info(`Triggered call.no_answer webhook for call ${callId}`, undefined, 'PlivoCall');
        } else if (status === 'busy') {
          await webhookDeliveryService.triggerEvent(call.userId, 'call.busy', webhookPayload, call.campaignId);
          logger.info(`Triggered call.busy webhook for call ${callId}`, undefined, 'PlivoCall');
        }
        
        // Check for voicemail detection in metadata
        const voicemailDetected = metadata?.machineDetection === 'voicemail' || 
                                   metadata?.hangupCause === 'MACHINE_DETECTED' ||
                                   (metadata as any)?.amd_status === 'machine';
        if (voicemailDetected) {
          await webhookDeliveryService.triggerEvent(call.userId, 'call.voicemail', webhookPayload, call.campaignId);
          logger.info(`Triggered call.voicemail webhook for call ${callId}`, undefined, 'PlivoCall');
        }
      } catch (webhookError: any) {
        logger.error(`Failed to trigger status webhook for call ${callId}: ${webhookError.message}`, webhookError, 'PlivoCall');
      }
    }

    const updateData: Partial<InsertPlivoCall> = {
      status,
    };

    if (status === 'in-progress') {
      updateData.answeredAt = new Date();
    }

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
      updateData.endedAt = new Date();

      if (call.openaiCredentialId) {
        await OpenAIPoolService.releaseSlot(call.openaiCredentialId);
      }

      if (call.userId) {
        // Use provided duration if available, otherwise calculate from timestamps
        let actualDuration = durationSeconds;
        if (!actualDuration && call.answeredAt) {
          const now = new Date();
          const answered = new Date(call.answeredAt);
          actualDuration = Math.ceil((now.getTime() - answered.getTime()) / 1000);
        }
        
        if (!actualDuration || actualDuration <= 0) {
          actualDuration = 0;
        }
        
        const creditsToDeduct = Math.ceil(actualDuration / 60);

        updateData.duration = actualDuration;

        if (creditsToDeduct > 0) {
          // Use centralized credit service for atomic, idempotent deduction
          const { deductCallCredits } = await import('../../../services/credit-service');
          const creditResult = await deductCallCredits({
            userId: call.userId,
            creditsToDeduct,
            callId: call.id,
            fromNumber: call.fromNumber,
            toNumber: call.toNumber,
            durationSeconds: actualDuration,
            engine: 'plivo-openai',
          });

          // Handle credit deduction failure with separate update payload
          if (!creditResult.success && !creditResult.alreadyDeducted) {
            logger.error(
              `Credit deduction failed for call ${call.id}: ${creditResult.error || 'Unknown error'}`,
              { userId: call.userId, creditsToDeduct, callId: call.id },
              'PlivoCall'
            );

            // Create a separate failure-specific update payload to avoid contaminating shared state.
            // Use the unified `credit_failed` status so the UI/notifications match
            // every other engine (Twilio+OpenAI, ElevenLabs, SIP).
            const failureUpdateData: Partial<InsertPlivoCall> = {
              status: 'credit_failed',
              endedAt: new Date(),
              duration: actualDuration,
              metadata: {
                ...(call.metadata as Record<string, unknown> || {}),
                creditDeductionFailed: true,
                creditDeductionError: creditResult.error || 'Insufficient credits',
                creditsRequired: creditsToDeduct,
              },
            };

            // Update the call record with failure status and return early
            const [failedCall] = await db
              .update(plivoCalls)
              .set(failureUpdateData)
              .where(eq(plivoCalls.id, callId))
              .returning();

            logger.warn(
              `Call ${call.id} marked as failed due to credit deduction failure`,
              undefined,
              'PlivoCall'
            );

            // Return immediately - success path logic must not execute
            return failedCall;
          }
        }
      }

      if (status === 'completed' && call.contactId) {
        await db
          .update(contacts)
          .set({ status: 'completed' })
          .where(eq(contacts.id, call.contactId));
      } else if (['busy', 'failed', 'no-answer'].includes(status) && call.contactId) {
        await db
          .update(contacts)
          .set({ status: 'failed' })
          .where(eq(contacts.id, call.contactId));
      }

      // Update the pre-created calls table record (created by campaign-executor for UI tracking).
      // Plivo engine tracks calls in plivoCalls; those records are never linked to the calls table.
      if (call.campaignId && call.contactId) {
        try {
          const terminalCallStatus = status === 'completed' ? 'completed' : 'failed';
          await db
            .update(calls)
            .set({
              status: terminalCallStatus,
              duration: updateData.duration ?? null,
              endedAt: new Date(),
            })
            .where(and(
              eq(calls.campaignId, call.campaignId),
              eq(calls.contactId, call.contactId)
            ));
        } catch (callsUpdateErr: any) {
          logger.error(`Failed to sync calls table for contact ${call.contactId}: ${callsUpdateErr.message}`, undefined, 'PlivoCall');
        }
      }

      if (call.campaignId) {
        if (status === 'completed') {
          await db
            .update(campaigns)
            .set({
              completedCalls: sql`${campaigns.completedCalls} + 1`,
              successfulCalls: sql`${campaigns.successfulCalls} + 1`,
            })
            .where(eq(campaigns.id, call.campaignId));
        } else if (['busy', 'failed', 'no-answer'].includes(status)) {
          await db
            .update(campaigns)
            .set({
              completedCalls: sql`${campaigns.completedCalls} + 1`,
              failedCalls: sql`${campaigns.failedCalls} + 1`,
            })
            .where(eq(campaigns.id, call.campaignId));
        }
      }

      if (status === 'completed' && call.transcript && call.transcript.length > 50) {
        try {
          // Get the OpenAI API key from the credential assigned to this call
          let openaiApiKey: string | undefined;
          if (call.openaiCredentialId) {
            const openaiCredential = await OpenAIPoolService.getCredentialById(call.openaiCredentialId);
            if (openaiCredential) {
              openaiApiKey = openaiCredential.apiKey;
            }
          }
          
          const insights = await CallInsightsService.analyzeTranscript(
            call.transcript,
            {
              callId: call.id,
              fromNumber: call.fromNumber,
              toNumber: call.toNumber,
              duration: updateData.duration || call.duration || undefined
            },
            openaiApiKey
          );
          
          if (insights) {
            updateData.aiSummary = insights.aiSummary;
            updateData.sentiment = insights.sentiment;
            updateData.classification = insights.classification;
            if (insights.keyPoints) updateData.keyPoints = insights.keyPoints;
            if (insights.nextActions) updateData.nextActions = insights.nextActions;
            logger.info(`Generated insights for call ${callId}`, { sentiment: insights.sentiment, classification: insights.classification }, 'PlivoCall');
          }
        } catch (insightError: any) {
          logger.error(`Failed to generate insights for call ${callId}`, insightError, 'PlivoCall');
        }
      }
    }

    if (metadata) {
      updateData.metadata = {
        ...(call.metadata as Record<string, unknown> || {}),
        statusUpdate: metadata,
      };
    }

    const [updatedCall] = await db
      .update(plivoCalls)
      .set(updateData)
      .where(eq(plivoCalls.id, callId))
      .returning();

    // Trigger call.completed or call.failed webhook events
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status) && call.userId) {
      try {
        // Get contact info if available
        let contactInfo: { id: string; firstName: string | null; lastName: string | null; phone: string; email: string | null; customFields: any } | null = null;
        if (call.contactId) {
          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, call.contactId))
            .limit(1);
          if (contact) {
            contactInfo = {
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              phone: contact.phone,
              email: contact.email,
              customFields: contact.customFields,
            };
          }
        }

        // Get campaign info if available
        let campaignInfo: { id: string; name: string; type: string } | null = null;
        if (call.campaignId) {
          const [campaign] = await db
            .select()
            .from(campaigns)
            .where(eq(campaigns.id, call.campaignId))
            .limit(1);
          if (campaign) {
            campaignInfo = { id: campaign.id, name: campaign.name, type: campaign.type };
          }
        }

        // Get agent info if available (including flowId for flow-based agents)
        let agentInfo: { id: string; name: string; type?: string; flowId?: string | null } | null = null;
        if (call.agentId) {
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, call.agentId))
            .limit(1);
          if (agent) {
            agentInfo = { id: agent.id, name: agent.name, type: agent.type || undefined, flowId: agent.flowId };
          }
        }

        const eventType = status === 'completed' ? 'call.completed' : 'call.failed';

        await webhookDeliveryService.triggerEvent(call.userId, eventType, {
          campaign: campaignInfo,
          contact: contactInfo || { phone: updatedCall.toNumber },
          agent: agentInfo,
          call: {
            id: updatedCall.id,
            status: updatedCall.status,
            duration: updatedCall.duration,
            phoneNumber: updatedCall.toNumber,
            startedAt: updatedCall.startedAt,
            endedAt: updatedCall.endedAt,
            leadClassification: updatedCall.classification,
            classification: updatedCall.classification,
            sentiment: updatedCall.sentiment,
            transcript: updatedCall.transcript,
            aiSummary: updatedCall.aiSummary,
            recordingUrl: updatedCall.recordingUrl,
            failureReason: status !== 'completed' ? ((metadata?.hangupCause as string) || status) : undefined,
          }
        }, call.campaignId).catch(err => {
          logger.error(`Failed to trigger ${eventType} webhook: ${err.message}`, err, 'PlivoCall');
        });

        logger.info(`Triggered ${eventType} webhook for call ${callId}`, undefined, 'PlivoCall');

        // Trigger flow.completed or flow.failed webhook for flow-based agents
        if (agentInfo?.type === 'flow') {
          try {
            // First check flow execution for the actual flow used (important for test calls with different flows)
            const [flowExec] = await db
              .select()
              .from(flowExecutions)
              .where(eq(flowExecutions.callId, callId))
              .limit(1);
            
            // Use flow from execution record, or fall back to agent's default flowId
            const effectiveFlowId = flowExec?.flowId || agentInfo.flowId;
            
            if (effectiveFlowId) {
              const [flow] = await db
                .select()
                .from(flows)
                .where(eq(flows.id, effectiveFlowId))
                .limit(1);
              
              if (flow) {
                const flowEventType = status === 'completed' ? 'flow.completed' : 'flow.failed';
                const flowDuration = updatedCall.duration || 
                  (updatedCall.startedAt && updatedCall.endedAt 
                    ? Math.ceil((new Date(updatedCall.endedAt).getTime() - new Date(updatedCall.startedAt).getTime()) / 1000)
                    : undefined);

                const flowPayload: Record<string, unknown> = {
                  flowId: flow.id,
                  flowName: flow.name,
                  callId: updatedCall.id,
                  callSid: updatedCall.plivoCallUuid,
                  agentId: agentInfo.id,
                  userId: call.userId,
                };

                if (status === 'completed') {
                  flowPayload.duration = flowDuration;
                  flowPayload.nodesExecuted = (flow.nodes as any[])?.length || 0;
                } else {
                  flowPayload.error = {
                    code: 'CALL_FAILED',
                    message: (metadata?.hangupCause as string) || status,
                  };
                }

                await webhookDeliveryService.triggerEvent(call.userId, flowEventType, flowPayload, call.campaignId);
                logger.info(`Triggered ${flowEventType} webhook for call ${callId}, flow ${flow.name}`, undefined, 'PlivoCall');
              }
            }
          } catch (flowWebhookError: any) {
            logger.error(`Failed to trigger flow webhook: ${flowWebhookError.message}`, flowWebhookError, 'PlivoCall');
          }
        }

        // Trigger inbound_call.completed or inbound_call.missed for inbound calls
        if (call.callDirection === 'inbound') {
          try {
            const inboundPayload = {
              callId: call.id,
              callSid: call.plivoCallUuid,
              direction: 'inbound',
              status: status,
              fromNumber: call.fromNumber,
              toNumber: call.toNumber,
              agentId: call.agentId,
              phoneNumberId: call.plivoPhoneNumberId,
              duration: updatedCall.duration,
            };

            if (status === 'completed') {
              await webhookDeliveryService.triggerEvent(call.userId, 'inbound_call.completed', inboundPayload);
              logger.info(`Triggered inbound_call.completed webhook for call ${callId}`, undefined, 'PlivoCall');
            } else if (status === 'no-answer' || status === 'canceled') {
              await webhookDeliveryService.triggerEvent(call.userId, 'inbound_call.missed', inboundPayload);
              logger.info(`Triggered inbound_call.missed webhook for call ${callId}`, undefined, 'PlivoCall');
            }
          } catch (inboundWebhookError: any) {
            logger.error(`Failed to trigger inbound call webhook: ${inboundWebhookError.message}`, undefined, 'PlivoCall');
          }
        }
      } catch (webhookError: any) {
        logger.error(`Failed to trigger webhook for call ${callId}: ${webhookError.message}`, webhookError, 'PlivoCall');
      }

      // CRM Lead Creation - Process call for qualified lead creation
      if (status === 'completed' && call.userId) {
        try {
          const { CRMLeadProcessor } = await import('../../crm/lead-processor.service');
          const result = await CRMLeadProcessor.processPlivoOpenAICall(call.id);
          if (result?.leadId) {
            logger.info(`CRM lead created: ${result.leadId} (${result.qualification.category})`, undefined, 'PlivoCall');
          } else if (result) {
            logger.info(`Call did not qualify for CRM lead`, undefined, 'PlivoCall');
          }
        } catch (crmError: any) {
          logger.error(`Failed to create CRM lead: ${crmError.message}`, crmError, 'PlivoCall');
        }
      }

      if (status === 'completed' && call.userId && call.agentId) {
        try {
          const callerPhone = call.callDirection === 'inbound'
            ? (call.fromNumber || (metadata?.from as string) || '')
            : (call.toNumber || (metadata?.to as string) || '');
          const { triggerPostCallMessaging } = await import('../../../services/post-call-messaging');
          triggerPostCallMessaging({
            elevenLabsAgentId: call.agentId,
            userId: call.userId,
            callerPhone,
            callId: call.id,
          }).catch(err => logger.error(`Post-call messaging error: ${err.message}`, err, 'PlivoCall'));
          logger.info(`Triggered post-call messaging for call ${callId}`, undefined, 'PlivoCall');
        } catch (msgErr: any) {
          logger.error(`Post-call messaging setup error: ${msgErr.message}`, msgErr, 'PlivoCall');
        }
      }
    }

    return updatedCall;
  }

  /**
   * Handle call recording ready webhook
   */
  static async handleRecordingReady(
    callId: string,
    recordingUrl: string,
    duration: number
  ): Promise<PlivoCallRecord | null> {
    logger.info(`Recording ready for call ${callId}: ${recordingUrl} (${duration}s)`, undefined, 'PlivoCall');

    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.id, callId))
      .limit(1);

    if (!call) {
      logger.error(`Call not found for recording: ${callId}`, undefined, 'PlivoCall');
      return null;
    }

    const [updatedCall] = await db
      .update(plivoCalls)
      .set({
        recordingUrl,
        recordingDuration: duration,
      })
      .where(eq(plivoCalls.id, callId))
      .returning();

    return updatedCall;
  }

  /**
   * End an active call
   */
  static async endCall(callId: string): Promise<void> {
    logger.info(`Ending call ${callId}`, undefined, 'PlivoCall');

    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.id, callId))
      .limit(1);

    if (!call || !call.plivoCallUuid) {
      logger.error(`Call not found or no UUID: ${callId}`, undefined, 'PlivoCall');
      return;
    }

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(call.status)) {
      logger.info(`Call ${callId} already ended with status: ${call.status}`, undefined, 'PlivoCall');
      return;
    }

    const plivoCredentialId = (call.metadata as Record<string, unknown>)?.plivoCredentialId as string | undefined;
    const { client } = await this.getPlivoClient(plivoCredentialId);

    try {
      await client.calls.hangup(call.plivoCallUuid);
      logger.info(`Successfully hung up call ${call.plivoCallUuid}`, undefined, 'PlivoCall');
    } catch (error: any) {
      logger.error('Failed to hang up call', error, 'PlivoCall');
      throw new Error(`Failed to end call: ${error.message}`);
    }
  }

  /**
   * Get call by internal ID
   */
  static async getCallById(callId: string): Promise<PlivoCallRecord | null> {
    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.id, callId))
      .limit(1);

    return call || null;
  }

  /**
   * Get call by Plivo UUID
   */
  static async getCallByUuid(plivoCallUuid: string): Promise<PlivoCallRecord | null> {
    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.plivoCallUuid, plivoCallUuid))
      .limit(1);

    return call || null;
  }

  /**
   * Get calls for a campaign
   */
  static async getCallsByCampaign(campaignId: string): Promise<PlivoCallRecord[]> {
    const calls = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.campaignId, campaignId))
      .orderBy(desc(plivoCalls.createdAt));

    return calls;
  }

  /**
   * Get calls for a user
   */
  static async getCallsByUser(userId: string, limit = 50): Promise<PlivoCallRecord[]> {
    const calls = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.userId, userId))
      .orderBy(desc(plivoCalls.createdAt))
      .limit(limit);

    return calls;
  }

  /**
   * Update call transcript and AI summary
   */
  static async updateCallSummary(
    callId: string,
    summary: {
      transcript: string;
      aiSummary: string;
      leadQualityScore: number;
      sentiment: PlivoCallSentiment;
      leadClassification?: 'hot' | 'warm' | 'cold' | 'lost';
      keyPoints?: string[];
      nextActions?: string[];
    }
  ): Promise<PlivoCallRecord | null> {
    logger.info(`Updating summary for call ${callId}`, undefined, 'PlivoCall');

    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.id, callId))
      .limit(1);

    if (!call) {
      logger.error(`Call not found: ${callId}`, undefined, 'PlivoCall');
      return null;
    }

    const existingMetadata = (call.metadata as Record<string, unknown>) || {};
    const updatedMetadata = {
      ...existingMetadata,
      leadClassification: summary.leadClassification || this.inferLeadClassification(summary.leadQualityScore),
      summarizedAt: new Date().toISOString(),
    };

    const [updatedCall] = await db
      .update(plivoCalls)
      .set({
        transcript: summary.transcript,
        aiSummary: summary.aiSummary,
        leadQualityScore: summary.leadQualityScore,
        sentiment: summary.sentiment,
        keyPoints: summary.keyPoints || [],
        nextActions: summary.nextActions || [],
        metadata: updatedMetadata,
      })
      .where(eq(plivoCalls.id, callId))
      .returning();

    return updatedCall;
  }

  /**
   * Infer lead classification from quality score
   */
  private static inferLeadClassification(score: number): 'hot' | 'warm' | 'cold' | 'lost' {
    if (score >= 80) return 'hot';
    if (score >= 60) return 'warm';
    if (score >= 30) return 'cold';
    return 'lost';
  }

  /**
   * Mark call as transferred
   */
  static async markCallTransferred(
    callId: string,
    transferredTo: string
  ): Promise<PlivoCallRecord | null> {
    logger.info(`Marking call ${callId} as transferred to ${transferredTo}`, undefined, 'PlivoCall');

    const [updatedCall] = await db
      .update(plivoCalls)
      .set({
        wasTransferred: true,
        transferredTo,
        transferredAt: new Date(),
      })
      .where(eq(plivoCalls.id, callId))
      .returning();

    // Trigger call.transferred webhook event
    if (updatedCall && updatedCall.userId) {
      try {
        // Get contact and agent info for the webhook payload
        let contactInfo: { id: string; name: string; phone: string; email: string | null } | null = null;
        let agentInfo: { id: string; name: string } | null = null;
        
        if (updatedCall.contactId) {
          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, updatedCall.contactId))
            .limit(1);
          if (contact) {
            contactInfo = {
              id: contact.id,
              name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown',
              phone: contact.phone,
              email: contact.email || null,
            };
          }
        }
        
        if (updatedCall.agentId) {
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, updatedCall.agentId))
            .limit(1);
          if (agent) {
            agentInfo = { id: agent.id, name: agent.name };
          }
        }

        const duration = updatedCall.startedAt
          ? Math.floor((new Date().getTime() - new Date(updatedCall.startedAt).getTime()) / 1000)
          : 0;

        await webhookDeliveryService.triggerEvent(updatedCall.userId, 'call.transferred', {
          call: {
            id: updatedCall.id,
            callUuid: updatedCall.plivoCallUuid,
            direction: updatedCall.callDirection || 'outbound',
            status: 'transferred',
            startedAt: updatedCall.startedAt ? new Date(updatedCall.startedAt).toISOString() : null,
            transferredAt: new Date().toISOString(),
            duration,
            fromNumber: updatedCall.fromNumber,
            toNumber: updatedCall.toNumber,
          },
          contact: contactInfo,
          transfer: {
            reason: 'Call transferred to human agent',
            transferTo: transferredTo,
            transferType: 'warm',
          },
          agent: agentInfo,
          campaign: updatedCall.campaignId ? { id: updatedCall.campaignId } : null,
        });
        logger.info(`Triggered call.transferred webhook for call ${callId}`, undefined, 'PlivoCall');
      } catch (webhookError: any) {
        logger.error(`Failed to trigger call.transferred webhook: ${webhookError.message}`, undefined, 'PlivoCall');
      }
    }

    return updatedCall || null;
  }

  /**
   * Create a record for an incoming call
   */
  static async createIncomingCall(params: {
    fromNumber: string;
    toNumber: string;
    plivoCallUuid: string;
    agentId?: string;
    plivoPhoneNumberId?: string;
    userId?: string;
    openaiCredentialId?: string;
    plivoCredentialId?: string;
  }): Promise<PlivoCallRecord> {
    logger.info(`Creating incoming call record: ${params.fromNumber} -> ${params.toNumber}`, undefined, 'PlivoCall');

    const [callRecord] = await db
      .insert(plivoCalls)
      .values({
        userId: params.userId || null,
        agentId: params.agentId || null,
        plivoPhoneNumberId: params.plivoPhoneNumberId || null,
        openaiCredentialId: params.openaiCredentialId || null,
        plivoCallUuid: params.plivoCallUuid,
        fromNumber: params.fromNumber,
        toNumber: params.toNumber,
        openaiVoice: PlivoEngineConfig.defaults.voice,
        openaiModel: PlivoEngineConfig.defaults.model,
        status: 'ringing',
        callDirection: 'inbound',
        startedAt: new Date(),
        metadata: params.plivoCredentialId ? { plivoCredentialId: params.plivoCredentialId } : null,
      } as InsertPlivoCall)
      .returning();

    return callRecord;
  }

  /**
   * Get active calls count for a user
   */
  static async getActiveCallsCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(plivoCalls)
      .where(
        and(
          eq(plivoCalls.userId, userId),
          sql`${plivoCalls.status} IN ('pending', 'initiated', 'ringing', 'in-progress')`
        )
      );

    return result?.count || 0;
  }

  /**
   * Get call statistics for a user
   */
  static async getCallStats(userId: string): Promise<{
    totalCalls: number;
    completedCalls: number;
    failedCalls: number;
    totalDurationSeconds: number;
    averageLeadScore: number;
  }> {
    const [stats] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        completedCalls: sql<number>`count(*) filter (where status = 'completed')::int`,
        failedCalls: sql<number>`count(*) filter (where status in ('failed', 'busy', 'no-answer'))::int`,
        totalDuration: sql<number>`coalesce(sum(duration), 0)::int`,
        avgLeadScore: sql<number>`coalesce(avg(lead_quality_score), 0)::float`,
      })
      .from(plivoCalls)
      .where(eq(plivoCalls.userId, userId));

    return {
      totalCalls: stats?.totalCalls || 0,
      completedCalls: stats?.completedCalls || 0,
      failedCalls: stats?.failedCalls || 0,
      totalDurationSeconds: stats?.totalDuration || 0,
      averageLeadScore: Math.round((stats?.avgLeadScore || 0) * 10) / 10,
    };
  }

  /**
   * Clear cached Plivo clients (useful when credentials are updated)
   */
  static clearClientCache(): void {
    this.plivoClients.clear();
    logger.info('Cleared Plivo client cache', undefined, 'PlivoCall');
  }

  /**
   * Query Plivo API for actual call status
   * Used as a fallback when webhooks don't arrive
   */
  static async getCallStatusFromPlivo(callId: string): Promise<{
    status: PlivoCallStatus;
    duration: number;
    endTime: Date | null;
    hangupCause: string | null;
  } | null> {
    const call = await this.getCallById(callId);
    if (!call || !call.plivoCallUuid) {
      logger.warn(`Cannot query Plivo: call ${callId} not found or no UUID`, undefined, 'PlivoCall');
      return null;
    }

    const plivoCredentialId = (call.metadata as Record<string, unknown>)?.plivoCredentialId as string | undefined;
    
    try {
      const { client } = await this.getPlivoClient(plivoCredentialId);
      const plivoCallDetails = await client.calls.get(call.plivoCallUuid) as any;
      
      logger.info(`Plivo API response for ${call.plivoCallUuid}:`, plivoCallDetails, 'PlivoCall');
      
      const plivoStatus = (plivoCallDetails.callState || plivoCallDetails.call_state || '').toLowerCase();
      const hangupCause = plivoCallDetails.hangupCauseName || plivoCallDetails.hangupCause || plivoCallDetails.hangup_cause || null;
      const hangupCode = plivoCallDetails.hangupCauseCode || plivoCallDetails.hangup_cause_code || null;
      const billDurationRaw = parseInt(plivoCallDetails.billDuration || plivoCallDetails.bill_duration || '0');
      const billDuration = isNaN(billDurationRaw) ? 0 : billDurationRaw;
      const endTimeStr = plivoCallDetails.endTime || plivoCallDetails.end_time;
      
      const statusMap: Record<string, PlivoCallStatus> = {
        'ringing': 'ringing',
        'answer': 'completed',
        'answered': 'in-progress',
        'in-progress': 'in-progress',
        'completed': 'completed',
        'busy': 'busy',
        'failed': 'failed',
        'no-answer': 'no-answer',
        'cancel': 'canceled',
        'canceled': 'canceled',
        'cancelled': 'canceled',
        'hangup': 'completed',
        'machine': 'completed',
      };
      
      // Normal hangup (code 4000) means successful completion
      const isNormalHangup = hangupCode === 4000 || hangupCause === 'Normal Hangup';
      const normalizedStatus = statusMap[plivoStatus] || 
        (isNormalHangup || hangupCause ? 'completed' : 'failed');
      
      return {
        status: normalizedStatus,
        duration: billDuration,
        endTime: endTimeStr ? new Date(endTimeStr) : null,
        hangupCause,
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        logger.info(`Call ${call.plivoCallUuid} not found in Plivo (may be too old or invalid)`, undefined, 'PlivoCall');
        return { status: 'failed', duration: 0, endTime: null, hangupCause: 'CALL_NOT_FOUND' };
      }
      logger.error(`Failed to query Plivo API for call ${callId}: ${error.message}`, error, 'PlivoCall');
      return null;
    }
  }

  /**
   * Update stuck initiated calls by querying Plivo API
   * Called periodically to fix calls that didn't receive status webhooks
   */
  static async updateStuckInitiatedCalls(): Promise<{ updated: number; failed: number }> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const stuckCalls = await db
      .select()
      .from(plivoCalls)
      .where(
        and(
          sql`${plivoCalls.status} IN ('initiated', 'pending')`,
          sql`${plivoCalls.createdAt} < ${fiveMinutesAgo}`
        )
      )
      .limit(20);
    
    if (stuckCalls.length === 0) {
      return { updated: 0, failed: 0 };
    }
    
    logger.info(`Found ${stuckCalls.length} stuck initiated calls to update`, undefined, 'PlivoCall');
    
    let updated = 0;
    let failed = 0;
    
    for (const call of stuckCalls) {
      try {
        const plivoStatus = await this.getCallStatusFromPlivo(call.id);
        
        if (plivoStatus) {
          logger.info(`Updating stuck call ${call.id} from 'initiated' to '${plivoStatus.status}'`, undefined, 'PlivoCall');
          
          await this.handleCallStatus(
            call.id,
            plivoStatus.status,
            { 
              source: 'plivo_api_fallback',
              hangupCause: plivoStatus.hangupCause,
            },
            plivoStatus.duration
          );
          updated++;
        } else {
          const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
          if (call.createdAt && new Date(call.createdAt) < twentyMinutesAgo) {
            logger.info(`Marking very old stuck call ${call.id} as failed (>20 min old)`, undefined, 'PlivoCall');
            await this.handleCallStatus(call.id, 'failed', { 
              source: 'timeout_fallback',
              reason: 'No status update received within 20 minutes',
            });
            updated++;
          } else {
            failed++;
          }
        }
      } catch (error: any) {
        logger.error(`Failed to update stuck call ${call.id}: ${error.message}`, error, 'PlivoCall');
        failed++;
      }
    }
    
    logger.info(`Stuck calls update complete: ${updated} updated, ${failed} failed`, undefined, 'PlivoCall');
    return { updated, failed };
  }

  /**
   * Start the stuck calls cleanup scheduler
   * Runs every 2 minutes to check for and fix stuck initiated calls
   */
  static startStuckCallsScheduler(): void {
    const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
    
    logger.info('🔄 [PlivoCall] Starting stuck calls cleanup scheduler (2 min interval)', undefined, 'PlivoCall');
    
    setInterval(async () => {
      try {
        const result = await this.updateStuckInitiatedCalls();
        if (result.updated > 0 || result.failed > 0) {
          logger.info(`[PlivoCall] Stuck calls cleanup: ${result.updated} updated, ${result.failed} failed`, undefined, 'PlivoCall');
        }
      } catch (error: any) {
        logger.error(`[PlivoCall] Stuck calls cleanup error: ${error.message}`, error, 'PlivoCall');
      }
    }, INTERVAL_MS);
  }
}
