'use strict';
/**
 * ============================================================
 * BullMQ Call Worker
 * Processes campaign calls by delegating to existing campaign services
 * 
 * This worker is designed to be isolated and opt-in.
 * It orchestrates call processing and delegates to existing services
 * to avoid duplicating business logic.
 * ============================================================
 */

import { Worker, Job } from 'bullmq';
import { getRedisConnection } from './redis-connection';
import { QUEUE_NAMES, CampaignCallJob } from './queues';
import { substituteContactVariables, enrichDynamicDataWithContactInfo } from '../../utils/contact-variable-substitution';

const MAX_CONCURRENT_CALLS = parseInt(process.env.BULLMQ_MAX_CONCURRENT_CALLS || '10', 10);

let callWorker: Worker<CampaignCallJob> | null = null;

interface CallResult {
  success: boolean;
  callId: string;
  duration?: number;
  status: 'completed' | 'failed' | 'no-answer' | 'busy' | 'error' | 'initiated';
  error?: string;
}

async function processCall(job: Job<CampaignCallJob>): Promise<CallResult> {
  const { callId, campaignId, engine, retryCount } = job.data;
  
  console.log(`[CallWorker] Processing call ${callId} for campaign ${campaignId} engine=${engine} (attempt ${retryCount + 1})`);
  
  try {
    const result = await initiateCall(job.data);
    console.log(`[CallWorker] Call ${callId} result: ${result.status}`);
    return result;
    
  } catch (error: any) {
    console.error(`[CallWorker] Call ${callId} failed:`, error.message);
    
    return {
      success: false,
      callId,
      status: 'error',
      error: error.message,
    };
  }
}

async function initiateCall(data: CampaignCallJob): Promise<CallResult> {
  const { callId, phone, agentId, campaignId, contactId, userId, engine, metadata } = data;
  
  const { db } = await import('../../db');
  const { agents, contacts, campaigns, calls } = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }
  
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  
  if (!contact) {
    throw new Error(`Contact ${contactId} not found`);
  }
  
  const [existingCall] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (existingCall && existingCall.status !== 'pending' && existingCall.status !== 'queued') {
    console.log(`[CallWorker] Call ${callId} already has status ${existingCall.status}, skipping`);
    return {
      success: true,
      callId,
      status: 'initiated',
    };
  }
  
  try {
    let success = false;
    let errorMessage: string | undefined;
    
    switch (engine) {
      case 'openai': {
        const { TwilioOpenAICallService } = await import('../../engines/twilio-openai/services/twilio-openai-call.service');
        const { phoneNumbers } = await import('../../../shared/schema');
        
        const fromNumberId = metadata?.fromNumberId as string;
        if (!fromNumberId) {
          throw new Error('fromNumberId is required for OpenAI calls');
        }
        
        const result = await TwilioOpenAICallService.initiateCall({
          agentId,
          campaignId,
          contactId,
          toNumber: phone,
          userId,
          fromNumberId,
        });
        success = result.success;
        errorMessage = result.error;
        break;
      }
      
      case 'sip': {
        const { PlivoElevenLabsOutboundService } = await import('../../engines/plivo-elevenlabs/services/outbound-call.service');
        const { sipTrunks, sipPhoneNumbers, elevenLabsCredentials } = await import('../../../shared/schema');
        
        if (!agent.sipPhoneNumberId) {
          throw new Error('Agent has no SIP phone number configured');
        }
        
        const [sipPhone] = await db.select().from(sipPhoneNumbers).where(eq(sipPhoneNumbers.id, agent.sipPhoneNumberId)).limit(1);
        
        if (!sipPhone || !sipPhone.sipTrunkId) {
          throw new Error('SIP phone number not found or has no trunk');
        }
        
        const [sipTrunk] = await db.select().from(sipTrunks).where(eq(sipTrunks.id, sipPhone.sipTrunkId)).limit(1);
        
        if (!sipTrunk || sipTrunk.provider !== 'plivo') {
          throw new Error('Only Plivo SIP trunks are supported');
        }
        
        const [elCred] = agent.elevenLabsCredentialId 
          ? await db.select().from(elevenLabsCredentials).where(eq(elevenLabsCredentials.id, agent.elevenLabsCredentialId)).limit(1)
          : [];
        
        if (!elCred) {
          throw new Error('ElevenLabs credentials not found');
        }
        
        // Substitute contact variables in firstMessage
        const contactInfo = {
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          email: contact.email,
          customFields: contact.customFields as Record<string, any> || null,
        };
        const hydratedFirstMessage = agent.firstMessage 
          ? substituteContactVariables(agent.firstMessage, contactInfo)
          : undefined;
        
        const dynamicData = enrichDynamicDataWithContactInfo(contactInfo);
        
        const result = await PlivoElevenLabsOutboundService.makeCall({
          toNumber: phone,
          fromNumber: sipPhone.phoneNumber,
          agentId: agent.elevenLabsAgentId || agentId,
          elevenLabsApiKey: elCred.apiKey,
          plivoAuthId: sipTrunk.username || '',
          plivoAuthToken: sipTrunk.password || '',
          agentConfig: {
            agentId: agent.elevenLabsAgentId || agentId,
            firstMessage: hydratedFirstMessage,
            language: agent.language || undefined,
            dynamicData,
          },
          // Tracking fields so the call can be recorded and billed.
          userId,
          dbAgentId: agent.id,
          campaignId,
          contactId,
        });
        success = result.success;
        errorMessage = result.error;
        break;
      }
      
      case 'elevenlabs': {
        console.log(`[CallWorker] ElevenLabs calls are handled by batch API, marking ${callId} as initiated`);
        success = true;
        break;
      }
      
      default:
        throw new Error(`Unknown engine: ${engine}`);
    }
    
    return {
      success,
      callId,
      status: success ? 'initiated' : 'failed',
      error: errorMessage,
    };
    
  } catch (error: any) {
    throw error;
  }
}

export function startCallWorker(): Worker<CampaignCallJob> {
  if (callWorker) {
    return callWorker;
  }
  
  callWorker = new Worker<CampaignCallJob>(
    QUEUE_NAMES.CAMPAIGN_CALLS,
    processCall,
    {
      connection: getRedisConnection(),
      concurrency: MAX_CONCURRENT_CALLS,
      limiter: {
        max: MAX_CONCURRENT_CALLS,
        duration: 1000,
      },
    }
  );
  
  callWorker.on('completed', (job, result) => {
    console.log(`[CallWorker] Job ${job.id} completed:`, result.status);
  });
  
  callWorker.on('failed', (job, err) => {
    if (job) {
      console.error(`[CallWorker] Job ${job.id} failed after retries:`, err.message);
    }
  });
  
  callWorker.on('error', (err) => {
    console.error('[CallWorker] Worker error:', err.message);
  });
  
  console.log(`[CallWorker] Started with concurrency: ${MAX_CONCURRENT_CALLS}`);
  return callWorker;
}

export async function stopCallWorker(): Promise<void> {
  if (callWorker) {
    await callWorker.close();
    callWorker = null;
    console.log('[CallWorker] Stopped');
  }
}

export function getCallWorker(): Worker<CampaignCallJob> | null {
  return callWorker;
}
