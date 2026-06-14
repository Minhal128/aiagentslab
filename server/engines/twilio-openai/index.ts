'use strict';
/**
 * ============================================================
 * Twilio + OpenAI Realtime Engine
 * 
 * Isolated engine for Twilio telephony with OpenAI Realtime API.
 * Completely separate from:
 * - Twilio + ElevenLabs integration (existing)
 * - Plivo + OpenAI integration (existing)
 * ============================================================
 */

export * from './types';
export * from './config/twilio-openai-config';
export * from './services';
export { default as twilioOpenaiWebhookRoutes } from './routes/twilio-openai-webhooks';
export { setupTwilioOpenAIStreamHandler } from './routes/twilio-openai-stream';
export { twilioOpenaiIncomingConnectionsRoutes } from './routes/twilio-openai-incoming-connections';
