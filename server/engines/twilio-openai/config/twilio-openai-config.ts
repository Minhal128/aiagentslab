'use strict';
/**
 * ============================================================
 * Twilio + OpenAI Realtime Engine Configuration
 * 
 * Configuration for the isolated Twilio-OpenAI telephony engine.
 * Uses existing Twilio credentials from the database.
 * ============================================================
 */

import { getDomain } from '../../../utils/domain';

export interface TwilioOpenAIConfig {
  openaiRealtimeUrl: string;
  openaiRealtimeModel: string;
  defaultVoice: string;
  defaultTemperature: number;
  webhookTimeout: number;
  maxCallDuration: number;
  recordCalls: boolean;
}

export const TWILIO_OPENAI_CONFIG: TwilioOpenAIConfig = {
  openaiRealtimeUrl: 'wss://api.openai.com/v1/realtime',
  openaiRealtimeModel: 'gpt-realtime-1.5',
  defaultVoice: 'alloy',
  defaultTemperature: 0.7,
  webhookTimeout: 15000,
  maxCallDuration: 3600,
  recordCalls: true,
};

export function getWebhookBaseUrl(): string {
  return getDomain();
}

export function getAnswerWebhookUrl(): string {
  return `${getWebhookBaseUrl()}/api/twilio-openai/voice/answer`;
}

export function getStatusWebhookUrl(): string {
  return `${getWebhookBaseUrl()}/api/twilio-openai/voice/status`;
}

export function getStreamWebhookUrl(callSid: string): string {
  const baseUrl = getWebhookBaseUrl();
  const wsUrl = baseUrl.replace('https://', 'wss://').replace('http://', 'wss://');
  return `${wsUrl}/api/twilio-openai/stream/${callSid}`;
}

export function getIncomingWebhookUrl(): string {
  return `${getWebhookBaseUrl()}/api/twilio-openai/voice/incoming`;
}

export function getRecordingWebhookUrl(): string {
  return `${getWebhookBaseUrl()}/api/twilio-openai/voice/recording`;
}

export function generateTwiML(options: {
  message?: string;
  streamUrl: string;
  statusCallbackUrl?: string;
  customParameters?: Record<string, string>;
}): string {
  const { message, streamUrl, statusCallbackUrl, customParameters } = options;
  
  let customParamsXml = '';
  if (customParameters) {
    for (const [key, value] of Object.entries(customParameters)) {
      customParamsXml += `<Parameter name="${key}" value="${escapeXml(value)}" />`;
    }
  }
  
  const connectAction = statusCallbackUrl ? `action="${escapeXml(statusCallbackUrl)}"` : '';
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${message ? `<Say>${escapeXml(message)}</Say>` : ''}
  <Connect ${connectAction}>
    <Stream url="${escapeXml(streamUrl)}">
      ${customParamsXml}
    </Stream>
  </Connect>
</Response>`;
}

export function generateTransferTwiML(phoneNumber: string, callerId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerId)}">
    <Number>${escapeXml(phoneNumber)}</Number>
  </Dial>
</Response>`;
}

export function generateHangupTwiML(message?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${message ? `<Say>${escapeXml(message)}</Say>` : ''}
  <Hangup/>
</Response>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
