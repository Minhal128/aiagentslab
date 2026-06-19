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
import { ElevenLabsService } from './elevenlabs';
import { ElevenLabsPoolService } from './elevenlabs-pool';
import { BatchCallingService, BatchJob, BatchJobStatus, BatchJobWithRecipients } from './batch-calling';
import { db } from '../db';
import { campaigns, contacts, calls, agents, phoneNumbers, plivoPhoneNumbers, sipPhoneNumbers, flowExecutions, flows } from '../../shared/schema';
import { nanoid } from 'nanoid';
import { eq, inArray, sql, and, isNotNull, lte } from 'drizzle-orm';
import { CampaignScheduler } from './campaign-scheduler';
import { webhookDeliveryService } from './webhook-delivery';
import { emailService } from './email-service';
import { 
  isConcurrencyLimitError, 
  markCampaignForRetry, 
  autoMigrateUser,
  hasAnyAvailableCapacity,
  PhoneMigrator 
} from '../engines/elevenlabs-migration';
import { PlivoBatchCallingService } from '../engines/plivo/services/plivo-batch-calling.service';
import { TwilioOpenAIBatchCallingService } from '../engines/twilio-openai/services/twilio-openai-batch-calling.service';
import { batchInsertCalls, batchInsertFlowExecutions, FlowExecutionInsert } from '../utils/batch-utils';
import { substituteContactVariables, enrichDynamicDataWithContactInfo } from '../utils/contact-variable-substitution';
import { resyncSinglePhoneCredentials, resyncSipPhoneCredentials, verifySipPhoneExists } from './elevenlabs-phone-resync';

/** Log when a single ElevenLabs batch job carries very many recipients (API / payload limits vary by workspace). */
const ELEVENLABS_BATCH_LARGE_RECIPIENT_WARN = 25_000;

function warnIfVeryLargeElevenLabsBatch(recipientCount: number, campaignName: string, campaignId: string): void {
  if (recipientCount >= ELEVENLABS_BATCH_LARGE_RECIPIENT_WARN) {
    console.warn(
      `⚠️ [Campaign Executor] Very large ElevenLabs batch: ${recipientCount} recipients for campaign "${campaignName}" (${campaignId}). ` +
        `If submission fails, split into multiple campaigns or confirm ElevenLabs batch limits for your plan.`
    );
  }
}

/**
 * Check if a batchJobId belongs to a non-ElevenLabs engine (Plivo or Twilio-OpenAI).
 * These engines store a prefixed batch job ID (e.g., "plivo-xxx" or "twilio_openai-xxx")
 * and should NOT be sent to ElevenLabs batch calling API.
 * Note: "twilio-openai-" (hyphen) is kept for backwards compat with older DB records
 * that were written before the prefix was standardised to "twilio_openai-" (underscore).
 */
function isNonElevenLabsBatchJob(batchJobId: string): boolean {
  return (
    batchJobId.startsWith('plivo-') ||
    batchJobId.startsWith('twilio_openai-') ||
    batchJobId.startsWith('twilio-openai-')
  );
}

interface CallConfig {
  campaignId: string;
  userId: string; // Direct user ownership for guaranteed isolation
  contactId: string;
  agentId: string;
  phoneNumberId: string;
  voiceId: string;
  customScript?: string;
}

interface CallResult {
  callId: string;
  status: 'completed' | 'failed' | 'no-answer' | 'busy';
  duration?: number;
  transcript?: string;
  summary?: string;
  classification?: string;
  recordingUrl?: string;
  twilioCallSid?: string;
  error?: string;
}

export class CampaignExecutor {
  private activeWebSockets: Map<string, WebSocket> = new Map();

  /**
   * Pre-validate campaign before execution
   * Checks all requirements for the appropriate engine (ElevenLabs, Plivo+OpenAI, Twilio+OpenAI)
   * Returns detailed error messages if validation fails
   */
  async validateCampaign(campaignId: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Get campaign
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      if (!campaign) {
        return { valid: false, errors: ['Campaign not found'], warnings: [] };
      }

      // Check campaign status
      if (!['pending', 'draft', 'scheduled'].includes(campaign.status)) {
        errors.push(`Campaign cannot be started - current status is "${campaign.status}"`);
      }

      // Check agent
      if (!campaign.agentId) {
        errors.push('No agent assigned to this campaign. Please select an agent.');
      }

      // Check phone number (Twilio phoneNumberId OR Plivo plivoPhoneNumberId OR SIP sipPhoneNumberId)
      if (!campaign.phoneNumberId && !campaign.plivoPhoneNumberId && !(campaign as any).sipPhoneNumberId) {
        errors.push('No phone number assigned to this campaign. Please select a phone number.');
      }

      // Get agent details
      let agent;
      if (campaign.agentId) {
        const [agentResult] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, campaign.agentId))
          .limit(1);
        agent = agentResult;
        
        if (!agent) {
          errors.push('Agent not found. The assigned agent may have been deleted.');
        }
      }

      // Get phone number details
      let phoneNumber;
      if (campaign.phoneNumberId) {
        const [phoneResult] = await db
          .select()
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, campaign.phoneNumberId))
          .limit(1);
        phoneNumber = phoneResult;
        
        if (!phoneNumber) {
          errors.push('Phone number not found. The assigned phone number may have been deleted.');
        }
      }

      // Get SIP phone number details (if using SIP)
      let sipPhoneNumber;
      if ((campaign as any).sipPhoneNumberId) {
        const [sipPhoneResult] = await db
          .select()
          .from(sipPhoneNumbers)
          .where(eq(sipPhoneNumbers.id, (campaign as any).sipPhoneNumberId))
          .limit(1);
        sipPhoneNumber = sipPhoneResult;
        
        if (!sipPhoneNumber) {
          errors.push('SIP phone number not found. The assigned SIP phone number may have been deleted or is invalid.');
        } else if (sipPhoneNumber.userId !== campaign.userId) {
          errors.push('SIP phone number does not belong to this account. Please select a valid SIP phone number.');
        } else if (!sipPhoneNumber.isActive) {
          errors.push('SIP phone number is not active. Please activate it before starting the campaign.');
        } else if (!sipPhoneNumber.outboundEnabled) {
          errors.push('SIP phone number is not enabled for outbound calls. Please enable outbound calling in your SIP trunk settings.');
        }
      }

      // Check contacts
      const campaignContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId));

      if (campaignContacts.length === 0) {
        errors.push('Campaign has no contacts. Please add at least one contact to start the campaign.');
      }

      // Engine-specific validation
      if (agent) {
        const provider = agent.telephonyProvider || 'twilio';

        if (provider === 'plivo') {
          // Plivo + OpenAI engine validation
          if (!agent.openaiCredentialId) {
            warnings.push('No OpenAI credential assigned to agent. Will use default pool.');
          }
        } else if (provider === 'twilio_openai') {
          // Twilio + OpenAI engine validation
          if (!agent.openaiCredentialId) {
            warnings.push('No OpenAI credential assigned to agent. Will use default pool.');
          }
        } else if (provider === 'elevenlabs-sip') {
          // ElevenLabs SIP engine validation - uses batch API directly
          if (!agent.elevenLabsAgentId) {
            errors.push('ElevenLabs SIP agent is not synced. Please sync the agent from Agent Settings.');
          }
        } else {
          // ElevenLabs engine validation (default)
          if (!agent.elevenLabsAgentId) {
            errors.push('Agent is not synced with ElevenLabs. Please sync the agent from Agent Settings before starting the campaign.');
          }
          
          if (!agent.elevenLabsCredentialId) {
            errors.push('Agent is not assigned to an ElevenLabs API key. Please configure ElevenLabs credentials in Admin Settings.');
          }

          if (phoneNumber && !phoneNumber.elevenLabsPhoneNumberId) {
            errors.push('Phone number is not synced with ElevenLabs. Please sync your phone numbers from Admin Settings.');
          }

          // Check credential mismatch (warning, not error - we can auto-migrate)
          if (phoneNumber && agent.elevenLabsCredentialId && 
              phoneNumber.elevenLabsCredentialId && 
              phoneNumber.elevenLabsCredentialId !== agent.elevenLabsCredentialId) {
            warnings.push('Phone number and agent use different ElevenLabs credentials. The system will attempt auto-migration which may take a moment.');
          }
        }
      }

      return { 
        valid: errors.length === 0, 
        errors, 
        warnings 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      return { valid: false, errors: [`Validation error: ${errorMessage}`], warnings: [] };
    }
  }

  /**
   * Execute a campaign using ElevenLabs Batch Calling API
   * 
   * This creates a single batch job with all contacts instead of queuing individual calls.
   * ElevenLabs handles the orchestration, rate limiting, and parallel execution.
   */
  async executeCampaign(campaignId: string): Promise<{ batchJob: BatchJob }> {
    try {
      // Get campaign details
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      if (campaign.status !== 'pending' && campaign.status !== 'draft' && campaign.status !== 'scheduled') {
        throw new Error('Campaign is already running or completed');
      }

      // Validate campaign has required fields
      if (!campaign.agentId) {
        throw new Error('Campaign has no agent configured');
      }
      // Check for either Twilio phoneNumberId, Plivo plivoPhoneNumberId, or SIP sipPhoneNumberId
      if (!campaign.phoneNumberId && !campaign.plivoPhoneNumberId && !(campaign as any).sipPhoneNumberId) {
        throw new Error('Campaign has no phone number configured');
      }

      // Get agent details
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, campaign.agentId))
        .limit(1);

      if (!agent) {
        throw new Error('Agent not found');
      }

      // Route to Plivo engine if agent uses Plivo telephony
      if (agent.telephonyProvider === 'plivo') {
        console.log(`📞 [Campaign Executor] Routing to Plivo + OpenAI engine for campaign ${campaignId}`);
        
        // Get all contacts for the campaign
        const campaignContacts = await db
          .select()
          .from(contacts)
          .where(eq(contacts.campaignId, campaignId));

        if (campaignContacts.length === 0) {
          throw new Error('Campaign has no contacts');
        }

        // Plivo campaigns use plivoPhoneNumberId, not phoneNumberId
        if (!campaign.plivoPhoneNumberId) {
          throw new Error('Plivo campaign requires a Plivo phone number');
        }

        // Get campaign phone number for fromNumber from Plivo phone numbers table
        const [campaignPhoneNumber] = await db
          .select()
          .from(plivoPhoneNumbers)
          .where(eq(plivoPhoneNumbers.id, campaign.plivoPhoneNumberId))
          .limit(1);

        if (!campaignPhoneNumber) {
          throw new Error('Plivo phone number not found');
        }

        // Store Plivo-specific batch job ID for tracking
        const plivoBatchJobId = `plivo-${campaignId}`;
        
        // Update campaign status to 'running' and set startedAt BEFORE execution
        await db
          .update(campaigns)
          .set({
            status: 'running',
            startedAt: new Date(),
            batchJobId: plivoBatchJobId,
            batchJobStatus: 'running',
            totalContacts: campaignContacts.length,
          })
          .where(eq(campaigns.id, campaignId));

        // PRE-CREATE CALL RECORDS using batch insert for scalability (10,000+ contacts)
        const callInserts = campaignContacts.map(contact => ({
          userId: campaign.userId,
          campaignId: campaign.id,
          contactId: contact.id,
          phoneNumber: contact.phone,
          fromNumber: campaignPhoneNumber.phoneNumber,
          toNumber: contact.phone,
          status: 'pending' as const,
          callDirection: 'outgoing' as const,
          engineType: 'plivo-openai',
          metadata: {
            batchCall: true,
            batchJobId: plivoBatchJobId,
            agentId: agent.id,
            telephonyProvider: 'plivo',
            engine: 'plivo-openai',
            contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
          },
        }));

        const callResult = await batchInsertCalls(callInserts, '📞 [Plivo Campaign]');
        const preCreatedCalls = callResult.results;

        // Stamp lastAttemptAt for all contacts being called in this first pass
        if (campaignContacts.length > 0) {
          await db.update(contacts).set({ lastAttemptAt: new Date(), attemptCount: 1 })
            .where(inArray(contacts.id, campaignContacts.map(c => c.id)));
        }
        
        // Create flow execution records for flow-based agents using batch insert
        if (agent.flowId && preCreatedCalls.length > 0) {
          const flowExecInserts: FlowExecutionInsert[] = preCreatedCalls.map(callRecord => ({
            callId: callRecord.id,
            flowId: agent.flowId!,
            campaignId: campaign.id,
            campaignName: campaign.name,
            contactPhone: callRecord.phoneNumber || '',
            telephonyProvider: 'plivo',
          }));
          
          await batchInsertFlowExecutions(flowExecInserts, '🔀 [Plivo Campaign]');
        }
        
        // Fire-and-forget: start the Plivo engine in the background so the HTTP
        // response is returned immediately without waiting for all calls to finish.
        const plivoBatchService = PlivoBatchCallingService.getInstance(campaignId);
        plivoBatchService.executeCampaign(campaignId).then(async (result) => {
          if (campaign.userId && result.status === 'completed') {
            const completedContacts = await db
              .select()
              .from(contacts)
              .where(eq(contacts.campaignId, campaignId));
            
            webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.completed', {
              campaign: {
                id: campaign.id,
                name: campaign.name,
                type: campaign.type,
                status: 'completed',
                totalContacts: result.totalCalls,
                startedAt: campaign.startedAt,
                completedAt: new Date().toISOString(),
                createdAt: campaign.createdAt,
              },
              stats: {
                successfulCalls: result.completedCalls,
                failedCalls: result.failedCalls,
                totalCalls: result.totalCalls,
                completedCalls: result.completedCalls + result.failedCalls,
              },
              contacts: completedContacts.map(c => ({
                id: c.id,
                firstName: c.firstName,
                lastName: c.lastName,
                phone: c.phone,
                email: c.email,
                status: c.status,
              })),
            }, campaignId).catch(err => {
              console.error('❌ [Webhook] Error triggering campaign.completed event:', err);
            });
            
            try {
              await emailService.sendCampaignCompleted(campaignId);
            } catch (emailError: any) {
              console.error(`❌ [Campaign] Failed to send campaign completed email:`, emailError);
            }
          }
        }).catch((error: any) => {
          // The batch service already marks the campaign as 'failed' in its own catch block.
          console.error(`❌ [Plivo Campaign] Background execution error for ${campaignId}:`, error);
        });

        // Return immediately — campaign is now running in the background
        return {
          batchJob: {
            id: plivoBatchJobId,
            name: campaign.name,
            agent_id: agent.id,
            agent_name: agent.name,
            created_at_unix: Math.floor(Date.now() / 1000),
            scheduled_time_unix: 0,
            last_updated_at_unix: Math.floor(Date.now() / 1000),
            total_calls_scheduled: campaignContacts.length,
            total_calls_dispatched: 0,
            status: 'running' as const,
          }
        };
      }

      // Route to Twilio-OpenAI engine if agent uses twilio_openai telephony
      if (agent.telephonyProvider === 'twilio_openai') {
        console.log(`📞 [Campaign Executor] Routing to Twilio + OpenAI engine for campaign ${campaignId}`);
        
        const campaignContacts = await db
          .select()
          .from(contacts)
          .where(eq(contacts.campaignId, campaignId));

        if (campaignContacts.length === 0) {
          throw new Error('Campaign has no contacts');
        }

        // Get campaign phone number for fromNumber
        const [campaignPhoneNumberTwilioOpenAI] = await db
          .select()
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, campaign.phoneNumberId!))
          .limit(1);

        if (!campaignPhoneNumberTwilioOpenAI) {
          throw new Error('Campaign phone number not found');
        }

        const twilioOpenAIBatchJobId = `twilio_openai-${campaignId}`;
        
        await db
          .update(campaigns)
          .set({
            status: 'running',
            startedAt: new Date(),
            batchJobId: twilioOpenAIBatchJobId,
            batchJobStatus: 'running',
            totalContacts: campaignContacts.length,
          })
          .where(eq(campaigns.id, campaignId));

        // PRE-CREATE CALL RECORDS using batch insert for scalability (10,000+ contacts)
        const callInsertsTwilioOpenAI = campaignContacts.map(contact => ({
          userId: campaign.userId,
          campaignId: campaign.id,
          contactId: contact.id,
          phoneNumber: contact.phone,
          fromNumber: campaignPhoneNumberTwilioOpenAI.phoneNumber,
          toNumber: contact.phone,
          status: 'pending' as const,
          callDirection: 'outgoing' as const,
          metadata: {
            batchCall: true,
            batchJobId: twilioOpenAIBatchJobId,
            agentId: agent.id,
            telephonyProvider: 'twilio_openai',
            contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
          },
        }));

        const callResultTwilioOpenAI = await batchInsertCalls(callInsertsTwilioOpenAI, '📞 [Twilio-OpenAI Campaign]');
        const preCreatedCalls = callResultTwilioOpenAI.results;

        // Stamp lastAttemptAt for all contacts being called in this first pass
        if (campaignContacts.length > 0) {
          await db.update(contacts).set({ lastAttemptAt: new Date(), attemptCount: 1 })
            .where(inArray(contacts.id, campaignContacts.map(c => c.id)));
        }
        
        // Create flow execution records for flow-based agents using batch insert
        if (agent.flowId && preCreatedCalls.length > 0) {
          const flowExecInsertsTwilioOpenAI: FlowExecutionInsert[] = preCreatedCalls.map(callRecord => ({
            callId: callRecord.id,
            flowId: agent.flowId!,
            campaignId: campaign.id,
            campaignName: campaign.name,
            contactPhone: callRecord.phoneNumber || '',
            telephonyProvider: 'twilio_openai',
          }));
          
          await batchInsertFlowExecutions(flowExecInsertsTwilioOpenAI, '🔀 [Twilio-OpenAI Campaign]');
        }
        
        // Fire-and-forget: start the Twilio-OpenAI engine in the background so the HTTP
        // response is returned immediately without waiting for all calls to finish.
        const twilioOpenAIBatchService = TwilioOpenAIBatchCallingService.getInstance(campaignId);
        twilioOpenAIBatchService.executeCampaign(campaignId).then(async (result) => {
          if (campaign.userId && result.status === 'completed') {
            const finalContacts = await db
              .select()
              .from(contacts)
              .where(eq(contacts.campaignId, campaignId));
            
            webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.completed', {
              campaign: {
                id: campaign.id,
                name: campaign.name,
                type: campaign.type,
                status: 'completed',
                totalContacts: result.totalCalls,
                startedAt: campaign.startedAt,
                completedAt: new Date().toISOString(),
                createdAt: campaign.createdAt,
              },
              stats: {
                successfulCalls: result.completedCalls,
                failedCalls: result.failedCalls,
                totalCalls: result.totalCalls,
                completedCalls: result.completedCalls + result.failedCalls,
              },
              contacts: finalContacts.map(c => ({
                id: c.id,
                firstName: c.firstName,
                lastName: c.lastName,
                phone: c.phone,
                email: c.email,
                status: c.status,
              })),
            }, campaignId).catch(err => {
              console.error('❌ [Webhook] Error triggering campaign.completed event:', err);
            });
            
            try {
              await emailService.sendCampaignCompleted(campaignId);
            } catch (emailError: any) {
              console.error(`❌ [Campaign] Failed to send campaign completed email:`, emailError);
            }
          }
        }).catch((error: any) => {
          // The batch service already marks the campaign as 'failed' in its own catch block.
          console.error(`❌ [Twilio-OpenAI Campaign] Background execution error for ${campaignId}:`, error);
        });

        // Return immediately — campaign is now running in the background
        return {
          batchJob: {
            id: twilioOpenAIBatchJobId,
            name: campaign.name,
            agent_id: agent.id,
            agent_name: agent.name,
            created_at_unix: Math.floor(Date.now() / 1000),
            scheduled_time_unix: 0,
            last_updated_at_unix: Math.floor(Date.now() / 1000),
            total_calls_scheduled: campaignContacts.length,
            total_calls_dispatched: 0,
            status: 'running' as const,
          }
        };
      }

      // Block OpenAI SIP engine from campaigns (incoming-only)
      if (agent.telephonyProvider === 'openai-sip') {
        throw new Error('OpenAI SIP engine is for incoming calls only and cannot be used for outbound campaigns. Please use an ElevenLabs SIP agent instead.');
      }

      // Route to ElevenLabs SIP engine using ElevenLabs Batch Calling API
      // This uses the same batch API as Twilio-based campaigns for scalability
      if (agent.telephonyProvider === 'elevenlabs-sip') {
        console.log(`📞 [Campaign Executor] Routing to ElevenLabs SIP batch calling for campaign ${campaignId}`);
        
        // Validate SIP phone number exists and is configured
        if (!(campaign as any).sipPhoneNumberId) {
          throw new Error('ElevenLabs SIP campaign requires a SIP phone number. Please select a SIP phone number.');
        }

        const [sipPhoneNumber] = await db
          .select()
          .from(sipPhoneNumbers)
          .where(eq(sipPhoneNumbers.id, (campaign as any).sipPhoneNumberId))
          .limit(1);

        if (!sipPhoneNumber) {
          throw new Error('SIP phone number not found. Please check your SIP phone number configuration.');
        }

        if (sipPhoneNumber.userId !== campaign.userId) {
          throw new Error('SIP phone number does not belong to this account. Please select a valid SIP phone number.');
        }

        if (!sipPhoneNumber.isActive) {
          throw new Error('SIP phone number is not active. Please activate it before starting the campaign.');
        }

        if (!sipPhoneNumber.outboundEnabled) {
          throw new Error('SIP phone number is not enabled for outbound calls. Please enable outbound calling in your SIP trunk settings.');
        }

        // ElevenLabs SIP requires externalElevenLabsPhoneId for batch API
        if (!sipPhoneNumber.externalElevenLabsPhoneId) {
          throw new Error('SIP phone number is not synced with ElevenLabs. Please re-provision the phone number in SIP settings.');
        }

        // Validate agent has ElevenLabs agent ID for batch calling
        if (!agent.elevenLabsAgentId) {
          throw new Error('Agent not synced with ElevenLabs. Please sync the agent first.');
        }

        // Get the ElevenLabs credential for this agent
        const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
        if (!credential) {
          throw new Error("No ElevenLabs credential found for agent. Please configure ElevenLabs credentials.");
        }

        // SIP PRE-FLIGHT CHECK 1: Credential mismatch — ensure the SIP phone is registered
        // under the same ElevenLabs credential the agent uses. If the admin rotated credentials
        // and Sync Agents reassigned the agent, the SIP phone may still point at the old key.
        let currentSipPhoneElevenLabsId = sipPhoneNumber.externalElevenLabsPhoneId!;

        if (sipPhoneNumber.elevenLabsCredentialId && agent.elevenLabsCredentialId &&
            sipPhoneNumber.elevenLabsCredentialId !== agent.elevenLabsCredentialId) {
          console.log(`📞 [Campaign Executor] SIP phone credential mismatch — resyncing to agent credential`);
          console.log(`   SIP phone credential: ${sipPhoneNumber.elevenLabsCredentialId}`);
          console.log(`   Agent credential: ${agent.elevenLabsCredentialId}`);

          const migResult = await resyncSipPhoneCredentials(sipPhoneNumber.id, agent.elevenLabsCredentialId);
          if (!migResult.success) {
            throw new Error(`SIP phone credential migration failed: ${migResult.error}`);
          }
          if (migResult.newElevenLabsPhoneId) {
            currentSipPhoneElevenLabsId = migResult.newElevenLabsPhoneId;
          }
          console.log(`✅ [Campaign Executor] SIP phone migrated to agent credential, new ID: ${currentSipPhoneElevenLabsId}`);
        }

        // SIP PRE-FLIGHT CHECK 2: Verify SIP phone still exists on ElevenLabs
        console.log(`📞 [Campaign Executor] Verifying SIP phone exists on ElevenLabs...`);
        const sipVerify = await verifySipPhoneExists(currentSipPhoneElevenLabsId, credential.apiKey);
        if (!sipVerify.exists) {
          if (sipVerify.notFound) {
            console.log(`⚠️ [Campaign Executor] SIP phone ${currentSipPhoneElevenLabsId} not found (404) on ElevenLabs — re-importing`);
            const reimportResult = await resyncSipPhoneCredentials(sipPhoneNumber.id, credential.id);
            if (!reimportResult.success) {
              throw new Error(`SIP phone re-import failed: ${reimportResult.error}`);
            }
            if (reimportResult.newElevenLabsPhoneId) {
              currentSipPhoneElevenLabsId = reimportResult.newElevenLabsPhoneId;
            }
            console.log(`✅ [Campaign Executor] SIP phone re-imported, new ID: ${currentSipPhoneElevenLabsId}`);
          } else {
            throw new Error(`Cannot verify SIP phone on ElevenLabs (transient error, not re-importing): ${sipVerify.error}`);
          }
        } else {
          console.log(`✅ [Campaign Executor] SIP phone exists on ElevenLabs`);
        }

        // SIP PRE-FLIGHT CHECK 3: Credential freshness — resync if not synced in last 24 hours
        {
          const now = Date.now();
          const twentyFourHours = 24 * 60 * 60 * 1000;
          const lastSync = sipPhoneNumber.credentialsSyncedAt ? new Date(sipPhoneNumber.credentialsSyncedAt).getTime() : 0;
          const needsSync = now - lastSync > twentyFourHours;

          if (needsSync && sipVerify.exists) {
            console.log(`🔄 [Campaign Executor] SIP PRE-FLIGHT CHECK 3: Refreshing SIP trunk credentials in ElevenLabs for ${sipPhoneNumber.phoneNumber}`);
            console.log(`   Last sync: ${sipPhoneNumber.credentialsSyncedAt ? new Date(sipPhoneNumber.credentialsSyncedAt).toISOString() : 'never'}`);
            try {
              const freshResult = await resyncSipPhoneCredentials(sipPhoneNumber.id, credential.id);
              if (freshResult.success && freshResult.newElevenLabsPhoneId) {
                currentSipPhoneElevenLabsId = freshResult.newElevenLabsPhoneId;
                console.log(`✅ [Campaign Executor] SIP credential refresh complete — new ID: ${currentSipPhoneElevenLabsId}`);
              } else if (!freshResult.success) {
                console.warn(`⚠️ [Campaign Executor] SIP credential refresh failed (non-fatal, continuing): ${freshResult.error}`);
              }
            } catch (syncErr: any) {
              console.warn(`⚠️ [Campaign Executor] SIP credential refresh error (non-fatal, continuing): ${syncErr?.message}`);
            }
          } else if (!needsSync) {
            console.log(`✅ [Campaign Executor] SIP PRE-FLIGHT CHECK 3: Credentials fresh (last synced ${Math.round((now - lastSync) / 3600000)}h ago)`);
          }
        }

        const campaignContacts = await db
          .select()
          .from(contacts)
          .where(eq(contacts.campaignId, campaignId));

        if (campaignContacts.length === 0) {
          throw new Error('Campaign has no contacts');
        }

        console.log(`[Campaign Executor] Creating ElevenLabs SIP batch job for campaign ${campaignId} with ${campaignContacts.length} contacts`);
        console.log(`   Agent: ${agent.name} (ElevenLabs ID: ${agent.elevenLabsAgentId})`);
        console.log(`   SIP Phone: ${sipPhoneNumber.phoneNumber} (ElevenLabs ID: ${currentSipPhoneElevenLabsId})`);
        console.log(`   Credential: ${credential.name}`);
        
        // PRE-FLIGHT CHECK: Refresh agent tools on ElevenLabs to pick up current date context
        // This ensures appointment booking tool has today's date for "tomorrow" calculations
        // Check both appointmentBookingEnabled flag AND flowId (flow agents may have appointment nodes)
        if (agent.appointmentBookingEnabled || agent.flowId) {
          console.log(`📅 [Campaign Executor] Refreshing SIP agent appointment tool for current date context...`);
          try {
            const elevenLabsServiceForTools = new ElevenLabsService(credential.apiKey);
            // Use dedicated method that fetches existing tools and updates only the appointment tool
            // while preserving all other tools (system tools, custom webhooks, etc.)
            await elevenLabsServiceForTools.refreshAppointmentToolWithCurrentDate(agent.elevenLabsAgentId);
            console.log(`✅ [Campaign Executor] SIP agent appointment tool refreshed with current date`);
          } catch (toolRefreshError: any) {
            console.warn(`⚠️ [Campaign Executor] Failed to refresh SIP agent tools: ${toolRefreshError.message}`);
            // Non-fatal - continue with campaign execution
          }
        }

        // PRE-CREATE CALL RECORDS using batch insert for scalability (10,000+ contacts)
        const callInsertsSip = campaignContacts.map(contact => ({
          userId: campaign.userId,
          campaignId: campaign.id,
          contactId: contact.id,
          phoneNumber: contact.phone,
          fromNumber: sipPhoneNumber.phoneNumber,
          toNumber: contact.phone,
          status: 'pending' as const,
          callDirection: 'outgoing' as const,
          metadata: {
            batchCall: true,
            agentId: agent.id,
            elevenLabsAgentId: agent.elevenLabsAgentId,
            telephonyProvider: 'elevenlabs-sip',
            sipPhoneNumberId: sipPhoneNumber.id,
            contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
          },
        }));

        const callResultSip = await batchInsertCalls(callInsertsSip, '📞 [ElevenLabs SIP Campaign]');
        const preCreatedCalls = callResultSip.results;

        // Stamp lastAttemptAt for all contacts being called in this first pass
        if (campaignContacts.length > 0) {
          await db.update(contacts).set({ lastAttemptAt: new Date(), attemptCount: 1 })
            .where(inArray(contacts.id, campaignContacts.map(c => c.id)));
        }

        // Create flow execution records for flow-based agents using batch insert
        if (agent.flowId && preCreatedCalls.length > 0) {
          const flowExecInsertsSip: FlowExecutionInsert[] = preCreatedCalls.map(callRecord => ({
            callId: callRecord.id,
            flowId: agent.flowId!,
            campaignId: campaign.id,
            campaignName: campaign.name,
            contactPhone: callRecord.phoneNumber || '',
            telephonyProvider: 'elevenlabs-sip',
          }));
          
          await batchInsertFlowExecutions(flowExecInsertsSip, '🔀 [ElevenLabs SIP Campaign]');
        }

        // Convert contacts to batch recipients format
        const recipients = BatchCallingService.contactsToBatchRecipients(
          campaignContacts.map(c => ({
            firstName: c.firstName,
            lastName: c.lastName,
            phone: c.phone,
            email: c.email,
            customFields: c.customFields as Record<string, any> | null,
          }))
        );

        // Create batch calling service with agent's credential
        const batchService = new BatchCallingService(credential.apiKey);

        // Calculate scheduled time if campaign has scheduling enabled
        let scheduledTimeUnix: number | undefined;
        if (campaign.scheduleEnabled) {
          const nextWindow = CampaignScheduler.getNextCallWindow(campaign);
          if (nextWindow) {
            scheduledTimeUnix = Math.floor(nextWindow.getTime() / 1000);
            console.log(`   Scheduled for: ${nextWindow.toISOString()}`);
          }
        }

        warnIfVeryLargeElevenLabsBatch(recipients.length, campaign.name, campaignId);

        // Create the batch job using ElevenLabs Batch Calling API with SIP phone number
        const batchJob = await batchService.createBatch({
          call_name: campaign.name,
          agent_id: agent.elevenLabsAgentId,
          recipients: recipients,
          agent_phone_number_id: currentSipPhoneElevenLabsId,
          scheduled_time_unix: scheduledTimeUnix || null,
        });

        console.log(`✅ [Campaign Executor] ElevenLabs SIP batch job created: ${batchJob.id}`);
        console.log(`   Status: ${batchJob.status}`);
        console.log(`   Total calls scheduled: ${batchJob.total_calls_scheduled}`);

        // Update pre-created call records with batch job ID for tracking
        if (preCreatedCalls.length > 0) {
          const callIds = preCreatedCalls.map(c => c.id);
          await db
            .update(calls)
            .set({
              metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{batchJobId}', ${JSON.stringify(batchJob.id)}::jsonb)`
            })
            .where(inArray(calls.id, callIds));
          console.log(`   Updated ${callIds.length} call records with batch job ID`);
        }

        // Update campaign with batch job ID and status
        await db
          .update(campaigns)
          .set({ 
            status: 'running',
            startedAt: new Date(),
            batchJobId: batchJob.id,
            batchJobStatus: batchJob.status,
            totalContacts: campaignContacts.length,
          })
          .where(eq(campaigns.id, campaignId));

        return { batchJob };
      }

      // ElevenLabs flow - requires elevenLabsAgentId
      if (!agent.elevenLabsAgentId) {
        throw new Error('Agent not synced with ElevenLabs. Please sync the agent first.');
      }

      // ElevenLabs campaigns require a Twilio phone number
      if (!campaign.phoneNumberId) {
        throw new Error('ElevenLabs campaign requires a Twilio phone number');
      }

      // Get phone number details
      const [phoneNumber] = await db
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, campaign.phoneNumberId))
        .limit(1);

      if (!phoneNumber) {
        throw new Error('Phone number not found');
      }

      if (!phoneNumber.elevenLabsPhoneNumberId) {
        throw new Error('Phone number not synced with ElevenLabs. Please sync your phone numbers first.');
      }

      // Get the correct credential for this agent
      const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      if (!credential) {
        throw new Error("No ElevenLabs credential found for agent");
      }
      
      // PRE-FLIGHT CHECK: Ensure phone number is on the same ElevenLabs credential as the agent
      // If credentials differ, migrate the phone number to the agent's credential before batch calling
      let currentPhoneElevenLabsId = phoneNumber.elevenLabsPhoneNumberId;
      
      // Guard: both phone and agent must have credentials defined for migration check
      if (!agent.elevenLabsCredentialId) {
        throw new Error('Agent is not assigned to an ElevenLabs credential. Please configure ElevenLabs credentials in admin settings.');
      }
      
      if (!phoneNumber.elevenLabsCredentialId) {
        throw new Error('Phone number is not assigned to an ElevenLabs credential. Please re-sync phone numbers.');
      }
      
      if (phoneNumber.elevenLabsCredentialId !== agent.elevenLabsCredentialId) {
        console.log(`📞 [Campaign Executor] Phone credential mismatch - initiating migration`);
        console.log(`   Phone credential: ${phoneNumber.elevenLabsCredentialId}`);
        console.log(`   Agent credential: ${agent.elevenLabsCredentialId}`);
        
        const migrationResult = await PhoneMigrator.syncPhoneToAgentCredential(
          phoneNumber.id,
          agent.id
        );
        
        if (!migrationResult.success) {
          throw new Error(`Phone migration failed: ${migrationResult.error}`);
        }
        
        if (!migrationResult.newElevenLabsPhoneId) {
          throw new Error('Phone migration incomplete: no new ElevenLabs phone ID returned');
        }
        
        console.log(`✅ [Campaign Executor] Phone migrated successfully`);
        console.log(`   Old ElevenLabs ID: ${migrationResult.oldElevenLabsPhoneId}`);
        console.log(`   New ElevenLabs ID: ${migrationResult.newElevenLabsPhoneId}`);
        
        currentPhoneElevenLabsId = migrationResult.newElevenLabsPhoneId;
      } else {
        console.log(`✅ [Campaign Executor] Phone and agent on same credential: ${agent.elevenLabsCredentialId}`);
      }
      
      // PRE-FLIGHT CHECK 2: Verify phone actually exists on ElevenLabs
      // The database may have a stale elevenLabsPhoneNumberId that no longer exists
      console.log(`📞 [Campaign Executor] Verifying phone exists on ElevenLabs...`);
      const verifyResult = await PhoneMigrator.verifyAndEnsurePhoneExists(
        phoneNumber.id,
        agent.elevenLabsCredentialId,
        agent.elevenLabsAgentId || undefined // Pass agent ID for assignment after re-import
      );
      
      if (!verifyResult.success) {
        throw new Error(`Phone number not available on ElevenLabs: ${verifyResult.error || 'Could not verify or re-import phone number'}`);
      }
      
      if (verifyResult.wasReimported) {
        console.log(`✅ [Campaign Executor] Phone was re-imported from Twilio`);
        console.log(`   New ElevenLabs ID: ${verifyResult.elevenLabsPhoneId}`);
      }
      
      // Use the verified (or re-imported) phone ID
      currentPhoneElevenLabsId = verifyResult.elevenLabsPhoneId!;

      // PRE-FLIGHT CHECK 3 (credential freshness): Re-register the phone number in ElevenLabs
      // with the current Twilio SID/Token if credentials haven't been synced in the last 24 hours.
      // This prevents "max auth retry attempts reached" failures that occur when ElevenLabs has
      // stale Twilio credentials stored for the phone — even though the phone ID itself is valid.
      // wasReimported already did a full re-import, so skip the freshness check in that case.
      if (!verifyResult.wasReimported) {
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const lastSync = phoneNumber.credentialsSyncedAt ? new Date(phoneNumber.credentialsSyncedAt).getTime() : 0;
        const needsSync = now - lastSync > twentyFourHours;

        if (needsSync) {
          console.log(`🔄 [Campaign Executor] PRE-FLIGHT CHECK 3: Refreshing Twilio credentials in ElevenLabs for ${phoneNumber.phoneNumber}`);
          console.log(`   Last sync: ${phoneNumber.credentialsSyncedAt ? new Date(phoneNumber.credentialsSyncedAt).toISOString() : 'never'}`);
          try {
            const freshResult = await resyncSinglePhoneCredentials(phoneNumber.id);
            if (freshResult.success) {
              console.log(`✅ [Campaign Executor] Credential refresh complete — phone re-registered with current Twilio credentials`);
              // Re-fetch the new elevenLabsPhoneNumberId since it changed after resync
              const [refreshedPhone] = await db
                .select({ elevenLabsPhoneNumberId: phoneNumbers.elevenLabsPhoneNumberId })
                .from(phoneNumbers)
                .where(eq(phoneNumbers.id, phoneNumber.id))
                .limit(1);
              if (refreshedPhone?.elevenLabsPhoneNumberId) {
                currentPhoneElevenLabsId = refreshedPhone.elevenLabsPhoneNumberId;
              }
            } else {
              console.warn(`⚠️ [Campaign Executor] Credential refresh failed (non-fatal, continuing): ${freshResult.error}`);
            }
          } catch (syncErr: any) {
            console.warn(`⚠️ [Campaign Executor] Credential refresh error (non-fatal, continuing): ${syncErr?.message}`);
          }
        } else {
          console.log(`✅ [Campaign Executor] PRE-FLIGHT CHECK 3: Credentials fresh (last synced ${Math.round((now - lastSync) / 3600000)}h ago)`);
        }
      }

      // Get all contacts for the campaign
      const campaignContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId));

      if (campaignContacts.length === 0) {
        throw new Error('Campaign has no contacts');
      }

      console.log(`[Campaign Executor] Creating batch job for campaign ${campaignId} with ${campaignContacts.length} contacts`);
      console.log(`   Agent: ${agent.name} (ElevenLabs ID: ${agent.elevenLabsAgentId})`);
      console.log(`   Phone: ${phoneNumber.phoneNumber} (ElevenLabs ID: ${currentPhoneElevenLabsId})`);
      console.log(`   Credential: ${credential.name}`);
      
      // PRE-FLIGHT CHECK 3: Refresh agent tools on ElevenLabs to pick up current date context
      // This ensures appointment booking tool has today's date for "tomorrow" calculations
      // Check both appointmentBookingEnabled flag AND flowId (flow agents may have appointment nodes)
      if (agent.appointmentBookingEnabled || agent.flowId) {
        console.log(`📅 [Campaign Executor] Refreshing agent tools on ElevenLabs for appointment date context...`);
        try {
          const elevenLabsService = new ElevenLabsService(credential.apiKey);
          // Use dedicated method that fetches existing tools and updates only the appointment tool
          // while preserving all other tools (system tools, custom webhooks, etc.)
          await elevenLabsService.refreshAppointmentToolWithCurrentDate(agent.elevenLabsAgentId);
          console.log(`✅ [Campaign Executor] Agent tools refreshed with current date context`);
        } catch (toolRefreshError: any) {
          console.warn(`⚠️ [Campaign Executor] Failed to refresh agent tools: ${toolRefreshError.message}`);
          // Non-fatal - continue with campaign execution
        }
      }

      // PRE-CREATE CALL RECORDS using batch insert for scalability (10,000+ contacts)
      const callInsertsElevenLabs = campaignContacts.map(contact => ({
        userId: campaign.userId,
        campaignId: campaign.id,
        contactId: contact.id,
        phoneNumber: contact.phone,
        status: 'pending' as const,
        callDirection: 'outgoing' as const,
        metadata: {
          batchCall: true,
          agentId: agent.id,
          elevenLabsAgentId: agent.elevenLabsAgentId,
          contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
        },
      }));

      const callResultElevenLabs = await batchInsertCalls(callInsertsElevenLabs, '📞 [ElevenLabs Campaign]');
      const preCreatedCalls = callResultElevenLabs.results;

      // Stamp lastAttemptAt for all contacts being called in this first pass
      if (campaignContacts.length > 0) {
        await db.update(contacts).set({ lastAttemptAt: new Date(), attemptCount: 1 })
          .where(inArray(contacts.id, campaignContacts.map(c => c.id)));
      }

      // Create flow execution records for flow-based agents using batch insert
      if (agent.flowId && preCreatedCalls.length > 0) {
        const flowExecInsertsElevenLabs: FlowExecutionInsert[] = preCreatedCalls.map(callRecord => ({
          callId: callRecord.id,
          flowId: agent.flowId!,
          campaignId: campaign.id,
          campaignName: campaign.name,
          contactPhone: callRecord.phoneNumber || '',
          telephonyProvider: 'elevenlabs',
        }));
        
        await batchInsertFlowExecutions(flowExecInsertsElevenLabs, '🔀 [ElevenLabs Campaign]');
      }

      // Convert contacts to batch recipients format
      const recipients = BatchCallingService.contactsToBatchRecipients(
        campaignContacts.map(c => ({
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          email: c.email,
          customFields: c.customFields as Record<string, any> | null,
        }))
      );

      // Create batch calling service with agent's credential
      const batchService = new BatchCallingService(credential.apiKey);

      // Calculate scheduled time if campaign has scheduling enabled
      let scheduledTimeUnix: number | undefined;
      if (campaign.scheduleEnabled) {
        const nextWindow = CampaignScheduler.getNextCallWindow(campaign);
        if (nextWindow) {
          scheduledTimeUnix = Math.floor(nextWindow.getTime() / 1000);
          console.log(`   Scheduled for: ${nextWindow.toISOString()}`);
        }
      }

      warnIfVeryLargeElevenLabsBatch(recipients.length, campaign.name, campaignId);

      // Create the batch job with verified/migrated phone number
      const batchJob = await batchService.createBatch({
        call_name: campaign.name,
        agent_id: agent.elevenLabsAgentId,
        recipients: recipients,
        agent_phone_number_id: currentPhoneElevenLabsId,
        scheduled_time_unix: scheduledTimeUnix || null,
      });

      console.log(`✅ [Campaign Executor] Batch job created: ${batchJob.id}`);
      console.log(`   Status: ${batchJob.status}`);
      console.log(`   Total calls scheduled: ${batchJob.total_calls_scheduled}`);
      
      // Update pre-created call records with batch job ID for tracking
      if (preCreatedCalls.length > 0) {
        const callIds = preCreatedCalls.map(c => c.id);
        await db
          .update(calls)
          .set({
            metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{batchJobId}', ${JSON.stringify(batchJob.id)}::jsonb)`
          })
          .where(inArray(calls.id, callIds));
        console.log(`   Updated ${callIds.length} call records with batch job ID`);
      }

      // Update campaign with batch job ID and status
      await db
        .update(campaigns)
        .set({ 
          status: 'running',
          startedAt: new Date(),
          batchJobId: batchJob.id,
          batchJobStatus: batchJob.status,
          totalContacts: campaignContacts.length,
        })
        .where(eq(campaigns.id, campaignId));

      return { batchJob };

    } catch (error) {
      console.error('Campaign execution failed:', error);
      
      // Check if this is a concurrency limit error from ElevenLabs
      if (isConcurrencyLimitError(error)) {
        console.log(`🔄 [Campaign Executor] Concurrency limit hit, attempting migration for campaign ${campaignId}`);
        
        // Get the agent's current credential to attempt migration from
        const [campaignData] = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, campaignId))
          .limit(1);
        
        if (campaignData?.agentId) {
          const [agentData] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, campaignData.agentId))
            .limit(1);
          
          if (agentData?.elevenLabsCredentialId) {
            // Check if any other key has capacity
            const hasCapacity = await hasAnyAvailableCapacity();
            
            if (hasCapacity) {
              // Attempt automatic migration
              const migrationResult = await autoMigrateUser(
                campaignData.userId,
                agentData.elevenLabsCredentialId
              );
              
              if (migrationResult.success) {
                console.log(`✅ [Campaign Executor] Migration successful, retrying campaign...`);
                // Retry the campaign execution after migration
                return this.executeCampaign(campaignId);
              } else {
                console.log(`❌ [Campaign Executor] Migration failed: ${migrationResult.error}`);
              }
            }
            
            // No capacity available or migration failed - mark for retry queue
            console.log(`⏰ [Campaign Executor] No capacity available, marking campaign for retry queue`);
            await markCampaignForRetry(
              campaignId,
              'ElevenLabs concurrency limit reached - no available capacity'
            );
            
            // Don't throw - campaign is now in processing state waiting for retry
            // Return a minimal BatchJob object indicating the campaign is queued for retry
            return { 
              batchJob: { 
                id: 'pending-migration',
                name: 'Awaiting Capacity',
                agent_id: '',
                created_at_unix: Math.floor(Date.now() / 1000),
                scheduled_time_unix: 0,
                last_updated_at_unix: Math.floor(Date.now() / 1000),
                total_calls_scheduled: 0,
                total_calls_dispatched: 0,
                status: 'pending' as const,
                agent_name: '',
              } 
            };
          }
        }
      }
      
      // Not a concurrency error or couldn't handle - mark as failed
      // Get campaign data for webhook if available
      let failedCampaign;
      try {
        const [campaignForWebhook] = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, campaignId))
          .limit(1);
        failedCampaign = campaignForWebhook;
      } catch (e) {
        console.warn('Could not fetch campaign for failure webhook:', e);
      }
      
      // Extract error details for storage and webhook
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = this.getErrorCode(errorMessage);
      
      // Save error message to database so users can see why campaign failed
      await db
        .update(campaigns)
        .set({ 
          status: 'failed',
          completedAt: new Date(),
          errorMessage: errorMessage,
          errorCode: errorCode,
        })
        .where(eq(campaigns.id, campaignId));
      
      console.error(`❌ [Campaign Executor] Campaign ${campaignId} failed with error: [${errorCode}] ${errorMessage}`);
      
      // Trigger campaign.failed webhook
      if (failedCampaign?.userId) {
        try {
          webhookDeliveryService.triggerEvent(failedCampaign.userId, 'campaign.failed', {
            campaignId: failedCampaign.id,
            campaignName: failedCampaign.name,
            status: 'failed',
            startedAt: failedCampaign.startedAt,
            failedAt: new Date().toISOString(),
            totalContacts: failedCampaign.totalContacts,
            completedCalls: failedCampaign.completedCalls || 0,
            failedCalls: failedCampaign.failedCalls || 0,
            error: {
              code: errorCode,
              message: errorMessage,
              details: null
            }
          }, campaignId).catch(err => {
            console.error('❌ [Webhook] Error triggering campaign.failed event:', err);
          });
        } catch (webhookErr) {
          console.error('Error triggering campaign.failed webhook:', webhookErr);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get batch job status for a campaign
   */
  async getBatchJobStatus(campaignId: string): Promise<BatchJobWithRecipients | null> {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || !campaign.batchJobId || !campaign.agentId) {
      return null;
    }

    // Non-ElevenLabs campaigns (Plivo, Twilio-OpenAI) use local batch job IDs
    // and should NOT be queried against ElevenLabs batch calling API
    if (isNonElevenLabsBatchJob(campaign.batchJobId)) {
      const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, campaignId));

      const completedCallsCount = campaignCalls.filter(c =>
        ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
      const failedCallsCount = campaignCalls.filter(c =>
        ['failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      const pendingCallsCount = campaignCalls.filter(c =>
        ['pending', 'queued', 'in-progress', 'ringing'].includes(c.status)
      ).length;

      const localStatus: BatchJobStatus = campaign.status === 'running' ? 'in_progress'
        : campaign.status === 'completed' ? 'completed'
        : campaign.status === 'cancelled' ? 'cancelled'
        : campaign.status === 'failed' ? 'failed'
        : campaign.status === 'paused' ? 'pending'
        : 'pending';

      const isTerminal = ['completed', 'failed', 'cancelled'].includes(localStatus);

      if (isTerminal && !campaign.completedAt) {
        await db
          .update(campaigns)
          .set({
            completedAt: new Date(),
            completedCalls: completedCallsCount,
            successfulCalls: successfulCallsCount,
            failedCalls: failedCallsCount,
          })
          .where(eq(campaigns.id, campaignId));
      }

      const [agent] = await db.select().from(agents).where(eq(agents.id, campaign.agentId)).limit(1);

      return {
        id: campaign.batchJobId,
        name: campaign.name || 'Campaign',
        agent_id: campaign.agentId,
        agent_name: agent?.name || 'Unknown',
        created_at_unix: campaign.createdAt ? Math.floor(new Date(campaign.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
        scheduled_time_unix: 0,
        last_updated_at_unix: Math.floor(Date.now() / 1000),
        total_calls_scheduled: campaign.totalContacts || campaignCalls.length,
        total_calls_dispatched: completedCallsCount,
        status: localStatus,
        phone_number_id: null,
        phone_provider: null,
        recipients: campaignCalls.map(c => ({
          recipient_id: c.id,
          phone_number: c.phoneNumber || c.toNumber || '',
          status: c.status === 'completed' ? 'completed' as const
            : c.status === 'failed' ? 'failed' as const
            : c.status === 'no-answer' ? 'no_response' as const
            : c.status === 'busy' ? 'failed' as const
            : ['pending', 'queued'].includes(c.status) ? 'pending' as const
            : 'in_progress' as const,
          conversation_id: c.elevenLabsConversationId || undefined,
          call_duration_secs: c.duration || undefined,
          error_message: undefined,
        })),
      } as BatchJobWithRecipients;
    }

    // ElevenLabs flow - query the ElevenLabs batch calling API
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, campaign.agentId))
      .limit(1);

    if (!agent) {
      return null;
    }

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      return null;
    }

    const batchService = new BatchCallingService(credential.apiKey);
    const batchJob = await batchService.getBatch(campaign.batchJobId);

    // Update campaign with latest batch status
    await db
      .update(campaigns)
      .set({ 
        batchJobStatus: batchJob.status,
        completedCalls: batchJob.total_calls_dispatched,
      })
      .where(eq(campaigns.id, campaignId));

    // If batch is completed or failed, update campaign status
    if (batchJob.status === 'completed' || batchJob.status === 'failed' || batchJob.status === 'cancelled') {
      // Recalculate stats from actual database records for accuracy
      const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
      
      const completedCallsCount = campaignCalls.filter(c => 
        ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
      const failedCallsCount = campaignCalls.filter(c => 
        ['failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      await db
        .update(campaigns)
        .set({ 
          status: batchJob.status === 'completed' ? 'completed' : batchJob.status,
          completedAt: new Date(),
          completedCalls: completedCallsCount,
          successfulCalls: successfulCallsCount,
          failedCalls: failedCallsCount,
        })
        .where(eq(campaigns.id, campaignId));
      
      // Trigger campaign.failed webhook if batch job failed
      if (campaign.userId && batchJob.status === 'failed') {
        try {
          webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.failed', {
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: 'failed',
            startedAt: campaign.startedAt,
            failedAt: new Date().toISOString(),
            totalContacts: campaign.totalContacts,
            completedCalls: completedCallsCount,
            failedCalls: failedCallsCount,
            error: {
              code: 'BATCH_JOB_FAILED',
              message: 'Batch calling job failed during execution',
              details: { batchJobId: campaign.batchJobId }
            }
          }, campaignId).catch(err => {
            console.error('❌ [Webhook] Error triggering campaign.failed event:', err);
          });
        } catch (webhookErr) {
          console.error('Error triggering campaign.failed webhook:', webhookErr);
        }
      }
      
      if (campaign.userId && batchJob.status === 'completed') {
        // Fetch contacts for this campaign
        const campaignContacts = await db
          .select()
          .from(contacts)
          .where(eq(contacts.campaignId, campaignId));
        
        // Build contact lookup map
        const contactMap = new Map(campaignContacts.map(c => [c.id, c]));
        
        // Build rich call data with all details
        const callsData = campaignCalls.map(call => {
          const contact = call.contactId ? contactMap.get(call.contactId) : null;
          return {
            id: call.id,
            status: call.status,
            classification: call.classification,
            sentiment: call.sentiment,
            duration: call.duration,
            phoneNumber: call.phoneNumber,
            transcript: call.transcript,
            aiSummary: call.aiSummary,
            recordingUrl: call.recordingUrl,
            startedAt: call.startedAt,
            endedAt: call.endedAt,
            contact: contact ? {
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              phone: contact.phone,
              email: contact.email,
              customFields: contact.customFields,
            } : null,
          };
        });
        
        // Build rich contacts data
        const contactsData = campaignContacts.map(contact => ({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          email: contact.email,
          customFields: contact.customFields,
          status: contact.status,
        }));
        
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.completed', {
          campaign: {
            id: campaign.id,
            name: campaign.name,
            type: campaign.type,
            status: 'completed',
            totalContacts: campaign.totalContacts,
            startedAt: campaign.startedAt,
            completedAt: new Date().toISOString(),
            createdAt: campaign.createdAt,
          },
          stats: {
            successfulCalls: successfulCallsCount,
            failedCalls: failedCallsCount,
            totalCalls: campaignCalls.length,
            completedCalls: completedCallsCount,
            hotLeads: campaignCalls.filter(c => c.classification === 'hot').length,
            warmLeads: campaignCalls.filter(c => c.classification === 'warm').length,
            coldLeads: campaignCalls.filter(c => c.classification === 'cold').length,
            lostLeads: campaignCalls.filter(c => c.classification === 'lost').length,
          },
          calls: callsData,
          contacts: contactsData,
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.completed event:', err);
        });
        
        // Note: Campaign completion email is now sent by CampaignScheduler
        // when ALL calls have reached a final status (not just when batch is dispatched)
        console.log(`📧 [Campaign] Batch job ${batchJob.status} - email will be sent by scheduler when all calls complete`);
      }
    }

    return batchJob;
  }

  /**
   * Pause a running campaign's batch job
   * Uses ElevenLabs cancel API but keeps status as 'paused' so it can be resumed
   */
  async pauseCampaign(campaignId: string, reason: 'manual' | 'scheduled' = 'manual'): Promise<BatchJob | null> {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || !campaign.agentId) {
      throw new Error('Campaign has no agent configured');
    }

    // Get agent to check telephony provider
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, campaign.agentId))
      .limit(1);

    if (!agent) {
      throw new Error('Agent not found');
    }

    // Route to Plivo engine if agent uses Plivo telephony
    if (agent.telephonyProvider === 'plivo') {
      const plivoBatchService = PlivoBatchCallingService.getInstance(campaignId);
      plivoBatchService.pause();
      
      await db
        .update(campaigns)
        .set({ 
          status: 'paused',
          batchJobStatus: 'paused',
          config: sql`jsonb_set(COALESCE(config, '{}'::jsonb), '{pauseReason}', ${JSON.stringify(reason)}::jsonb)`
        })
        .where(eq(campaigns.id, campaignId));
      
      console.log(`⏸️ [Campaign Executor] Paused Plivo campaign ${campaignId} (reason: ${reason})`);
      
      // Trigger webhook event for Plivo pause
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.paused', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
            completedCalls: campaign.completedCalls,
            successfulCalls: campaign.successfulCalls,
            failedCalls: campaign.failedCalls,
          },
          pausedAt: new Date().toISOString(),
          reason,
          engine: 'plivo',
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.paused event:', err);
        });
      }
      
      return null;
    }

    // Route to Twilio-OpenAI engine if agent uses twilio_openai telephony
    if (agent.telephonyProvider === 'twilio_openai') {
      const twilioOpenAIBatchService = TwilioOpenAIBatchCallingService.getInstance(campaignId);
      twilioOpenAIBatchService.pause();
      
      await db
        .update(campaigns)
        .set({ 
          status: 'paused',
          batchJobStatus: 'paused',
          config: sql`jsonb_set(COALESCE(config, '{}'::jsonb), '{pauseReason}', ${JSON.stringify(reason)}::jsonb)`
        })
        .where(eq(campaigns.id, campaignId));
      
      console.log(`⏸️ [Campaign Executor] Paused Twilio-OpenAI campaign ${campaignId} (reason: ${reason})`);
      
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.paused', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
            completedCalls: campaign.completedCalls,
            successfulCalls: campaign.successfulCalls,
            failedCalls: campaign.failedCalls,
          },
          pausedAt: new Date().toISOString(),
          reason,
          engine: 'twilio_openai',
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.paused event:', err);
        });
      }
      
      return null;
    }

    // ElevenLabs flow - requires batchJobId
    if (!campaign.batchJobId) {
      throw new Error('Campaign has no active batch job');
    }

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      throw new Error('No ElevenLabs credential found for agent');
    }

    const batchService = new BatchCallingService(credential.apiKey);
    
    try {
      // Check current batch status before attempting to pause/cancel
      // ElevenLabs returns 400 if batch is already completed/cancelled/failed
      const currentBatch = await batchService.getBatch(campaign.batchJobId);
      const terminalStatuses = ['completed', 'failed', 'cancelled'];
      
      if (terminalStatuses.includes(currentBatch.status)) {
        // Batch already in terminal state - sync local database instead of calling cancel API
        console.log(`ℹ️ [Campaign Executor] Batch already ${currentBatch.status}, syncing local status for campaign ${campaignId}`);
        
        // Recalculate stats from actual database records
        const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
        const completedCallsCount = campaignCalls.filter(c => 
          ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
        ).length;
        const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
        const failedCallsCount = campaignCalls.filter(c => 
          ['failed', 'busy', 'no-answer'].includes(c.status)
        ).length;
        
        // Update local campaign to match ElevenLabs status
        await db
          .update(campaigns)
          .set({ 
            status: currentBatch.status,
            batchJobStatus: currentBatch.status,
            completedAt: campaign.completedAt || new Date(),
            completedCalls: completedCallsCount,
            successfulCalls: successfulCallsCount,
            failedCalls: failedCallsCount,
          })
          .where(eq(campaigns.id, campaignId));
        
        return currentBatch;
      }
      
      // Batch is still running/pending - proceed with cancel (for pause)
      const batchJob = await batchService.cancelBatch(campaign.batchJobId);
      console.log(`⏸️ [Campaign Executor] Paused campaign ${campaignId} (reason: ${reason})`);

      // Update campaign status to 'paused' (NOT cancelled - so it can be resumed)
      await db
        .update(campaigns)
        .set({ 
          status: 'paused',
          batchJobStatus: 'cancelled',
          config: sql`jsonb_set(COALESCE(config, '{}'::jsonb), '{pauseReason}', ${JSON.stringify(reason)}::jsonb)`
        })
        .where(eq(campaigns.id, campaignId));

      // Trigger webhook event
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.paused', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
            completedCalls: campaign.completedCalls,
            successfulCalls: campaign.successfulCalls,
            failedCalls: campaign.failedCalls,
          },
          pausedAt: new Date().toISOString(),
          reason,
          batchJobStatus: batchJob.status,
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.paused event:', err);
        });
      }

      return batchJob;
    } catch (error: any) {
      console.error(`❌ [Campaign Executor] Failed to pause campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a running campaign's batch job (permanent stop)
   */
  async cancelCampaign(campaignId: string): Promise<BatchJob | null> {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || !campaign.agentId) {
      throw new Error('Campaign has no agent configured');
    }

    // Get agent to check telephony provider
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, campaign.agentId))
      .limit(1);

    if (!agent) {
      throw new Error('Agent not found');
    }

    // Route to Plivo engine if agent uses Plivo telephony
    if (agent.telephonyProvider === 'plivo') {
      const plivoBatchService = PlivoBatchCallingService.getInstance(campaignId);
      await plivoBatchService.cancel();
      
      // Query current stats from database for accurate webhook payload
      const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
      const completedCallsCount = campaignCalls.filter(c => 
        ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
      const failedCallsCount = campaignCalls.filter(c => 
        ['failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      await db
        .update(campaigns)
        .set({ 
          status: 'cancelled',
          batchJobStatus: 'cancelled',
          completedAt: new Date(),
          completedCalls: completedCallsCount,
          successfulCalls: successfulCallsCount,
          failedCalls: failedCallsCount,
        })
        .where(eq(campaigns.id, campaignId));
      
      console.log(`🛑 [Campaign Executor] Cancelled Plivo campaign ${campaignId}`);
      
      // Trigger webhook event for Plivo campaign cancellation
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.cancelled', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
            startedAt: campaign.startedAt,
            cancelledAt: new Date().toISOString(),
            createdAt: campaign.createdAt,
          },
          stats: {
            completedCalls: completedCallsCount,
            successfulCalls: successfulCallsCount,
            failedCalls: failedCallsCount,
            totalCalls: campaignCalls.length,
          },
          cancelledAt: new Date().toISOString(),
          engine: 'plivo',
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.cancelled event:', err);
        });
      }
      
      PlivoBatchCallingService.removeInstance(campaignId);
      return null;
    }

    // Route to Twilio-OpenAI engine if agent uses twilio_openai telephony
    if (agent.telephonyProvider === 'twilio_openai') {
      const twilioOpenAIBatchService = TwilioOpenAIBatchCallingService.getInstance(campaignId);
      await twilioOpenAIBatchService.cancel();
      
      const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
      const completedCallsCount = campaignCalls.filter(c => 
        ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
      const failedCallsCount = campaignCalls.filter(c => 
        ['failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      await db
        .update(campaigns)
        .set({ 
          status: 'cancelled',
          batchJobStatus: 'cancelled',
          completedAt: new Date(),
          completedCalls: completedCallsCount,
          successfulCalls: successfulCallsCount,
          failedCalls: failedCallsCount,
        })
        .where(eq(campaigns.id, campaignId));
      
      console.log(`🛑 [Campaign Executor] Cancelled Twilio-OpenAI campaign ${campaignId}`);
      
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.cancelled', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
            startedAt: campaign.startedAt,
            cancelledAt: new Date().toISOString(),
            createdAt: campaign.createdAt,
          },
          stats: {
            completedCalls: completedCallsCount,
            successfulCalls: successfulCallsCount,
            failedCalls: failedCallsCount,
            totalCalls: campaignCalls.length,
          },
          cancelledAt: new Date().toISOString(),
          engine: 'twilio_openai',
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.cancelled event:', err);
        });
      }
      
      TwilioOpenAIBatchCallingService.removeInstance(campaignId);
      return null;
    }

    // ElevenLabs flow - requires batchJobId
    if (!campaign.batchJobId) {
      throw new Error('Campaign has no active batch job');
    }

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      throw new Error('No ElevenLabs credential found for agent');
    }

    const batchService = new BatchCallingService(credential.apiKey);
    
    // Check current batch status before attempting to cancel
    // ElevenLabs returns 400 if batch is already completed/cancelled/failed
    const currentBatch = await batchService.getBatch(campaign.batchJobId);
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    
    if (terminalStatuses.includes(currentBatch.status)) {
      // Batch already in terminal state - sync local database instead of calling cancel API
      console.log(`ℹ️ [Campaign Executor] Batch already ${currentBatch.status}, syncing local status for campaign ${campaignId}`);
      
      // Recalculate stats from actual database records
      const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, campaignId));
      const completedCallsCount = campaignCalls.filter(c => 
        ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
      const failedCallsCount = campaignCalls.filter(c => 
        ['failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      // Update local campaign to match ElevenLabs status
      await db
        .update(campaigns)
        .set({ 
          status: currentBatch.status,
          batchJobStatus: currentBatch.status,
          completedAt: campaign.completedAt || new Date(),
          completedCalls: completedCallsCount,
          successfulCalls: successfulCallsCount,
          failedCalls: failedCallsCount,
        })
        .where(eq(campaigns.id, campaignId));
      
      return currentBatch;
    }
    
    // Batch is still running/pending - proceed with cancel
    const batchJob = await batchService.cancelBatch(campaign.batchJobId);
    console.log(`🛑 [Campaign Executor] Cancelled campaign ${campaignId}`);

    // Update campaign status
    await db
      .update(campaigns)
      .set({ 
        status: 'cancelled',
        batchJobStatus: 'cancelled',
        completedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId));

    return batchJob;
  }

  /**
   * Resume a paused campaign or retry failed calls
   * Uses ElevenLabs retry API to continue with pending/failed/no-response recipients
   */
  async resumeCampaign(campaignId: string, reason: 'manual' | 'scheduled' = 'manual'): Promise<BatchJob | null> {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || !campaign.agentId) {
      throw new Error('Campaign has no agent configured');
    }

    // Only allow resuming paused or completed/failed campaigns (for retry)
    if (campaign.status !== 'paused' && campaign.status !== 'completed' && campaign.status !== 'failed') {
      throw new Error(`Campaign status '${campaign.status}' cannot be resumed. Must be paused, completed, or failed.`);
    }

    // Get agent to check telephony provider
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, campaign.agentId))
      .limit(1);

    if (!agent) {
      throw new Error('Agent not found');
    }

    // Route to Plivo engine if agent uses Plivo telephony
    if (agent.telephonyProvider === 'plivo') {
      // For Plivo, resume means re-executing the campaign with pending contacts
      const plivoBatchService = PlivoBatchCallingService.getInstance(campaignId);
      
      // If paused, just resume; if completed/failed, re-execute
      if (plivoBatchService.isRunning() === false) {
        plivoBatchService.resume();
      }
      
      // Update campaign status to running BEFORE re-execution, clear completedAt, add resumeReason
      await db
        .update(campaigns)
        .set({ 
          status: 'running',
          batchJobStatus: 'running',
          completedAt: null,
          config: sql`jsonb_set(COALESCE(config, '{}'::jsonb), '{resumeReason}', ${JSON.stringify(reason)}::jsonb)`
        })
        .where(eq(campaigns.id, campaignId));
      
      // Re-execute the campaign (it will pick up pending contacts)
      const result = await plivoBatchService.executeCampaign(campaignId);
      
      console.log(`▶️ [Campaign Executor] Resumed Plivo campaign ${campaignId} (reason: ${reason})`);
      
      // Trigger webhook event for Plivo resume
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.resumed', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
          },
          resumedAt: new Date().toISOString(),
          reason,
          engine: 'plivo',
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.resumed event:', err);
        });
      }
      
      return {
        id: campaignId,
        name: campaign.name,
        agent_id: agent.id,
        agent_name: agent.name,
        created_at_unix: Math.floor(Date.now() / 1000),
        scheduled_time_unix: 0,
        last_updated_at_unix: Math.floor(Date.now() / 1000),
        total_calls_scheduled: result.totalCalls,
        total_calls_dispatched: result.completedCalls + result.failedCalls,
        status: result.status === 'completed' ? 'completed' as const : 
               result.status === 'cancelled' ? 'cancelled' as const : 'failed' as const,
      };
    }

    // Route to Twilio-OpenAI engine if agent uses twilio_openai telephony
    if (agent.telephonyProvider === 'twilio_openai') {
      const twilioOpenAIBatchService = TwilioOpenAIBatchCallingService.getInstance(campaignId);
      
      if (twilioOpenAIBatchService.isRunning() === false) {
        twilioOpenAIBatchService.resume();
      }
      
      await db
        .update(campaigns)
        .set({ 
          status: 'running',
          batchJobStatus: 'running',
          completedAt: null,
          config: sql`jsonb_set(COALESCE(config, '{}'::jsonb), '{resumeReason}', ${JSON.stringify(reason)}::jsonb)`
        })
        .where(eq(campaigns.id, campaignId));
      
      const result = await twilioOpenAIBatchService.executeCampaign(campaignId);
      
      console.log(`▶️ [Campaign Executor] Resumed Twilio-OpenAI campaign ${campaignId} (reason: ${reason})`);
      
      if (campaign.userId) {
        webhookDeliveryService.triggerEvent(campaign.userId, 'campaign.resumed', {
          campaign: { 
            id: campaign.id, 
            name: campaign.name,
            type: campaign.type,
            totalContacts: campaign.totalContacts,
          },
          resumedAt: new Date().toISOString(),
          reason,
          engine: 'twilio_openai',
        }, campaignId).catch(err => {
          console.error('❌ [Webhook] Error triggering campaign.resumed event:', err);
        });
      }
      
      return {
        id: campaignId,
        name: campaign.name,
        agent_id: agent.id,
        agent_name: agent.name,
        created_at_unix: Math.floor(Date.now() / 1000),
        scheduled_time_unix: 0,
        last_updated_at_unix: Math.floor(Date.now() / 1000),
        total_calls_scheduled: result.totalCalls,
        total_calls_dispatched: result.completedCalls + result.failedCalls,
        status: result.status === 'completed' ? 'completed' as const : 
               result.status === 'cancelled' ? 'cancelled' as const : 'failed' as const,
      };
    }

    // ElevenLabs flow - requires batchJobId
    if (!campaign.batchJobId) {
      throw new Error('Campaign has no batch job to resume');
    }

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      throw new Error('No ElevenLabs credential found for agent');
    }

    const batchService = new BatchCallingService(credential.apiKey);
    
    try {
      const batchJob = await batchService.retryBatch(campaign.batchJobId);
      console.log(`▶️ [Campaign Executor] Resumed campaign ${campaignId} (reason: ${reason})`);

      // Update campaign status back to running
      await db
        .update(campaigns)
        .set({ 
          status: 'running',
          batchJobStatus: batchJob.status,
          completedAt: null,
          config: sql`jsonb_set(COALESCE(config, '{}'::jsonb), '{resumeReason}', ${JSON.stringify(reason)}::jsonb)`
        })
        .where(eq(campaigns.id, campaignId));

      return batchJob;
    } catch (error: any) {
      console.error(`❌ [Campaign Executor] Failed to resume campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Retry failed and no-response calls in a campaign (alias for resumeCampaign)
   * @deprecated Use resumeCampaign instead
   */
  async retryCampaign(campaignId: string): Promise<BatchJob | null> {
    return this.resumeCampaign(campaignId, 'manual');
  }

  /**
   * Resume a campaign by creating a new batch job for pending/failed contacts only
   * Use this when the campaign has no existing batchJobId to retry
   */
  async resumeWithNewBatch(campaignId: string): Promise<{ batchJob: BatchJob | null; contactsToCall: number }> {
    console.log(`▶️ [Campaign Executor] resumeWithNewBatch for campaign ${campaignId}`);
    
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (!campaign.agentId) {
      throw new Error('Campaign has no agent configured');
    }

    // Check for either Twilio phoneNumberId, Plivo plivoPhoneNumberId, or SIP sipPhoneNumberId
    if (!campaign.phoneNumberId && !campaign.plivoPhoneNumberId && !(campaign as any).sipPhoneNumberId) {
      throw new Error('Campaign has no phone number configured');
    }

    // Get agent details
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, campaign.agentId))
      .limit(1);

    if (!agent) {
      throw new Error('Agent not found');
    }

    // Route to Plivo engine if agent uses Plivo telephony
    if (agent.telephonyProvider === 'plivo') {
      const plivoBatchService = PlivoBatchCallingService.getInstance(campaignId);
      
      // Update campaign status to running
      await db
        .update(campaigns)
        .set({ 
          status: 'running',
          batchJobStatus: 'running',
          completedAt: null,
        })
        .where(eq(campaigns.id, campaignId));
      
      const result = await plivoBatchService.executeCampaign(campaignId);
      
      console.log(`▶️ [Campaign Executor] Resumed Plivo campaign with new batch: ${campaignId}`);
      
      return {
        batchJob: {
          id: campaignId,
          name: campaign.name,
          agent_id: agent.id,
          agent_name: agent.name,
          created_at_unix: Math.floor(Date.now() / 1000),
          scheduled_time_unix: 0,
          last_updated_at_unix: Math.floor(Date.now() / 1000),
          total_calls_scheduled: result.totalCalls,
          total_calls_dispatched: 0,
          status: 'in_progress' as const,
        },
        contactsToCall: result.totalCalls,
      };
    }

    // Block OpenAI SIP engine from campaigns (incoming-only)
    if (agent.telephonyProvider === 'openai-sip') {
      throw new Error('OpenAI SIP engine is for incoming calls only and cannot be used for outbound campaigns. Please use an ElevenLabs SIP agent instead.');
    }

    // Route to ElevenLabs SIP engine using ElevenLabs Batch Calling API for resume
    if (agent.telephonyProvider === 'elevenlabs-sip') {
      console.log(`📞 [Campaign Executor] Routing to ElevenLabs SIP batch calling for campaign resume ${campaignId}`);
      
      // Validate SIP phone number exists and is configured
      if (!(campaign as any).sipPhoneNumberId) {
        throw new Error('ElevenLabs SIP campaign requires a SIP phone number. Please select a SIP phone number.');
      }

      const [sipPhoneNumber] = await db
        .select()
        .from(sipPhoneNumbers)
        .where(eq(sipPhoneNumbers.id, (campaign as any).sipPhoneNumberId))
        .limit(1);

      if (!sipPhoneNumber) {
        throw new Error('SIP phone number not found. Please check your SIP phone number configuration.');
      }

      if (sipPhoneNumber.userId !== campaign.userId) {
        throw new Error('SIP phone number does not belong to this account. Please select a valid SIP phone number.');
      }

      if (!sipPhoneNumber.isActive) {
        throw new Error('SIP phone number is not active. Please activate it before starting the campaign.');
      }

      if (!sipPhoneNumber.outboundEnabled) {
        throw new Error('SIP phone number is not enabled for outbound calls. Please enable outbound calling in your SIP trunk settings.');
      }

      // ElevenLabs SIP requires externalElevenLabsPhoneId for batch API
      if (!sipPhoneNumber.externalElevenLabsPhoneId) {
        throw new Error('SIP phone number is not synced with ElevenLabs. Please re-provision the phone number in SIP settings.');
      }

      // Validate agent has ElevenLabs agent ID for batch calling
      if (!agent.elevenLabsAgentId) {
        throw new Error('Agent not synced with ElevenLabs. Please sync the agent first.');
      }

      // Get the ElevenLabs credential for this agent
      const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      if (!credential) {
        throw new Error("No ElevenLabs credential found for agent. Please configure ElevenLabs credentials.");
      }

      // SIP RESUME PRE-FLIGHT CHECK 1: Credential mismatch
      let currentSipPhoneElevenLabsId = sipPhoneNumber.externalElevenLabsPhoneId!;

      if (sipPhoneNumber.elevenLabsCredentialId && agent.elevenLabsCredentialId &&
          sipPhoneNumber.elevenLabsCredentialId !== agent.elevenLabsCredentialId) {
        console.log(`📞 [Campaign Executor Resume] SIP phone credential mismatch — resyncing to agent credential`);
        console.log(`   SIP phone credential: ${sipPhoneNumber.elevenLabsCredentialId}`);
        console.log(`   Agent credential: ${agent.elevenLabsCredentialId}`);

        const migResult = await resyncSipPhoneCredentials(sipPhoneNumber.id, agent.elevenLabsCredentialId);
        if (!migResult.success) {
          throw new Error(`SIP phone credential migration failed: ${migResult.error}`);
        }
        if (migResult.newElevenLabsPhoneId) {
          currentSipPhoneElevenLabsId = migResult.newElevenLabsPhoneId;
        }
        console.log(`✅ [Campaign Executor Resume] SIP phone migrated to agent credential, new ID: ${currentSipPhoneElevenLabsId}`);
      }

      // SIP RESUME PRE-FLIGHT CHECK 2: Verify SIP phone still exists on ElevenLabs
      console.log(`📞 [Campaign Executor Resume] Verifying SIP phone exists on ElevenLabs...`);
      const sipVerify = await verifySipPhoneExists(currentSipPhoneElevenLabsId, credential.apiKey);
      if (!sipVerify.exists) {
        if (sipVerify.notFound) {
          console.log(`⚠️ [Campaign Executor Resume] SIP phone ${currentSipPhoneElevenLabsId} not found (404) on ElevenLabs — re-importing`);
          const reimportResult = await resyncSipPhoneCredentials(sipPhoneNumber.id, credential.id);
          if (!reimportResult.success) {
            throw new Error(`SIP phone re-import failed: ${reimportResult.error}`);
          }
          if (reimportResult.newElevenLabsPhoneId) {
            currentSipPhoneElevenLabsId = reimportResult.newElevenLabsPhoneId;
          }
          console.log(`✅ [Campaign Executor Resume] SIP phone re-imported, new ID: ${currentSipPhoneElevenLabsId}`);
        } else {
          throw new Error(`Cannot verify SIP phone on ElevenLabs (transient error, not re-importing): ${sipVerify.error}`);
        }
      } else {
        console.log(`✅ [Campaign Executor Resume] SIP phone exists on ElevenLabs`);
      }

      // SIP RESUME PRE-FLIGHT CHECK 3: Credential freshness
      {
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const lastSync = sipPhoneNumber.credentialsSyncedAt ? new Date(sipPhoneNumber.credentialsSyncedAt).getTime() : 0;
        const needsSync = now - lastSync > twentyFourHours;

        if (needsSync && sipVerify.exists) {
          console.log(`🔄 [Campaign Executor Resume] SIP PRE-FLIGHT CHECK 3: Refreshing SIP trunk credentials for ${sipPhoneNumber.phoneNumber}`);
          console.log(`   Last sync: ${sipPhoneNumber.credentialsSyncedAt ? new Date(sipPhoneNumber.credentialsSyncedAt).toISOString() : 'never'}`);
          try {
            const freshResult = await resyncSipPhoneCredentials(sipPhoneNumber.id, credential.id);
            if (freshResult.success && freshResult.newElevenLabsPhoneId) {
              currentSipPhoneElevenLabsId = freshResult.newElevenLabsPhoneId;
              console.log(`✅ [Campaign Executor Resume] SIP credential refresh complete — new ID: ${currentSipPhoneElevenLabsId}`);
            } else if (!freshResult.success) {
              console.warn(`⚠️ [Campaign Executor Resume] SIP credential refresh failed (non-fatal): ${freshResult.error}`);
            }
          } catch (syncErr: any) {
            console.warn(`⚠️ [Campaign Executor Resume] SIP credential refresh error (non-fatal): ${syncErr?.message}`);
          }
        } else if (!needsSync) {
          console.log(`✅ [Campaign Executor Resume] SIP PRE-FLIGHT CHECK 3: Credentials fresh (last synced ${Math.round((now - lastSync) / 3600000)}h ago)`);
        }
      }

      // Get contacts that haven't been successfully called
      const campaignContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId));

      if (campaignContacts.length === 0) {
        console.log(`[Campaign Executor] Campaign ${campaignId} has no contacts, marking as completed`);
        await db.update(campaigns).set({ status: 'completed', completedAt: new Date() }).where(eq(campaigns.id, campaignId));
        return { batchJob: null, contactsToCall: 0 };
      }

      // Get all call records for this campaign
      const existingCalls = await db
        .select({
          contactId: calls.contactId,
          status: calls.status,
        })
        .from(calls)
        .where(eq(calls.campaignId, campaignId));

      // Build a map of contact -> best call status
      const successStatuses = new Set(['completed', 'connected', 'transferred', 'voicemail']);
      const inProgressStatuses = new Set(['initiated', 'in_progress', 'ringing']);
      
      const contactCallStatus = new Map<string, string>();
      for (const call of existingCalls) {
        if (call.contactId) {
          const current = contactCallStatus.get(call.contactId);
          const status = call.status || 'pending';
          
          if (successStatuses.has(status)) {
            contactCallStatus.set(call.contactId, 'success');
          } else if (inProgressStatuses.has(status) && current !== 'success') {
            contactCallStatus.set(call.contactId, 'in-progress');
          } else if (!current) {
            contactCallStatus.set(call.contactId, status);
          }
        }
      }

      // Filter to only contacts that need to be called
      const contactsToCall = campaignContacts.filter(contact => {
        const status = contactCallStatus.get(contact.id);
        if (status === 'success' || status === 'in-progress') {
          return false;
        }
        return true;
      });

      if (contactsToCall.length === 0) {
        console.log(`[Campaign Executor] All contacts already called successfully, nothing to resume`);
        return { batchJob: null, contactsToCall: 0 };
      }

      console.log(`[Campaign Executor] Resuming ElevenLabs SIP campaign ${campaignId} with ${contactsToCall.length} pending/failed contacts`);
      console.log(`   Agent: ${agent.name} (ElevenLabs ID: ${agent.elevenLabsAgentId})`);
      console.log(`   SIP Phone: ${sipPhoneNumber.phoneNumber} (ElevenLabs ID: ${currentSipPhoneElevenLabsId})`);

      // PRE-FLIGHT CHECK: Refresh agent tools on ElevenLabs to pick up current date context
      // This ensures appointment booking tool has today's date for "tomorrow" calculations
      // Check both appointmentBookingEnabled flag AND flowId (flow agents may have appointment nodes)
      if (agent.appointmentBookingEnabled || agent.flowId) {
        console.log(`📅 [Campaign Executor] Refreshing SIP agent appointment tool for current date context (resume)...`);
        try {
          const elevenLabsServiceForTools = new ElevenLabsService(credential.apiKey);
          await elevenLabsServiceForTools.refreshAppointmentToolWithCurrentDate(agent.elevenLabsAgentId);
          console.log(`✅ [Campaign Executor] SIP agent appointment tool refreshed with current date`);
        } catch (toolRefreshError: any) {
          console.warn(`⚠️ [Campaign Executor] Failed to refresh SIP agent tools: ${toolRefreshError.message}`);
          // Non-fatal - continue with campaign execution
        }
      }

      // PRE-CREATE CALL RECORDS for contacts to be called
      const callInsertsSip = contactsToCall.map(contact => ({
        userId: campaign.userId,
        campaignId: campaign.id,
        contactId: contact.id,
        phoneNumber: contact.phone,
        fromNumber: sipPhoneNumber.phoneNumber,
        toNumber: contact.phone,
        status: 'pending' as const,
        callDirection: 'outgoing' as const,
        metadata: {
          batchCall: true,
          agentId: agent.id,
          elevenLabsAgentId: agent.elevenLabsAgentId,
          telephonyProvider: 'elevenlabs-sip',
          sipPhoneNumberId: sipPhoneNumber.id,
          contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
          isResume: true,
        },
      }));

      const callResultSip = await batchInsertCalls(callInsertsSip, '📞 [ElevenLabs SIP Resume]');
      const preCreatedCalls = callResultSip.results;

      // Create flow execution records for flow-based agents
      if (agent.flowId && preCreatedCalls.length > 0) {
        const flowExecInsertsSip: FlowExecutionInsert[] = preCreatedCalls.map(callRecord => ({
          callId: callRecord.id,
          flowId: agent.flowId!,
          campaignId: campaign.id,
          campaignName: campaign.name,
          contactPhone: callRecord.phoneNumber || '',
          telephonyProvider: 'elevenlabs-sip',
        }));
        
        await batchInsertFlowExecutions(flowExecInsertsSip, '🔀 [ElevenLabs SIP Resume]');
      }

      // Convert contacts to batch recipients format
      const recipients = BatchCallingService.contactsToBatchRecipients(
        contactsToCall.map(c => ({
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          email: c.email,
          customFields: c.customFields as Record<string, any> | null,
        }))
      );

      // Create batch calling service with agent's credential
      const batchService = new BatchCallingService(credential.apiKey);

      // Calculate scheduled time if campaign has scheduling enabled
      let scheduledTimeUnix: number | undefined;
      if (campaign.scheduleEnabled) {
        const nextWindow = CampaignScheduler.getNextCallWindow(campaign);
        if (nextWindow) {
          scheduledTimeUnix = Math.floor(nextWindow.getTime() / 1000);
          console.log(`   Scheduled for: ${nextWindow.toISOString()}`);
        }
      }

      // Create the batch job using ElevenLabs Batch Calling API with SIP phone number
      const batchJob = await batchService.createBatch({
        call_name: `${campaign.name} (Resume)`,
        agent_id: agent.elevenLabsAgentId,
        recipients: recipients,
        agent_phone_number_id: currentSipPhoneElevenLabsId,
        scheduled_time_unix: scheduledTimeUnix,
      });

      console.log(`✅ [Campaign Executor] Created ElevenLabs SIP resume batch job: ${batchJob.id}`);
      console.log(`   Status: ${batchJob.status}`);
      console.log(`   Contacts: ${contactsToCall.length}`);

      // Update pre-created call records with batch job ID for tracking
      if (preCreatedCalls.length > 0) {
        const callIds = preCreatedCalls.map(c => c.id);
        await db
          .update(calls)
          .set({
            metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{batchJobId}', ${JSON.stringify(batchJob.id)}::jsonb)`
          })
          .where(inArray(calls.id, callIds));
      }

      // Update campaign with new batch job info
      await db
        .update(campaigns)
        .set({
          status: 'running',
          batchJobId: batchJob.id,
          batchJobStatus: batchJob.status,
          completedAt: null,
        })
        .where(eq(campaigns.id, campaignId));

      return { batchJob, contactsToCall: contactsToCall.length };
    }

    // ElevenLabs flow (Twilio-based) - get pending/failed contacts only
    if (!agent.elevenLabsAgentId) {
      throw new Error('Agent not synced with ElevenLabs');
    }

    // ElevenLabs campaigns require a Twilio phone number
    if (!campaign.phoneNumberId) {
      throw new Error('ElevenLabs campaign requires a Twilio phone number');
    }

    // Get phone number
    const [phoneNumber] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, campaign.phoneNumberId))
      .limit(1);

    if (!phoneNumber) {
      throw new Error('Phone number not found');
    }

    if (!phoneNumber.elevenLabsPhoneNumberId) {
      throw new Error('Phone number not synced with ElevenLabs');
    }

    // Get credential for agent
    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      throw new Error('No ElevenLabs credential found for agent');
    }

    // Get contacts that haven't been successfully called
    // Find contacts where either:
    // 1. No call record exists
    // 2. Call record exists but status is pending/failed/no-answer
    const campaignContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.campaignId, campaignId));

    if (campaignContacts.length === 0) {
      console.log(`[Campaign Executor] Campaign ${campaignId} has no contacts, marking as completed`);
      await db.update(campaigns).set({ status: 'completed', completedAt: new Date() }).where(eq(campaigns.id, campaignId));
      return { batchJob: null, contactsToCall: 0 };
    }

    // Get all call records for this campaign
    const existingCalls = await db
      .select({
        contactId: calls.contactId,
        status: calls.status,
      })
      .from(calls)
      .where(eq(calls.campaignId, campaignId));

    // Build a map of contact -> best call status
    // "completed" statuses that mean the contact was successfully reached
    const successStatuses = new Set(['completed', 'connected', 'transferred', 'voicemail']);
    // "in-progress" statuses that mean a call is currently active (don't retry)
    const inProgressStatuses = new Set(['initiated', 'in_progress', 'ringing']);
    
    const contactCallStatus = new Map<string, string>();
    for (const call of existingCalls) {
      if (call.contactId) {
        const current = contactCallStatus.get(call.contactId);
        const status = call.status || 'pending';
        
        // Priority: success > in-progress > failed/pending
        if (successStatuses.has(status)) {
          contactCallStatus.set(call.contactId, 'success');
        } else if (inProgressStatuses.has(status) && current !== 'success') {
          contactCallStatus.set(call.contactId, 'in-progress');
        } else if (!current) {
          contactCallStatus.set(call.contactId, status);
        }
      }
    }

    // Filter to only contacts that need to be called
    // Exclude: successfully completed calls, in-progress calls
    // Include: no call, pending, failed, no-answer, busy, cancelled
    const contactsToCall = campaignContacts.filter(contact => {
      const status = contactCallStatus.get(contact.id);
      // Exclude if already successful or currently in progress
      if (status === 'success' || status === 'in-progress') {
        return false;
      }
      // Include all other cases (no call, failed, pending, no-answer, busy, etc.)
      return true;
    });

    if (contactsToCall.length === 0) {
      console.log(`[Campaign Executor] All contacts already called successfully, nothing to resume`);
      return { batchJob: null, contactsToCall: 0 };
    }

    console.log(`[Campaign Executor] Resuming campaign ${campaignId} with ${contactsToCall.length} pending/failed contacts (of ${campaignContacts.length} total)`);

    // PRE-CREATE CALL RECORDS for contacts to be called (mirrors executeCampaign logic)
    const callInserts = contactsToCall.map(contact => ({
      userId: campaign.userId,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: contact.phone,
      status: 'pending' as const,
      callDirection: 'outgoing' as const,
      metadata: {
        batchCall: true,
        agentId: agent.id,
        elevenLabsAgentId: agent.elevenLabsAgentId,
        contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
        isResume: true,
        telephonyProvider: 'elevenlabs',
      },
    }));

    const callResult = await batchInsertCalls(callInserts, '📞 [ElevenLabs Resume]');
    const preCreatedCalls = callResult.results;

    // Create flow execution records for flow-based agents using batch insert
    if (agent.flowId && preCreatedCalls.length > 0) {
      const flowExecInserts: FlowExecutionInsert[] = preCreatedCalls.map(callRecord => ({
        callId: callRecord.id,
        flowId: agent.flowId!,
        campaignId: campaign.id,
        campaignName: campaign.name,
        contactPhone: callRecord.phoneNumber || '',
        telephonyProvider: 'elevenlabs',
      }));
      
      await batchInsertFlowExecutions(flowExecInserts, '🔀 [ElevenLabs Resume]');
    }

    // Convert contacts to batch recipients format
    const recipients = BatchCallingService.contactsToBatchRecipients(
      contactsToCall.map(c => ({
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        customFields: c.customFields as Record<string, any> | null,
      }))
    );

    // Create batch calling service with agent's credential
    const batchService = new BatchCallingService(credential.apiKey);

    // Calculate scheduled time if campaign has scheduling enabled
    let scheduledTimeUnix: number | undefined;
    if (campaign.scheduleEnabled) {
      const nextWindow = CampaignScheduler.getNextCallWindow(campaign);
      if (nextWindow) {
        scheduledTimeUnix = Math.floor(nextWindow.getTime() / 1000);
        console.log(`   Scheduled for: ${nextWindow.toISOString()}`);
      }
    }

    // Create the batch job
    const batchJob = await batchService.createBatch({
      call_name: `${campaign.name} (Resume)`,
      agent_id: agent.elevenLabsAgentId,
      recipients: recipients,
      agent_phone_number_id: phoneNumber.elevenLabsPhoneNumberId,
      scheduled_time_unix: scheduledTimeUnix,
    });

    console.log(`✅ [Campaign Executor] Created resume batch job: ${batchJob.id}`);
    console.log(`   Status: ${batchJob.status}`);
    console.log(`   Contacts: ${contactsToCall.length}`);
    console.log(`   Pre-created calls: ${preCreatedCalls.length}`);

    // Update campaign with new batch job info
    await db
      .update(campaigns)
      .set({
        status: 'running',
        batchJobId: batchJob.id,
        batchJobStatus: batchJob.status,
        completedAt: null,
      })
      .where(eq(campaigns.id, campaignId));

    return { batchJob, contactsToCall: contactsToCall.length };
  }

  /**
   * Make a call using ElevenLabs native Twilio integration
   * ElevenLabs handles the call directly - we just initiate and track
   */
  private async makeCall(config: CallConfig): Promise<CallResult> {
    try {
      // Get phone number details - must have elevenLabsPhoneNumberId for native integration
      const [phoneNumber] = await db
        .select()
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, config.phoneNumberId))
        .limit(1);

      if (!phoneNumber) {
        throw new Error('Phone number not found');
      }

      if (!phoneNumber.elevenLabsPhoneNumberId) {
        throw new Error('Phone number not synced with ElevenLabs. Please sync your phone numbers first.');
      }

      // Get contact details
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, config.contactId))
        .limit(1);

      if (!contact) {
        throw new Error('Contact not found');
      }

      // Get agent details
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, config.agentId))
        .limit(1);

      if (!agent) {
        throw new Error('Agent not found');
      }

      // Validate agent has ElevenLabs agent ID
      if (!agent.elevenLabsAgentId) {
        throw new Error('Agent not synced with ElevenLabs');
      }

      // Get the correct credential for this agent
      const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      if (!credential) {
        throw new Error("No ElevenLabs credential found for agent");
      }

      // Create ElevenLabsService with agent's credential
      const agentElevenLabsService = new ElevenLabsService(credential.apiKey);

      // Create call record first
      const [callRecord] = await db
        .insert(calls)
        .values({
          userId: config.userId, // Direct user ownership for guaranteed isolation
          campaignId: config.campaignId,
          contactId: config.contactId,
          phoneNumber: contact.phone,
          fromNumber: phoneNumber.phoneNumber,
          toNumber: contact.phone,
          status: 'initiated',
          callDirection: 'outgoing',
          startedAt: new Date(),
        })
        .returning();

      console.log(`[Campaign Executor] 📞 Initiating call via ElevenLabs native integration`);
      console.log(`   Contact: ${contact.firstName} ${contact.lastName || ''} (${contact.phone})`);
      console.log(`   From: ${phoneNumber.phoneNumber} (ElevenLabs ID: ${phoneNumber.elevenLabsPhoneNumberId})`);
      console.log(`   Agent: ${agent.name} (ElevenLabs ID: ${agent.elevenLabsAgentId})`);
      console.log(`   Credential: ${credential.name}`);

      try {
        // Substitute contact variables in firstMessage (e.g., {{contact_name}})
        const hydratedFirstMessage = agent.firstMessage && !config.customScript
          ? substituteContactVariables(agent.firstMessage, {
              firstName: contact.firstName,
              lastName: contact.lastName,
              phone: contact.phone,
              email: contact.email,
              customFields: contact.customFields as Record<string, any> || null,
            })
          : undefined;

        // Build dynamic_data for ElevenLabs variable substitution in flow nodes
        // This enables {{contact_name}}, {{contact_phone}}, and custom CSV fields
        // to be available throughout the entire conversation, not just the first message
        const customFieldsData: Record<string, string> = {};
        if (contact.customFields && typeof contact.customFields === 'object') {
          for (const [key, value] of Object.entries(contact.customFields as Record<string, any>)) {
            if (value !== null && value !== undefined) {
              customFieldsData[key] = String(value);
            }
          }
        }
        const dynamicData = enrichDynamicDataWithContactInfo(
          {
            firstName: contact.firstName,
            lastName: contact.lastName,
            phone: contact.phone,
            email: contact.email,
          },
          Object.keys(customFieldsData).length > 0 ? customFieldsData : null
        );

        console.log(`[Campaign Executor] Dynamic data for ${contact.phone}: ${Object.keys(dynamicData).join(', ')}`);

        // Initiate call via ElevenLabs API - they handle everything
        const callResult = await agentElevenLabsService.initiateOutboundCall({
          phoneNumberId: phoneNumber.elevenLabsPhoneNumberId,
          toNumber: contact.phone,
          agentId: agent.elevenLabsAgentId,
          firstMessage: hydratedFirstMessage,
          dynamicData,
        });

        console.log(`✅ [Campaign Executor] ElevenLabs call initiated`);
        console.log(`   Conversation ID: ${callResult.conversation_id}`);
        if (callResult.call_sid) {
          console.log(`   Call SID: ${callResult.call_sid}`);
        }

        // Update call record with ElevenLabs conversation ID and Twilio SID
        await db
          .update(calls)
          .set({ 
            elevenLabsConversationId: callResult.conversation_id || null,
            twilioSid: callResult.call_sid || null,
            status: 'ringing',
            metadata: {
              initiatedVia: 'elevenlabs_native',
              agentName: agent.name,
              credentialName: credential.name,
            }
          })
          .where(eq(calls.id, callRecord.id));

        return {
          callId: callRecord.id,
          status: 'completed',
          twilioCallSid: callResult.call_sid
        };

      } catch (callError: any) {
        console.error(`❌ [Campaign Executor] ElevenLabs call initiation failed:`, callError);
        
        // Mark call as failed in database
        await db
          .update(calls)
          .set({ 
            status: 'failed',
            endedAt: new Date(),
            metadata: { error: `ElevenLabs error: ${callError.message}` }
          })
          .where(eq(calls.id, callRecord.id));
        
        return {
          callId: callRecord.id,
          status: 'failed',
          error: callError.message
        };
      }

    } catch (error) {
      console.error('Failed to make call:', error);
      
      return {
        callId: config.contactId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Map error messages to error codes for campaign.failed webhook
   */
  private getErrorCode(errorMessage: string): string {
    const message = errorMessage.toLowerCase();
    
    if (message.includes('insufficient') && message.includes('credit')) {
      return 'INSUFFICIENT_CREDITS';
    }
    if (message.includes('elevenlabs') || message.includes('eleven labs')) {
      return 'ELEVENLABS_API_ERROR';
    }
    if (message.includes('twilio')) {
      return 'TWILIO_API_ERROR';
    }
    if (message.includes('plivo')) {
      return 'PLIVO_API_ERROR';
    }
    if (message.includes('phone') && (message.includes('not found') || message.includes('not synced'))) {
      return 'PHONE_NUMBER_ERROR';
    }
    if (message.includes('agent') && (message.includes('not found') || message.includes('not synced'))) {
      return 'AGENT_ERROR';
    }
    if (message.includes('credential') && message.includes('not found')) {
      return 'CREDENTIAL_ERROR';
    }
    if (message.includes('campaign') && message.includes('not found')) {
      return 'CAMPAIGN_NOT_FOUND';
    }
    if (message.includes('no contacts') || message.includes('has no contacts')) {
      return 'NO_CONTACTS';
    }
    if (message.includes('database') || message.includes('db')) {
      return 'DATABASE_ERROR';
    }
    if (message.includes('concurrency') || message.includes('limit')) {
      return 'CONCURRENCY_LIMIT';
    }
    if (message.includes('migration')) {
      return 'MIGRATION_ERROR';
    }
    if (message.includes('timeout')) {
      return 'TIMEOUT_ERROR';
    }
    
    return 'EXECUTION_ERROR';
  }

  /**
   * Execute a retry pass for contacts that qualified for retry.
   * Called by the scheduler when nextRetryAt has passed for contacts in this campaign.
   * Creates NEW call records (not updates) to preserve full call history.
   */
  async executeRetryPass(campaignId: string): Promise<void> {
    const now = new Date();

    // Get campaign details
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      console.error(`[Retry Pass] Campaign ${campaignId} not found`);
      return;
    }

    if (!campaign.retryEnabled) {
      console.log(`[Retry Pass] Campaign "${campaign.name}" has retry disabled — skipping`);
      return;
    }

    // Build the set of statuses that qualify for retry (based on current campaign config)
    const retryStatuses: string[] = [];
    if (campaign.retryOnNoAnswer !== false) retryStatuses.push('no-answer');
    if (campaign.retryOnBusy === true) retryStatuses.push('busy');
    if (campaign.retryOnFailed === true) retryStatuses.push('failed');

    const maxAttempts = campaign.retryMaxAttempts ?? 3;

    // Find contacts that are due AND still eligible at execution time.
    // Re-validating here prevents stale retries if: campaign flags were edited after
    // scheduling, contact answered on a previous pass (status changed to 'completed'),
    // or max attempts was already reached.
    const dueContacts = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.campaignId, campaignId),
          isNotNull(contacts.nextRetryAt),
          lte(contacts.nextRetryAt, now),
          retryStatuses.length > 0 ? inArray(contacts.status, retryStatuses) : sql`FALSE`,
          // Use <= maxAttempts because scheduleContactRetry already incremented the count
          // before the next call is created (so at execution time, count == maxAttempts is
          // still valid — we're about to make the maxAttempts-th call).
          sql`COALESCE(${contacts.attemptCount}, 1) <= ${maxAttempts}`
        )
      );

    if (dueContacts.length === 0) {
      console.log(`[Retry Pass] No contacts due for retry in campaign "${campaign.name}"`);
      return;
    }

    const currentPass = campaign.currentRetryPass ?? 0;
    console.log(`🔄 [Retry Pass] Executing retry pass ${currentPass} for campaign "${campaign.name}" — ${dueContacts.length} contacts`);

    // Get agent details
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, campaign.agentId!))
      .limit(1);

    if (!agent) {
      console.error(`[Retry Pass] Agent not found for campaign ${campaignId}`);
      return;
    }

    const provider = agent.telephonyProvider || 'twilio';
    const dueContactIds = dueContacts.map(c => c.id);

    try {
      if (provider === 'plivo') {
        await this._retryPassPlivo(campaign, agent, dueContacts, currentPass);
      } else if (provider === 'twilio_openai') {
        await this._retryPassTwilioOpenAI(campaign, agent, dueContacts, currentPass);
      } else if (provider === 'elevenlabs-sip') {
        await this._retryPassElevenLabsSip(campaign, agent, dueContacts, currentPass);
      } else {
        // Default: ElevenLabs (Twilio + ElevenLabs batch calling)
        await this._retryPassElevenLabs(campaign, agent, dueContacts, currentPass);
      }

      // Clear nextRetryAt and stamp lastAttemptAt AFTER successful call-record creation.
      // attemptCount is NOT incremented here — scheduleContactRetry (the webhook helper)
      // is the single authoritative increment source, firing once per terminal call status.
      // This avoids double-counting and keeps the guard logic in one place.
      await db
        .update(contacts)
        .set({
          nextRetryAt: null,
          lastAttemptAt: new Date(),
        })
        .where(inArray(contacts.id, dueContactIds));

    } catch (err: any) {
      console.error(`[Retry Pass] Failed for campaign "${campaign.name}": ${err.message}`);
      // Do NOT update contacts — leave nextRetryAt intact so they can be retried again
    }
  }

  /**
   * Retry pass for Plivo+OpenAI engine
   */
  private async _retryPassPlivo(campaign: any, agent: any, dueContacts: any[], pass: number): Promise<void> {
    const [campaignPhoneNumber] = await db
      .select()
      .from(plivoPhoneNumbers)
      .where(eq(plivoPhoneNumbers.id, campaign.plivoPhoneNumberId!))
      .limit(1);

    if (!campaignPhoneNumber) {
      throw new Error('Plivo phone number not found for retry pass');
    }

    const retryBatchJobId = `plivo-${campaign.id}-retry${pass}`;

    // Archive old batchJobId in history before updating
    const batchJobHistory = (campaign.batchJobHistory as any[]) || [];
    if (campaign.batchJobId) {
      const alreadyRecorded = batchJobHistory.some((h: any) => h.batchJobId === campaign.batchJobId);
      if (!alreadyRecorded) {
        batchJobHistory.push({
          batchJobId: campaign.batchJobId,
          pass,
          contactCount: campaign.totalContacts,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Append the new retry batch entry to history
    batchJobHistory.push({
      batchJobId: retryBatchJobId,
      pass: pass + 1,
      contactCount: dueContacts.length,
      createdAt: new Date().toISOString(),
    });

    // Update campaign batchJobId + history + advance retry pass counter
    await db.update(campaigns).set({
      batchJobId: retryBatchJobId,
      batchJobHistory: batchJobHistory as any,
      currentRetryPass: pass + 1,
      status: 'running',
    }).where(eq(campaigns.id, campaign.id));

    // Insert new call records for retry contacts
    const callInserts = dueContacts.map(contact => ({
      userId: campaign.userId,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: contact.phone,
      fromNumber: campaignPhoneNumber.phoneNumber,
      toNumber: contact.phone,
      status: 'pending' as const,
      callDirection: 'outgoing' as const,
      metadata: {
        batchCall: true,
        batchJobId: retryBatchJobId,
        agentId: agent.id,
        telephonyProvider: 'plivo',
        retryPass: pass,
        contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      },
    }));

    await batchInsertCalls(callInserts, `🔄 [Plivo Retry Pass ${pass}]`);

    // Fire-and-forget via Plivo batch service
    const plivoBatchService = PlivoBatchCallingService.getInstance(`${campaign.id}-retry${pass}`);
    plivoBatchService.executeCampaign(campaign.id, dueContacts.map(c => c.id)).catch((err: any) => {
      console.error(`[Retry Pass Plivo] Error: ${err.message}`);
    });

    console.log(`✅ [Retry Pass] Plivo retry pass ${pass} initiated for ${dueContacts.length} contacts`);
  }

  /**
   * Retry pass for Twilio+OpenAI engine
   */
  private async _retryPassTwilioOpenAI(campaign: any, agent: any, dueContacts: any[], pass: number): Promise<void> {
    const [campaignPhoneNumber] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, campaign.phoneNumberId!))
      .limit(1);

    if (!campaignPhoneNumber) {
      throw new Error('Phone number not found for Twilio+OpenAI retry pass');
    }

    const retryBatchJobId = `twilio_openai-${campaign.id}-retry${pass}`;

    // Archive old batchJobId in history before updating
    const batchJobHistory = (campaign.batchJobHistory as any[]) || [];
    if (campaign.batchJobId) {
      const alreadyRecorded = batchJobHistory.some((h: any) => h.batchJobId === campaign.batchJobId);
      if (!alreadyRecorded) {
        batchJobHistory.push({
          batchJobId: campaign.batchJobId,
          pass,
          contactCount: campaign.totalContacts,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Append new retry batch entry to history
    batchJobHistory.push({
      batchJobId: retryBatchJobId,
      pass: pass + 1,
      contactCount: dueContacts.length,
      createdAt: new Date().toISOString(),
    });

    await db.update(campaigns).set({
      batchJobId: retryBatchJobId,
      batchJobHistory: batchJobHistory as any,
      currentRetryPass: pass + 1,
      status: 'running',
    }).where(eq(campaigns.id, campaign.id));

    const callInserts = dueContacts.map(contact => ({
      userId: campaign.userId,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: contact.phone,
      fromNumber: campaignPhoneNumber.phoneNumber,
      toNumber: contact.phone,
      status: 'pending' as const,
      callDirection: 'outgoing' as const,
      metadata: {
        batchCall: true,
        batchJobId: retryBatchJobId,
        agentId: agent.id,
        telephonyProvider: 'twilio_openai',
        retryPass: pass,
        contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      },
    }));

    await batchInsertCalls(callInserts, `🔄 [Twilio+OpenAI Retry Pass ${pass}]`);

    const twilioOpenAIBatchService = TwilioOpenAIBatchCallingService.getInstance(`${campaign.id}-retry${pass}`);
    twilioOpenAIBatchService.executeCampaign(campaign.id, dueContacts.map(c => c.id)).catch((err: any) => {
      console.error(`[Retry Pass Twilio+OpenAI] Error: ${err.message}`);
    });

    console.log(`✅ [Retry Pass] Twilio+OpenAI retry pass ${pass} initiated for ${dueContacts.length} contacts`);
  }

  /**
   * Retry pass for ElevenLabs SIP engine
   */
  private async _retryPassElevenLabsSip(campaign: any, agent: any, dueContacts: any[], pass: number): Promise<void> {
    const [sipPhoneNumber] = await db
      .select()
      .from(sipPhoneNumbers)
      .where(eq(sipPhoneNumbers.id, (campaign as any).sipPhoneNumberId!))
      .limit(1);

    if (!sipPhoneNumber || !sipPhoneNumber.externalElevenLabsPhoneId) {
      throw new Error('SIP phone number not found or not synced for retry pass');
    }

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) throw new Error('No ElevenLabs credential for retry pass');

    const batchService = new BatchCallingService(credential.apiKey);

    const recipients = BatchCallingService.contactsToBatchRecipients(
      dueContacts.map(c => ({
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        customFields: c.customFields as Record<string, any> | null,
      }))
    );

    const batchJob = await batchService.createBatch({
      call_name: `${campaign.name} (Retry ${pass})`,
      agent_id: agent.elevenLabsAgentId,
      recipients,
      agent_phone_number_id: sipPhoneNumber.externalElevenLabsPhoneId,
      scheduled_time_unix: null,
    });

    // Build batch history: archive old batchJobId then append the new one
    const batchJobHistory = (campaign.batchJobHistory as any[]) || [];
    if (campaign.batchJobId) {
      const alreadyRecorded = batchJobHistory.some((h: any) => h.batchJobId === campaign.batchJobId);
      if (!alreadyRecorded) {
        batchJobHistory.push({
          batchJobId: campaign.batchJobId,
          pass,
          contactCount: campaign.totalContacts,
          createdAt: new Date().toISOString(),
        });
      }
    }
    // Append new retry batch entry
    batchJobHistory.push({
      batchJobId: batchJob.id,
      pass: pass + 1,
      contactCount: dueContacts.length,
      createdAt: new Date().toISOString(),
    });

    // Insert new call records for retry
    const callInserts = dueContacts.map(contact => ({
      userId: campaign.userId,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: contact.phone,
      fromNumber: sipPhoneNumber.phoneNumber,
      toNumber: contact.phone,
      status: 'pending' as const,
      callDirection: 'outgoing' as const,
      metadata: {
        batchCall: true,
        batchJobId: batchJob.id,
        agentId: agent.id,
        telephonyProvider: 'elevenlabs-sip',
        retryPass: pass,
        contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      },
    }));

    await batchInsertCalls(callInserts, `🔄 [ElevenLabs SIP Retry Pass ${pass}]`);

    await db.update(campaigns).set({
      batchJobId: batchJob.id,
      batchJobStatus: batchJob.status,
      batchJobHistory: batchJobHistory as any,
      currentRetryPass: pass + 1,
      status: 'running',
    }).where(eq(campaigns.id, campaign.id));

    console.log(`✅ [Retry Pass] ElevenLabs SIP retry pass ${pass} initiated: batch ${batchJob.id}`);
  }

  /**
   * Retry pass for ElevenLabs (Twilio+ElevenLabs) engine
   */
  private async _retryPassElevenLabs(campaign: any, agent: any, dueContacts: any[], pass: number): Promise<void> {
    const [phoneNumber] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, campaign.phoneNumberId!))
      .limit(1);

    if (!phoneNumber || !phoneNumber.elevenLabsPhoneNumberId) {
      throw new Error('Phone number not found or not synced for ElevenLabs retry pass');
    }

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) throw new Error('No ElevenLabs credential for retry pass');

    const batchService = new BatchCallingService(credential.apiKey);

    const recipients = BatchCallingService.contactsToBatchRecipients(
      dueContacts.map(c => ({
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        customFields: c.customFields as Record<string, any> | null,
      }))
    );

    const batchJob = await batchService.createBatch({
      call_name: `${campaign.name} (Retry ${pass})`,
      agent_id: agent.elevenLabsAgentId,
      recipients,
      agent_phone_number_id: phoneNumber.elevenLabsPhoneNumberId,
      scheduled_time_unix: null,
    });

    // Build batch history: archive old batchJobId then append the new one
    const batchJobHistory = (campaign.batchJobHistory as any[]) || [];
    if (campaign.batchJobId) {
      const alreadyRecorded = batchJobHistory.some((h: any) => h.batchJobId === campaign.batchJobId);
      if (!alreadyRecorded) {
        batchJobHistory.push({
          batchJobId: campaign.batchJobId,
          pass,
          contactCount: campaign.totalContacts,
          createdAt: new Date().toISOString(),
        });
      }
    }
    // Append new retry batch entry
    batchJobHistory.push({
      batchJobId: batchJob.id,
      pass: pass + 1,
      contactCount: dueContacts.length,
      createdAt: new Date().toISOString(),
    });

    // Insert new call records for retry
    const callInserts = dueContacts.map(contact => ({
      userId: campaign.userId,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneNumber: contact.phone,
      status: 'pending' as const,
      callDirection: 'outgoing' as const,
      metadata: {
        batchCall: true,
        batchJobId: batchJob.id,
        agentId: agent.id,
        retryPass: pass,
        contactName: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      },
    }));

    const callResult = await batchInsertCalls(callInserts, `🔄 [ElevenLabs Retry Pass ${pass}]`);
    const preCreatedCalls = callResult.results;

    // Update call records with batch job ID
    if (preCreatedCalls.length > 0) {
      await db
        .update(calls)
        .set({
          metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{batchJobId}', ${JSON.stringify(batchJob.id)}::jsonb)`
        })
        .where(inArray(calls.id, preCreatedCalls.map(c => c.id)));
    }

    await db.update(campaigns).set({
      batchJobId: batchJob.id,
      batchJobStatus: batchJob.status,
      batchJobHistory: batchJobHistory as any,
      currentRetryPass: pass + 1,
      status: 'running',
    }).where(eq(campaigns.id, campaign.id));

    console.log(`✅ [Retry Pass] ElevenLabs retry pass ${pass} initiated: batch ${batchJob.id}`);
  }

  async stopCampaign(campaignId: string): Promise<void> {
    // Update campaign status
    await db
      .update(campaigns)
      .set({ 
        status: 'paused',
        completedAt: new Date()
      })
      .where(eq(campaigns.id, campaignId));

    // Close any active WebSocket connections for this campaign
    const entries = Array.from(this.activeWebSockets.entries());
    for (const [key, ws] of entries) {
      if (key.startsWith(campaignId)) {
        ws.close();
        this.activeWebSockets.delete(key);
      }
    }
  }
}

export const campaignExecutor = new CampaignExecutor();