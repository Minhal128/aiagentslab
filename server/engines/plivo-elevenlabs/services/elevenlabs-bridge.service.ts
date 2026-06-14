'use strict';
/**
 * ============================================================
 * ElevenLabs Bridge Service (Plivo-ElevenLabs Engine)
 * 
 * Bridges audio between Plivo SIP trunk and ElevenLabs Conversational AI.
 * This is ISOLATED from the Twilio+ElevenLabs and Plivo+OpenAI integrations.
 * 
 * Session keys are namespaced with "plivo-elevenlabs:" prefix to avoid
 * collisions with other engines.
 * 
 * Flow:
 * 1. Plivo calls → Incoming webhook creates bridge session
 * 2. Plivo connects stream WebSocket
 * 3. Audio bridge converts and forwards audio bidirectionally
 * ============================================================
 */

import WebSocket from 'ws';
import { AudioConverter } from './audio-converter';
import type { CallSession, TranscriptPart, ElevenLabsAgentConfig, ElevenLabsWebSocketMessage } from '../types';
import { PlivoElevenLabsConfig } from '../config/config';
import { logger } from '../../../utils/logger';

const SESSION_PREFIX = 'plivo-elevenlabs:';
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface CreateBridgeSessionParams {
  callUuid: string;
  agentId: string;
  elevenLabsApiKey: string;
  agentConfig?: ElevenLabsAgentConfig;
  fromNumber: string;
  toNumber: string;
  direction: 'inbound' | 'outbound';
}

export class ElevenLabsBridgeService {
  private static activeSessions: Map<string, CallSession> = new Map();
  private static cleanupTimer: ReturnType<typeof setInterval> | null = null;
  
  private static getSessionKey(callUuid: string): string {
    return `${SESSION_PREFIX}${callUuid}`;
  }
  
  private static ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
    }, SESSION_CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
  
  private static cleanupStaleSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of Array.from(this.activeSessions.entries())) {
      const age = now - session.startedAt.getTime();
      if (age > SESSION_MAX_AGE_MS) {
        logger.warn(`Cleaning up stale session ${key} (age: ${Math.round(age / 1000)}s)`, undefined, 'PlivoElevenLabsBridge');
        if (session.elevenLabsWs && (session.elevenLabsWs as any).readyState === WebSocket.OPEN) {
          (session.elevenLabsWs as any).close();
        }
        this.activeSessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale sessions, ${this.activeSessions.size} remaining`, undefined, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Create a new bridge session between Plivo and ElevenLabs
   */
  static async createSession(params: CreateBridgeSessionParams): Promise<CallSession> {
    const { callUuid, agentId, elevenLabsApiKey, agentConfig, fromNumber, toNumber, direction } = params;
    
    this.ensureCleanupTimer();
    
    const sessionKey = this.getSessionKey(callUuid);
    
    logger.info(`Creating session ${sessionKey}`, undefined, 'PlivoElevenLabsBridge');
    logger.info(`Agent ID: ${agentId}`, undefined, 'PlivoElevenLabsBridge');
    
    const session: CallSession = {
      callUuid,
      streamSid: '',
      elevenLabsWs: null,
      plivoWs: null,
      status: 'connecting',
      startedAt: new Date(),
      endedAt: null,
      agentId,
      fromNumber,
      toNumber,
      direction,
      transcript: [],
    };
    
    this.activeSessions.set(sessionKey, session);
    
    try {
      await this.connectToElevenLabs(session, elevenLabsApiKey, agentConfig);
      return session;
    } catch (error: any) {
      logger.error('Failed to create session', error.message, 'PlivoElevenLabsBridge');
      session.status = 'error';
      this.activeSessions.delete(sessionKey);
      throw error;
    }
  }
  
  /**
   * Connect to ElevenLabs WebSocket
   */
  private static async connectToElevenLabs(
    session: CallSession,
    apiKey: string,
    agentConfig?: ElevenLabsAgentConfig
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const agentId = agentConfig?.agentId || session.agentId;
      const wsUrl = `${PlivoElevenLabsConfig.elevenLabsWebSocketUrl}?agent_id=${agentId}`;
      
      logger.info(`Connecting to ElevenLabs: agent=${agentId}`, undefined, 'PlivoElevenLabsBridge');
      
      const ws = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': apiKey,
        },
      });
      
      session.elevenLabsWs = ws as any;
      
      ws.on('open', () => {
        logger.info(`ElevenLabs WebSocket connected for ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');
        session.status = 'connected';
        
        const initMessage: any = {
          type: 'conversation_initiation_client_data',
          conversation_config_override: {
            agent: {
              first_message: agentConfig?.firstMessage,
              language: agentConfig?.language || 'en',
            },
            tts: {
              voice_id: agentConfig?.voiceId,
            },
          },
        };
        
        if (agentConfig?.dynamicData && Object.keys(agentConfig.dynamicData).length > 0) {
          initMessage.dynamic_data = agentConfig.dynamicData;
          logger.info(`Sending dynamic_data with ${Object.keys(agentConfig.dynamicData).length} variables`, undefined, 'PlivoElevenLabsBridge');
        }
        
        ws.send(JSON.stringify(initMessage));
        resolve();
      });
      
      ws.on('message', (data) => {
        this.handleElevenLabsMessage(session, data.toString());
      });
      
      ws.on('error', (error) => {
        logger.error('ElevenLabs WebSocket error', error, 'PlivoElevenLabsBridge');
        session.status = 'error';
        reject(error);
      });
      
      ws.on('close', (code, reason) => {
        logger.info(`ElevenLabs WebSocket closed: ${code}`, undefined, 'PlivoElevenLabsBridge');
        session.status = 'disconnected';
        session.endedAt = new Date();
      });
      
      setTimeout(() => {
        if (session.status === 'connecting') {
          reject(new Error('ElevenLabs WebSocket connection timeout'));
        }
      }, PlivoElevenLabsConfig.defaults.connectionTimeout);
    });
  }
  
  /**
   * Handle messages from ElevenLabs
   */
  private static handleElevenLabsMessage(session: CallSession, data: string): void {
    try {
      const message: ElevenLabsWebSocketMessage = JSON.parse(data);
      
      switch (message.type) {
        case 'conversation_initiation_metadata':
          session.conversationId = message.conversation_id;
          logger.info(`Conversation started: ${message.conversation_id}`, undefined, 'PlivoElevenLabsBridge');
          break;
          
        case 'audio':
          if (message.audio?.chunk) {
            const pcmBuffer = AudioConverter.decodeBase64(message.audio.chunk);
            const mulawBuffer = AudioConverter.pcm16ToMulaw(pcmBuffer);
            const mulawBase64 = AudioConverter.encodeBase64(mulawBuffer);
            
            this.sendToPlivoStream(session, mulawBase64);
          }
          break;
          
        case 'user_transcript':
          if (message.user_transcript?.is_final) {
            session.transcript.push({
              role: 'user',
              text: message.user_transcript.text,
              timestamp: new Date(),
            });
            logger.info(`User: "${message.user_transcript.text.substring(0, 80)}..."`, undefined, 'PlivoElevenLabsBridge');
          }
          break;
          
        case 'agent_response':
          if (message.agent_response?.is_final) {
            session.transcript.push({
              role: 'agent',
              text: message.agent_response.text,
              timestamp: new Date(),
            });
            logger.info(`Agent: "${message.agent_response.text.substring(0, 80)}..."`, undefined, 'PlivoElevenLabsBridge');
          }
          break;
          
        case 'ping':
          if (message.ping_event?.event_id) {
            const pongMessage = {
              type: 'pong',
              event_id: message.ping_event.event_id,
            };
            if (session.elevenLabsWs && (session.elevenLabsWs as any).readyState === WebSocket.OPEN) {
              (session.elevenLabsWs as any).send(JSON.stringify(pongMessage));
            }
          }
          break;
          
        case 'error':
          logger.error('ElevenLabs error', message.error, 'PlivoElevenLabsBridge');
          break;
          
        default:
          break;
      }
    } catch (error: any) {
      logger.error('Error handling message', error.message, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Send audio to Plivo stream
   */
  private static sendToPlivoStream(session: CallSession, audioBase64: string): void {
    if (!session.plivoWs || (session.plivoWs as any).readyState !== WebSocket.OPEN) {
      return;
    }
    
    const mediaMessage = {
      event: 'media',
      streamSid: session.streamSid,
      media: {
        payload: audioBase64,
      },
    };
    
    (session.plivoWs as any).send(JSON.stringify(mediaMessage));
  }
  
  /**
   * Handle incoming audio from Plivo
   */
  static async handlePlivoAudio(callUuid: string, audioBase64: string): Promise<void> {
    const sessionKey = this.getSessionKey(callUuid);
    const session = this.activeSessions.get(sessionKey);
    
    if (!session) {
      return;
    }
    
    if (!session.elevenLabsWs || (session.elevenLabsWs as any).readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      const mulawBuffer = AudioConverter.decodeBase64(audioBase64);
      const pcmBuffer = AudioConverter.mulawToPcm16(mulawBuffer);
      const pcmBase64 = AudioConverter.encodeBase64(pcmBuffer);
      
      const audioMessage = {
        user_audio_chunk: pcmBase64,
      };
      
      (session.elevenLabsWs as any).send(JSON.stringify(audioMessage));
    } catch (error: any) {
      logger.error('Error processing audio', error.message, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Set the Plivo WebSocket for a session
   */
  static setPlivoWebSocket(callUuid: string, plivoWs: WebSocket, streamSid: string): void {
    const sessionKey = this.getSessionKey(callUuid);
    const session = this.activeSessions.get(sessionKey);
    
    if (session) {
      session.plivoWs = plivoWs as any;
      session.streamSid = streamSid;
      logger.info(`Plivo WebSocket set for ${callUuid}, streamSid: ${streamSid}`, undefined, 'PlivoElevenLabsBridge');
    } else {
      logger.warn(`No session found for ${callUuid} when setting Plivo WebSocket`, undefined, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Get active session
   */
  static getSession(callUuid: string): CallSession | undefined {
    const sessionKey = this.getSessionKey(callUuid);
    return this.activeSessions.get(sessionKey);
  }
  
  /**
   * Check if a session exists
   */
  static hasSession(callUuid: string): boolean {
    const sessionKey = this.getSessionKey(callUuid);
    return this.activeSessions.has(sessionKey);
  }
  
  /**
   * End a bridge session
   */
  static async endSession(callUuid: string): Promise<{
    duration: number;
    transcript: TranscriptPart[];
  }> {
    const sessionKey = this.getSessionKey(callUuid);
    const session = this.activeSessions.get(sessionKey);
    
    if (!session) {
      return { duration: 0, transcript: [] };
    }
    
    logger.info(`Ending session for ${callUuid}`, undefined, 'PlivoElevenLabsBridge');
    
    session.status = 'disconnected';
    session.endedAt = new Date();
    
    if (session.elevenLabsWs && (session.elevenLabsWs as any).readyState === WebSocket.OPEN) {
      (session.elevenLabsWs as any).close();
    }
    
    const duration = Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000);
    const transcript = [...session.transcript];
    
    this.activeSessions.delete(sessionKey);
    
    return { duration, transcript };
  }
  
  /**
   * Get all active sessions (for monitoring)
   */
  static getActiveSessions(): Map<string, CallSession> {
    return this.activeSessions;
  }
  
  /**
   * Get session count (for monitoring)
   */
  static getSessionCount(): number {
    return this.activeSessions.size;
  }
}
