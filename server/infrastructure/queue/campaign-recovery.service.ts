/**
 * Campaign Recovery Service
 * 
 * Handles recovery of incomplete campaigns on server startup.
 * Resets stuck 'processing' jobs back to 'pending' for retry.
 */

import { db } from '../../db';
import { campaignJobs, campaigns } from '@shared/schema';
import { eq, and, inArray, or } from 'drizzle-orm';
import { logger } from '../../utils/logger';

const SOURCE = 'Campaign Recovery';

export class CampaignRecoveryService {
  private static lastRecoveryTime: Date | null = null;
  private static recoveredCampaigns: number = 0;
  private static resetJobs: number = 0;

  static async recoverIncompleteCampaigns(): Promise<void> {
    logger.info('[Campaign Recovery] Starting recovery check...', undefined, SOURCE);

    try {
      const runningCampaigns = await db
        .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
        .from(campaigns)
        .where(or(eq(campaigns.status, 'running'), eq(campaigns.status, 'in_progress')));

      if (runningCampaigns.length === 0) {
        logger.info('[Campaign Recovery] No running campaigns found, skipping recovery', undefined, SOURCE);
        this.lastRecoveryTime = new Date();
        return;
      }

      logger.info(`[Campaign Recovery] Found ${runningCampaigns.length} running campaign(s)`, undefined, SOURCE);

      const campaignIds = runningCampaigns.map(c => c.id);

      const stuckJobs = await db
        .select()
        .from(campaignJobs)
        .where(
          and(
            inArray(campaignJobs.campaignId, campaignIds),
            or(eq(campaignJobs.status, 'processing'), eq(campaignJobs.status, 'pending'))
          )
        );

      const processingJobs = stuckJobs.filter(j => j.status === 'processing');
      const pendingJobs = stuckJobs.filter(j => j.status === 'pending');

      logger.info(`[Campaign Recovery] Found ${processingJobs.length} stuck processing job(s) and ${pendingJobs.length} pending job(s)`, undefined, SOURCE);

      let resetCount = 0;
      if (processingJobs.length > 0) {
        const processingJobIds = processingJobs.map(j => j.id);
        
        await db
          .update(campaignJobs)
          .set({ 
            status: 'pending',
            workerId: null,
            processedAt: null
          })
          .where(inArray(campaignJobs.id, processingJobIds));

        resetCount = processingJobs.length;
        logger.info(`[Campaign Recovery] Reset ${resetCount} processing job(s) to pending`, undefined, SOURCE);
      }

      const affectedCampaignIds = new Set(stuckJobs.map(j => j.campaignId));

      this.recoveredCampaigns = affectedCampaignIds.size;
      this.resetJobs = resetCount;
      this.lastRecoveryTime = new Date();

      logger.info(
        `[Campaign Recovery] Recovery complete - Campaigns: ${this.recoveredCampaigns}, Jobs reset: ${this.resetJobs}`,
        undefined,
        SOURCE
      );

      for (const campaign of runningCampaigns) {
        const campaignJobCount = stuckJobs.filter(j => j.campaignId === campaign.id).length;
        if (campaignJobCount > 0) {
          logger.info(
            `[Campaign Recovery] Campaign "${campaign.name}" (${campaign.id}): ${campaignJobCount} job(s) recovered`,
            undefined,
            SOURCE
          );
        }
      }

    } catch (error) {
      logger.error(
        `[Campaign Recovery] Error during recovery: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        SOURCE
      );
      throw error;
    }
  }

  static getRecoveryStats() {
    return {
      recoveredCampaigns: this.recoveredCampaigns,
      resetJobs: this.resetJobs,
      lastRecoveryTime: this.lastRecoveryTime
    };
  }
}

export const campaignRecoveryService = new CampaignRecoveryService();
