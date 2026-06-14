'use strict';
/**
 * ============================================================
 * Plivo + OpenAI Realtime Engine - Entry Point
 * 
 * This engine provides an alternative to ElevenLabs for voice AI:
 * - Plivo for telephony (supports India + international numbers)
 * - OpenAI Realtime API for conversational AI
 * - @openai/agents SDK for agent orchestration
 * ============================================================
 */

export * from './types';
export { PlivoEngineConfig, getWebhookUrl, getStreamUrl } from './config/plivo-config';

export { OpenAIPoolService } from './services/openai-pool.service';
export { PlivoCallService } from './services/plivo-call.service';
export { createPlivoApiRoutes } from './routes/plivo-api';

export { PlivoPhoneService } from './services/plivo-phone.service';

export { OpenAIAgentFactory } from './services/openai-agent-factory';
export { AudioBridgeService } from './services/audio-bridge.service';
export { setupPlivoWebhooks } from './routes/plivo-webhooks';
export { setupPlivoStream } from './routes/plivo-stream';
