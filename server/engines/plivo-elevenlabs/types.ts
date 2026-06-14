'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs SIP Trunk Engine - Types
 * 
 * This is a SEPARATE engine from the Twilio+ElevenLabs integration.
 * It connects Plivo SIP trunk to ElevenLabs Conversational AI.
 * ============================================================
 */

export interface PlivoElevenLabsConfig {
  plivoAuthId: string;
  plivoAuthToken: string;
  elevenLabsApiKey: string;
  sipTrunkCredentialUuid?: string;
  sipTrunkEndpointUuid?: string;
}

export interface ElevenLabsAgentConfig {
  agentId: string;
  firstMessage?: string;
  systemPrompt?: string;
  voiceId?: string;
  temperature?: number;
  maxDuration?: number;
  language?: string;
  dynamicData?: Record<string, string>;
}

export interface CallSession {
  callUuid: string;
  streamSid: string;
  elevenLabsWs: WebSocket | null;
  plivoWs: WebSocket | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startedAt: Date;
  endedAt: Date | null;
  agentId: string;
  fromNumber: string;
  toNumber: string;
  direction: 'inbound' | 'outbound';
  transcript: TranscriptPart[];
  conversationId?: string;
}

export interface TranscriptPart {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export type PlivoCallStatus = 
  | 'ringing'
  | 'answered'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

export interface PlivoWebhookPayload {
  CallUUID: string;
  From: string;
  To: string;
  Direction: string;
  CallStatus?: string;
  Duration?: string;
  HangupCause?: string;
  RecordUrl?: string;
  RecordingDuration?: string;
}

export interface ElevenLabsWebSocketMessage {
  type: string;
  audio?: {
    chunk?: string;
    format?: string;
    sample_rate?: number;
  };
  user_transcript?: {
    text: string;
    is_final: boolean;
  };
  agent_response?: {
    text: string;
    is_final: boolean;
  };
  conversation_id?: string;
  ping_event?: {
    event_id: number;
  };
  error?: {
    message: string;
    code?: string;
  };
}
