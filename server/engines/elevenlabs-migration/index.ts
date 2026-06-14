/**
 * @fileoverview ElevenLabs Migration Engine - Main Entry Point
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Dynamic migration engine for automatic resource migration between
 * ElevenLabs API keys when concurrency limits are reached.
 * 
 * Usage:
 * ```typescript
 * import { withMigrationFallback } from './engines/elevenlabs-migration';
 * 
 * // Wrap any ElevenLabs operation
 * const result = await withMigrationFallback(userId, credentialId, async () => {
 *   return await batchCallingService.createBatch(request);
 * });
 * ```
 */

export * from './types';
export * from './error-detector';
export * from './resource-migrator';
export * from './migration-service';
export * from './retry-scheduler';
export * from './phone-migrator';

import { 
  detectConcurrencyError, 
  isRecoverableError, 
  formatErrorForLog 
} from './error-detector';
import { 
  autoMigrateUser, 
  getAvailableCredential,
  hasAnyAvailableCapacity,
  getUserCurrentCredential 
} from './migration-service';
import { markCampaignForRetry } from './retry-scheduler';
import { MigrationResult } from './types';

/**
 * Wrapper that handles automatic migration on concurrency errors
 * 
 * This is the main function to use when calling ElevenLabs APIs.
 * It wraps the operation and:
 * 1. Attempts the operation
 * 2. If concurrency error → migrates user resources → retries
 * 3. If migration fails → queues for retry
 * 
 * @param userId - User ID for resource ownership
 * @param currentCredentialId - Current credential being used
 * @param operation - Async function to execute
 * @param options - Additional options
 * @returns Result of the operation
 * @throws If operation fails with non-recoverable error
 */
export async function withMigrationFallback<T>(
  userId: string,
  currentCredentialId: string,
  operation: () => Promise<T>,
  options: {
    campaignId?: string;
    retryAfterMigration?: boolean;
    maxRetries?: number;
  } = {}
): Promise<T> {
  const { 
    campaignId, 
    retryAfterMigration = true,
    maxRetries = 1 
  } = options;

  let lastError: any;
  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      attempts++;
      console.log(`🔄 [Migration Fallback] Attempt ${attempts}/${maxRetries + 1}`);
      
      const result = await operation();
      console.log(`✅ [Migration Fallback] Operation succeeded on attempt ${attempts}`);
      return result;
      
    } catch (error) {
      lastError = error;
      const concurrencyError = detectConcurrencyError(error);
      
      console.log(`❌ [Migration Fallback] Operation failed:`, formatErrorForLog(error));
      console.log(`   Is concurrency error: ${concurrencyError.isConcurrencyError}`);
      console.log(`   Is recoverable: ${isRecoverableError(error)}`);
      
      if (!concurrencyError.isConcurrencyError) {
        console.log(`   Not a concurrency error, throwing original error`);
        throw error;
      }
      
      if (attempts > maxRetries) {
        console.log(`   Max retries exceeded`);
        break;
      }
      
      console.log(`🔄 [Migration Fallback] Attempting auto-migration...`);
      
      const migrationResult = await autoMigrateUser(userId, currentCredentialId);
      
      if (!migrationResult.success) {
        console.log(`❌ [Migration Fallback] Migration failed: ${migrationResult.error}`);
        
        if (campaignId) {
          console.log(`📋 [Migration Fallback] Marking campaign for retry queue`);
          await markCampaignForRetry(campaignId, migrationResult.error || 'No capacity available');
        }
        
        throw new MigrationRequiredError(
          'No available capacity for migration',
          concurrencyError.message,
          campaignId
        );
      }
      
      console.log(`✅ [Migration Fallback] Migration successful to ${migrationResult.toCredentialId}`);
      console.log(`   Migrated: ${migrationResult.migratedAgents.length} agents, ${migrationResult.migratedPhones.length} phones`);
      
      if (!retryAfterMigration) {
        throw new MigrationCompletedError(
          'Resources migrated, retry operation with new credential',
          migrationResult
        );
      }
      
      currentCredentialId = migrationResult.toCredentialId;
    }
  }
  
  if (campaignId) {
    await markCampaignForRetry(campaignId, formatErrorForLog(lastError));
  }
  
  throw lastError;
}

/**
 * Simpler wrapper for operations that don't need campaign tracking
 * 
 * @param userId - User ID for resource ownership  
 * @param operation - Async function to execute
 * @returns Result of the operation
 */
export async function withAutoMigration<T>(
  userId: string,
  operation: () => Promise<T>
): Promise<T> {
  const currentCredentialId = await getUserCurrentCredential(userId);
  
  if (!currentCredentialId) {
    return operation();
  }
  
  return withMigrationFallback(userId, currentCredentialId, operation);
}

/**
 * Check if migration is available for a user
 * Returns true if there's another credential with capacity
 * 
 * @param currentCredentialId - Current credential ID
 * @returns boolean indicating if migration is possible
 */
export async function canMigrate(currentCredentialId: string): Promise<boolean> {
  const available = await getAvailableCredential(currentCredentialId);
  return available !== null;
}

/**
 * Custom error for migration-required scenarios
 */
export class MigrationRequiredError extends Error {
  public readonly originalError: string;
  public readonly campaignId?: string;
  public readonly isQueued: boolean;

  constructor(message: string, originalError: string, campaignId?: string) {
    super(message);
    this.name = 'MigrationRequiredError';
    this.originalError = originalError;
    this.campaignId = campaignId;
    this.isQueued = !!campaignId;
  }
}

/**
 * Custom error indicating migration was completed successfully
 * Used when retryAfterMigration=false
 */
export class MigrationCompletedError extends Error {
  public readonly migrationResult: MigrationResult;

  constructor(message: string, migrationResult: MigrationResult) {
    super(message);
    this.name = 'MigrationCompletedError';
    this.migrationResult = migrationResult;
  }
}

/**
 * Initialize the migration engine
 * Call this on server startup to start the retry scheduler
 */
export function initializeMigrationEngine(): void {
  console.log(`🔄 ============================================`);
  console.log(`🔄 ELEVENLABS MIGRATION ENGINE INITIALIZED`);
  console.log(`🔄 ============================================`);
  console.log(`🔄 Features:`);
  console.log(`   ✓ Automatic concurrency error detection`);
  console.log(`   ✓ Dynamic resource migration between API keys`);
  console.log(`   ✓ Campaign retry queue (hourly)`);
  console.log(`   ✓ Agent + Phone number migration`);
  console.log(`🔄 ============================================\n`);
  
  import('./retry-scheduler').then(({ startRetryScheduler }) => {
    startRetryScheduler();
  }).catch(err => {
    console.error(`🔄 [Migration Engine] Failed to start retry scheduler:`, err);
  });
}
