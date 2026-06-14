/**
 * @fileoverview ElevenLabs Migration Engine - Type Definitions
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Type definitions for the dynamic migration engine that handles
 * automatic resource migration between ElevenLabs API keys.
 */

export interface MigrationResult {
  success: boolean;
  migratedAgents: MigratedAgent[];
  migratedPhones: MigratedPhone[];
  error?: string;
  fromCredentialId: string;
  toCredentialId: string;
  duration: number;
}

export interface MigratedAgent {
  localId: string;
  oldElevenLabsId: string;
  newElevenLabsId: string;
  name: string;
}

export interface MigratedPhone {
  localId: string;
  oldElevenLabsId: string;
  newElevenLabsId: string;
  phoneNumber: string;
}

export interface AgentFullConfig {
  agent_id: string;
  name: string;
  conversation_config: {
    agent?: {
      prompt?: {
        prompt?: string;
        llm?: string;
        temperature?: number;
        tools?: any[];
        knowledge_base?: any[];
      };
      first_message?: string;
      language?: string;
    };
    tts?: {
      voice_id?: string;
      model_id?: string;
      stability?: number;
      similarity_boost?: number;
      speed?: number;
      agent_output_audio_format?: string;
    };
    asr?: {
      provider?: string;
      model?: string;
      user_input_audio_format?: string;
      keywords?: string[];
    };
    turn?: {
      turn_timeout?: number;
      silence_end_call_timeout?: number;
      turn_eagerness?: string;
      mode?: string;
    };
    conversation?: {
      max_duration_seconds?: number;
      client_events?: string[];
    };
  };
  workflow?: {
    nodes?: Record<string, any>;
    edges?: Record<string, any>;
  };
  platform_settings?: {
    webhook?: {
      url?: string;
      secret?: string;
    };
    overrides?: Record<string, any>;
  };
  metadata?: {
    created_at_unix_secs?: number;
    updated_at_unix_secs?: number;
  };
}

export interface PhoneFullConfig {
  phone_number_id: string;
  phone_number: string;
  label?: string;
  agent_id?: string;
  supports_inbound?: boolean;
  supports_outbound?: boolean;
}

export interface ConcurrencyError {
  isConcurrencyError: boolean;
  message: string;
  statusCode?: number;
  rawError?: string;
}

export interface AvailableCredential {
  id: string;
  name: string;
  apiKey: string;
  currentLoad: number;
  maxConcurrency: number;
  availableCapacity: number;
}

export interface RetryQueueItem {
  campaignId: string;
  userId: string;
  agentId: string;
  phoneNumberId: string;
  originalCredentialId: string;
  retryCount: number;
  lastRetryAt: Date;
  nextRetryAt: Date;
  error: string;
}

export interface MigrationOptions {
  skipAgents?: boolean;
  skipPhones?: boolean;
  dryRun?: boolean;
  preserveInboundConnections?: boolean;
}

export type MigrationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'partial';

export interface MigrationLog {
  id: string;
  userId: string;
  fromCredentialId: string;
  toCredentialId: string;
  status: MigrationStatus;
  agentsCount: number;
  phonesCount: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  details: {
    agents: MigratedAgent[];
    phones: MigratedPhone[];
  };
}

/**
 * Phone Number Migration Types
 * 
 * Used by PhoneMigrator for cross-credential phone migration
 */
export interface PhoneMigrationResult {
  success: boolean;
  phoneNumberId: string;
  phoneNumber: string;
  oldCredentialId: string | null;
  newCredentialId: string;
  oldElevenLabsPhoneId: string | null;
  newElevenLabsPhoneId: string | null;
  error?: string;
}

export interface AgentPhoneMigrationResult {
  agentId: string;
  agentName: string;
  migratedPhones: PhoneMigrationResult[];
  totalPhones: number;
  successfulMigrations: number;
  failedMigrations: number;
}

export interface CampaignPhoneMigrationResult {
  campaignId: string;
  agentId: string;
  agentName: string;
  migratedPhones: PhoneMigrationResult[];
  totalPhones: number;
  successfulMigrations: number;
  failedMigrations: number;
  allPhonesReady: boolean;
  error?: string;
}

export interface PhoneMigrationStatus {
  phoneNumberId: string;
  phoneNumber: string;
  phoneCredentialId: string | null;
  phoneCredentialName: string;
  connectedAgentId: string | null;
  connectedAgentName: string | null;
  agentCredentialId: string | null;
  agentCredentialName: string;
  needsMigration: boolean;
}
