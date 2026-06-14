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
import { db } from "../db";
import { elevenLabsCredentials, agents, incomingAgents, phoneNumbers, users } from "@shared/schema";
import { eq, and, desc, asc, sql, isNull, notInArray, or } from "drizzle-orm";
import type { InsertElevenLabsCredential, ElevenLabsCredential } from "@shared/schema";
import { ElevenLabsService } from "./elevenlabs";
import { NotificationService } from "./notification-service";
import { getCorrelationHeaders } from "../middleware/correlation-id";

// Track last notification sent for each threshold to prevent flooding
const lastNotificationThreshold = new Map<number, number>();

export class ElevenLabsPoolService {
  /**
   * Add a new ElevenLabs API key to the pool
   */
  static async addCredential(data: InsertElevenLabsCredential): Promise<ElevenLabsCredential> {
    // Test the API key first
    const isValid = await this.testCredential(data.apiKey);
    if (!isValid) {
      throw new Error("Invalid ElevenLabs API key");
    }

    const [credential] = await db
      .insert(elevenLabsCredentials)
      .values({
        ...data,
        healthStatus: "healthy",
        lastHealthCheck: new Date(),
      })
      .returning();

    console.log(`✅ Added ElevenLabs credential: ${credential.name}`);
    return credential;
  }

  /**
   * Test if an API key is valid
   * Tests both v2 voices endpoint and v1 agents endpoint
   */
  static async testCredential(apiKey: string): Promise<boolean> {
    // Create AbortController for timeout (15 seconds for simple validation)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      // Test v2 voices endpoint
      const voicesResponse = await fetch("https://api.elevenlabs.io/v2/voices?page_size=10", {
        signal: controller.signal,
        headers: {
          "xi-api-key": apiKey,
          ...getCorrelationHeaders(), // Propagate correlation ID for distributed tracing
        },
      });
      
      if (!voicesResponse.ok) {
        console.error("❌ ElevenLabs v2 voices API test failed");
        return false;
      }
      
      // Test v1 agents endpoint
      const agentsResponse = await fetch("https://api.elevenlabs.io/v1/convai/agents", {
        signal: controller.signal,
        headers: {
          "xi-api-key": apiKey,
          ...getCorrelationHeaders(), // Propagate correlation ID for distributed tracing
        },
      });
      
      if (!agentsResponse.ok) {
        console.error("❌ ElevenLabs v1 agents API test failed");
        return false;
      }
      
      console.log("✅ ElevenLabs API key validated (v2 voices + v1 agents)");
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("❌ ElevenLabs API key test timed out after 15s");
      } else {
        console.error("❌ ElevenLabs API key test failed:", error);
      }
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get the least-loaded active credential for auto-assignment
   * Considers both current load and total assigned agents for optimal distribution
   */
  static async getLeastLoadedCredential(): Promise<ElevenLabsCredential | null> {
    const credentials = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.isActive, true));

    if (credentials.length === 0) {
      return null;
    }

    // Calculate utilization for each key and sort by lowest utilization
    const sorted = credentials
      .map((c) => ({
        ...c,
        utilization: c.maxConcurrency > 0 ? c.currentLoad / c.maxConcurrency : 0,
        agentDensity: c.totalAssignedAgents,
      }))
      .sort((a, b) => {
        // First priority: utilization (current load)
        if (Math.abs(a.utilization - b.utilization) > 0.1) {
          return a.utilization - b.utilization;
        }
        // Second priority: total assigned agents (for long-term distribution)
        return a.agentDensity - b.agentDensity;
      });

    return sorted[0];
  }

  /**
   * Get the least-loaded active credential with row locking for concurrent use
   * Uses FOR UPDATE SKIP LOCKED to prevent race conditions in credential selection
   * @param transaction - The transaction context to use for the query
   */
  static async getLeastLoadedCredentialWithLock(transaction: { execute: typeof db.execute }): Promise<ElevenLabsCredential | null> {
    // Use raw SQL for FOR UPDATE SKIP LOCKED which isn't natively supported by Drizzle
    const result = await transaction.execute(
      sql`SELECT * FROM ${elevenLabsCredentials} 
          WHERE ${elevenLabsCredentials.isActive} = true 
          ORDER BY 
            CASE WHEN ${elevenLabsCredentials.maxConcurrency} > 0 
              THEN ${elevenLabsCredentials.currentLoad}::float / ${elevenLabsCredentials.maxConcurrency}::float 
              ELSE 0 
            END ASC,
            ${elevenLabsCredentials.totalAssignedAgents} ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`
    );
    
    if (!result.rows || result.rows.length === 0) {
      return null;
    }
    
    // Map the raw row to the credential type
    const row = result.rows[0] as any;
    return {
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      webhookSecret: row.webhook_secret || null,
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

  /**
   * Get credential by ID
   */
  static async getCredentialById(credentialId: string): Promise<ElevenLabsCredential | null> {
    const [credential] = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.id, credentialId))
      .limit(1);

    return credential || null;
  }

  /**
   * Get credential for a specific agent (with load balancing fallback)
   */
  static async getCredentialForAgent(agentId: string): Promise<ElevenLabsCredential | null> {
    // First try to get the agent's assigned credential
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agent?.elevenLabsCredentialId) {
      const [credential] = await db
        .select()
        .from(elevenLabsCredentials)
        .where(
          and(
            eq(elevenLabsCredentials.id, agent.elevenLabsCredentialId),
            eq(elevenLabsCredentials.isActive, true)
          )
        )
        .limit(1);

      if (credential) {
        return credential;
      }
    }

    // Fallback: get least loaded credential
    return this.getLeastLoadedCredential();
  }

  /**
   * Get credential with available capacity for making calls
   * Checks both current load and concurrency limit
   * 
   * NOTE: This is a READ-ONLY check. For starting calls, use reserveSlot()
   * which atomically checks AND reserves in one operation to prevent race conditions.
   */
  static async getAvailableCredential(): Promise<ElevenLabsCredential | null> {
    const credentials = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.isActive, true))
      .orderBy(asc(elevenLabsCredentials.currentLoad));

    // Find first credential with available capacity
    for (const credential of credentials) {
      if (credential.currentLoad < credential.maxConcurrency) {
        return credential;
      }
    }

    // No capacity available
    return null;
  }

  /**
   * Atomically reserve a slot on the least-loaded credential with available capacity.
   * This prevents race conditions where multiple concurrent requests could exceed limits.
   * 
   * Uses a single UPDATE with WHERE condition to atomically:
   * 1. Find a credential with current_load < max_concurrency
   * 2. Increment current_load by 1
   * 3. Return the updated credential
   * 
   * @returns The credential with reserved slot, or null if no capacity available
   */
  static async reserveSlot(): Promise<ElevenLabsCredential | null> {
    try {
      // Use raw SQL for atomic UPDATE with subquery selection
      // This finds the least-loaded credential with capacity and reserves a slot in one operation
      const result = await db.execute(sql`
        UPDATE eleven_labs_credentials
        SET current_load = current_load + 1,
            updated_at = NOW()
        WHERE id = (
          SELECT id FROM eleven_labs_credentials
          WHERE is_active = true
            AND current_load < max_concurrency
          ORDER BY current_load ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `);

      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0] as any;
        console.log(`🔒 [Pool] Reserved slot on credential ${row.name} (load: ${row.current_load}/${row.max_concurrency})`);
        
        // Map snake_case DB columns to camelCase for TypeScript
        return {
          id: row.id,
          name: row.name,
          apiKey: row.api_key,
          maxConcurrency: row.max_concurrency,
          currentLoad: row.current_load,
          totalAssignedAgents: row.total_assigned_agents,
          totalAssignedUsers: row.total_assigned_users,
          maxAgentsThreshold: row.max_agents_threshold,
          isActive: row.is_active,
          healthStatus: row.health_status,
          lastHealthCheck: row.last_health_check ? new Date(row.last_health_check) : null,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
        } as ElevenLabsCredential;
      }

      console.log(`⚠️ [Pool] No available capacity - all credentials at max load`);
      return null;
    } catch (error) {
      console.error(`❌ [Pool] Failed to reserve slot:`, error);
      return null;
    }
  }

  /**
   * Reserve a slot on a specific credential (for agent-assigned calls)
   * Atomically checks capacity and increments load
   * 
   * @param credentialId - The specific credential to reserve on
   * @returns The credential with reserved slot, or null if no capacity
   */
  static async reserveSlotOnCredential(credentialId: string): Promise<ElevenLabsCredential | null> {
    try {
      const result = await db.execute(sql`
        UPDATE eleven_labs_credentials
        SET current_load = current_load + 1,
            updated_at = NOW()
        WHERE id = ${credentialId}
          AND is_active = true
          AND current_load < max_concurrency
        RETURNING *
      `);

      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0] as any;
        console.log(`🔒 [Pool] Reserved slot on credential ${row.name} (load: ${row.current_load}/${row.max_concurrency})`);
        
        return {
          id: row.id,
          name: row.name,
          apiKey: row.api_key,
          maxConcurrency: row.max_concurrency,
          currentLoad: row.current_load,
          totalAssignedAgents: row.total_assigned_agents,
          totalAssignedUsers: row.total_assigned_users,
          maxAgentsThreshold: row.max_agents_threshold,
          isActive: row.is_active,
          healthStatus: row.health_status,
          lastHealthCheck: row.last_health_check ? new Date(row.last_health_check) : null,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
        } as ElevenLabsCredential;
      }

      console.log(`⚠️ [Pool] Credential ${credentialId} has no capacity or is inactive`);
      return null;
    } catch (error) {
      console.error(`❌ [Pool] Failed to reserve slot on credential ${credentialId}:`, error);
      return null;
    }
  }

  /**
   * Increment current load for a credential (when starting a call)
   * @deprecated Use reserveSlot() or reserveSlotOnCredential() for atomic reservation
   */
  static async incrementLoad(credentialId: string): Promise<void> {
    await db
      .update(elevenLabsCredentials)
      .set({
        currentLoad: sql`${elevenLabsCredentials.currentLoad} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(elevenLabsCredentials.id, credentialId));
  }

  /**
   * Decrement current load for a credential (when call ends)
   * Uses GREATEST(0, ...) to prevent negative counts
   */
  static async decrementLoad(credentialId: string): Promise<void> {
    await db
      .update(elevenLabsCredentials)
      .set({
        currentLoad: sql`GREATEST(0, ${elevenLabsCredentials.currentLoad} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(elevenLabsCredentials.id, credentialId));
  }

  /**
   * Release a slot (alias for decrementLoad for clarity)
   * Should be called in finally block after reserveSlot/reserveSlotOnCredential
   */
  static async releaseSlot(credentialId: string): Promise<void> {
    await this.decrementLoad(credentialId);
    console.log(`🔓 [Pool] Released slot on credential ${credentialId}`);
  }

  /**
   * Update agent assignment count for a credential
   * Uses GREATEST(0, ...) to prevent negative counts on repeated decrements
   * @param credentialId - The credential to update
   * @param increment - True to increment, false to decrement
   * @param transaction - Optional transaction context for atomic operations
   */
  static async updateAssignmentCount(credentialId: string, increment: boolean, transaction?: typeof db): Promise<void> {
    const dbContext = transaction || db;
    if (increment) {
      await dbContext
        .update(elevenLabsCredentials)
        .set({
          totalAssignedAgents: sql`${elevenLabsCredentials.totalAssignedAgents} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(elevenLabsCredentials.id, credentialId));
    } else {
      // Use GREATEST to ensure count never goes below zero
      await dbContext
        .update(elevenLabsCredentials)
        .set({
          totalAssignedAgents: sql`GREATEST(0, ${elevenLabsCredentials.totalAssignedAgents} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(elevenLabsCredentials.id, credentialId));
    }
  }

  /**
   * Get all credentials with stats (sanitized - no API keys or secrets)
   */
  static async getAllWithStats() {
    const credentials = await db.select().from(elevenLabsCredentials).orderBy(desc(elevenLabsCredentials.createdAt));
    
    // Remove API keys and webhook secrets from response for security
    return credentials.map(({ apiKey, webhookSecret, ...rest }) => ({
      ...rest,
      hasWebhookSecret: !!webhookSecret,
    }));
  }

  /**
   * Get pool capacity statistics and check for capacity warnings
   */
  static async getPoolStats() {
    const credentials = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.isActive, true));

    const totalCapacity = credentials.reduce((sum: number, c) => sum + c.maxConcurrency, 0);
    const totalLoad = credentials.reduce((sum: number, c) => sum + c.currentLoad, 0);
    const totalAgents = credentials.reduce((sum: number, c) => sum + c.totalAssignedAgents, 0);
    const totalUsers = credentials.reduce((sum: number, c) => sum + c.totalAssignedUsers, 0);
    const availableCapacity = totalCapacity - totalLoad;
    const utilizationPercent = totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0;

    // Proactively check capacity and notify admins if needed
    await this.checkCapacityAndNotify(utilizationPercent);

    return {
      totalKeys: credentials.length,
      totalCapacity,
      totalLoad,
      availableCapacity,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      totalAgents,
      totalUsers,
      credentials: credentials.map((c: ElevenLabsCredential) => ({
        id: c.id,
        name: c.name,
        maxConcurrency: c.maxConcurrency,
        currentLoad: c.currentLoad,
        totalAssignedAgents: c.totalAssignedAgents,
        totalAssignedUsers: c.totalAssignedUsers,
        maxAgentsThreshold: c.maxAgentsThreshold,
        agentFillPercent: c.maxAgentsThreshold > 0 
          ? Math.round((c.totalAssignedAgents / c.maxAgentsThreshold) * 10000) / 100 
          : 0,
        utilizationPercent:
          c.maxConcurrency > 0 ? Math.round((c.currentLoad / c.maxConcurrency) * 10000) / 100 : 0,
        healthStatus: c.healthStatus,
        isActive: c.isActive,
        hasWebhookSecret: !!c.webhookSecret,
      })),
    };
  }

  /**
   * Check capacity and send notifications to admins if needed (throttled to prevent flooding)
   */
  private static async checkCapacityAndNotify(utilizationPercent: number): Promise<void> {
    const now = Date.now();
    const THROTTLE_PERIOD = 4 * 60 * 60 * 1000; // 4 hours

    // Determine which threshold we're at
    let threshold = 0;
    if (utilizationPercent >= 95) {
      threshold = 95;
    } else if (utilizationPercent >= 90) {
      threshold = 90;
    } else if (utilizationPercent >= 80) {
      threshold = 80;
    }

    // If no threshold crossed, reset and return
    if (threshold === 0) {
      lastNotificationThreshold.clear();
      return;
    }

    // Check if we've already sent a notification for this threshold recently
    const lastSent = lastNotificationThreshold.get(threshold);
    if (lastSent && now - lastSent < THROTTLE_PERIOD) {
      return; // Throttle - don't send duplicate notification
    }

    // Send notification based on threshold
    if (threshold === 95) {
      await NotificationService.createNotificationForAllAdmins({
        type: "system",
        title: "CRITICAL: ElevenLabs Pool at 95%+ Capacity",
        message: `The ElevenLabs API key pool is at ${utilizationPercent.toFixed(1)}% capacity. Add more API keys immediately to prevent service disruption.`,
        link: "/admin/elevenlabs-pool",
      });
      lastNotificationThreshold.set(95, now);
    } else if (threshold === 90) {
      await NotificationService.createNotificationForAllAdmins({
        type: "system",
        title: "WARNING: ElevenLabs Pool at 90%+ Capacity",
        message: `The ElevenLabs API key pool is at ${utilizationPercent.toFixed(1)}% capacity. Consider adding more API keys soon.`,
        link: "/admin/elevenlabs-pool",
      });
      lastNotificationThreshold.set(90, now);
    } else if (threshold === 80) {
      await NotificationService.createNotificationForAllAdmins({
        type: "system",
        title: "Notice: ElevenLabs Pool at 80%+ Capacity",
        message: `The ElevenLabs API key pool is at ${utilizationPercent.toFixed(1)}% capacity. Monitor usage and plan to add more keys if needed.`,
        link: "/admin/elevenlabs-pool",
      });
      lastNotificationThreshold.set(80, now);
    }
  }

  /**
   * Deactivate a credential
   */
  static async deactivateCredential(id: string): Promise<void> {
    await db
      .update(elevenLabsCredentials)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(elevenLabsCredentials.id, id));
  }

  /**
   * Delete a credential - reassigns agents to remaining active credentials, then deletes.
   * If no other active credentials exist, agents are set to null as a fallback.
   */
  static async deleteCredential(id: string): Promise<{ unassignedAgents: number; unassignedPhoneNumbers: number; reassignedTo: string | null; autoReassigned: boolean }> {
    const [credential] = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.id, id))
      .limit(1);

    if (!credential) {
      throw new Error("Credential not found");
    }

    const remainingActive = await db
      .select()
      .from(elevenLabsCredentials)
      .where(sql`${elevenLabsCredentials.isActive} = true AND ${elevenLabsCredentials.id} != ${id}`);

    const orphanedRegularAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.elevenLabsCredentialId, id));

    const orphanedIncomingAgentsList = await db
      .select({ id: incomingAgents.id })
      .from(incomingAgents)
      .where(eq(incomingAgents.elevenLabsCredentialId, id));

    const totalOrphaned = orphanedRegularAgents.length + orphanedIncomingAgentsList.length;
    let reassignedTo: string | null = null;
    let autoReassigned = false;

    if (remainingActive.length > 0 && totalOrphaned > 0) {
      const allOrphans: Array<{ id: string; table: 'agents' | 'incomingAgents' }> = [
        ...orphanedRegularAgents.map(a => ({ id: a.id, table: 'agents' as const })),
        ...orphanedIncomingAgentsList.map(a => ({ id: a.id, table: 'incomingAgents' as const })),
      ];

      const remainingIds = remainingActive.map(c => c.id);

      for (let i = 0; i < allOrphans.length; i++) {
        const targetId = remainingIds[i % remainingIds.length];
        const orphan = allOrphans[i];

        if (orphan.table === 'agents') {
          await db.update(agents)
            .set({ elevenLabsCredentialId: targetId })
            .where(eq(agents.id, orphan.id));
        } else {
          await db.update(incomingAgents)
            .set({ elevenLabsCredentialId: targetId })
            .where(eq(incomingAgents.id, orphan.id));
        }
      }

      reassignedTo = remainingIds.length === 1 ? remainingIds[0] : null;
      autoReassigned = true;
      console.log(`[ElevenLabs Pool] Reassigned ${totalOrphaned} agents from deleted credential to ${remainingIds.length} remaining credential(s)`);
    } else if (totalOrphaned > 0) {
      await db.update(agents)
        .set({ elevenLabsCredentialId: null })
        .where(eq(agents.elevenLabsCredentialId, id));

      await db.update(incomingAgents)
        .set({ elevenLabsCredentialId: null })
        .where(eq(incomingAgents.elevenLabsCredentialId, id));

      console.log(`[ElevenLabs Pool] No remaining active credentials - ${totalOrphaned} agents unassigned`);
    }

    await db.update(phoneNumbers)
      .set({ elevenLabsCredentialId: null })
      .where(eq(phoneNumbers.elevenLabsCredentialId, id));

    await db.delete(elevenLabsCredentials).where(eq(elevenLabsCredentials.id, id));

    await this.recalculateAgentCounts();

    console.log(`[ElevenLabs Pool] Deleted credential: ${credential.name}`);

    return { 
      unassignedAgents: totalOrphaned,
      unassignedPhoneNumbers: 0,
      reassignedTo,
      autoReassigned,
    };
  }

  /**
   * Perform health check on all credentials
   */
  static async performHealthChecks(): Promise<void> {
    const credentials = await db.select().from(elevenLabsCredentials);

    for (const credential of credentials) {
      const isHealthy = await this.testCredential(credential.apiKey);
      await db
        .update(elevenLabsCredentials)
        .set({
          healthStatus: isHealthy ? "healthy" : "unhealthy",
          lastHealthCheck: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(elevenLabsCredentials.id, credential.id));
    }
  }

  /**
   * Sync ALL ElevenLabs agents across active credentials using round-robin balancing.
   * This handles every scenario:
   * - Agents with no credential (NULL) → assigned to active key
   * - Agents on inactive/deleted credentials → moved to active key
   * - Agents already on active credentials → redistributed for balance
   * Also syncs incoming agents the same way.
   */
  static async syncExistingAgents(): Promise<{ synced: number; reassigned: number; rebalanced: number; total: number; credentialId: string | null }> {
    const activeCredentials = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.isActive, true));

    if (activeCredentials.length === 0) {
      throw new Error("No active ElevenLabs credentials available. Please add at least one API key to the pool.");
    }

    const activeCredentialIds = activeCredentials.map(c => c.id);

    const allRegularAgents = await db
      .select()
      .from(agents)
      .where(sql`${agents.elevenLabsAgentId} IS NOT NULL`);

    const allIncomingAgents = await db
      .select()
      .from(incomingAgents)
      .where(sql`${incomingAgents.elevenLabsAgentId} IS NOT NULL`);

    const totalAgents = allRegularAgents.length + allIncomingAgents.length;

    if (totalAgents === 0) {
      return { synced: 0, reassigned: 0, rebalanced: 0, total: 0, credentialId: activeCredentials[0]?.id || null };
    }

    let newlyAssigned = 0;
    let movedFromInactive = 0;
    let rebalanced = 0;

    const allItems: Array<{ id: string; table: 'agents' | 'incomingAgents' }> = [];

    for (const agent of allRegularAgents) {
      if (!agent.elevenLabsCredentialId) newlyAssigned++;
      else if (!activeCredentialIds.includes(agent.elevenLabsCredentialId)) movedFromInactive++;
      else rebalanced++;
      allItems.push({ id: agent.id, table: 'agents' });
    }

    for (const agent of allIncomingAgents) {
      if (!agent.elevenLabsCredentialId) newlyAssigned++;
      else if (!activeCredentialIds.includes(agent.elevenLabsCredentialId)) movedFromInactive++;
      else rebalanced++;
      allItems.push({ id: agent.id, table: 'incomingAgents' });
    }

    const credentialBuckets: Record<string, number> = {};
    for (const cred of activeCredentials) {
      credentialBuckets[cred.id] = 0;
    }

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      const targetCredentialId = activeCredentialIds[i % activeCredentials.length];
      credentialBuckets[targetCredentialId]++;

      if (item.table === 'agents') {
        await db
          .update(agents)
          .set({ elevenLabsCredentialId: targetCredentialId })
          .where(eq(agents.id, item.id));
      } else {
        await db
          .update(incomingAgents)
          .set({ elevenLabsCredentialId: targetCredentialId })
          .where(eq(incomingAgents.id, item.id));
      }
    }

    for (const cred of activeCredentials) {
      await db
        .update(elevenLabsCredentials)
        .set({
          totalAssignedAgents: credentialBuckets[cred.id],
          updatedAt: new Date(),
        })
        .where(eq(elevenLabsCredentials.id, cred.id));
    }

    for (const credId of Object.keys(credentialBuckets)) {
      const cred = activeCredentials.find(c => c.id === credId);
      console.log(`[ElevenLabs Pool] Credential ${cred?.name || credId}: assigned ${credentialBuckets[credId]} agents`);
    }

    console.log(`[ElevenLabs Pool] Sync complete: ${totalAgents} total (${newlyAssigned} newly assigned, ${movedFromInactive} moved from inactive, ${rebalanced} rebalanced) across ${activeCredentials.length} credential(s)`);

    return {
      synced: newlyAssigned,
      reassigned: movedFromInactive,
      rebalanced,
      total: totalAgents,
      credentialId: activeCredentials.length === 1 ? activeCredentials[0].id : null,
    };
  }

  /**
   * Recalculate agent counts for all credentials based on actual agents in database.
   * This fixes any drift between stored totalAssignedAgents and actual agent counts.
   */
  static async recalculateAgentCounts(): Promise<{ 
    updated: number; 
    credentials: Array<{ id: string; name: string; oldCount: number; newCount: number }> 
  }> {
    // Get all credentials
    const credentials = await db.select().from(elevenLabsCredentials);
    
    const updates: Array<{ id: string; name: string; oldCount: number; newCount: number }> = [];
    
    for (const credential of credentials) {
      // Count actual agents using this credential
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(eq(agents.elevenLabsCredentialId, credential.id));
      
      const actualCount = result?.count || 0;
      const oldCount = credential.totalAssignedAgents;
      
      // Only update if counts differ
      if (actualCount !== oldCount) {
        await db
          .update(elevenLabsCredentials)
          .set({
            totalAssignedAgents: actualCount,
            updatedAt: new Date(),
          })
          .where(eq(elevenLabsCredentials.id, credential.id));
        
        updates.push({
          id: credential.id,
          name: credential.name,
          oldCount,
          newCount: actualCount,
        });
        
        console.log(`🔄 [ElevenLabs Pool] Recalculated ${credential.name}: ${oldCount} → ${actualCount} agents`);
      }
    }
    
    return {
      updated: updates.length,
      credentials: updates,
    };
  }

  // ============================================================
  // USER CREDENTIAL AFFINITY SYSTEM
  // Ensures all user's resources (agents, phone numbers) stay on same ElevenLabs account
  // Uses threshold-based distribution: fill keys to threshold, then round-robin
  // ============================================================

  /**
   * Get or assign a credential for a user.
   * This is the PRIMARY method for getting credentials for user operations.
   * 
   * Logic:
   * 1. If user already has a credential assigned, return it (if still active)
   * 2. If user has existing agents with credentials, adopt that credential
   * 3. Otherwise, assign new credential using threshold-based selection:
   *    - Pick credential under threshold (default 100 agents)
   *    - If all at/above threshold, pick least-loaded for round-robin balance
   * 
   * @param userId - The user ID to get/assign credential for
   * @returns The assigned credential, or null if no active credentials available
   */
  static async getUserCredential(userId: string): Promise<ElevenLabsCredential | null> {
    // Step 1: Check if user already has a credential assigned
    const [user] = await db
      .select({ elevenLabsCredentialId: users.elevenLabsCredentialId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user?.elevenLabsCredentialId) {
      // User has credential - verify it's still active
      const [existingCredential] = await db
        .select()
        .from(elevenLabsCredentials)
        .where(
          and(
            eq(elevenLabsCredentials.id, user.elevenLabsCredentialId),
            eq(elevenLabsCredentials.isActive, true)
          )
        )
        .limit(1);

      if (existingCredential) {
        console.log(`🔑 [User Affinity] User ${userId} using existing credential: ${existingCredential.name}`);
        return existingCredential;
      }
      // Credential is inactive/deleted - need to reassign
      console.log(`⚠️ [User Affinity] User ${userId}'s credential is inactive, reassigning...`);
    }

    // Step 2: Check if user has existing agents with credentials (migration path)
    const [existingAgent] = await db
      .select({ elevenLabsCredentialId: agents.elevenLabsCredentialId })
      .from(agents)
      .where(
        and(
          eq(agents.userId, userId),
          sql`${agents.elevenLabsCredentialId} IS NOT NULL`
        )
      )
      .limit(1);

    if (existingAgent?.elevenLabsCredentialId) {
      const [agentCredential] = await db
        .select()
        .from(elevenLabsCredentials)
        .where(
          and(
            eq(elevenLabsCredentials.id, existingAgent.elevenLabsCredentialId),
            eq(elevenLabsCredentials.isActive, true)
          )
        )
        .limit(1);

      if (agentCredential) {
        // Adopt this credential for the user
        await this.assignUserToCredential(userId, agentCredential.id);
        console.log(`🔑 [User Affinity] User ${userId} adopted credential from existing agent: ${agentCredential.name}`);
        return agentCredential;
      }
    }

    // Step 3: Assign new credential using threshold-based selection
    const credential = await this.selectCredentialForNewUser();
    if (!credential) {
      console.error(`❌ [User Affinity] No active credentials available for user ${userId}`);
      return null;
    }

    // Assign user to this credential
    await this.assignUserToCredential(userId, credential.id);
    console.log(`🔑 [User Affinity] User ${userId} assigned to credential: ${credential.name} (${credential.totalAssignedAgents}/${credential.maxAgentsThreshold} agents)`);
    return credential;
  }

  /**
   * Select a credential for a new user using threshold-based distribution.
   * 
   * Strategy:
   * 1. Find credentials under their maxAgentsThreshold
   * 2. Among those, pick the one with most agents (fill to threshold)
   * 3. If all at/above threshold, pick least-loaded (round-robin balance)
   */
  private static async selectCredentialForNewUser(): Promise<ElevenLabsCredential | null> {
    const credentials = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.isActive, true));

    if (credentials.length === 0) {
      return null;
    }

    // Find credentials under threshold
    const underThreshold = credentials.filter(c => c.totalAssignedAgents < c.maxAgentsThreshold);

    if (underThreshold.length > 0) {
      // Pick the one with most agents (fill to threshold before moving to next)
      const sorted = underThreshold.sort((a, b) => b.totalAssignedAgents - a.totalAssignedAgents);
      return sorted[0];
    }

    // All at/above threshold - round-robin by picking least loaded
    const sorted = credentials.sort((a, b) => a.totalAssignedAgents - b.totalAssignedAgents);
    return sorted[0];
  }

  /**
   * Assign a user to a specific credential and update counters.
   * This is called by the migration engine after successful migration to keep user's credential pointer in sync.
   * 
   * @param userId - User ID to assign
   * @param credentialId - Credential ID to assign to
   */
  static async assignUserToCredential(userId: string, credentialId: string): Promise<void> {
    // Check if user was previously assigned to a different credential
    const [user] = await db
      .select({ elevenLabsCredentialId: users.elevenLabsCredentialId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const oldCredentialId = user?.elevenLabsCredentialId;

    // Update user's credential assignment
    await db
      .update(users)
      .set({ 
        elevenLabsCredentialId: credentialId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Decrement old credential's user count if reassigning
    if (oldCredentialId && oldCredentialId !== credentialId) {
      await db
        .update(elevenLabsCredentials)
        .set({
          totalAssignedUsers: sql`GREATEST(0, ${elevenLabsCredentials.totalAssignedUsers} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(elevenLabsCredentials.id, oldCredentialId));
    }

    // Increment new credential's user count (only if not already assigned)
    if (!oldCredentialId || oldCredentialId !== credentialId) {
      await db
        .update(elevenLabsCredentials)
        .set({
          totalAssignedUsers: sql`${elevenLabsCredentials.totalAssignedUsers} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(elevenLabsCredentials.id, credentialId));
    }
  }

  /**
   * Recalculate user assignment counts for all credentials.
   * This fixes any drift between stored totalAssignedUsers and actual user counts.
   */
  static async recalculateUserCounts(): Promise<{ 
    updated: number; 
    credentials: Array<{ id: string; name: string; oldCount: number; newCount: number }> 
  }> {
    const credentials = await db.select().from(elevenLabsCredentials);
    
    const updates: Array<{ id: string; name: string; oldCount: number; newCount: number }> = [];
    
    for (const credential of credentials) {
      // Count actual users assigned to this credential
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.elevenLabsCredentialId, credential.id));
      
      const actualCount = result?.count || 0;
      const oldCount = credential.totalAssignedUsers;
      
      if (actualCount !== oldCount) {
        await db
          .update(elevenLabsCredentials)
          .set({
            totalAssignedUsers: actualCount,
            updatedAt: new Date(),
          })
          .where(eq(elevenLabsCredentials.id, credential.id));
        
        updates.push({
          id: credential.id,
          name: credential.name,
          oldCount,
          newCount: actualCount,
        });
        
        console.log(`🔄 [ElevenLabs Pool] Recalculated users for ${credential.name}: ${oldCount} → ${actualCount}`);
      }
    }
    
    return {
      updated: updates.length,
      credentials: updates,
    };
  }

  /**
   * Get credential stats including user assignments.
   */
  static async getCredentialWithUserStats(credentialId: string) {
    const [credential] = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.id, credentialId))
      .limit(1);

    if (!credential) return null;

    // Get users assigned to this credential
    const assignedUsers = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.elevenLabsCredentialId, credentialId));

    return {
      ...credential,
      assignedUsers,
    };
  }
}
