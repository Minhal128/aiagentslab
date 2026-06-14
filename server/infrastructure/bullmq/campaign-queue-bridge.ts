'use strict';
/**
 * ============================================================
 * Campaign Queue Bridge
 * 
 * IMPORTANT: This is an OPTIONAL enhancement, NOT a replacement.
 * 
 * When BullMQ is enabled (ENABLE_BULLMQ=true + REDIS_URL):
 * - Calls can be queued to BullMQ for persistent, distributed processing
 * - Workers process calls with retry logic and concurrency control
 * 
 * When BullMQ is disabled:
 * - This bridge does NOT queue anything
 * - Callers MUST continue using their existing queue logic
 * - The existing CampaignQueueService and batch calling services remain active
 * 
 * INTEGRATION GUIDE:
 * ------------------
 * To use BullMQ for a campaign, you would modify the campaign executor's
 * Twilio+OpenAI or SIP path like this:
 * 
 * ```typescript
 * // In campaign-executor.ts, after creating call records:
 * if (shouldUseBullMQ()) {
 *   // Queue all calls to BullMQ for distributed processing
 *   const queueableCalls = callRecords.map(call => ({
 *     campaignId: campaign.id,
 *     contactId: call.contactId,
 *     callId: call.id,
 *     phone: call.phoneNumber,
 *     agentId: agent.id,
 *     userId: campaign.userId,
 *     engine: 'openai' as const,
 *     metadata: { fromNumberId: campaignPhoneNumber.id }
 *   }));
 *   await queueCampaignCalls(queueableCalls);
 * } else {
 *   // Use existing batch calling service
 *   const batchService = TwilioOpenAIBatchCallingService.getInstance(campaignId);
 *   await batchService.executeCampaign(campaignId);
 * }
 * ```
 * 
 * CURRENT STATUS: This is infrastructure-ready but not auto-integrated.
 * The existing TwilioOpenAIBatchCallingService continues to work.
 * ============================================================
 */

import { isBullMQEnabled, addCallsToQueue, CampaignCallJob } from './index';

export interface QueueableCampaignCall {
  campaignId: string;
  contactId: string;
  callId: string;
  phone: string;
  agentId: string;
  userId: string;
  engine: 'openai' | 'sip' | 'elevenlabs';
  flowId?: string;
  metadata?: Record<string, any>;
}

export async function queueCampaignCalls(calls: QueueableCampaignCall[]): Promise<{
  queued: boolean;
  provider: 'bullmq';
  count: number;
}> {
  if (!isBullMQEnabled()) {
    throw new Error(
      'BullMQ is not enabled. Use shouldUseBullMQ() to check before calling this function. ' +
      'When BullMQ is disabled, use your existing queue logic instead.'
    );
  }
  
  const jobs: CampaignCallJob[] = calls.map(call => ({
    ...call,
    retryCount: 0,
  }));
  
  await addCallsToQueue(jobs);
  
  return {
    queued: true,
    provider: 'bullmq',
    count: calls.length,
  };
}

export function shouldUseBullMQ(): boolean {
  return isBullMQEnabled();
}

export async function queueCampaignCallsFromBatch(
  campaignId: string,
  callRecords: Array<{ id: string; contactId: string; phoneNumber: string }>,
  agentId: string,
  userId: string,
  engine: 'openai' | 'sip',
  metadata?: Record<string, any>
): Promise<{ queued: boolean; count: number }> {
  if (!isBullMQEnabled()) {
    return { queued: false, count: 0 };
  }
  
  const queueableCalls: QueueableCampaignCall[] = callRecords.map(call => ({
    campaignId,
    contactId: call.contactId,
    callId: call.id,
    phone: call.phoneNumber,
    agentId,
    userId,
    engine,
    metadata,
  }));
  
  const result = await queueCampaignCalls(queueableCalls);
  return { queued: result.queued, count: result.count };
}
