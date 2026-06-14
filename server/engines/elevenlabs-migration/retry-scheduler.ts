/**
 * @fileoverview ElevenLabs Migration Engine - Retry Scheduler
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Manages retry queue for campaigns that couldn't run due to capacity limits.
 * Runs hourly to check for available capacity and retry queued campaigns.
 */

import { db } from '../../db';
import { campaigns, agents, phoneNumbers } from '@shared/schema';
import { eq, and, lte, isNotNull } from 'drizzle-orm';
import { hasAnyAvailableCapacity, autoMigrateUser, getUserCurrentCredential } from './migration-service';
import { formatErrorForLog } from './error-detector';
import { logger } from '../../utils/logger';

const RETRY_INTERVAL_MS = 60 * 60 * 1000;
const MAX_RETRY_COUNT = 24;

let retryIntervalId: NodeJS.Timeout | null = null;
let isProcessingRetries = false;

/**
 * Mark a campaign for retry due to capacity limits
 * Sets status to 'processing' and schedules for retry
 * 
 * @param campaignId - Campaign ID to mark for retry
 * @param error - Error message explaining why retry is needed
 * @returns boolean indicating if campaign was marked
 */
export async function markCampaignForRetry(
  campaignId: string,
  error: string
): Promise<boolean> {
  logger.info(`Marking campaign ${campaignId} for retry`, undefined, 'RetryScheduler');
  logger.info(`Reason: ${error}`, undefined, 'RetryScheduler');

  try {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      logger.error(`Campaign not found: ${campaignId}`, undefined, 'RetryScheduler');
      return false;
    }

    const currentConfig = (campaign.config as Record<string, any>) || {};
    const currentRetryCount = currentConfig.migrationRetryCount || 0;

    if (currentRetryCount >= MAX_RETRY_COUNT) {
      logger.info(`Campaign ${campaignId} exceeded max retries (${MAX_RETRY_COUNT})`, undefined, 'RetryScheduler');
      await db
        .update(campaigns)
        .set({
          status: 'failed',
          config: {
            ...currentConfig,
            migrationRetryExhausted: true,
            migrationLastError: error,
            migrationRetryCount: currentRetryCount,
          },
        })
        .where(eq(campaigns.id, campaignId));
      return false;
    }

    const nextRetryAt = new Date(Date.now() + RETRY_INTERVAL_MS);

    await db
      .update(campaigns)
      .set({
        status: 'processing',
        config: {
          ...currentConfig,
          migrationRetryCount: currentRetryCount + 1,
          migrationLastError: error,
          migrationNextRetryAt: nextRetryAt.toISOString(),
          migrationMarkedAt: new Date().toISOString(),
        },
      })
      .where(eq(campaigns.id, campaignId));

    logger.info(`Campaign marked for retry. Next attempt: ${nextRetryAt.toISOString()}`, undefined, 'RetryScheduler');
    return true;
  } catch (err) {
    logger.error('Error marking campaign for retry', formatErrorForLog(err), 'RetryScheduler');
    return false;
  }
}

/**
 * Get all campaigns that are ready for retry
 * Returns campaigns with status='processing' and nextRetryAt <= now
 */
async function getCampaignsReadyForRetry() {
  const now = new Date();

  const allProcessing = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      userId: campaigns.userId,
      agentId: campaigns.agentId,
      phoneNumberId: campaigns.phoneNumberId,
      config: campaigns.config,
    })
    .from(campaigns)
    .where(eq(campaigns.status, 'processing'));

  return allProcessing.filter(campaign => {
    const campaignConfig = (campaign.config as Record<string, any>) || {};
    const nextRetryAt = campaignConfig.migrationNextRetryAt;
    if (!nextRetryAt) return true;
    return new Date(nextRetryAt) <= now;
  });
}

/**
 * Process a single campaign retry
 * Attempts to migrate resources if needed and restart the campaign
 * 
 * @param campaign - Campaign data
 * @returns boolean indicating if retry was successful
 */
async function processCampaignRetry(campaign: {
  id: string;
  name: string;
  userId: string;
  agentId: string | null;
  phoneNumberId: string | null;
  config: unknown;
}): Promise<boolean> {
  logger.info(`Processing retry for campaign: ${campaign.name} (${campaign.id})`, undefined, 'RetryScheduler');

  if (!await hasAnyAvailableCapacity()) {
    logger.info('No capacity available, rescheduling...', undefined, 'RetryScheduler');
    await markCampaignForRetry(campaign.id, 'No capacity available');
    return false;
  }

  if (!campaign.agentId) {
    logger.error(`Campaign has no agent: ${campaign.id}`, undefined, 'RetryScheduler');
    return false;
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, campaign.agentId))
    .limit(1);

  if (!agent) {
    logger.error(`Agent not found: ${campaign.agentId}`, undefined, 'RetryScheduler');
    return false;
  }

  const currentCredentialId = agent.elevenLabsCredentialId;
  
  if (currentCredentialId) {
    const migrationResult = await autoMigrateUser(campaign.userId, currentCredentialId);
    
    if (!migrationResult.success) {
      logger.info('Migration failed or no capacity, rescheduling...', undefined, 'RetryScheduler');
      await markCampaignForRetry(campaign.id, migrationResult.error || 'Migration failed');
      return false;
    }
    
    logger.info(`Migration successful, resources moved to ${migrationResult.toCredentialId}`, undefined, 'RetryScheduler');
  }

  const currentConfig = (campaign.config as Record<string, any>) || {};
  
  await db
    .update(campaigns)
    .set({
      status: 'pending',
      config: {
        ...currentConfig,
        migrationLastRetrySuccessAt: new Date().toISOString(),
        migrationReadyForExecution: true,
      },
    })
    .where(eq(campaigns.id, campaign.id));

  logger.info(`Campaign ${campaign.id} set to pending, ready for execution`, undefined, 'RetryScheduler');
  return true;
}

/**
 * Process all campaigns ready for retry
 * Called by the scheduler or manually
 */
export async function processRetryQueue(): Promise<{
  processed: number;
  successful: number;
  rescheduled: number;
}> {
  if (isProcessingRetries) {
    logger.info('Already processing retries, skipping...', undefined, 'RetryScheduler');
    return { processed: 0, successful: 0, rescheduled: 0 };
  }

  isProcessingRetries = true;
  const stats = { processed: 0, successful: 0, rescheduled: 0 };

  try {
    logger.info('============================================', undefined, 'RetryScheduler');
    logger.info('RETRY SCHEDULER: Processing retry queue', undefined, 'RetryScheduler');
    logger.info('============================================', undefined, 'RetryScheduler');

    const campaignsToRetry = await getCampaignsReadyForRetry();
    logger.info(`Found ${campaignsToRetry.length} campaign(s) ready for retry`, undefined, 'RetryScheduler');

    for (const campaign of campaignsToRetry) {
      stats.processed++;
      const success = await processCampaignRetry(campaign);
      
      if (success) {
        stats.successful++;
      } else {
        stats.rescheduled++;
      }
    }

    logger.info('============================================', undefined, 'RetryScheduler');
    logger.info('RETRY SCHEDULER: Complete', undefined, 'RetryScheduler');
    logger.info(`Processed: ${stats.processed}`, undefined, 'RetryScheduler');
    logger.info(`Successful: ${stats.successful}`, undefined, 'RetryScheduler');
    logger.info(`Rescheduled: ${stats.rescheduled}`, undefined, 'RetryScheduler');
    logger.info('============================================', undefined, 'RetryScheduler');

    return stats;
  } finally {
    isProcessingRetries = false;
  }
}

/**
 * Start the retry scheduler
 * Runs every hour to check for campaigns ready for retry
 */
export function startRetryScheduler(): void {
  if (retryIntervalId) {
    logger.info('Already running', undefined, 'RetryScheduler');
    return;
  }

  logger.info(`Starting scheduler (interval: ${RETRY_INTERVAL_MS / 1000 / 60} minutes)`, undefined, 'RetryScheduler');

  retryIntervalId = setInterval(async () => {
    try {
      await processRetryQueue();
    } catch (error) {
      logger.error('Error processing queue', formatErrorForLog(error), 'RetryScheduler');
    }
  }, RETRY_INTERVAL_MS);

  setTimeout(async () => {
    try {
      await processRetryQueue();
    } catch (error) {
      logger.error('Error in initial run', formatErrorForLog(error), 'RetryScheduler');
    }
  }, 10000);
}

/**
 * Stop the retry scheduler
 */
export function stopRetryScheduler(): void {
  if (retryIntervalId) {
    clearInterval(retryIntervalId);
    retryIntervalId = null;
    logger.info('Stopped', undefined, 'RetryScheduler');
  }
}

/**
 * Get retry queue status
 */
export async function getRetryQueueStatus(): Promise<{
  pendingRetries: number;
  campaigns: Array<{
    id: string;
    name: string;
    retryCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
  }>;
}> {
  const processingCampaigns = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      config: campaigns.config,
    })
    .from(campaigns)
    .where(eq(campaigns.status, 'processing'));

  return {
    pendingRetries: processingCampaigns.length,
    campaigns: processingCampaigns.map(c => {
      const config = (c.config as Record<string, any>) || {};
      return {
        id: c.id,
        name: c.name,
        retryCount: config.migrationRetryCount || 0,
        nextRetryAt: config.migrationNextRetryAt || null,
        lastError: config.migrationLastError || null,
      };
    }),
  };
}
