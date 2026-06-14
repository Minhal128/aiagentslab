'use strict';
/**
 * ============================================================
 * OpenAI Multi-Key Pool Service
 * 
 * Similar to ElevenLabsPoolService - manages multiple OpenAI API keys
 * with load balancing, health checks, and model tier restrictions.
 * ============================================================
 */

import { db } from "../../../db";
import { openaiCredentials, agents, users } from "@shared/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import type { InsertOpenaiCredential, OpenaiCredential } from "@shared/schema";
import type { ModelTier } from '../types';
import { NotificationService } from "../../../services/notification-service";

const lastNotificationThreshold = new Map<number, number>();

export class OpenAIPoolService {
  /**
   * Add a new OpenAI API key to the pool
   */
  static async addCredential(data: InsertOpenaiCredential): Promise<OpenaiCredential> {
    const isValid = await this.testCredential(data.apiKey);
    if (!isValid) {
      throw new Error('Invalid OpenAI API key');
    }

    const [credential] = await db
      .insert(openaiCredentials)
      .values({
        ...data,
        healthStatus: "healthy",
        lastHealthCheck: new Date(),
      })
      .returning();

    console.log(`✅ Added OpenAI credential: ${credential.name} (tier: ${credential.modelTier})`);
    return credential;
  }

  /**
   * Update an existing credential
   */
  static async updateCredential(
    id: string, 
    data: Partial<Pick<OpenaiCredential, 'name' | 'modelTier' | 'maxConcurrency' | 'maxAgentsThreshold' | 'isActive'>>
  ): Promise<OpenaiCredential> {
    const [updated] = await db
      .update(openaiCredentials)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(openaiCredentials.id, id))
      .returning();

    if (!updated) {
      throw new Error('Credential not found');
    }

    console.log(`✅ Updated OpenAI credential: ${updated.name}`);
    return updated;
  }

  /**
   * Test if an API key is valid by making a simple API call
   */
  static async testCredential(apiKey: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('❌ OpenAI API key test failed');
        return false;
      }

      console.log('✅ OpenAI API key validated');
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('❌ OpenAI API key test timed out after 15s');
      } else {
        console.error('❌ OpenAI API key test failed:', error);
      }
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get credential by ID
   */
  static async getCredentialById(credentialId: string): Promise<OpenaiCredential | null> {
    const [credential] = await db
      .select()
      .from(openaiCredentials)
      .where(eq(openaiCredentials.id, credentialId))
      .limit(1);

    return credential || null;
  }

  /**
   * Get the least-loaded active credential for a given model tier
   * Considers both current load and total assigned agents for optimal distribution
   */
  static async getLeastLoadedCredential(tier?: ModelTier): Promise<OpenaiCredential | null> {
    const baseConditions = [eq(openaiCredentials.isActive, true)];
    
    if (tier) {
      baseConditions.push(eq(openaiCredentials.modelTier, tier));
    }

    const credentials = await db
      .select()
      .from(openaiCredentials)
      .where(and(...baseConditions));

    if (credentials.length === 0) {
      return null;
    }

    const sorted = credentials
      .map((c) => ({
        ...c,
        utilization: c.maxConcurrency > 0 ? c.currentLoad / c.maxConcurrency : 0,
        agentDensity: c.totalAssignedAgents,
      }))
      .sort((a, b) => {
        if (Math.abs(a.utilization - b.utilization) > 0.1) {
          return a.utilization - b.utilization;
        }
        return a.agentDensity - b.agentDensity;
      });

    return sorted[0];
  }

  /**
   * Get credential for a specific agent (with load balancing fallback)
   */
  static async getCredentialForAgent(agentId: string): Promise<OpenaiCredential | null> {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agent?.openaiCredentialId) {
      const [credential] = await db
        .select()
        .from(openaiCredentials)
        .where(
          and(
            eq(openaiCredentials.id, agent.openaiCredentialId),
            eq(openaiCredentials.isActive, true)
          )
        )
        .limit(1);

      if (credential) {
        return credential;
      }
    }

    return this.getLeastLoadedCredential();
  }

  /**
   * Get credential with available capacity for making calls
   * Checks both current load, concurrency limit, and model tier
   */
  static async getAvailableCredential(tier?: ModelTier): Promise<OpenaiCredential | null> {
    const baseConditions = [eq(openaiCredentials.isActive, true)];
    
    if (tier) {
      baseConditions.push(eq(openaiCredentials.modelTier, tier));
    }

    const credentials = await db
      .select()
      .from(openaiCredentials)
      .where(and(...baseConditions))
      .orderBy(asc(openaiCredentials.currentLoad));

    for (const credential of credentials) {
      if (credential.currentLoad < credential.maxConcurrency) {
        return credential;
      }
    }

    return null;
  }

  /**
   * Atomically reserve a slot on the least-loaded credential with available capacity.
   * Uses a single UPDATE with WHERE condition to atomically find and reserve.
   * 
   * @param tier - Optional model tier to filter by ('free' or 'pro')
   * @returns The credential with reserved slot, or null if no capacity available
   */
  static async reserveSlot(tier?: ModelTier): Promise<OpenaiCredential | null> {
    try {
      let result;
      
      if (tier) {
        // Single atomic query: prefer matching tier, fall back to any tier
        // This prevents false "high demand" errors when credentials exist but under a different tier
        result = await db.execute(sql`
          UPDATE openai_credentials
          SET current_load = current_load + 1,
              updated_at = NOW()
          WHERE id = (
            SELECT id FROM openai_credentials
            WHERE is_active = true
              AND current_load < max_concurrency
            ORDER BY 
              CASE WHEN model_tier = ${tier} THEN 0 ELSE 1 END,
              (current_load::float / NULLIF(max_concurrency, 0)) ASC,
              total_assigned_agents ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *
        `);
      } else {
        result = await db.execute(sql`
          UPDATE openai_credentials
          SET current_load = current_load + 1,
              updated_at = NOW()
          WHERE id = (
            SELECT id FROM openai_credentials
            WHERE is_active = true
              AND current_load < max_concurrency
            ORDER BY 
              (current_load::float / NULLIF(max_concurrency, 0)) ASC,
              total_assigned_agents ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *
        `);
      }

      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0] as any;
        const tierMatch = tier && row.model_tier !== tier ? ` (fallback from '${tier}')` : '';
        console.log(`[OpenAI Pool] Reserved slot on ${row.name} (tier: ${row.model_tier}${tierMatch}, load: ${row.current_load}/${row.max_concurrency})`);
        
        return this.mapRowToCredential(row);
      }

      console.log(`[OpenAI Pool] No available capacity${tier ? ` for tier ${tier}` : ''} - all credentials at max load or none configured`);
      return null;
    } catch (error) {
      console.error(`[OpenAI Pool] Failed to reserve slot:`, error);
      return null;
    }
  }

  /**
   * Reserve a slot on a specific credential
   */
  static async reserveSlotOnCredential(credentialId: string): Promise<OpenaiCredential | null> {
    try {
      const result = await db.execute(sql`
        UPDATE openai_credentials
        SET current_load = current_load + 1,
            updated_at = NOW()
        WHERE id = ${credentialId}
          AND is_active = true
          AND current_load < max_concurrency
        RETURNING *
      `);

      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0] as any;
        console.log(`🔒 [OpenAI Pool] Reserved slot on ${row.name} (load: ${row.current_load}/${row.max_concurrency})`);
        return this.mapRowToCredential(row);
      }

      console.log(`⚠️ [OpenAI Pool] Credential ${credentialId} has no capacity or is inactive`);
      return null;
    } catch (error) {
      console.error(`❌ [OpenAI Pool] Failed to reserve slot on credential ${credentialId}:`, error);
      return null;
    }
  }

  /**
   * Release a slot when call ends
   */
  static async releaseSlot(credentialId: string): Promise<void> {
    await db
      .update(openaiCredentials)
      .set({
        currentLoad: sql`GREATEST(0, ${openaiCredentials.currentLoad} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(openaiCredentials.id, credentialId));
    
    console.log(`🔓 [OpenAI Pool] Released slot on credential ${credentialId}`);
  }

  /**
   * Update agent assignment count for a credential
   */
  static async updateAssignmentCount(credentialId: string, increment: boolean): Promise<void> {
    if (increment) {
      await db
        .update(openaiCredentials)
        .set({
          totalAssignedAgents: sql`${openaiCredentials.totalAssignedAgents} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(openaiCredentials.id, credentialId));
    } else {
      await db
        .update(openaiCredentials)
        .set({
          totalAssignedAgents: sql`GREATEST(0, ${openaiCredentials.totalAssignedAgents} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(openaiCredentials.id, credentialId));
    }
  }

  /**
   * Get all credentials with stats (sanitized - no API keys)
   */
  static async getAllWithStats() {
    const credentials = await db
      .select()
      .from(openaiCredentials)
      .orderBy(desc(openaiCredentials.createdAt));
    
    return credentials.map(({ apiKey, ...rest }) => rest);
  }

  /**
   * Get pool statistics with tier breakdown
   */
  static async getPoolStats(): Promise<{
    totalKeys: number;
    totalCapacity: number;
    totalLoad: number;
    availableCapacity: number;
    utilizationPercent: number;
    totalAgents: number;
    totalUsers: number;
    byTier: Record<ModelTier, { keys: number; capacity: number; load: number; available: number }>;
    credentials: Array<{
      id: string;
      name: string;
      modelTier: string;
      maxConcurrency: number;
      currentLoad: number;
      totalAssignedAgents: number;
      totalAssignedUsers: number;
      maxAgentsThreshold: number;
      utilizationPercent: number;
      healthStatus: string;
      isActive: boolean;
    }>;
  }> {
    const credentials = await db
      .select()
      .from(openaiCredentials)
      .where(eq(openaiCredentials.isActive, true));

    const totalCapacity = credentials.reduce((sum, c) => sum + c.maxConcurrency, 0);
    const totalLoad = credentials.reduce((sum, c) => sum + c.currentLoad, 0);
    const totalAgents = credentials.reduce((sum, c) => sum + c.totalAssignedAgents, 0);
    const totalUsers = credentials.reduce((sum, c) => sum + c.totalAssignedUsers, 0);
    const availableCapacity = totalCapacity - totalLoad;
    const utilizationPercent = totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0;

    const freeCredentials = credentials.filter(c => c.modelTier === 'free');
    const proCredentials = credentials.filter(c => c.modelTier === 'pro');

    const byTier: Record<ModelTier, { keys: number; capacity: number; load: number; available: number }> = {
      free: {
        keys: freeCredentials.length,
        capacity: freeCredentials.reduce((sum, c) => sum + c.maxConcurrency, 0),
        load: freeCredentials.reduce((sum, c) => sum + c.currentLoad, 0),
        available: freeCredentials.reduce((sum, c) => sum + (c.maxConcurrency - c.currentLoad), 0),
      },
      pro: {
        keys: proCredentials.length,
        capacity: proCredentials.reduce((sum, c) => sum + c.maxConcurrency, 0),
        load: proCredentials.reduce((sum, c) => sum + c.currentLoad, 0),
        available: proCredentials.reduce((sum, c) => sum + (c.maxConcurrency - c.currentLoad), 0),
      },
    };

    await this.checkCapacityAndNotify(utilizationPercent);

    return {
      totalKeys: credentials.length,
      totalCapacity,
      totalLoad,
      availableCapacity,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      totalAgents,
      totalUsers,
      byTier,
      credentials: credentials.map((c) => ({
        id: c.id,
        name: c.name,
        modelTier: c.modelTier,
        maxConcurrency: c.maxConcurrency,
        currentLoad: c.currentLoad,
        totalAssignedAgents: c.totalAssignedAgents,
        totalAssignedUsers: c.totalAssignedUsers,
        maxAgentsThreshold: c.maxAgentsThreshold,
        utilizationPercent:
          c.maxConcurrency > 0 ? Math.round((c.currentLoad / c.maxConcurrency) * 10000) / 100 : 0,
        healthStatus: c.healthStatus,
        isActive: c.isActive,
      })),
    };
  }

  /**
   * Check capacity and send notifications to admins if needed (throttled)
   */
  private static async checkCapacityAndNotify(utilizationPercent: number): Promise<void> {
    const now = Date.now();
    const THROTTLE_PERIOD = 4 * 60 * 60 * 1000; // 4 hours

    let threshold = 0;
    if (utilizationPercent >= 95) {
      threshold = 95;
    } else if (utilizationPercent >= 90) {
      threshold = 90;
    } else if (utilizationPercent >= 80) {
      threshold = 80;
    }

    if (threshold === 0) {
      lastNotificationThreshold.clear();
      return;
    }

    const lastSent = lastNotificationThreshold.get(threshold);
    if (lastSent && now - lastSent < THROTTLE_PERIOD) {
      return;
    }

    if (threshold === 95) {
      await NotificationService.createNotificationForAllAdmins({
        type: "system",
        title: "CRITICAL: OpenAI Pool at 95%+ Capacity",
        message: `The OpenAI API key pool is at ${utilizationPercent.toFixed(1)}% capacity. Add more API keys immediately to prevent service disruption.`,
        link: "/admin/openai-pool",
      });
      lastNotificationThreshold.set(95, now);
    } else if (threshold === 90) {
      await NotificationService.createNotificationForAllAdmins({
        type: "system",
        title: "WARNING: OpenAI Pool at 90%+ Capacity",
        message: `The OpenAI API key pool is at ${utilizationPercent.toFixed(1)}% capacity. Consider adding more API keys soon.`,
        link: "/admin/openai-pool",
      });
      lastNotificationThreshold.set(90, now);
    } else if (threshold === 80) {
      await NotificationService.createNotificationForAllAdmins({
        type: "system",
        title: "Notice: OpenAI Pool at 80%+ Capacity",
        message: `The OpenAI API key pool is at ${utilizationPercent.toFixed(1)}% capacity. Monitor usage and plan to add more keys if needed.`,
        link: "/admin/openai-pool",
      });
      lastNotificationThreshold.set(80, now);
    }
  }

  /**
   * Deactivate a credential
   */
  static async deactivateCredential(id: string): Promise<void> {
    await db
      .update(openaiCredentials)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(openaiCredentials.id, id));
  }

  /**
   * Activate a credential
   */
  static async activateCredential(id: string): Promise<void> {
    await db
      .update(openaiCredentials)
      .set({
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(openaiCredentials.id, id));
  }

  /**
   * Delete a credential (only if no agents are using it)
   */
  static async deleteCredential(id: string): Promise<void> {
    const [credential] = await db
      .select()
      .from(openaiCredentials)
      .where(eq(openaiCredentials.id, id))
      .limit(1);

    if (!credential) {
      throw new Error("Credential not found");
    }

    if (credential.totalAssignedAgents > 0) {
      throw new Error(`Cannot delete credential. ${credential.totalAssignedAgents} agents are still using it.`);
    }

    await db.delete(openaiCredentials).where(eq(openaiCredentials.id, id));
    console.log(`🗑️ [OpenAI Pool] Deleted credential: ${credential.name}`);
  }

  /**
   * Perform health check on all credentials
   */
  static async performHealthChecks(): Promise<void> {
    const credentials = await db.select().from(openaiCredentials);

    for (const credential of credentials) {
      const isHealthy = await this.testCredential(credential.apiKey);
      await db
        .update(openaiCredentials)
        .set({
          healthStatus: isHealthy ? "healthy" : "unhealthy",
          lastHealthCheck: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(openaiCredentials.id, credential.id));
    }

    console.log(`🏥 [OpenAI Pool] Health checks completed for ${credentials.length} credentials`);
  }

  /**
   * Recalculate agent counts for all credentials based on actual agents in database
   */
  static async recalculateAgentCounts(): Promise<{ 
    updated: number; 
    credentials: Array<{ id: string; name: string; oldCount: number; newCount: number }> 
  }> {
    const credentials = await db.select().from(openaiCredentials);
    const updates: Array<{ id: string; name: string; oldCount: number; newCount: number }> = [];
    
    for (const credential of credentials) {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(eq(agents.openaiCredentialId, credential.id));
      
      const actualCount = result?.count || 0;
      const oldCount = credential.totalAssignedAgents;
      
      if (actualCount !== oldCount) {
        await db
          .update(openaiCredentials)
          .set({
            totalAssignedAgents: actualCount,
            updatedAt: new Date(),
          })
          .where(eq(openaiCredentials.id, credential.id));
        
        updates.push({
          id: credential.id,
          name: credential.name,
          oldCount,
          newCount: actualCount,
        });
        
        console.log(`🔄 [OpenAI Pool] Recalculated ${credential.name}: ${oldCount} → ${actualCount} agents`);
      }
    }
    
    return {
      updated: updates.length,
      credentials: updates,
    };
  }

  /**
   * Get or assign a credential for a user based on their plan
   * Free plan users get 'free' tier, Pro plan users get 'pro' tier
   */
  static async getOrAssignCredentialForUser(
    userId: string,
    requiredTier: ModelTier = 'free'
  ): Promise<OpenaiCredential | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return null;
    }

    const credential = await this.getLeastLoadedCredential(requiredTier);
    
    if (credential) {
      await db
        .update(openaiCredentials)
        .set({
          totalAssignedUsers: sql`${openaiCredentials.totalAssignedUsers} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(openaiCredentials.id, credential.id));
    }

    return credential;
  }

  /**
   * Get model tier for user based on subscription
   */
  static getModelTierForUser(subscriptionPlan: string | null): ModelTier {
    if (!subscriptionPlan) return 'free';
    
    const plan = subscriptionPlan.toLowerCase();
    if (plan === 'pro' || plan === 'enterprise' || plan === 'premium') {
      return 'pro';
    }
    return 'free';
  }

  /**
   * Get available models for a tier
   */
  static getModelsForTier(tier: ModelTier): string[] {
    if (tier === 'pro') {
      return ['gpt-realtime-2', 'gpt-realtime-translate', 'gpt-realtime-whisper', 'gpt-realtime-1.5', 'gpt-realtime', 'gpt-realtime-mini', 'gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview'];
    }
    return ['gpt-realtime-mini', 'gpt-4o-mini-realtime-preview'];
  }

  /**
   * Map database row to TypeScript OpenaiCredential type
   */
  private static mapRowToCredential(row: any): OpenaiCredential {
    return {
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      modelTier: row.model_tier,
      maxConcurrency: row.max_concurrency,
      currentLoad: row.current_load,
      totalAssignedAgents: row.total_assigned_agents,
      totalAssignedUsers: row.total_assigned_users,
      maxAgentsThreshold: row.max_agents_threshold,
      isActive: row.is_active,
      healthStatus: row.health_status,
      lastHealthCheck: row.last_health_check ? new Date(row.last_health_check) : null,
      metadata: row.metadata,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }
}
