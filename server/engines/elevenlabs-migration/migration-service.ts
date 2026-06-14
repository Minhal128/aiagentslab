/**
 * @fileoverview ElevenLabs Migration Engine - Migration Service
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Main orchestrator for migrating user resources between ElevenLabs API keys.
 * Ensures all user's agents and phone numbers stay on the same key.
 */

import { db } from '../../db';
import { agents, phoneNumbers, elevenLabsCredentials } from '@shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { 
  MigrationResult, 
  MigratedAgent, 
  MigratedPhone,
  MigrationOptions,
  AvailableCredential 
} from './types';
import { migrateAgent, migratePhoneNumber } from './resource-migrator';
import { formatErrorForLog } from './error-detector';
import { ElevenLabsPoolService } from '../../services/elevenlabs-pool';

/**
 * Get all user's agents that are on a specific credential
 */
async function getUserAgentsOnCredential(userId: string, credentialId: string) {
  return db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.userId, userId),
        eq(agents.elevenLabsCredentialId, credentialId),
        isNotNull(agents.elevenLabsAgentId)
      )
    );
}

/**
 * Get all user's phone numbers that are on a specific credential
 */
async function getUserPhonesOnCredential(userId: string, credentialId: string) {
  return db
    .select()
    .from(phoneNumbers)
    .where(
      and(
        eq(phoneNumbers.userId, userId),
        eq(phoneNumbers.elevenLabsCredentialId, credentialId),
        isNotNull(phoneNumbers.elevenLabsPhoneNumberId)
      )
    );
}

/**
 * Get an available credential with capacity
 * Returns the credential with the most available capacity
 * 
 * @param excludeCredentialId - Optional credential ID to exclude from selection
 * @returns Available credential or null if none available
 */
export async function getAvailableCredential(
  excludeCredentialId?: string
): Promise<AvailableCredential | null> {
  const credentials = await db
    .select()
    .from(elevenLabsCredentials)
    .where(eq(elevenLabsCredentials.isActive, true));

  if (credentials.length === 0) {
    return null;
  }

  const available = credentials
    .filter(c => c.id !== excludeCredentialId)
    .filter(c => c.currentLoad < c.maxConcurrency)
    .map(c => ({
      id: c.id,
      name: c.name,
      apiKey: c.apiKey,
      currentLoad: c.currentLoad,
      maxConcurrency: c.maxConcurrency,
      availableCapacity: c.maxConcurrency - c.currentLoad,
    }))
    .sort((a, b) => b.availableCapacity - a.availableCapacity);

  return available.length > 0 ? available[0] : null;
}

/**
 * Check if any credential has available capacity
 * 
 * @returns boolean indicating if any key has capacity
 */
export async function hasAnyAvailableCapacity(): Promise<boolean> {
  const credential = await getAvailableCredential();
  return credential !== null;
}

/**
 * Get credential by ID
 */
export async function getCredentialById(credentialId: string) {
  const [credential] = await db
    .select()
    .from(elevenLabsCredentials)
    .where(eq(elevenLabsCredentials.id, credentialId))
    .limit(1);
  
  return credential || null;
}

/**
 * Migrate all user resources from one credential to another
 * 
 * This is the main migration function. It:
 * 1. Gets all user's agents on the source credential
 * 2. Gets all user's phones on the source credential
 * 3. Migrates each agent (GET config → CREATE on new → DELETE from old)
 * 4. Migrates each phone (DELETE from old → SYNC to new)
 * 5. Returns detailed migration result
 * 
 * @param userId - User ID whose resources to migrate
 * @param fromCredentialId - Source credential ID
 * @param toCredentialId - Destination credential ID
 * @param options - Migration options
 * @returns MigrationResult with details of migrated resources
 */
export async function migrateUserResources(
  userId: string,
  fromCredentialId: string,
  toCredentialId: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const startTime = Date.now();
  const migratedAgents: MigratedAgent[] = [];
  const migratedPhones: MigratedPhone[] = [];
  
  console.log(`\n🔄 ============================================`);
  console.log(`🔄 MIGRATION ENGINE: Starting resource migration`);
  console.log(`🔄 User: ${userId}`);
  console.log(`🔄 From Credential: ${fromCredentialId}`);
  console.log(`🔄 To Credential: ${toCredentialId}`);
  console.log(`🔄 ============================================\n`);

  const fromCredential = await getCredentialById(fromCredentialId);
  const toCredential = await getCredentialById(toCredentialId);

  if (!fromCredential) {
    return {
      success: false,
      migratedAgents: [],
      migratedPhones: [],
      error: `Source credential not found: ${fromCredentialId}`,
      fromCredentialId,
      toCredentialId,
      duration: Date.now() - startTime,
    };
  }

  if (!toCredential) {
    return {
      success: false,
      migratedAgents: [],
      migratedPhones: [],
      error: `Destination credential not found: ${toCredentialId}`,
      fromCredentialId,
      toCredentialId,
      duration: Date.now() - startTime,
    };
  }

  if (!toCredential.isActive) {
    return {
      success: false,
      migratedAgents: [],
      migratedPhones: [],
      error: `Destination credential is not active: ${toCredential.name}`,
      fromCredentialId,
      toCredentialId,
      duration: Date.now() - startTime,
    };
  }

  if (options.dryRun) {
    console.log(`🔄 [DRY RUN] Would migrate resources - no actual changes made`);
    const userAgents = await getUserAgentsOnCredential(userId, fromCredentialId);
    const userPhones = await getUserPhonesOnCredential(userId, fromCredentialId);
    
    return {
      success: true,
      migratedAgents: userAgents.map(a => ({
        localId: a.id,
        oldElevenLabsId: a.elevenLabsAgentId!,
        newElevenLabsId: '[DRY RUN]',
        name: a.name,
      })),
      migratedPhones: userPhones.map(p => ({
        localId: p.id,
        oldElevenLabsId: p.elevenLabsPhoneNumberId!,
        newElevenLabsId: '[DRY RUN]',
        phoneNumber: p.phoneNumber,
      })),
      fromCredentialId,
      toCredentialId,
      duration: Date.now() - startTime,
    };
  }

  if (!options.skipAgents) {
    const userAgents = await getUserAgentsOnCredential(userId, fromCredentialId);
    console.log(`🔄 Found ${userAgents.length} agent(s) to migrate`);

    for (const agent of userAgents) {
      try {
        const result = await migrateAgent(
          agent.id,
          fromCredential.apiKey,
          toCredential.apiKey,
          toCredentialId
        );
        migratedAgents.push(result);
        console.log(`   ✅ Agent migrated: ${result.name}`);
      } catch (error) {
        console.error(`   ❌ Failed to migrate agent ${agent.name}:`, formatErrorForLog(error));
        return {
          success: false,
          migratedAgents,
          migratedPhones,
          error: `Failed to migrate agent ${agent.name}: ${formatErrorForLog(error)}`,
          fromCredentialId,
          toCredentialId,
          duration: Date.now() - startTime,
        };
      }
    }
  }

  if (!options.skipPhones) {
    const userPhones = await getUserPhonesOnCredential(userId, fromCredentialId);
    console.log(`🔄 Found ${userPhones.length} phone number(s) to migrate`);

    for (const phone of userPhones) {
      try {
        const result = await migratePhoneNumber(
          phone.id,
          fromCredential.apiKey,
          toCredential.apiKey,
          toCredentialId
        );
        migratedPhones.push(result);
        console.log(`   ✅ Phone migrated: ${result.phoneNumber}`);
      } catch (error) {
        console.error(`   ❌ Failed to migrate phone ${phone.phoneNumber}:`, formatErrorForLog(error));
        return {
          success: false,
          migratedAgents,
          migratedPhones,
          error: `Failed to migrate phone ${phone.phoneNumber}: ${formatErrorForLog(error)}`,
          fromCredentialId,
          toCredentialId,
          duration: Date.now() - startTime,
        };
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`\n🔄 ============================================`);
  console.log(`🔄 MIGRATION COMPLETE`);
  console.log(`🔄 Agents migrated: ${migratedAgents.length}`);
  console.log(`🔄 Phones migrated: ${migratedPhones.length}`);
  console.log(`🔄 Duration: ${duration}ms`);
  console.log(`🔄 ============================================\n`);

  // Update user's credential pointer to the new credential
  // This ensures future allocations stay on the same key
  try {
    await ElevenLabsPoolService.assignUserToCredential(userId, toCredentialId);
    console.log(`🔄 Updated user ${userId} credential pointer to ${toCredentialId}`);
  } catch (error) {
    console.error(`🔄 Warning: Failed to update user credential pointer:`, formatErrorForLog(error));
    // Don't fail the migration for this - resources are already moved
  }

  return {
    success: true,
    migratedAgents,
    migratedPhones,
    fromCredentialId,
    toCredentialId,
    duration,
  };
}

/**
 * Find and migrate user resources to an available credential
 * 
 * This is a convenience function that:
 * 1. Determines which credential the user's resources are currently on
 * 2. Finds an available credential with capacity
 * 3. Migrates all resources to the new credential
 * 
 * @param userId - User ID to migrate
 * @param currentCredentialId - Current credential ID (the one hitting limits)
 * @returns MigrationResult
 */
export async function autoMigrateUser(
  userId: string,
  currentCredentialId: string
): Promise<MigrationResult> {
  console.log(`🔄 [Auto-Migration] Looking for available credential for user ${userId}`);

  const availableCredential = await getAvailableCredential(currentCredentialId);

  if (!availableCredential) {
    console.log(`🔄 [Auto-Migration] No available credentials with capacity`);
    return {
      success: false,
      migratedAgents: [],
      migratedPhones: [],
      error: 'No available credentials with capacity',
      fromCredentialId: currentCredentialId,
      toCredentialId: '',
      duration: 0,
    };
  }

  console.log(`🔄 [Auto-Migration] Found available credential: ${availableCredential.name} (capacity: ${availableCredential.availableCapacity})`);

  return migrateUserResources(userId, currentCredentialId, availableCredential.id);
}

/**
 * Get the credential a user's resources are currently on
 * Checks agents first, then phones
 * 
 * @param userId - User ID to check
 * @returns Credential ID or null if no resources found
 */
export async function getUserCurrentCredential(userId: string): Promise<string | null> {
  const [agent] = await db
    .select({ credentialId: agents.elevenLabsCredentialId })
    .from(agents)
    .where(
      and(
        eq(agents.userId, userId),
        isNotNull(agents.elevenLabsCredentialId)
      )
    )
    .limit(1);

  if (agent?.credentialId) {
    return agent.credentialId;
  }

  const [phone] = await db
    .select({ credentialId: phoneNumbers.elevenLabsCredentialId })
    .from(phoneNumbers)
    .where(
      and(
        eq(phoneNumbers.userId, userId),
        isNotNull(phoneNumbers.elevenLabsCredentialId)
      )
    )
    .limit(1);

  return phone?.credentialId || null;
}

/**
 * Get migration stats for a credential
 */
export async function getMigrationStats(credentialId: string) {
  const agentCount = await db
    .select()
    .from(agents)
    .where(eq(agents.elevenLabsCredentialId, credentialId));

  const phoneCount = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.elevenLabsCredentialId, credentialId));

  const [credential] = await db
    .select()
    .from(elevenLabsCredentials)
    .where(eq(elevenLabsCredentials.id, credentialId))
    .limit(1);

  return {
    credentialId,
    credentialName: credential?.name || 'Unknown',
    agentCount: agentCount.length,
    phoneCount: phoneCount.length,
    currentLoad: credential?.currentLoad || 0,
    maxConcurrency: credential?.maxConcurrency || 0,
    isActive: credential?.isActive || false,
  };
}
