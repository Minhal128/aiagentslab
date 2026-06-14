/**
 * @fileoverview ElevenLabs Migration Engine - Phone Number Migrator
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Handles migration of phone numbers between ElevenLabs API keys (credentials).
 * When an agent moves to a different ElevenLabs account, its connected phone 
 * numbers must also migrate to maintain proper call routing.
 * 
 * COMPLETE PHONE LIFECYCLE:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Twilio                    │  ElevenLabs           │  Migration    │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  Buy/Search numbers        │  Import from Twilio   │  Cross-key    │
 * │  Release/Delete numbers    │  Delete from account  │  co-location  │
 * │  Configure webhooks        │  Assign agent         │  orchestration│
 * │  Voice routing             │  Verify ownership     │               │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * Migration uses official APIs:
 * - ElevenLabs GET /v1/convai/phone-numbers/:id (verify ownership)
 * - ElevenLabs DELETE /v1/convai/phone-numbers/:id (remove from old key)
 * - ElevenLabs POST /v1/convai/phone-numbers (import to new key)
 * - ElevenLabs PATCH /v1/convai/phone-numbers/:id (assign agent)
 * - Twilio POST /IncomingPhoneNumbers/:sid (reconfigure webhook)
 */

import { db } from '../../db';
import { phoneNumbers, agents, incomingConnections, elevenLabsCredentials, campaigns } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { ElevenLabsService } from '../../services/elevenlabs';
import { getTwilioAccountSid, getTwilioAuthToken } from '../../services/twilio-connector';
import { 
  PhoneMigrationResult, 
  AgentPhoneMigrationResult,
  CampaignPhoneMigrationResult,
  PhoneMigrationStatus 
} from './types';

/**
 * Phone Number Migrator
 * 
 * Provides methods to migrate phone numbers between ElevenLabs credentials
 * for both incoming connections and outbound campaigns.
 * 
 * Uses in-memory locks to prevent concurrent migration operations.
 */
export class PhoneMigrator {
  
  // In-memory tracking for lock state
  private static activeLocks: Set<string> = new Set();
  private static verificationLocks: Set<string> = new Set();
  private static bulkMigrationLock: boolean = false;
  
  /**
   * Acquire an in-memory lock for phone migration
   */
  private static async lockPhone(phoneId: string): Promise<boolean> {
    const lockKey = `migration:${phoneId}`;
    if (this.activeLocks.has(lockKey)) {
      return false;
    }
    this.activeLocks.add(lockKey);
    return true;
  }
  
  /**
   * Release an in-memory lock for phone migration
   */
  private static async unlockPhone(phoneId: string): Promise<void> {
    const lockKey = `migration:${phoneId}`;
    this.activeLocks.delete(lockKey);
  }
  
  /**
   * Acquire an in-memory lock for phone verification
   */
  private static async lockPhoneVerification(phoneId: string): Promise<boolean> {
    const lockKey = `verification:${phoneId}`;
    if (this.verificationLocks.has(lockKey)) {
      return false;
    }
    this.verificationLocks.add(lockKey);
    return true;
  }
  
  /**
   * Release an in-memory lock for phone verification
   */
  private static async unlockPhoneVerification(phoneId: string): Promise<void> {
    const lockKey = `verification:${phoneId}`;
    this.verificationLocks.delete(lockKey);
  }
  
  /**
   * Acquire an in-memory lock for bulk migration operations
   */
  private static async lockBulkMigration(): Promise<boolean> {
    if (this.bulkMigrationLock) {
      return false;
    }
    this.bulkMigrationLock = true;
    return true;
  }
  
  /**
   * Release an in-memory lock for bulk migration operations
   */
  private static async unlockBulkMigration(): Promise<void> {
    this.bulkMigrationLock = false;
  }
  
  /**
   * Migrate a single phone number to a new ElevenLabs credential
   * 
   * Uses official ElevenLabs & Twilio APIs:
   * 1. GET - Verify phone exists in old account
   * 2. DELETE - Remove from old ElevenLabs account  
   * 3. POST - Import to new ElevenLabs account
   * 4. Twilio API - Reconfigure webhook
   * 5. PATCH - Assign agent in new account
   * 6. DB Update - Store new IDs
   */
  static async migratePhoneNumber(
    phoneNumberDbId: string,
    targetCredentialId: string,
    targetAgentElevenLabsId?: string
  ): Promise<PhoneMigrationResult> {
    console.log(`📞 [Phone Migrator] Starting migration for phone ${phoneNumberDbId} to credential ${targetCredentialId}`);
    
    const lockAcquired = await this.lockPhone(phoneNumberDbId);
    if (!lockAcquired) {
      console.warn(`   ⚠️  Phone ${phoneNumberDbId} is already being migrated - skipping`);
      return {
        success: false,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: 'unknown',
        oldCredentialId: null,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId: null,
        newElevenLabsPhoneId: null,
        error: 'Phone number is already being migrated by another process'
      };
    }
    
    const [phoneRecord] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, phoneNumberDbId))
      .limit(1);
    
    if (!phoneRecord) {
      await this.unlockPhone(phoneNumberDbId);
      return {
        success: false,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: 'unknown',
        oldCredentialId: null,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId: null,
        newElevenLabsPhoneId: null,
        error: 'Phone number not found in database'
      };
    }
    
    const oldCredentialId = phoneRecord.elevenLabsCredentialId;
    const oldElevenLabsPhoneId = phoneRecord.elevenLabsPhoneNumberId;
    
    if (oldCredentialId === targetCredentialId) {
      console.log(`   ℹ️  Phone ${phoneRecord.phoneNumber} already on target credential - no migration needed`);
      await this.unlockPhone(phoneNumberDbId);
      return {
        success: true,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: phoneRecord.phoneNumber,
        oldCredentialId,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId,
        newElevenLabsPhoneId: oldElevenLabsPhoneId,
      };
    }
    
    const [targetCredential] = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.id, targetCredentialId))
      .limit(1);
    
    if (!targetCredential) {
      await this.unlockPhone(phoneNumberDbId);
      return {
        success: false,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: phoneRecord.phoneNumber,
        oldCredentialId,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId,
        newElevenLabsPhoneId: null,
        error: 'Target credential not found'
      };
    }
    
    if (!targetCredential.isActive) {
      await this.unlockPhone(phoneNumberDbId);
      return {
        success: false,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: phoneRecord.phoneNumber,
        oldCredentialId,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId,
        newElevenLabsPhoneId: null,
        error: 'Target credential is inactive'
      };
    }
    
    try {
      // Step 1: Delete from old ElevenLabs account (with ownership verification)
      if (oldElevenLabsPhoneId && oldCredentialId) {
        const [oldCredential] = await db
          .select()
          .from(elevenLabsCredentials)
          .where(eq(elevenLabsCredentials.id, oldCredentialId))
          .limit(1);
        
        if (oldCredential) {
          try {
            console.log(`   🔍 Verifying phone exists in old ElevenLabs account (${oldCredential.name})`);
            const oldElevenLabsService = new ElevenLabsService(oldCredential.apiKey);
            
            try {
              const existingPhone = await oldElevenLabsService.getPhoneNumber(oldElevenLabsPhoneId);
              if (existingPhone && existingPhone.phone_number === phoneRecord.phoneNumber) {
                console.log(`   🗑️  Deleting phone from old ElevenLabs account`);
                await oldElevenLabsService.deletePhoneNumber(oldElevenLabsPhoneId);
                console.log(`   ✅ Deleted from old account`);
              } else {
                console.warn(`   ⚠️  Phone number mismatch - skipping delete from old account`);
              }
            } catch (getError: any) {
              console.log(`   ℹ️  Phone not found in old account (may already be deleted)`);
            }
          } catch (deleteError: any) {
            console.warn(`   ⚠️  Could not delete from old account: ${deleteError.message}`);
          }
        }
      }
      
      // Step 2: Import to new ElevenLabs account using Twilio credentials
      console.log(`   📥 Importing phone to new ElevenLabs account (${targetCredential.name})`);
      
      const twilioAccountSid = await getTwilioAccountSid();
      const twilioAuthToken = await getTwilioAuthToken();
      
      const newElevenLabsService = new ElevenLabsService(targetCredential.apiKey);
      const importResult = await newElevenLabsService.syncPhoneNumberToElevenLabs({
        phoneNumber: phoneRecord.phoneNumber,
        twilioAccountSid,
        twilioAuthToken,
        label: phoneRecord.friendlyName || phoneRecord.phoneNumber,
        enableOutbound: true
      });
      
      const newElevenLabsPhoneId = importResult.phone_number_id;
      console.log(`   ✅ Imported to new account: ${newElevenLabsPhoneId}`);
      
      // Step 3: Reconfigure Twilio webhook
      if (phoneRecord.twilioSid) {
        try {
          console.log(`   🔗 Reconfiguring Twilio webhook for phone`);
          const { TwilioService } = await import('../../services/twilio');
          const twilioService = new TwilioService();
          await twilioService.configurePhoneWebhookForElevenLabs(
            phoneRecord.twilioSid,
            phoneRecord.phoneNumber
          );
          console.log(`   ✅ Twilio webhook reconfigured`);
        } catch (webhookError: any) {
          console.warn(`   ⚠️  Could not reconfigure Twilio webhook: ${webhookError.message}`);
        }
      }
      
      // Step 4: Assign agent if provided
      if (targetAgentElevenLabsId) {
        console.log(`   🔗 Assigning agent ${targetAgentElevenLabsId} to phone`);
        await newElevenLabsService.assignAgentToPhoneNumber(
          newElevenLabsPhoneId,
          targetAgentElevenLabsId,
          true
        );
        console.log(`   ✅ Agent assigned to phone`);
      }
      
      // Step 5: Update database
      await db
        .update(phoneNumbers)
        .set({
          elevenLabsPhoneNumberId: newElevenLabsPhoneId,
          elevenLabsCredentialId: targetCredentialId,
        })
        .where(eq(phoneNumbers.id, phoneNumberDbId));
      
      console.log(`   ✅ Database updated`);
      console.log(`📞 [Phone Migrator] Successfully migrated ${phoneRecord.phoneNumber}`);
      
      return {
        success: true,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: phoneRecord.phoneNumber,
        oldCredentialId,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId,
        newElevenLabsPhoneId
      };
      
    } catch (error: any) {
      console.error(`📞 [Phone Migrator] Failed to migrate ${phoneRecord.phoneNumber}: ${error.message}`);
      
      return {
        success: false,
        phoneNumberId: phoneNumberDbId,
        phoneNumber: phoneRecord.phoneNumber,
        oldCredentialId,
        newCredentialId: targetCredentialId,
        oldElevenLabsPhoneId,
        newElevenLabsPhoneId: null,
        error: error.message
      };
    } finally {
      await this.unlockPhone(phoneNumberDbId);
    }
  }
  
  /**
   * Verify that a phone number exists on ElevenLabs and re-import if missing
   * 
   * This is a PRE-FLIGHT CHECK before making outbound calls.
   * If the phone number ID stored in the database doesn't exist on ElevenLabs
   * (returns 404), this method will re-import the phone from Twilio.
   * 
   * Use cases:
   * - Phone was deleted from ElevenLabs directly
   * - ElevenLabs account was reset
   * - Database has stale elevenLabsPhoneNumberId
   * 
   * @param phoneNumberDbId - The database ID of the phone number
   * @param credentialId - The ElevenLabs credential to verify/import against
   * @param agentElevenLabsId - Optional agent ID to assign to phone after re-import
   * @returns Object with success status and current ElevenLabs phone ID
   */
  static async verifyAndEnsurePhoneExists(
    phoneNumberDbId: string,
    credentialId: string,
    agentElevenLabsId?: string
  ): Promise<{
    success: boolean;
    elevenLabsPhoneId: string | null;
    wasReimported: boolean;
    error?: string;
  }> {
    // Acquire distributed lock for verification
    const lockAcquired = await this.lockPhoneVerification(phoneNumberDbId);
    if (!lockAcquired) {
      console.warn(`   ⚠️  Phone ${phoneNumberDbId} is already being verified by another process`);
      // Wait a bit and retry once
      await new Promise(resolve => setTimeout(resolve, 2000));
      const retryLock = await this.lockPhoneVerification(phoneNumberDbId);
      if (!retryLock) {
        return {
          success: false,
          elevenLabsPhoneId: null,
          wasReimported: false,
          error: 'Phone number is being verified by another process'
        };
      }
    }
    
    console.log(`📞 [Phone Migrator] Verifying phone ${phoneNumberDbId} exists on ElevenLabs credential ${credentialId}`);
    
    // Get phone record from database
    const [phoneRecord] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, phoneNumberDbId))
      .limit(1);
    
    if (!phoneRecord) {
      await this.unlockPhoneVerification(phoneNumberDbId);
      return {
        success: false,
        elevenLabsPhoneId: null,
        wasReimported: false,
        error: 'Phone number not found in database'
      };
    }
    
    // Get the credential
    const [credential] = await db
      .select()
      .from(elevenLabsCredentials)
      .where(eq(elevenLabsCredentials.id, credentialId))
      .limit(1);
    
    if (!credential) {
      await this.unlockPhoneVerification(phoneNumberDbId);
      return {
        success: false,
        elevenLabsPhoneId: null,
        wasReimported: false,
        error: 'ElevenLabs credential not found'
      };
    }
    
    if (!credential.isActive) {
      await this.unlockPhoneVerification(phoneNumberDbId);
      return {
        success: false,
        elevenLabsPhoneId: null,
        wasReimported: false,
        error: 'ElevenLabs credential is inactive'
      };
    }
    
    const elevenLabsService = new ElevenLabsService(credential.apiKey);
    
    // If phone has an ElevenLabs ID, verify it exists
    if (phoneRecord.elevenLabsPhoneNumberId) {
      try {
        console.log(`   🔍 Checking if phone ${phoneRecord.elevenLabsPhoneNumberId} exists on ElevenLabs...`);
        const existingPhone = await elevenLabsService.getPhoneNumber(phoneRecord.elevenLabsPhoneNumberId);
        
        if (existingPhone && existingPhone.phone_number === phoneRecord.phoneNumber) {
          console.log(`   ✅ Phone exists on ElevenLabs: ${existingPhone.phone_number_id}`);
          await this.unlockPhoneVerification(phoneNumberDbId);
          return {
            success: true,
            elevenLabsPhoneId: existingPhone.phone_number_id,
            wasReimported: false
          };
        } else {
          console.log(`   ⚠️ Phone number mismatch - will re-import`);
        }
      } catch (error: any) {
        // 404 means phone doesn't exist - need to re-import
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('Phone number') || error.status === 404) {
          console.log(`   ⚠️ Phone not found on ElevenLabs (404) - will re-import from Twilio`);
        } else {
          console.error(`   ❌ Error checking phone: ${error.message}`);
          await this.unlockPhoneVerification(phoneNumberDbId);
          return {
            success: false,
            elevenLabsPhoneId: null,
            wasReimported: false,
            error: `Failed to verify phone: ${error.message}`
          };
        }
      }
    } else {
      console.log(`   ℹ️ Phone has no ElevenLabs ID - will import from Twilio`);
    }
    
    // Phone doesn't exist on ElevenLabs - re-import from Twilio
    console.log(`   📥 Re-importing phone ${phoneRecord.phoneNumber} from Twilio to ElevenLabs...`);
    
    try {
      const twilioAccountSid = await getTwilioAccountSid();
      const twilioAuthToken = await getTwilioAuthToken();
      
      const importResult = await elevenLabsService.syncPhoneNumberToElevenLabs({
        phoneNumber: phoneRecord.phoneNumber,
        twilioAccountSid,
        twilioAuthToken,
        label: phoneRecord.friendlyName || phoneRecord.phoneNumber,
        enableOutbound: true
      });
      
      const newElevenLabsPhoneId = importResult.phone_number_id;
      console.log(`   ✅ Phone re-imported: ${newElevenLabsPhoneId}`);
      
      // Reconfigure Twilio webhook
      if (phoneRecord.twilioSid) {
        try {
          console.log(`   🔗 Reconfiguring Twilio webhook...`);
          const { TwilioService } = await import('../../services/twilio');
          const twilioService = new TwilioService();
          await twilioService.configurePhoneWebhookForElevenLabs(
            phoneRecord.twilioSid,
            phoneRecord.phoneNumber
          );
          console.log(`   ✅ Twilio webhook reconfigured`);
        } catch (webhookError: any) {
          console.warn(`   ⚠️ Could not reconfigure Twilio webhook: ${webhookError.message}`);
        }
      }
      
      // Assign agent to phone if provided (for outbound call routing)
      if (agentElevenLabsId) {
        try {
          console.log(`   🔗 Assigning agent ${agentElevenLabsId} to phone...`);
          await elevenLabsService.assignAgentToPhoneNumber(
            newElevenLabsPhoneId,
            agentElevenLabsId,
            false // for outbound, not inbound
          );
          console.log(`   ✅ Agent assigned to phone`);
        } catch (assignError: any) {
          console.warn(`   ⚠️ Could not assign agent to phone: ${assignError.message}`);
          // Don't fail the whole operation - phone is still usable
        }
      }
      
      // Update database with new ElevenLabs ID
      await db
        .update(phoneNumbers)
        .set({
          elevenLabsPhoneNumberId: newElevenLabsPhoneId,
          elevenLabsCredentialId: credentialId,
        })
        .where(eq(phoneNumbers.id, phoneNumberDbId));
      
      console.log(`   ✅ Database updated with new ElevenLabs phone ID`);
      console.log(`📞 [Phone Migrator] Phone ${phoneRecord.phoneNumber} re-imported successfully`);
      
      await this.unlockPhoneVerification(phoneNumberDbId);
      return {
        success: true,
        elevenLabsPhoneId: newElevenLabsPhoneId,
        wasReimported: true
      };
      
    } catch (error: any) {
      console.error(`   ❌ Failed to re-import phone: ${error.message}`);
      await this.unlockPhoneVerification(phoneNumberDbId);
      return {
        success: false,
        elevenLabsPhoneId: null,
        wasReimported: false,
        error: `Failed to re-import phone from Twilio: ${error.message}`
      };
    }
  }
  
  /**
   * Migrate all phone numbers connected to an agent (for incoming calls)
   */
  static async migrateAgentPhoneNumbers(agentDbId: string): Promise<AgentPhoneMigrationResult> {
    console.log(`📞 [Phone Migrator] Migrating phone numbers for agent ${agentDbId}`);
    
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentDbId))
      .limit(1);
    
    if (!agent) {
      return {
        agentId: agentDbId,
        agentName: 'unknown',
        migratedPhones: [],
        totalPhones: 0,
        successfulMigrations: 0,
        failedMigrations: 0
      };
    }
    
    const targetCredentialId = agent.elevenLabsCredentialId;
    const targetAgentElevenLabsId = agent.elevenLabsAgentId;
    
    if (!targetCredentialId) {
      console.warn(`   ⚠️  Agent ${agent.name} has no credential assigned - cannot migrate phones`);
      return {
        agentId: agentDbId,
        agentName: agent.name,
        migratedPhones: [],
        totalPhones: 0,
        successfulMigrations: 0,
        failedMigrations: 0
      };
    }
    
    const connections = await db
      .select({
        phoneNumberId: incomingConnections.phoneNumberId,
      })
      .from(incomingConnections)
      .where(eq(incomingConnections.agentId, agentDbId));
    
    const phoneIds = connections.map(c => c.phoneNumberId);
    console.log(`   📱 Found ${phoneIds.length} phone(s) connected to agent ${agent.name}`);
    
    const results: PhoneMigrationResult[] = [];
    
    for (const phoneId of phoneIds) {
      const result = await this.migratePhoneNumber(
        phoneId,
        targetCredentialId,
        targetAgentElevenLabsId || undefined
      );
      results.push(result);
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`📞 [Phone Migrator] Agent migration complete: ${successful}/${results.length} successful`);
    
    return {
      agentId: agentDbId,
      agentName: agent.name,
      migratedPhones: results,
      totalPhones: results.length,
      successfulMigrations: successful,
      failedMigrations: failed
    };
  }
  
  /**
   * Migrate all phone numbers for a campaign to match agent's credential (for outbound calls)
   * 
   * This is called:
   * - When creating/updating a campaign
   * - Before executing a campaign (preflight check)
   */
  static async migratePhonesForCampaign(
    campaignId: string,
    agentId: string,
    phoneNumberIds: string[]
  ): Promise<CampaignPhoneMigrationResult> {
    console.log(`📞 [Phone Migrator] Migrating phones for campaign ${campaignId}`);
    
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    
    if (!agent) {
      return {
        campaignId,
        agentId,
        agentName: 'unknown',
        migratedPhones: [],
        totalPhones: phoneNumberIds.length,
        successfulMigrations: 0,
        failedMigrations: phoneNumberIds.length,
        allPhonesReady: false,
        error: 'Agent not found'
      };
    }
    
    const targetCredentialId = agent.elevenLabsCredentialId;
    
    if (!targetCredentialId) {
      console.warn(`   ⚠️  Agent ${agent.name} has no credential assigned - cannot migrate phones`);
      return {
        campaignId,
        agentId,
        agentName: agent.name,
        migratedPhones: [],
        totalPhones: phoneNumberIds.length,
        successfulMigrations: 0,
        failedMigrations: phoneNumberIds.length,
        allPhonesReady: false,
        error: 'Agent has no ElevenLabs credential assigned'
      };
    }
    
    console.log(`   📱 Checking ${phoneNumberIds.length} phone(s) for campaign`);
    
    const results: PhoneMigrationResult[] = [];
    
    for (const phoneId of phoneNumberIds) {
      const result = await this.migratePhoneNumber(
        phoneId,
        targetCredentialId
      );
      results.push(result);
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const allReady = failed === 0;
    
    console.log(`📞 [Phone Migrator] Campaign migration complete: ${successful}/${results.length} successful`);
    
    return {
      campaignId,
      agentId,
      agentName: agent.name,
      migratedPhones: results,
      totalPhones: results.length,
      successfulMigrations: successful,
      failedMigrations: failed,
      allPhonesReady: allReady
    };
  }
  
  /**
   * Sync phone credential to match connected agent (for incoming connections)
   */
  static async syncPhoneToAgentCredential(
    phoneNumberId: string,
    agentId: string
  ): Promise<PhoneMigrationResult> {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    
    if (!agent || !agent.elevenLabsCredentialId) {
      return {
        success: false,
        phoneNumberId,
        phoneNumber: 'unknown',
        oldCredentialId: null,
        newCredentialId: '',
        oldElevenLabsPhoneId: null,
        newElevenLabsPhoneId: null,
        error: 'Agent not found or has no credential'
      };
    }
    
    return this.migratePhoneNumber(
      phoneNumberId,
      agent.elevenLabsCredentialId,
      agent.elevenLabsAgentId || undefined
    );
  }
  
  /**
   * Check if a phone needs migration to match its connected agent
   */
  static async checkMigrationNeeded(phoneNumberId: string): Promise<{
    needsMigration: boolean;
    phoneNumber: string;
    phoneCredentialId: string | null;
    agentCredentialId: string | null;
    agentName: string | null;
  }> {
    const [result] = await db
      .select({
        phoneNumber: phoneNumbers.phoneNumber,
        phoneCredentialId: phoneNumbers.elevenLabsCredentialId,
        agentId: incomingConnections.agentId
      })
      .from(phoneNumbers)
      .leftJoin(incomingConnections, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
      .where(eq(phoneNumbers.id, phoneNumberId))
      .limit(1);
    
    if (!result) {
      return {
        needsMigration: false,
        phoneNumber: 'unknown',
        phoneCredentialId: null,
        agentCredentialId: null,
        agentName: null
      };
    }
    
    if (!result.agentId) {
      return {
        needsMigration: false,
        phoneNumber: result.phoneNumber,
        phoneCredentialId: result.phoneCredentialId,
        agentCredentialId: null,
        agentName: null
      };
    }
    
    const [agent] = await db
      .select({
        name: agents.name,
        elevenLabsCredentialId: agents.elevenLabsCredentialId
      })
      .from(agents)
      .where(eq(agents.id, result.agentId))
      .limit(1);
    
    if (!agent) {
      return {
        needsMigration: false,
        phoneNumber: result.phoneNumber,
        phoneCredentialId: result.phoneCredentialId,
        agentCredentialId: null,
        agentName: null
      };
    }
    
    return {
      needsMigration: result.phoneCredentialId !== agent.elevenLabsCredentialId,
      phoneNumber: result.phoneNumber,
      phoneCredentialId: result.phoneCredentialId,
      agentCredentialId: agent.elevenLabsCredentialId,
      agentName: agent.name
    };
  }
  
  /**
   * Get system-wide migration status for admin view
   */
  static async getSystemMigrationStatus(): Promise<PhoneMigrationStatus[]> {
    const allPhones = await db
      .select({
        phoneNumberId: phoneNumbers.id,
        phoneNumber: phoneNumbers.phoneNumber,
        phoneCredentialId: phoneNumbers.elevenLabsCredentialId,
      })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.status, 'active'));
    
    const allConnections = await db
      .select({
        phoneNumberId: incomingConnections.phoneNumberId,
        agentId: incomingConnections.agentId,
      })
      .from(incomingConnections);
    
    const connectionMap = new Map(allConnections.map(c => [c.phoneNumberId, c.agentId]));
    
    const allAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        elevenLabsCredentialId: agents.elevenLabsCredentialId,
      })
      .from(agents);
    
    const agentMap = new Map(allAgents.map(a => [a.id, a]));
    
    const allCreds = await db.select().from(elevenLabsCredentials);
    const credMap = new Map(allCreds.map(c => [c.id, c.name]));
    
    const statusList: PhoneMigrationStatus[] = [];
    
    for (const row of allPhones) {
      const connectedAgentId = connectionMap.get(row.phoneNumberId);
      const connectedAgent = connectedAgentId ? agentMap.get(connectedAgentId) : null;
      
      const phoneCredentialName = row.phoneCredentialId ? credMap.get(row.phoneCredentialId) || 'Unknown' : 'None';
      const agentCredentialId = connectedAgent?.elevenLabsCredentialId || null;
      const agentCredentialName = agentCredentialId ? credMap.get(agentCredentialId) || 'Unknown' : 'None';
      
      const needsMigration = connectedAgent 
        ? row.phoneCredentialId !== agentCredentialId
        : false;
      
      statusList.push({
        phoneNumberId: row.phoneNumberId,
        phoneNumber: row.phoneNumber,
        phoneCredentialId: row.phoneCredentialId,
        phoneCredentialName,
        connectedAgentId: connectedAgentId || null,
        connectedAgentName: connectedAgent?.name || null,
        agentCredentialId,
        agentCredentialName,
        needsMigration
      });
    }
    
    return statusList;
  }
  
  /**
   * Migrate all mismatched phones system-wide (admin function)
   */
  static async migrateAllMismatchedPhones(): Promise<{
    totalChecked: number;
    totalMigrated: number;
    successful: number;
    failed: number;
    results: PhoneMigrationResult[];
  }> {
    // Acquire distributed lock for bulk migration
    const lockAcquired = await this.lockBulkMigration();
    if (!lockAcquired) {
      // Lock not acquired - another process has it, return without releasing
      console.warn(`📞 [Phone Migrator] Bulk migration already in progress - aborting`);
      return {
        totalChecked: 0,
        totalMigrated: 0,
        successful: 0,
        failed: 0,
        results: []
      };
    }
    
    // Lock acquired - ALL code paths after this point must release the lock
    try {
      console.log(`📞 [Phone Migrator] Starting system-wide migration check...`);
      
      const status = await this.getSystemMigrationStatus();
      const needsMigration = status.filter(s => s.needsMigration);
      
      console.log(`   📱 Found ${needsMigration.length}/${status.length} phones needing migration`);
      
      const results: PhoneMigrationResult[] = [];
      
      for (const phone of needsMigration) {
        if (phone.agentCredentialId && phone.connectedAgentId) {
          const [agent] = await db
            .select({ elevenLabsAgentId: agents.elevenLabsAgentId })
            .from(agents)
            .where(eq(agents.id, phone.connectedAgentId))
            .limit(1);
          
          const result = await this.migratePhoneNumber(
            phone.phoneNumberId,
            phone.agentCredentialId,
            agent?.elevenLabsAgentId || undefined
          );
          results.push(result);
        }
      }
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`📞 [Phone Migrator] System-wide migration complete: ${successful}/${results.length} successful`);
      
      return {
        totalChecked: status.length,
        totalMigrated: results.length,
        successful,
        failed,
        results
      };
    } finally {
      await this.unlockBulkMigration();
    }
  }
}

export default PhoneMigrator;
