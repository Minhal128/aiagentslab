'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs SIP Trunk Engine - Configuration
 * 
 * Separate configuration for Plivo SIP trunk to ElevenLabs.
 * Does NOT interfere with existing Twilio+ElevenLabs setup.
 * ============================================================
 */

import { getDomain } from '../../../utils/domain';

export const PlivoElevenLabsConfig = {
  elevenLabsWebSocketUrl: 'wss://api.elevenlabs.io/v1/convai/conversation',
  
  audioFormat: {
    plivoCodec: 'PCMU',
    plivoSampleRate: 8000,
    elevenLabsFormat: 'pcm_16000',
    elevenLabsSampleRate: 16000,
  },
  
  defaults: {
    maxCallDuration: 600,
    connectionTimeout: 10000,
  },
};

export function getWebhookBaseUrl(): string {
  return getDomain();
}

export function getSipWebhookUrl(path: string): string {
  const baseUrl = getWebhookBaseUrl();
  return `${baseUrl}/api/plivo-elevenlabs${path}`;
}

export function getSipStreamUrl(callUuid: string): string {
  const baseUrl = getWebhookBaseUrl();
  const wsBaseUrl = baseUrl.replace(/^http/, 'ws');
  return `${wsBaseUrl}/api/plivo-elevenlabs/stream/${callUuid}`;
}
