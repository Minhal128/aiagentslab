/**
 * @fileoverview ElevenLabs Migration Engine - Resource Migrator
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Handles the actual migration of agents and phone numbers
 * between ElevenLabs API keys.
 */

import { db } from '../../db';
import { agents, phoneNumbers } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { ElevenLabsService } from '../../services/elevenlabs';
import { getTwilioAccountSid, getTwilioAuthToken } from '../../services/twilio-connector';
import { 
  AgentFullConfig, 
  PhoneFullConfig, 
  MigratedAgent, 
  MigratedPhone 
} from './types';
import { formatErrorForLog } from './error-detector';
import { logger } from '../../utils/logger';

/**
 * Migrate a single agent from one credential to another
 * 
 * Flow:
 * 1. GET full agent config from old key
 * 2. CREATE agent on new key with same config
 * 3. PATCH workflow if exists
 * 4. DELETE agent from old key
 * 5. UPDATE local database with new IDs
 * 
 * @param localAgentId - Local database agent ID
 * @param fromApiKey - Source ElevenLabs API key
 * @param toApiKey - Destination ElevenLabs API key
 * @param toCredentialId - Destination credential ID for DB update
 * @returns MigratedAgent result
 */
export async function migrateAgent(
  localAgentId: string,
  fromApiKey: string,
  toApiKey: string,
  toCredentialId: string
): Promise<MigratedAgent> {
  logger.info(`Starting agent migration: ${localAgentId}`, undefined, 'Migration');
  
  const [localAgent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, localAgentId))
    .limit(1);

  if (!localAgent) {
    throw new Error(`Agent not found in local database: ${localAgentId}`);
  }

  if (!localAgent.elevenLabsAgentId) {
    throw new Error(`Agent has no ElevenLabs ID: ${localAgentId}`);
  }

  const oldElevenLabsId = localAgent.elevenLabsAgentId;
  logger.info(`Old ElevenLabs ID: ${oldElevenLabsId}`, undefined, 'Migration');

  const fromService = new ElevenLabsService(fromApiKey);
  let fullConfig: AgentFullConfig;
  
  try {
    const rawConfig = await fromService.getAgent(oldElevenLabsId);
    fullConfig = rawConfig as unknown as AgentFullConfig;
    logger.info(`Fetched full config for agent: ${fullConfig.name}`, undefined, 'Migration');
  } catch (error) {
    logger.error('Failed to fetch agent config', formatErrorForLog(error), 'Migration');
    throw new Error(`Failed to fetch agent config from source key: ${formatErrorForLog(error)}`);
  }

  const toService = new ElevenLabsService(toApiKey);
  let newElevenLabsId: string;

  try {
    const agentConfig = fullConfig.conversation_config?.agent;
    const ttsConfig = fullConfig.conversation_config?.tts;
    
    const createResult = await toService.createAgent({
      name: fullConfig.name,
      prompt: agentConfig?.prompt?.prompt || '',
      voice_id: ttsConfig?.voice_id || 'cjVigY5qzO86Huf0OWal',
      language: agentConfig?.language || 'en',
      model: agentConfig?.prompt?.llm || 'gpt-4o-mini',
      temperature: agentConfig?.prompt?.temperature ?? 0.5,
      first_message: agentConfig?.first_message || 'Hello! How can I help you today?',
      voiceStability: ttsConfig?.stability ?? 0.5,
      voiceSimilarityBoost: ttsConfig?.similarity_boost ?? 0.85,
      voiceSpeed: ttsConfig?.speed ?? 1.0,
      tools: agentConfig?.prompt?.tools,
      skipWorkflow: true,
    });
    
    newElevenLabsId = createResult.agent_id;
    logger.info(`Created agent on new key: ${newElevenLabsId}`, undefined, 'Migration');
  } catch (error) {
    logger.error('Failed to create agent on new key', formatErrorForLog(error), 'Migration');
    throw new Error(`Failed to create agent on destination key: ${formatErrorForLog(error)}`);
  }

  if (fullConfig.workflow && Object.keys(fullConfig.workflow.nodes || {}).length > 0) {
    try {
      logger.info('Applying workflow to new agent...', undefined, 'Migration');
      await toService.patchAgentRaw(newElevenLabsId, {
        workflow: fullConfig.workflow,
      });
      logger.info('Workflow applied successfully', undefined, 'Migration');
    } catch (error) {
      logger.warn('Failed to apply workflow (non-critical)', formatErrorForLog(error), 'Migration');
    }
  }

  if (fullConfig.platform_settings?.webhook) {
    try {
      logger.info('Applying platform settings...', undefined, 'Migration');
      await toService.patchAgentRaw(newElevenLabsId, {
        platform_settings: fullConfig.platform_settings,
      });
      logger.info('Platform settings applied', undefined, 'Migration');
    } catch (error) {
      logger.warn('Failed to apply platform settings (non-critical)', formatErrorForLog(error), 'Migration');
    }
  }

  try {
    await fromService.deleteAgent(oldElevenLabsId);
    logger.info(`Deleted agent from old key: ${oldElevenLabsId}`, undefined, 'Migration');
  } catch (error) {
    logger.warn('Failed to delete agent from old key (non-critical)', formatErrorForLog(error), 'Migration');
  }

  await db
    .update(agents)
    .set({
      elevenLabsAgentId: newElevenLabsId,
      elevenLabsCredentialId: toCredentialId,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, localAgentId));

  logger.info('Updated local database with new ElevenLabs ID', undefined, 'Migration');

  return {
    localId: localAgentId,
    oldElevenLabsId,
    newElevenLabsId,
    name: localAgent.name,
  };
}

/**
 * Migrate a single phone number from one credential to another
 * 
 * Flow:
 * 1. DELETE phone number from old key
 * 2. CREATE (sync) phone number on new key with Twilio credentials
 * 3. PATCH to enable outbound support
 * 4. UPDATE local database with new IDs
 * 
 * @param localPhoneId - Local database phone number ID
 * @param fromApiKey - Source ElevenLabs API key
 * @param toApiKey - Destination ElevenLabs API key
 * @param toCredentialId - Destination credential ID for DB update
 * @returns MigratedPhone result
 */
export async function migratePhoneNumber(
  localPhoneId: string,
  fromApiKey: string,
  toApiKey: string,
  toCredentialId: string
): Promise<MigratedPhone> {
  logger.info(`Starting phone number migration: ${localPhoneId}`, undefined, 'Migration');

  const [localPhone] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.id, localPhoneId))
    .limit(1);

  if (!localPhone) {
    throw new Error(`Phone number not found in local database: ${localPhoneId}`);
  }

  if (!localPhone.elevenLabsPhoneNumberId) {
    throw new Error(`Phone number has no ElevenLabs ID: ${localPhoneId}`);
  }

  const oldElevenLabsId = localPhone.elevenLabsPhoneNumberId;
  logger.info(`Old ElevenLabs ID: ${oldElevenLabsId}`, undefined, 'Migration');
  logger.info(`Phone Number: ${localPhone.phoneNumber}`, undefined, 'Migration');

  const fromService = new ElevenLabsService(fromApiKey);
  
  try {
    await fromService.deletePhoneNumber(oldElevenLabsId);
    logger.info(`Deleted phone from old key: ${oldElevenLabsId}`, undefined, 'Migration');
  } catch (error) {
    logger.warn('Failed to delete phone from old key (continuing)', formatErrorForLog(error), 'Migration');
  }

  const toService = new ElevenLabsService(toApiKey);
  let newElevenLabsId: string;

  try {
    const twilioAccountSid = await getTwilioAccountSid();
    const twilioAuthToken = await getTwilioAuthToken();

    const syncResult = await toService.syncPhoneNumberToElevenLabs({
      phoneNumber: localPhone.phoneNumber,
      twilioAccountSid,
      twilioAuthToken,
      label: localPhone.phoneNumber,
      enableOutbound: true,
    });
    
    newElevenLabsId = syncResult.phone_number_id;
    logger.info(`Synced phone to new key: ${newElevenLabsId}`, undefined, 'Migration');
  } catch (error) {
    logger.error('Failed to sync phone to new key', formatErrorForLog(error), 'Migration');
    throw new Error(`Failed to sync phone to destination key: ${formatErrorForLog(error)}`);
  }

  await db
    .update(phoneNumbers)
    .set({
      elevenLabsPhoneNumberId: newElevenLabsId,
      elevenLabsCredentialId: toCredentialId,
    })
    .where(eq(phoneNumbers.id, localPhoneId));

  logger.info('Updated local database with new ElevenLabs ID', undefined, 'Migration');

  return {
    localId: localPhoneId,
    oldElevenLabsId,
    newElevenLabsId,
    phoneNumber: localPhone.phoneNumber,
  };
}

/**
 * Verify an agent exists on a specific credential
 * 
 * @param elevenLabsAgentId - The ElevenLabs agent ID to verify
 * @param apiKey - The API key to check against
 * @returns boolean indicating if agent exists
 */
export async function verifyAgentOnCredential(
  elevenLabsAgentId: string,
  apiKey: string
): Promise<boolean> {
  try {
    const service = new ElevenLabsService(apiKey);
    await service.getAgent(elevenLabsAgentId);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Verify a phone number exists on a specific credential
 * 
 * @param elevenLabsPhoneId - The ElevenLabs phone number ID to verify
 * @param apiKey - The API key to check against
 * @returns boolean indicating if phone exists
 */
export async function verifyPhoneOnCredential(
  elevenLabsPhoneId: string,
  apiKey: string
): Promise<boolean> {
  try {
    const service = new ElevenLabsService(apiKey);
    await service.getPhoneNumber(elevenLabsPhoneId);
    return true;
  } catch (error) {
    return false;
  }
}
