'use strict';
/**
 * ============================================================
 * Plivo + OpenAI Realtime Engine - Type Definitions
 * ============================================================
 */

export type OpenAIVoice = 'alloy' | 'echo' | 'shimmer' | 'ash' | 'ballad' | 'coral' | 'sage' | 'verse' | 'cedar' | 'marin' | 'arjun';

export type OpenAIRealtimeModel = 
  | 'gpt-realtime-2'
  | 'gpt-realtime-translate'
  | 'gpt-realtime-whisper'
  | 'gpt-realtime-1.5'
  | 'gpt-realtime' 
  | 'gpt-realtime-mini'
  | 'gpt-4o-realtime-preview'
  | 'gpt-4o-mini-realtime-preview';

export type ModelTier = 'free' | 'pro';

export type TelephonyProvider = 'twilio' | 'plivo';

export type PlivoCallStatus = 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';

export type PlivoKycStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'requires_resubmission';

export interface OpenAICredential {
  id: string;
  name: string;
  apiKey: string;
  modelTier: ModelTier;
  isActive: boolean;
  maxConcurrency: number;
  currentLoad: number;
  totalAssignedAgents: number;
  totalAssignedUsers: number;
  maxAgentsThreshold: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlivoCredential {
  id: string;
  name: string;
  authId: string;
  authToken: string;
  isActive: boolean;
  isPrimary: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PlivoPhoneStatus = 'active' | 'pending' | 'released' | 'suspended';
export type PlivoNumberType = 'local' | 'toll_free' | 'national';

export interface PlivoPhoneCapabilities {
  voice: boolean;
  sms: boolean;
}

export interface PlivoKycDocumentUrls {
  identity_proof?: string;
  address_proof?: string;
  business_registration?: string;
}

export interface PlivoPhoneNumber {
  id: string;
  userId: string | null;
  plivoCredentialId: string | null;
  openaiCredentialId: string | null;
  phoneNumber: string;
  plivoNumberId: string;
  friendlyName: string | null;
  country: string;
  region: string | null;
  numberType: PlivoNumberType;
  capabilities: PlivoPhoneCapabilities | null;
  status: PlivoPhoneStatus;
  kycStatus: PlivoKycStatus | null;
  kycDocumentUrls: PlivoKycDocumentUrls | null;
  kycSubmittedAt: Date | null;
  kycApprovedAt: Date | null;
  kycRejectionReason: string | null;
  purchaseCredits: number;
  monthlyCredits: number;
  nextBillingDate: Date | null;
  assignedAgentId: string | null;
  purchasedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PlivoCallSentiment = 'positive' | 'neutral' | 'negative';

export interface PlivoCall {
  id: string;
  userId: string | null;
  campaignId: string | null;
  contactId: string | null;
  agentId: string | null;
  plivoPhoneNumberId: string | null;
  openaiCredentialId: string | null;
  plivoCallUuid: string | null;
  fromNumber: string;
  toNumber: string;
  openaiSessionId: string | null;
  openaiVoice: OpenAIVoice;
  openaiModel: OpenAIRealtimeModel;
  status: PlivoCallStatus | 'pending';
  callDirection: 'inbound' | 'outbound';
  duration: number | null;
  recordingUrl: string | null;
  recordingDuration: number | null;
  transcript: string | null;
  aiSummary: string | null;
  leadQualityScore: number | null;
  sentiment: PlivoCallSentiment | null;
  keyPoints: string[] | null;
  nextActions: string[] | null;
  wasTransferred: boolean;
  transferredTo: string | null;
  transferredAt: Date | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AudioStreamConfig {
  plivoCallUuid: string;
  openaiApiKey: string;
  agentConfig: {
    voice: OpenAIVoice;
    model: OpenAIRealtimeModel;
    systemPrompt: string;
    tools?: AgentTool[];
  };
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface CallRecordingSummary {
  transcript: string;
  summary: string;
  leadQualityScore: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  keyPoints: string[];
  nextActions: string[];
}

export interface VADSettings {
  type?: 'server_vad' | 'semantic_vad';
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  eagerness?: 'low' | 'medium' | 'high' | 'auto';
}

export interface AgentConfig {
  voice: OpenAIVoice;
  model: OpenAIRealtimeModel;
  systemPrompt: string;
  firstMessage?: string;
  temperature?: number;
  tools?: AgentTool[];
  knowledgeBaseIds?: string[];
  flowConfig?: CompiledFlowConfig;
  vadSettings?: VADSettings;
  transferPhoneNumber?: string;
}

export interface CompiledFlowConfig {
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: Record<string, unknown>;
}

export interface FlowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface FlowEdge {
  source: string;
  target: string;
  condition?: string;
}

export const OPENAI_VOICES: { id: OpenAIVoice; name: string; description: string }[] = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, versatile voice' },
  { id: 'echo', name: 'Echo', description: 'Warm, engaging voice' },
  { id: 'shimmer', name: 'Shimmer', description: 'Expressive, dynamic voice' },
  { id: 'ash', name: 'Ash', description: 'Calm, measured voice' },
  { id: 'ballad', name: 'Ballad', description: 'Warm, melodic voice' },
  { id: 'coral', name: 'Coral', description: 'Clear, friendly voice' },
  { id: 'sage', name: 'Sage', description: 'Thoughtful, wise voice' },
  { id: 'verse', name: 'Verse', description: 'Poetic, expressive voice' },
  { id: 'cedar', name: 'Cedar', description: 'Deep, grounded voice' },
  { id: 'marin', name: 'Marin', description: 'Bright, cheerful voice' },
  { id: 'arjun', name: 'Arjun', description: 'Warm Indian tone' },
];

export const MODEL_TIER_CONFIG: Record<ModelTier, { models: OpenAIRealtimeModel[]; description: string }> = {
  free: {
    models: ['gpt-realtime-mini', 'gpt-4o-mini-realtime-preview'],
    description: 'GPT Realtime Mini - Cost-effective model',
  },
  pro: {
    models: ['gpt-realtime-2', 'gpt-realtime-translate', 'gpt-realtime-whisper', 'gpt-realtime-1.5', 'gpt-realtime', 'gpt-realtime-mini', 'gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview'],
    description: 'Full model access including GPT Realtime 2 and 1.5 (recommended)',
  },
};

// Plivo Phone Pricing (admin-configured per country)
export interface PlivoPhonePricing {
  id: string;
  countryCode: string;
  countryName: string;
  purchaseCredits: number;
  monthlyCredits: number;
  kycRequired: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Agent with telephony provider configuration
export interface AgentTelephonyConfig {
  telephonyProvider: TelephonyProvider;
  // ElevenLabs config (when telephonyProvider='twilio')
  elevenLabsCredentialId?: string;
  elevenLabsVoiceId?: string;
  elevenLabsAgentId?: string;
  // OpenAI config (when telephonyProvider='plivo')
  openaiCredentialId?: string;
  openaiVoice?: OpenAIVoice;
}

// ============================================================
// Plivo SDK Response Types
// The Plivo SDK has incomplete TypeScript definitions, so we
// define our own interfaces based on their API documentation
// ============================================================

import type WebSocket from 'ws';

/** WebSocket type alias for audio bridge sessions */
export type BridgeWebSocket = WebSocket;

/** Plivo call initiation response */
export interface PlivoCallInitiateResponse {
  requestUuid?: string;
  request_uuid?: string;
  apiId?: string;
  api_id?: string;
  message?: string;
}

/** Single phone number from Plivo search results */
export interface PlivoNumberSearchResult {
  number: string;
  type?: string;
  sub_type?: string;
  city?: string;
  region?: string;
  country?: string;
  voice_enabled?: boolean;
  sms_enabled?: boolean;
  monthly_rental_rate?: string;
  setup_rate?: string;
  voice_rate?: string;
  sms_rate?: string;
}

/** Plivo phone number search response */
export interface PlivoNumberSearchResponse {
  api_id?: string;
  meta?: {
    limit?: number;
    offset?: number;
    total_count?: number;
    next?: string;
    previous?: string;
  };
  objects?: PlivoNumberSearchResult[];
}

/** Plivo number purchase response */
export interface PlivoNumberPurchaseResponse {
  api_id?: string;
  message?: string;
  numbers?: Array<{ number: string; status: string }>;
  number?: string;
  status?: string;
}

/** Plivo owned number from list API */
export interface PlivoOwnedNumber {
  number: string;
  alias?: string;
  application?: string;
  carrier?: string;
  monthly_rental_rate?: string;
  resource_uri?: string;
  app_id?: string;
  appId?: string;
}

/** Plivo number list response */
export interface PlivoNumberListResponse {
  api_id?: string;
  meta?: {
    limit?: number;
    offset?: number;
    total_count?: number;
  };
  objects?: PlivoOwnedNumber[];
}

/** Plivo application object */
export interface PlivoApplication {
  app_id?: string;
  appId?: string;
  app_name?: string;
  appName?: string;
  answer_url?: string;
  answer_method?: string;
  hangup_url?: string;
  hangup_method?: string;
  resource_uri?: string;
}

/** Plivo application create response */
export interface PlivoApplicationCreateResponse {
  api_id?: string;
  app_id?: string;
  appId?: string;
  message?: string;
}

/** Plivo application list response */
export interface PlivoApplicationListResponse {
  api_id?: string;
  meta?: {
    limit?: number;
    offset?: number;
    total_count?: number;
  };
  objects?: PlivoApplication[];
}
