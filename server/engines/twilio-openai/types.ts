'use strict';
/**
 * ============================================================
 * Twilio + OpenAI Realtime Engine - Type Definitions
 * 
 * Isolated engine for Twilio telephony with OpenAI Realtime API.
 * Completely separate from the Twilio + ElevenLabs integration.
 * ============================================================
 */

import type WebSocket from 'ws';

export type OpenAIVoice = 'alloy' | 'echo' | 'shimmer' | 'ash' | 'ballad' | 'coral' | 'sage' | 'verse' | 'cedar' | 'marin' | 'arjun' | 'priya';

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

export type TwilioOpenAICallStatus = 
  | 'pending'
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

export type CallDirection = 'inbound' | 'outbound';

export type CallSentiment = 'positive' | 'neutral' | 'negative';

export interface TwilioOpenAICall {
  id: string;
  
  userId: string | null;
  campaignId: string | null;
  contactId: string | null;
  agentId: string | null;
  
  twilioPhoneNumberId: string | null;
  openaiCredentialId: string | null;
  
  twilioCallSid: string | null;
  fromNumber: string;
  toNumber: string;
  
  openaiSessionId: string | null;
  openaiVoice: OpenAIVoice;
  openaiModel: OpenAIRealtimeModel;
  
  status: TwilioOpenAICallStatus;
  callDirection: CallDirection;
  
  duration: number | null;
  recordingUrl: string | null;
  recordingDuration: number | null;
  
  transcript: string | null;
  aiSummary: string | null;
  leadQualityScore: number | null;
  sentiment: CallSentiment | null;
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

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
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

export interface CallRecordingSummary {
  transcript: string;
  summary: string;
  leadQualityScore: number;
  sentiment: CallSentiment;
  keyPoints: string[];
  nextActions: string[];
}

export interface TwilioMediaStreamEvent {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
    customParameters?: Record<string, string>;
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
  mark?: {
    name: string;
  };
}

export interface TwilioWebhookParams {
  CallSid: string;
  AccountSid: string;
  From: string;
  To: string;
  CallStatus: string;
  Direction: string;
  ApiVersion?: string;
  ForwardedFrom?: string;
  CallerName?: string;
  ParentCallSid?: string;
  CallDuration?: string;
  RecordingUrl?: string;
  RecordingSid?: string;
  RecordingDuration?: string;
  Digits?: string;
  SpeechResult?: string;
  Confidence?: string;
}

export interface PendingAudioRequest {
  audioUrl: string;
  callId: string;
  timestamp: Date;
}

export interface AudioBridgeSession {
  callSid: string;
  streamSid: string | null;
  openaiSessionId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startedAt: Date;
  endedAt: Date | null;
  openaiWs: WebSocket | null;
  twilioWs: WebSocket | null;
  agentConfig: AgentConfig;
  transcriptParts: { role: 'user' | 'assistant'; text: string; timestamp: Date }[];
  toolHandlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;
  processedToolCallIds: Set<string>;
  onTranscriptCallback: ((text: string, isFinal: boolean) => void) | null;
  onToolCallback: ((toolName: string, params: Record<string, unknown>) => Promise<unknown>) | null;
  onAudioCallback: ((audioBase64: string) => void) | null;
  onEndCallback: ((sessionData: { transcript: string; duration: number; openaiSessionId: string }) => void) | null;
  endCallbackFired: boolean;
  firstMessageSent: boolean;
  twilioStreamReady: boolean;
  lastUserSpeechTime: number;
  fromNumber?: string;
  toNumber?: string;
  callDirection?: CallDirection;
  pendingAudioQueue: PendingAudioRequest[];
}

export interface CreateSessionParams {
  callSid: string;
  openaiApiKey: string;
  agentConfig: AgentConfig;
  twilioWs?: WebSocket;
  streamSid?: string;
  fromNumber?: string;
  toNumber?: string;
  callDirection?: CallDirection;
  credentialId?: string;
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
  { id: 'priya', name: 'Priya', description: 'Warm Indian female tone' },
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
