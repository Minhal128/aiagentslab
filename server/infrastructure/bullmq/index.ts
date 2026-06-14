'use strict';
/**
 * ============================================================
 * BullMQ Infrastructure Module
 * 
 * Isolated, opt-in job queue system for campaign processing.
 * Enable by setting ENABLE_BULLMQ=true and REDIS_URL env vars.
 * ============================================================
 */

export * from './redis-connection';
export * from './queues';
export * from './call-worker';
export * from './scheduler-worker';
export * from './campaign-queue-bridge';

import { getRedisConnection, closeRedisConnection, isRedisAvailable, getRedisHealthStatus } from './redis-connection';
import { closeAllQueues, getCampaignCallsQueue, getCampaignSchedulerQueue, getCampaignRecoveryQueue, addCampaignCallJobs, getQueueStats, QUEUE_NAMES, CampaignCallJob } from './queues';
import { startCallWorker, stopCallWorker, getCallWorker } from './call-worker';
import { startSchedulerWorker, startRecoveryWorker, setupRecurringJobs, stopSchedulerWorkers } from './scheduler-worker';

let isInitialized = false;

export function isBullMQEnabled(): boolean {
  return process.env.ENABLE_BULLMQ === 'true' && !!process.env.REDIS_URL;
}

export async function initializeBullMQ(): Promise<boolean> {
  if (!isBullMQEnabled()) {
    console.log('[BullMQ] Disabled (set ENABLE_BULLMQ=true and REDIS_URL to enable)');
    return false;
  }
  
  if (isInitialized) {
    console.log('[BullMQ] Already initialized');
    return true;
  }
  
  try {
    console.log('[BullMQ] Initializing...');
    
    getRedisConnection();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (!isRedisAvailable()) {
      console.warn('[BullMQ] Redis not ready, initialization deferred');
      return false;
    }
    
    startCallWorker();
    startSchedulerWorker();
    startRecoveryWorker();
    
    await setupRecurringJobs();
    
    isInitialized = true;
    console.log('[BullMQ] Initialization complete');
    return true;
    
  } catch (error: any) {
    console.error('[BullMQ] Initialization failed:', error.message);
    return false;
  }
}

export async function shutdownBullMQ(): Promise<void> {
  if (!isInitialized) {
    return;
  }
  
  console.log('[BullMQ] Shutting down...');
  
  try {
    await stopCallWorker();
    await stopSchedulerWorkers();
    await closeAllQueues();
    await closeRedisConnection();
    
    isInitialized = false;
    console.log('[BullMQ] Shutdown complete');
  } catch (error: any) {
    console.error('[BullMQ] Shutdown error:', error.message);
  }
}

export async function addCallsToQueue(jobs: CampaignCallJob[]): Promise<void> {
  if (!isBullMQEnabled()) {
    throw new Error('BullMQ is not enabled');
  }
  
  await addCampaignCallJobs(jobs);
}

export async function getCampaignQueueStats(): Promise<{
  calls: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  scheduler: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  recovery: { waiting: number; active: number; completed: number; failed: number; delayed: number };
}> {
  const [calls, scheduler, recovery] = await Promise.all([
    getQueueStats(QUEUE_NAMES.CAMPAIGN_CALLS),
    getQueueStats(QUEUE_NAMES.CAMPAIGN_SCHEDULER),
    getQueueStats(QUEUE_NAMES.CAMPAIGN_RECOVERY),
  ]);
  
  return { calls, scheduler, recovery };
}

export function getBullMQStatus(): {
  enabled: boolean;
  initialized: boolean;
  redisConnected: boolean;
  redisHealth: ReturnType<typeof getRedisHealthStatus>;
  workers: {
    call: boolean;
    scheduler: boolean;
  };
} {
  return {
    enabled: isBullMQEnabled(),
    initialized: isInitialized,
    redisConnected: isRedisAvailable(),
    redisHealth: getRedisHealthStatus(),
    workers: {
      call: !!getCallWorker(),
      scheduler: true,
    },
  };
}
