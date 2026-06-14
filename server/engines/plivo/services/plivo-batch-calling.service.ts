'use strict';
/**
 * ============================================================
 * Plivo Batch Calling Service
 * 
 * Manages bulk outbound calling campaigns via Plivo + OpenAI:
 * - Concurrent call management with configurable limits
 * - Rate limiting to avoid overwhelming Plivo API
 * - Queue processing for large contact lists
 * - Integration with OpenAI pool for slot reservation
 * - Campaign progress tracking with real-time updates
 * ============================================================
 */

import { db } from "../../../db";
import { campaigns, contacts, calls, plivoCalls, agents, plivoPhoneNumbers, users, flows } from "@shared/schema";
import { eq, and, inArray, sql, ne, desc } from "drizzle-orm";
import { PlivoCallService } from "./plivo-call.service";
import { logger } from '../../../utils/logger';
import { OpenAIPoolService } from "./openai-pool.service";
import { OpenAIAgentFactory } from "./openai-agent-factory";
import { PlivoEngineConfig } from "../config/plivo-config";
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { storage } from '../../../storage';
import type { OpenAIVoice, OpenAIRealtimeModel, CompiledFlowConfig } from "../types";

const MAX_CAPACITY_WAIT_MS = 5 * 60 * 1000; // 5 minutes max wait for OpenAI capacity
const STUCK_CONTACT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes - contacts stuck in 'in_progress' longer are reset

type Campaign = typeof campaigns.$inferSelect;
type Contact = typeof contacts.$inferSelect;
type Agent = typeof agents.$inferSelect;
type PlivoPhoneNumber = typeof plivoPhoneNumbers.$inferSelect;

interface BatchCallConfig {
  campaignId: string;
  userId: string;
  agentId: string;
  phoneNumberId: string;
  maxConcurrentCalls: number;
  callDelayMs: number;
}

interface BatchCallProgress {
  total: number;
  queued: number;
  inProgress: number;
  completed: number;
  failed: number;
  percentage: number;
}

interface ActiveCall {
  callId: string;
  contactId: string;
  startTime: Date;
  openaiCredentialId?: string;
}

interface BatchJobResult {
  campaignId: string;
  status: 'completed' | 'failed' | 'cancelled';
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  duration: number;
}

export class PlivoBatchCallingService {
  private activeCalls: Map<string, ActiveCall> = new Map();
  private callQueue: Contact[] = [];
  private processedContactIds: Set<string> = new Set();
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private isCapacityFailed: boolean = false; // Flag for graceful capacity failure
  private config: BatchCallConfig | null = null;
  private agent: Agent | null = null;
  private phoneNumber: PlivoPhoneNumber | null = null;
  private startTime: Date | null = null;
  private completedCount: number = 0;
  private failedCount: number = 0;
  private pendingInitiations: number = 0;
  private lastProgressUpdate: number = 0;
  private totalContacts: number = 0;
  private capacityWaitStartTime: number | null = null;
  private lastStuckContactCheck: number = 0;

  private static instances: Map<string, PlivoBatchCallingService> = new Map();

  private constructor() {}

  /**
   * Get or create a batch calling service instance for a campaign
   */
  static getInstance(campaignId: string): PlivoBatchCallingService {
    if (!this.instances.has(campaignId)) {
      this.instances.set(campaignId, new PlivoBatchCallingService());
    }
    return this.instances.get(campaignId)!;
  }

  /**
   * Remove instance when campaign is complete
   */
  static removeInstance(campaignId: string): void {
    this.instances.delete(campaignId);
  }

  /**
   * Get all active campaign instances
   */
  static getActiveInstances(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Execute a campaign using Plivo + OpenAI engine
   */
  async executeCampaign(campaignId: string): Promise<BatchJobResult> {
    logger.info(`Starting campaign execution: ${campaignId}`, undefined, 'PlivoBatch');

    try {
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

      // Use campaign.plivoPhoneNumberId directly (stored as a column, not in config)
      const plivoPhoneNumberId = campaign.plivoPhoneNumberId;

      if (!plivoPhoneNumberId) {
        throw new Error('Campaign has no Plivo phone number configured. Please select a Plivo phone number.');
      }

      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, campaign.agentId))
        .limit(1);

      if (!agent) {
        throw new Error('Agent not found');
      }

      const [phoneNumber] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(eq(plivoPhoneNumbers.id, plivoPhoneNumberId))
        .limit(1);

      if (!phoneNumber) {
        throw new Error('Plivo phone number not found');
      }

      if (phoneNumber.status !== 'active') {
        throw new Error('Plivo phone number is not active');
      }

      // Use paginated loading - get counts first, then load contacts in batches
      const CONTACT_BATCH_SIZE = 500;
      
      // Get counts by status using aggregate query (memory efficient)
      const statusCounts = await db
        .select({
          status: contacts.status,
          count: sql<number>`count(*)::int`,
        })
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId))
        .groupBy(contacts.status);
      
      const totalCount = statusCounts.reduce((sum, s) => sum + s.count, 0);
      if (totalCount === 0) {
        throw new Error('Campaign has no contacts');
      }
      
      const initialCompleted = statusCounts.find(s => s.status === 'completed')?.count || 0;
      const initialFailed = statusCounts.find(s => s.status === 'failed')?.count || 0;
      const pendingCount = totalCount - initialCompleted - initialFailed;
      
      // Load first batch of pending contacts (pending or in_progress)
      const firstBatch = await db
        .select()
        .from(contacts)
        .where(and(
          eq(contacts.campaignId, campaignId),
          ne(contacts.status, 'completed'),
          ne(contacts.status, 'failed')
        ))
        .limit(CONTACT_BATCH_SIZE);

      this.agent = agent;
      this.phoneNumber = phoneNumber;
      this.callQueue = firstBatch;
      this.totalContacts = totalCount;
      this.startTime = new Date();
      this.completedCount = initialCompleted;
      this.failedCount = initialFailed;
      this.isProcessing = true;
      this.isPaused = false;
      this.isCancelled = false;

      // Read admin-configured concurrency limit from global settings
      const globalConcurrencySetting = await storage.getGlobalSetting('campaign_batch_concurrency');
      const adminConcurrencyLimit = typeof globalConcurrencySetting?.value === 'number' 
        ? globalConcurrencySetting.value 
        : (typeof globalConcurrencySetting?.value === 'string' ? parseInt(globalConcurrencySetting.value, 10) : null);
      
      // Priority: campaign config > admin setting > engine default
      const concurrencyLimit = (campaign.config as any)?.maxConcurrentCalls || 
        adminConcurrencyLimit ||
        PlivoEngineConfig.defaults.concurrentCallLimit;
      const callDelay = (campaign.config as any)?.callDelayMs || 
        PlivoEngineConfig.defaults.callDelayMs;

      this.config = {
        campaignId,
        userId: campaign.userId,
        agentId: campaign.agentId,
        phoneNumberId: plivoPhoneNumberId,
        maxConcurrentCalls: concurrencyLimit,
        callDelayMs: callDelay,
      };

      logger.info(`Agent: ${agent.name}`, undefined, 'PlivoBatch');
      logger.info(`Phone: ${phoneNumber.phoneNumber}`, undefined, 'PlivoBatch');
      logger.info(`Total Contacts: ${totalCount}`, undefined, 'PlivoBatch');
      logger.info(`Pending: ${pendingCount}, Already Completed: ${initialCompleted}, Already Failed: ${initialFailed}`, undefined, 'PlivoBatch');
      logger.info(`Concurrency: ${concurrencyLimit} (paginated loading: ${CONTACT_BATCH_SIZE} contacts/batch)`, undefined, 'PlivoBatch');
      logger.info(`Call Delay: ${callDelay}ms`, undefined, 'PlivoBatch');

      await db
        .update(campaigns)
        .set({
          status: 'running',
          startedAt: new Date(),
          totalContacts: totalCount,
        })
        .where(eq(campaigns.id, campaignId));

      // Recover any stuck contacts from previous runs before starting
      await this.recoverStuckContactsAtStart();

      await this.processQueue();

      const duration = this.startTime 
        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
        : 0;

      // Query authoritative counts from database for accuracy (using aggregate for efficiency)
      const finalStatusCounts = await db
        .select({
          status: contacts.status,
          count: sql<number>`count(*)::int`,
        })
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId))
        .groupBy(contacts.status);

      const dbCompletedCount = finalStatusCounts.find(s => s.status === 'completed')?.count || 0;
      const dbFailedCount = finalStatusCounts.find(s => s.status === 'failed')?.count || 0;

      // Determine final status: cancelled > capacity_failed > completed
      let finalStatus: 'completed' | 'failed' | 'cancelled' = 'completed';
      if (this.isCancelled) {
        finalStatus = 'cancelled';
      } else if (this.isCapacityFailed) {
        finalStatus = 'failed';
      }

      const result: BatchJobResult = {
        campaignId,
        status: finalStatus,
        totalCalls: this.totalContacts,
        completedCalls: dbCompletedCount,
        failedCalls: dbFailedCount,
        duration,
      };

      await db
        .update(campaigns)
        .set({
          status: finalStatus,
          completedAt: new Date(),
          completedCalls: dbCompletedCount + dbFailedCount,
          successfulCalls: dbCompletedCount,
          failedCalls: dbFailedCount,
        })
        .where(eq(campaigns.id, campaignId));

      logger.info(`Campaign ${campaignId} finished`, undefined, 'PlivoBatch');
      logger.info(`Status: ${result.status}`, undefined, 'PlivoBatch');
      logger.info(`Completed: ${result.completedCalls}/${result.totalCalls}`, undefined, 'PlivoBatch');
      logger.info(`Failed: ${result.failedCalls}`, undefined, 'PlivoBatch');
      logger.info(`Duration: ${result.duration}s`, undefined, 'PlivoBatch');

      PlivoBatchCallingService.removeInstance(campaignId);
      return result;

    } catch (error: any) {
      logger.error(`Campaign ${campaignId} failed`, error, 'PlivoBatch');

      await db
        .update(campaigns)
        .set({
          status: 'failed',
          completedAt: new Date(),
        })
        .where(eq(campaigns.id, campaignId));

      PlivoBatchCallingService.removeInstance(campaignId);

      throw error;
    }
  }

  /**
   * Recover stuck contacts at campaign START.
   * Any contacts in 'in_progress' state when campaign begins are orphaned from a previous run.
   * Called once at the beginning of executeCampaign, not during runtime.
   */
  private async recoverStuckContactsAtStart(): Promise<number> {
    if (!this.config) return 0;

    // Find all contacts that are stuck in 'in_progress' state
    const stuckContacts = await db
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.campaignId, this.config.campaignId),
        eq(contacts.status, 'in_progress')
      ));

    if (stuckContacts.length > 0) {
      const stuckIds = stuckContacts.map(c => c.id);
      await db
        .update(contacts)
        .set({ status: 'pending' })
        .where(inArray(contacts.id, stuckIds));
      
      logger.info(`Recovered ${stuckContacts.length} stuck contacts at campaign start (reset to pending)`, undefined, 'PlivoBatch');
      return stuckContacts.length;
    }

    return 0;
  }

  /**
   * Process the call queue with concurrency limits and paginated loading
   */
  private async processQueue(): Promise<void> {
    const CONTACT_BATCH_SIZE = 500;
    logger.info(`Processing queue with ${this.callQueue.length} contacts (paginated)`, undefined, 'PlivoBatch');

    while (true) {
      if (this.isCancelled) {
        logger.info('Campaign cancelled, stopping queue processing', undefined, 'PlivoBatch');
        await this.releaseAllActiveSlots();
        break;
      }

      // Handle capacity failure - graceful shutdown
      if (this.isCapacityFailed) {
        logger.error('Campaign stopping due to OpenAI capacity timeout', undefined, 'PlivoBatch');
        await this.releaseAllActiveSlots();
        // Mark remaining queued contacts as failed
        if (this.callQueue.length > 0 && this.config) {
          const queuedContactIds = this.callQueue.map(c => c.id);
          await db
            .update(contacts)
            .set({ status: 'failed' })
            .where(inArray(contacts.id, queuedContactIds));
          this.failedCount += queuedContactIds.length;
          logger.info(`Marked ${queuedContactIds.length} queued contacts as failed due to capacity timeout`, undefined, 'PlivoBatch');
        }
        this.callQueue = [];
        break;
      }

      if (this.isPaused) {
        logger.info('Campaign paused, waiting...', undefined, 'PlivoBatch');
        await this.sleep(1000);
        continue;
      }

      // Refill queue from database if running low and there are more pending contacts.
      // Exclude ALL terminal statuses so that contacts which ended as no-answer / busy /
      // cancelled in this session are never re-queued and re-dialled within the same
      // processQueue loop (regression guard for Task #145).
      if (this.callQueue.length < 50 && this.config) {
        const moreContacts = await db
          .select()
          .from(contacts)
          .where(and(
            eq(contacts.campaignId, this.config.campaignId),
            ne(contacts.status, 'completed'),
            ne(contacts.status, 'failed'),
            ne(contacts.status, 'no-answer'),
            ne(contacts.status, 'busy'),
            ne(contacts.status, 'cancelled'),
            ne(contacts.status, 'canceled'),
            ne(contacts.status, 'in_progress')
          ))
          .limit(CONTACT_BATCH_SIZE);
        
        if (moreContacts.length > 0) {
          // Filter out contacts already in queue
          const existingIds = new Set(this.callQueue.map(c => c.id));
          const newContacts = moreContacts.filter(c => !existingIds.has(c.id));
          if (newContacts.length > 0) {
            this.callQueue.push(...newContacts);
            logger.info(`Refilled queue with ${newContacts.length} contacts (total: ${this.callQueue.length})`, undefined, 'PlivoBatch');
          }
        }
      }

      // Exit if no more work to do (including calls that are being initiated but not yet in activeCalls)
      if (this.callQueue.length === 0 && this.activeCalls.size === 0 && this.pendingInitiations === 0) {
        break;
      }

      while (
        this.callQueue.length > 0 &&
        this.activeCalls.size < this.config!.maxConcurrentCalls
      ) {
        // Check pause/cancel before each call initiation
        if (this.isPaused || this.isCancelled || this.isCapacityFailed) {
          break;
        }

        const hasCapacity = await this.checkOpenAICapacity();
        if (!hasCapacity) {
          // Track when we started waiting for capacity
          if (this.capacityWaitStartTime === null) {
            this.capacityWaitStartTime = Date.now();
            logger.info('No OpenAI capacity available, starting wait timer...', undefined, 'PlivoBatch');
          }
          
          const waitDuration = Date.now() - this.capacityWaitStartTime;
          if (waitDuration > MAX_CAPACITY_WAIT_MS) {
            logger.error(`OpenAI capacity wait exceeded ${MAX_CAPACITY_WAIT_MS / 60000} minutes, failing campaign gracefully`, undefined, 'PlivoBatch');
            this.isCapacityFailed = true;
            break; // Exit inner loop, outer loop will handle cleanup
          }
          
          logger.info(`No OpenAI capacity, waited ${Math.floor(waitDuration / 1000)}s (max: ${MAX_CAPACITY_WAIT_MS / 1000}s)`, undefined, 'PlivoBatch');
          await this.sleep(2000);
          break;
        }

        // Reset capacity wait timer on successful capacity check
        this.capacityWaitStartTime = null;

        const contact = this.callQueue.shift()!;
        this.pendingInitiations++;
        this.initiateCallForContact(contact).catch(err => {
          logger.error(`Failed to initiate call for ${contact.phone}`, err, 'PlivoBatch');
          this.failedCount++;
        });

        if (this.config!.callDelayMs > 0 && this.callQueue.length > 0) {
          await this.sleep(this.config!.callDelayMs);
        }
      }

      await this.updateProgress();
      await this.sleep(500);
    }

    this.isProcessing = false;
    logger.info('Queue processing complete', undefined, 'PlivoBatch');
  }

  /**
   * Check if OpenAI pool has available capacity
   */
  private async checkOpenAICapacity(): Promise<boolean> {
    const stats = await OpenAIPoolService.getPoolStats();
    return stats.availableCapacity > 0;
  }

  /**
   * Initiate a call for a single contact
   * Handles both natural agents (systemPrompt-based) and flow agents (compiled flows)
   */
  private async initiateCallForContact(contact: Contact): Promise<void> {
    try {
      if (!this.config || !this.agent || !this.phoneNumber) {
        throw new Error('Batch calling service not properly initialized');
      }

      logger.info(`Initiating call to ${contact.phone}`, undefined, 'PlivoBatch');
      await db
        .update(contacts)
        .set({ status: 'in_progress' })
        .where(eq(contacts.id, contact.id));

      const agentConfigData = this.agent.config as Record<string, any> || {};
      
      // Use validated voice and model from OpenAIAgentFactory
      const validatedVoice = OpenAIAgentFactory.validateVoice(
        this.agent.openaiVoice || PlivoEngineConfig.defaults.voice
      );
      const validatedModel = OpenAIAgentFactory.validateModel(
        agentConfigData.openaiModel || PlivoEngineConfig.defaults.model,
        'pro' // Allow full model access for campaigns
      );

      let agentConfig: {
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

      // Check if agent is flow-based and compile the flow
      if (this.agent.type === 'flow' && this.agent.flowId) {
        logger.info(`Agent is flow-based, fetching flow ${this.agent.flowId}`, undefined, 'PlivoBatch');
        
        const [flow] = await db
          .select()
          .from(flows)
          .where(eq(flows.id, this.agent.flowId))
          .limit(1);

        if (flow) {
          // Build contact variables for flow substitution
          const contactVariables: Record<string, unknown> = {
            firstName: contact.firstName,
            lastName: contact.lastName || '',
            phone: contact.phone,
            email: contact.email || '',
            ...(contact.customFields as Record<string, unknown> || {}),
          };

          // Use agent language (flows don't have language column)
          const language = this.agent.language || 'en';

          // Check if flow has pre-compiled data (compiled at save time)
          if (flow.compiledSystemPrompt && flow.compiledTools) {
            logger.info(`Using pre-compiled flow data (${(flow.compiledTools as any[]).length} tools)`, undefined, 'PlivoBatch');
            
            // Import the shared hydrator
            const { hydrateCompiledFlow, substituteContactVariables } = await import('../../../services/openai-voice-agent/hydrator');
            
            // Substitute contact variables in pre-compiled prompts
            const systemPrompt = substituteContactVariables(flow.compiledSystemPrompt, contactVariables);
            const firstMessage = flow.compiledFirstMessage 
              ? substituteContactVariables(flow.compiledFirstMessage, contactVariables) 
              : undefined;
            
            // Use the shared hydrator to create agent config with proper tool handlers
            const hydratedConfig = hydrateCompiledFlow({
              compiledSystemPrompt: systemPrompt,
              compiledFirstMessage: firstMessage || null,
              compiledTools: flow.compiledTools as any[],
              compiledStates: (flow.compiledStates || []) as any[],
              voice: validatedVoice,
              model: validatedModel,
              temperature: this.agent.temperature ?? 0.7,
              toolContext: {
                userId: this.config.userId,
                agentId: this.config.agentId,
                callId: '', // Will be set after call creation
              },
              language,
              knowledgeBaseIds: this.agent.knowledgeBaseIds || [],
              transferPhoneNumber: this.agent.transferPhoneNumber || undefined,
              transferEnabled: !!this.agent.transferPhoneNumber,
            });
            
            agentConfig = {
              voice: validatedVoice,
              model: validatedModel,
              systemPrompt: hydratedConfig.systemPrompt,
              firstMessage: hydratedConfig.firstMessage,
              tools: hydratedConfig.tools,
            };
          } else {
            // Fall back to runtime compilation (legacy or no pre-compiled data)
            logger.info(`Flow loaded with ${(flow.nodes as any[]).length} nodes, language: ${language}, compiling at runtime`, undefined, 'PlivoBatch');

            const flowConfig: CompiledFlowConfig = {
              nodes: flow.nodes as any[],
              edges: flow.edges as any[],
              variables: contactVariables,
            };

            // compileFlow handles variable substitution internally via buildFlowSystemPrompt
            const compiledConfig = await OpenAIAgentFactory.compileFlow(flowConfig, {
              voice: validatedVoice,
              model: validatedModel,
              userId: this.config.userId,
              agentId: this.config.agentId,
              temperature: this.agent.temperature ?? 0.7,
              language,
            });

            agentConfig = {
              voice: compiledConfig.voice,
              model: compiledConfig.model,
              systemPrompt: compiledConfig.systemPrompt,
              firstMessage: compiledConfig.firstMessage,
              tools: compiledConfig.tools,
            };
          }
        } else {
          logger.warn(`Flow ${this.agent.flowId} not found, falling back to natural agent`, undefined, 'PlivoBatch');
          agentConfig = {
            voice: validatedVoice,
            model: validatedModel,
            systemPrompt: this.buildSystemPrompt(contact),
            firstMessage: this.buildFirstMessage(contact),
          };
        }
      } else {
        // Natural agent - use systemPrompt and firstMessage directly
        agentConfig = {
          voice: validatedVoice,
          model: validatedModel,
          systemPrompt: this.buildSystemPrompt(contact),
          firstMessage: this.buildFirstMessage(contact),
        };
      }

      const { callUuid, plivoCall } = await PlivoCallService.initiateCall({
        fromNumber: this.phoneNumber.phoneNumber,
        toNumber: contact.phone,
        userId: this.config.userId,
        campaignId: this.config.campaignId,
        contactId: contact.id,
        agentId: this.config.agentId,
        plivoPhoneNumberId: this.config.phoneNumberId,
        agentConfig,
      });

      this.activeCalls.set(plivoCall.id, {
        callId: plivoCall.id,
        contactId: contact.id,
        startTime: new Date(),
        openaiCredentialId: plivoCall.openaiCredentialId || undefined,
      });

      // Trigger call.started webhook event
      if (this.config && this.config.userId) {
        try {
          const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
          await webhookDeliveryService.triggerEvent(this.config.userId, 'call.started', {
            call: {
              id: plivoCall.id,
              callUuid: callUuid,
              direction: 'outbound',
              status: 'initiated',
              startedAt: new Date().toISOString(),
              fromNumber: this.phoneNumber.phoneNumber,
              toNumber: contact.phone,
            },
            contact: {
              id: contact.id,
              name: contactName,
              phone: contact.phone,
              email: contact.email || null,
            },
            campaign: {
              id: this.config.campaignId,
              name: null,
            },
            agent: {
              id: this.config.agentId,
              name: this.agent?.name || null,
            },
          });
          logger.info(`Triggered call.started webhook for call ${plivoCall.id}`, undefined, 'PlivoBatch');
        } catch (webhookError: any) {
          logger.error(`Failed to trigger call.started webhook: ${webhookError.message}`, undefined, 'PlivoBatch');
        }
      }

      this.monitorCall(plivoCall.id, contact.id);

    } catch (error: any) {
      logger.error(`Call initiation failed for ${contact.phone}`, error, 'PlivoBatch');
      
      await db
        .update(contacts)
        .set({ status: 'failed' })
        .where(eq(contacts.id, contact.id));

      // Sync the calls table so the campaign scheduler doesn't stay stuck on pending.
      // No Plivo webhook fires when initiation fails before the call reaches Plivo,
      // so this is the only path that can update the calls row.
      try {
        const [latestCallsRow] = await db
          .select({ id: calls.id })
          .from(calls)
          .where(and(
            eq(calls.campaignId, this.config.campaignId),
            eq(calls.contactId, contact.id)
          ))
          .orderBy(desc(calls.createdAt))
          .limit(1);
        if (latestCallsRow) {
          await db
            .update(calls)
            .set({ status: 'failed', endedAt: new Date() })
            .where(eq(calls.id, latestCallsRow.id));
        }
      } catch (callsSyncErr: any) {
        logger.error(`Failed to sync calls table on initiation failure for ${contact.phone}: ${callsSyncErr.message}`, undefined, 'PlivoBatch');
      }

      this.failedCount++;
    } finally {
      this.pendingInitiations--;
    }
  }

  /**
   * Monitor a call and handle completion
   */
  private async monitorCall(callId: string, contactId: string): Promise<void> {
    const checkInterval = 2000;
    const maxDuration = PlivoEngineConfig.defaults.maxCallDuration * 1000;
    const startTime = Date.now();

    const checkStatus = async () => {
      try {
        if (this.isCancelled) {
          await this.endCall(callId);
          return;
        }

        const call = await PlivoCallService.getCallById(callId);
        if (!call) {
          await this.handleCallEnd(callId, contactId, 'failed');
          return;
        }

        if (['completed', 'busy', 'failed', 'no-answer', 'canceled', 'cancelled'].includes(call.status)) {
          await this.handleCallEnd(callId, contactId, call.status);
          return;
        }

        if (Date.now() - startTime > maxDuration) {
          logger.info(`Call ${callId} exceeded max duration, ending`, undefined, 'PlivoBatch');
          await this.endCall(callId);
          return;
        }

        setTimeout(checkStatus, checkInterval);
      } catch (error) {
        logger.error(`Error monitoring call ${callId}`, error, 'PlivoBatch');
        // Ensure cleanup on error
        this.activeCalls.delete(callId);
        this.failedCount++;
      }
    };

    setTimeout(checkStatus, checkInterval);
  }

  /**
   * Handle call completion - idempotent update of contact status, release OpenAI slot, update counters
   * Guards against double processing from overlapping webhook and monitor updates
   */
  private async handleCallEnd(callId: string, contactId: string, callStatus: string): Promise<void> {
    // Guard against double processing - only process if call is still active
    const activeCall = this.activeCalls.get(callId);
    if (!activeCall) {
      logger.info(`Call ${callId} already processed, skipping`, undefined, 'PlivoBatch');
      return;
    }
    this.activeCalls.delete(callId);

    // Release OpenAI slot if one was reserved
    if (activeCall.openaiCredentialId) {
      await OpenAIPoolService.releaseSlot(activeCall.openaiCredentialId);
    }

    // Check current contact status to avoid double-counting
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact) {
      logger.warn(`Contact ${contactId} not found`, undefined, 'PlivoBatch');
      return;
    }

    // Map Plivo call status to canonical contact status.
    // Preserve the distinction between no-answer/busy/cancelled so that
    // executeRetryPass can match the correct retryStatuses filter.
    const mapToContactStatus = (s: string): string => {
      if (s === 'completed') return 'completed';
      if (s === 'no-answer') return 'no-answer';
      if (s === 'busy') return 'busy';
      if (s === 'canceled' || s === 'cancelled') return 'cancelled';
      return 'failed';
    };

    // All statuses that are already terminal — guard against double-writes from
    // overlapping monitorCall and webhook paths.
    const terminalStatuses = ['completed', 'failed', 'no-answer', 'busy', 'cancelled', 'canceled'];

    const newStatus = mapToContactStatus(callStatus);

    // Always sync the pre-created `calls` row regardless of whether the contact was
    // already marked terminal by the Plivo webhook (via scheduleContactRetry).
    // The terminal-status guard below only protects the contacts table from double-writes;
    // the calls table must be updated unconditionally so the campaign UI shows correct data.
    //
    // We target the MOST RECENTLY CREATED calls row (limit 1 by createdAt desc) so that
    // retries (which create a second calls row) only update their own row, preventing
    // the initial row from being overwritten and preventing double-counts in analytics.
    if (this.config?.campaignId) {
      try {
        const [engineCall] = await db
          .select()
          .from(plivoCalls)
          .where(eq(plivoCalls.id, callId))
          .limit(1);

        const [latestCallsRow] = await db
          .select({ id: calls.id })
          .from(calls)
          .where(and(eq(calls.campaignId, this.config.campaignId), eq(calls.contactId, contactId)))
          .orderBy(desc(calls.createdAt))
          .limit(1);

        if (latestCallsRow) {
          await db
            .update(calls)
            .set({
              status: newStatus,
              endedAt: new Date(),
              ...(engineCall?.transcript ? { transcript: engineCall.transcript } : {}),
              ...(engineCall?.recordingUrl ? { recordingUrl: engineCall.recordingUrl } : {}),
              ...(engineCall?.duration != null ? { duration: engineCall.duration } : {}),
              ...(engineCall?.aiSummary ? { aiSummary: engineCall.aiSummary } : {}),
              ...(engineCall?.sentiment ? { sentiment: engineCall.sentiment } : {}),
              ...(engineCall?.classification ? { classification: engineCall.classification } : {}),
            })
            .where(eq(calls.id, latestCallsRow.id));
          logger.info(`Synced calls status to ${newStatus} for contact ${contactId} (campaign ${this.config.campaignId})`, undefined, 'PlivoBatch');
        } else {
          logger.warn(`No calls row found for contact ${contactId} in campaign ${this.config.campaignId} — handleCallEnd status not synced (scheduleContactRetry should have already handled this)`, undefined, 'PlivoBatch');
        }
      } catch (callsUpdateErr: any) {
        logger.error(
          `Failed to sync calls table for contact ${contactId}: ${callsUpdateErr.message}`,
          undefined,
          'PlivoBatch'
        );
      }
    }

    if (!terminalStatuses.includes(contact.status)) {
      await db
        .update(contacts)
        .set({ status: newStatus })
        .where(eq(contacts.id, contactId));

      // Only increment counter when we actually update the status
      if (newStatus === 'completed') {
        this.completedCount++;
        logger.info(`Call ${callId} completed successfully`, undefined, 'PlivoBatch');
      } else {
        this.failedCount++;
        logger.info(`Call ${callId} ended with status: ${newStatus}`, undefined, 'PlivoBatch');
      }
    } else {
      // Status already set (likely by webhook), update local counter to stay in sync
      if (contact.status === 'completed') {
        this.completedCount++;
      } else {
        this.failedCount++;
      }
      logger.info(`Call ${callId} already marked as ${contact.status} by webhook`, undefined, 'PlivoBatch');
    }
  }

  /**
   * End an active call
   */
  private async endCall(callId: string): Promise<void> {
    try {
      await PlivoCallService.endCall(callId);
    } catch (error) {
      logger.error(`Failed to end call ${callId}`, error, 'PlivoBatch');
    }
  }

  /**
   * Release all active OpenAI slots and mark active contacts as failed
   */
  private async releaseAllActiveSlots(): Promise<void> {
    const entries = Array.from(this.activeCalls.entries());
    const contactIds: string[] = [];

    for (const [callId, activeCall] of entries) {
      if (activeCall.openaiCredentialId) {
        await OpenAIPoolService.releaseSlot(activeCall.openaiCredentialId);
      }
      contactIds.push(activeCall.contactId);
      try {
        await PlivoCallService.endCall(callId);
      } catch (e) {
        // Ignore errors when force-ending calls
      }
    }

    // Mark all active contacts as failed since they were interrupted
    if (contactIds.length > 0) {
      await db
        .update(contacts)
        .set({ status: 'failed' })
        .where(inArray(contacts.id, contactIds));
      this.failedCount += contactIds.length;
      logger.info(`Marked ${contactIds.length} active contacts as failed`, undefined, 'PlivoBatch');
    }

    this.activeCalls.clear();
    this.pendingInitiations = 0;
  }

  /**
   * Build system prompt with contact personalization
   */
  private buildSystemPrompt(contact: Contact): string {
    let prompt = this.agent?.systemPrompt || '';
    
    prompt = prompt.replace(/\{firstName\}/g, contact.firstName);
    prompt = prompt.replace(/\{lastName\}/g, contact.lastName || '');
    prompt = prompt.replace(/\{phone\}/g, contact.phone);
    prompt = prompt.replace(/\{email\}/g, contact.email || '');

    const customFields = contact.customFields as Record<string, any> || {};
    for (const [key, value] of Object.entries(customFields)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value || ''));
    }

    return prompt;
  }

  /**
   * Build first message with contact personalization
   * Supports both {{contact_name}} (double braces) and {firstName} (single braces) formats
   */
  private buildFirstMessage(contact: Contact): string | undefined {
    let message = this.agent?.firstMessage || '';
    if (!message) return undefined;

    const fullName = contact.lastName 
      ? `${contact.firstName} ${contact.lastName}`.trim()
      : contact.firstName;

    // Support {{contact_name}} format (double braces, snake_case)
    message = message.replace(/\{\{contact_name\}\}/g, fullName);
    message = message.replace(/\{\{contact_first_name\}\}/g, contact.firstName);
    message = message.replace(/\{\{contact_last_name\}\}/g, contact.lastName || '');
    message = message.replace(/\{\{contact_phone\}\}/g, contact.phone);
    message = message.replace(/\{\{contact_email\}\}/g, contact.email || '');
    // Also support shorthand versions
    message = message.replace(/\{\{name\}\}/g, fullName);
    message = message.replace(/\{\{first_name\}\}/g, contact.firstName);
    message = message.replace(/\{\{last_name\}\}/g, contact.lastName || '');
    message = message.replace(/\{\{phone\}\}/g, contact.phone);
    message = message.replace(/\{\{email\}\}/g, contact.email || '');

    // Legacy support: {firstName} format (single braces, camelCase)
    message = message.replace(/\{firstName\}/g, contact.firstName);
    message = message.replace(/\{lastName\}/g, contact.lastName || '');
    message = message.replace(/\{phone\}/g, contact.phone);
    message = message.replace(/\{email\}/g, contact.email || '');

    const customFields = contact.customFields as Record<string, any> || {};
    for (const [key, value] of Object.entries(customFields)) {
      // Support both {{key}} and {key} formats for custom fields
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value || ''));
      message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value || ''));
    }

    return message;
  }

  /**
   * Update campaign progress from database - queries authoritative counts
   */
  private async updateProgress(): Promise<void> {
    const now = Date.now();
    if (now - this.lastProgressUpdate < 5000) return;
    this.lastProgressUpdate = now;

    if (!this.config) return;

    // Query authoritative counts from database to avoid race conditions
    const campaignContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.campaignId, this.config.campaignId));

    const dbCompletedCount = campaignContacts.filter(c => c.status === 'completed').length;
    const dbFailedCount = campaignContacts.filter(c => c.status === 'failed').length;

    // Sync local counters with DB for accurate getProgress() calls
    this.completedCount = dbCompletedCount;
    this.failedCount = dbFailedCount;

    await db
      .update(campaigns)
      .set({
        completedCalls: dbCompletedCount + dbFailedCount,
        successfulCalls: dbCompletedCount,
        failedCalls: dbFailedCount,
      })
      .where(eq(campaigns.id, this.config.campaignId));
  }

  /**
   * Get current progress
   */
  getProgress(): BatchCallProgress {
    const total = this.completedCount + this.failedCount + this.callQueue.length + this.activeCalls.size;
    const processed = this.completedCount + this.failedCount;

    return {
      total,
      queued: this.callQueue.length,
      inProgress: this.activeCalls.size,
      completed: this.completedCount,
      failed: this.failedCount,
      percentage: total > 0 ? Math.round((processed / total) * 100) : 0,
    };
  }

  /**
   * Pause the campaign
   */
  pause(): void {
    logger.info('Pausing campaign', undefined, 'PlivoBatch');
    this.isPaused = true;
  }

  /**
   * Resume the campaign
   */
  resume(): void {
    logger.info('Resuming campaign', undefined, 'PlivoBatch');
    this.isPaused = false;
  }

  /**
   * Cancel the campaign - marks remaining queued and active contacts as failed
   */
  async cancel(): Promise<void> {
    logger.info('Cancelling campaign', undefined, 'PlivoBatch');
    this.isCancelled = true;

    // Mark all remaining queued contacts as failed
    if (this.callQueue.length > 0 && this.config) {
      const queuedContactIds = this.callQueue.map(c => c.id);
      await db
        .update(contacts)
        .set({ status: 'failed' })
        .where(inArray(contacts.id, queuedContactIds));
      logger.info(`Marked ${queuedContactIds.length} queued contacts as failed`, undefined, 'PlivoBatch');
    }
    this.callQueue = [];

    // Release all active calls and mark their contacts as failed
    await this.releaseAllActiveSlots();
  }

  /**
   * Check if campaign is running
   */
  isRunning(): boolean {
    return this.isProcessing && !this.isPaused && !this.isCancelled;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
