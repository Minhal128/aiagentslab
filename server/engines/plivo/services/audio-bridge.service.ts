'use strict';
/**
 * ============================================================
 * Audio Bridge Service
 * 
 * Bridges audio between Plivo and OpenAI Realtime API:
 * - Receives mulaw 8kHz audio from Plivo WebSocket
 * - Converts to PCM16 24kHz for OpenAI Realtime API
 * - Sends back converted audio to Plivo
 * - Handles tool calls, transcripts, and interruptions
 * ============================================================
 */

import WebSocket from 'ws';
import * as plivo from 'plivo';
import axios from 'axios';
import type { AgentConfig, AgentTool, OpenAIVoice, OpenAIRealtimeModel } from '../types';
import { logger } from '../../../utils/logger';
import { getDomain } from '../../../utils/domain';
import { getTransferWebhookUrl } from '../config/plivo-config';
import { PlivoRecordingService } from './plivo-recording.service';
import { db } from '../../../db';
import { plivoCredentials, plivoCalls, agents, appointments } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { openaiPoolManager } from '../../../infrastructure';

/**
 * Mulaw decoding table (256 entries for byte values 0-255)
 */
const MULAW_DECODE_TABLE: Int16Array = new Int16Array([
  -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
  -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
  -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
  -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
  -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
  -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
  -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
  -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
  -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
  -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
  -876, -844, -812, -780, -748, -716, -684, -652,
  -620, -588, -556, -524, -492, -460, -428, -396,
  -372, -356, -340, -324, -308, -292, -276, -260,
  -244, -228, -212, -196, -180, -164, -148, -132,
  -120, -112, -104, -96, -88, -80, -72, -64,
  -56, -48, -40, -32, -24, -16, -8, 0,
  32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
  23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
  15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
  11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
  7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
  5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
  3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
  2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
  1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
  1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
  876, 844, 812, 780, 748, 716, 684, 652,
  620, 588, 556, 524, 492, 460, 428, 396,
  372, 356, 340, 324, 308, 292, 276, 260,
  244, 228, 212, 196, 180, 164, 148, 132,
  120, 112, 104, 96, 88, 80, 72, 64,
  56, 48, 40, 32, 24, 16, 8, 0
]);

/**
 * Session state for each active audio bridge
 */
export interface AudioBridgeSession {
  callUuid: string;
  openaiSessionId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startedAt: Date;
  endedAt: Date | null;
  openaiWs: WebSocket | null;
  plivoWs: WebSocket | null;
  streamSid: string | null;
  agentConfig: AgentConfig;
  transcriptParts: { role: 'user' | 'assistant'; text: string; timestamp: Date }[];
  toolHandlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;
  processedToolCallIds: Set<string>;
  onTranscriptCallback: ((text: string, isFinal: boolean) => void) | null;
  onToolCallback: ((toolName: string, params: Record<string, unknown>) => Promise<unknown>) | null;
  onAudioCallback: ((audioBase64: string) => void) | null;
  onEndCallback: (() => void) | null;
  inputAudioBuffer: Buffer[];
  lastUserSpeechTime: number;
  fromNumber?: string;
  toNumber?: string;
  plivoCredentialId?: string;
  callDirection?: 'inbound' | 'outbound';
  firstMessageSent: boolean;
  plivoStreamReady: boolean;
  recordingId: string | null;
  recordingStartTime: Date | null;
  recordingActive: boolean;
  callRecordId: string | null;
  greetingGraceUntil: number;
}

/**
 * Parameters for creating an audio bridge session
 */
export interface CreateSessionParams {
  callUuid: string;
  openaiApiKey: string;
  agentConfig: AgentConfig;
  plivoWs?: WebSocket;
  streamSid?: string;
  fromNumber?: string;
  toNumber?: string;
  plivoCredentialId?: string;
  callDirection?: 'inbound' | 'outbound';
  callRecordId?: string;
}

export class AudioBridgeService {
  private static activeSessions: Map<string, AudioBridgeSession> = new Map();
  private static pendingTransfers: Map<string, { targetNumber: string; callerId: string }> = new Map();
  private static readonly OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';

  private static readonly INPUT_SAMPLE_RATE = 8000;  // Plivo mulaw
  private static readonly OUTPUT_SAMPLE_RATE = 24000; // OpenAI Realtime

  static setPendingTransfer(callUuid: string, data: { targetNumber: string; callerId: string }): void {
    this.pendingTransfers.set(callUuid, data);
    logger.info(`[Transfer] Stored pending transfer for ${callUuid} to ${data.targetNumber}`, undefined, 'AudioBridge');
  }

  static getPendingTransfer(callUuid: string): { targetNumber: string; callerId: string } | undefined {
    return this.pendingTransfers.get(callUuid);
  }

  static clearPendingTransfer(callUuid: string): void {
    this.pendingTransfers.delete(callUuid);
  }

  /**
   * Create a new audio bridge session between Plivo and OpenAI
   */
  static async createSession(params: CreateSessionParams): Promise<AudioBridgeSession> {
    const { callUuid, openaiApiKey, agentConfig, plivoWs, streamSid, fromNumber, toNumber, plivoCredentialId, callDirection } = params;

    logger.info(`Creating session for call ${callUuid}`, undefined, 'AudioBridge');
    logger.info(`Voice: ${agentConfig.voice}, Model: ${agentConfig.model}`, undefined, 'AudioBridge');

    // Ensure pool manager settings are loaded
    if (!openaiPoolManager.isSettingsLoaded()) {
      await openaiPoolManager.loadSettings();
    }

    // Check if we can reserve a slot in the OpenAI pool
    const credentialId = plivoCredentialId || 'default';
    if (!openaiPoolManager.canReserveSlot(credentialId)) {
      logger.warn(`OpenAI pool limit reached for credential ${credentialId}`, undefined, 'AudioBridge');
      throw new Error('OpenAI connection limit reached. Please try again later.');
    }

    const session: AudioBridgeSession = {
      callUuid,
      openaiSessionId: '',
      status: 'connecting',
      startedAt: new Date(),
      endedAt: null,
      openaiWs: null,
      plivoWs: plivoWs || null,
      streamSid: streamSid || null,
      agentConfig,
      transcriptParts: [],
      toolHandlers: new Map(),
      processedToolCallIds: new Set<string>(),
      onTranscriptCallback: null,
      onToolCallback: null,
      onAudioCallback: null,
      onEndCallback: null,
      inputAudioBuffer: [],
      lastUserSpeechTime: Date.now(),
      fromNumber,
      toNumber,
      plivoCredentialId,
      callDirection,
      firstMessageSent: false,
      plivoStreamReady: false,
      recordingId: null,
      recordingStartTime: null,
      recordingActive: false,
      callRecordId: params.callRecordId || null,
      greetingGraceUntil: 0,
    };

    // Register tool handlers from agent config
    if (agentConfig.tools) {
      for (const tool of agentConfig.tools) {
        if (tool.handler) {
          session.toolHandlers.set(tool.name, tool.handler);
        } else {
          logger.warn(`Tool "${tool.name}" has no handler — will not be dispatchable`, undefined, 'AudioBridge');
        }
      }
    }

    this.activeSessions.set(callUuid, session);

    try {
      // Connect to OpenAI Realtime API
      await this.connectToOpenAI(session, openaiApiKey);
      return session;
    } catch (error: any) {
      logger.error(`Failed to create session: ${error.message}`, error, 'AudioBridge');
      session.status = 'error';
      throw error;
    }
  }

  /**
   * Connect to OpenAI Realtime API WebSocket
   */
  private static async connectToOpenAI(session: AudioBridgeSession, apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { agentConfig, callUuid } = session;

      // Resolve internal model alias to real OpenAI model ID
      const wsUrl = `${this.OPENAI_REALTIME_URL}?model=${agentConfig.model}`;

      logger.info(`Connecting to OpenAI Realtime: ${agentConfig.model}`, undefined, 'AudioBridge');

      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      session.openaiWs = ws;

      ws.on('open', () => {
        logger.info(`OpenAI WebSocket connected for ${callUuid}`, undefined, 'AudioBridge');
        session.status = 'connected';

        // Register connection with the pool manager
        openaiPoolManager.addConnection(
          session.callUuid,
          ws,
          session.openaiSessionId,
          session.plivoCredentialId || 'default'
        );

        // Configure the session
        this.configureSession(session);
        resolve();
      });

      ws.on('message', (data) => {
        this.handleOpenAIMessage(session, data.toString());
      });

      ws.on('error', (error) => {
        logger.error(`OpenAI WebSocket error for ${callUuid}`, error, 'AudioBridge');
        session.status = 'error';
        openaiPoolManager.removeConnection(session.callUuid);
        reject(error);
      });

      ws.on('close', async (code, reason) => {
        logger.info(`OpenAI WebSocket closed for ${callUuid}: ${code} ${reason}`, undefined, 'AudioBridge');
        session.status = 'disconnected';
        openaiPoolManager.removeConnection(session.callUuid);

        // Stop recording on session end
        await AudioBridgeService.stopSessionRecording(session);

        if (session.onEndCallback) {
          session.onEndCallback();
        }
      });

      // Timeout for connection
      setTimeout(() => {
        if (session.status === 'connecting') {
          reject(new Error('OpenAI WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Configure the OpenAI Realtime session
   */
  private static configureSession(session: AudioBridgeSession): void {
    const { agentConfig, openaiWs } = session;
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    // Build tools array for OpenAI
    const tools: any[] = [];
    if (agentConfig.tools) {
      for (const tool of agentConfig.tools) {
        tools.push({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        });
      }
    }

    // VAD configuration with semantic VAD support
    // Improved defaults for better call quality - less aggressive interruption
    const vadSettings = agentConfig.vadSettings || {};
    const vadType = vadSettings.type ?? 'server_vad';
    const vadThreshold = vadSettings.threshold ?? 0.3;
    const vadPrefixPaddingMs = vadSettings.prefixPaddingMs ?? 200;
    // ponytail: 1000ms gives the caller a full second of silence before the agent
    // replies, instead of jumping in after a brief pause mid-sentence.
    const vadSilenceDurationMs = vadSettings.silenceDurationMs ?? 1000;
    const vadEagerness = vadSettings.eagerness ?? 'medium';

    logger.info(`VAD settings: type=${vadType}, threshold=${vadThreshold}, prefix=${vadPrefixPaddingMs}ms, silence=${vadSilenceDurationMs}ms`, undefined, 'AudioBridge');

    const turnDetection = vadType === 'semantic_vad'
      ? {
        type: 'semantic_vad',
        eagerness: vadEagerness,
        create_response: true,
        interrupt_response: true,
      }
      : {
        type: 'server_vad',
        threshold: vadThreshold,
        prefix_padding_ms: vadPrefixPaddingMs,
        silence_duration_ms: vadSilenceDurationMs,
        create_response: true,
        interrupt_response: true,
      };

    // Append mandatory function calling requirements to system prompt
    const functionCallingRequirements = `

STRICT CONVERSATION RULES — ALWAYS FOLLOW:
1. ONE sentence per turn. Stop. Wait for the caller to respond. Never speak two turns in a row without hearing the caller.
2. If the caller starts speaking while you are talking — STOP IMMEDIATELY. Listen. Then respond to what they said.
3. Never repeat the same sentence or idea twice in a conversation. If you already said something, do not say it again.
4. Never ask for information the caller already provided. Remember everything from earlier in the call.
5. Do NOT keep redirecting to the same person or action repeatedly. Once you have mentioned something, move on.

BOOKING RULE — CRITICAL:
- Before confirming a specific date/time, call check_availability with the date the caller mentioned and offer 2-3 of the open slots it returns.
- Once the caller picks an open slot, call book_appointment IMMEDIATELY. Do not say "I am booking" — just call the tool silently and then confirm once it succeeds.
- contactPhone is auto-filled from the caller's number. You do NOT need to ask for it, ever.
- contactName defaults to "Customer" if unknown. Do NOT block the booking waiting for a name.
- Never ask the same question twice or restate information the caller already gave you — track what you already have and move straight to the next missing piece, or call the tool.
- After confirming the booking, always say a brief warm closing (e.g. "Thank you, have a great day!") BEFORE calling end_call. Never hang up silently.

TOOL RULES:
- submit_form: call it immediately when form data is collected. Do NOT say you submitted without calling it.
- end_call: only after saying a short goodbye AND the caller has said goodbye or confirmed they are done. Never call end_call as your only action in a turn — always speak a closing line first.
- If a tool returns error: say it failed ONCE, then move forward. Never retry.

BACKGROUND NOISE: Ignore all background sound. Only respond to the primary caller.`;

    const enhancedInstructions = agentConfig.systemPrompt + functionCallingRequirements;

    // GA Realtime API format: session.type is required, audio config is nested
    // under audio.input/audio.output, and temperature is no longer supported.
    const sessionConfig = {
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: enhancedInstructions,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: this.OUTPUT_SAMPLE_RATE },
            turn_detection: turnDetection,
            transcription: { model: 'whisper-1' },
          },
          output: {
            format: { type: 'audio/pcm', rate: this.OUTPUT_SAMPLE_RATE },
            voice: agentConfig.voice,
          },
        },
        tools,
        tool_choice: tools.length > 0 ? 'auto' : 'none',
      },
    };

    logger.info(`Configuring session with ${tools.length} tools, VAD=${vadType}`, undefined, 'AudioBridge');
    if (tools.length > 0) {
      logger.info(`Tools configured: ${tools.map((t: any) => t.name || t.function?.name).join(', ')}`, undefined, 'AudioBridge');
    }
    openaiWs.send(JSON.stringify(sessionConfig));

    // First message is now sent when Plivo stream starts (see markStreamReady)
    // This ensures the audio is not lost before the stream is ready
    if (agentConfig.firstMessage) {
      logger.info(`First message configured, will send when Plivo stream is ready for ${session.callUuid}`, undefined, 'AudioBridge');
    }
  }

  /**
   * Mark the Plivo stream as ready and attempt to send the first message
   * This should be called when the 'start' event is received from Plivo
   */
  static markStreamReady(callUuid: string): void {
    const session = this.activeSessions.get(callUuid);
    if (!session) return;

    session.plivoStreamReady = true;
    logger.info(`Plivo stream marked as ready for ${callUuid}`, undefined, 'AudioBridge');
    this.trySendFirstMessage(session);

    // Start recording after 2 seconds to let call stabilize
    if (session.callRecordId) {
      setTimeout(async () => {
        if (session.status !== 'connected') {
          logger.info(`[AudioBridge] Session no longer connected, skipping recording for ${callUuid}`, undefined, 'AudioBridge');
          return;
        }

        logger.info(`[AudioBridge] Recording enabled for ${callUuid}`, undefined, 'AudioBridge');

        const plivoCallUuid = session.callUuid;
        const result = await PlivoRecordingService.startRecording({
          callUuid: plivoCallUuid,
          callRecordId: session.callRecordId!,
          plivoCredentialId: session.plivoCredentialId,
        });

        if (result.success) {
          // Plivo's async API may not return recordingId immediately - it comes via callback
          // Mark the session as recording active so we know to stop it later
          session.recordingStartTime = new Date();
          session.recordingActive = true;
          logger.info(`[AudioBridge] ✓ Recording started for ${callUuid}`, undefined, 'AudioBridge');

          if (result.recordingId) {
            session.recordingId = result.recordingId;
            logger.info(`[AudioBridge] Recording ID: ${result.recordingId}`, undefined, 'AudioBridge');

            // Update database with recording ID if provided
            if (session.callRecordId) {
              try {
                await db.update(plivoCalls)
                  .set({ recordingId: result.recordingId })
                  .where(eq(plivoCalls.id, session.callRecordId));
              } catch (err: any) {
                logger.error(`[AudioBridge] Failed to save recording ID: ${err.message}`, err, 'AudioBridge');
              }
            }
          } else {
            logger.info(`[AudioBridge] Recording ID will be provided via callback for ${callUuid}`, undefined, 'AudioBridge');
          }
        } else {
          logger.error(`[AudioBridge] Failed to start recording for ${callUuid}: ${result.error}`, undefined, 'AudioBridge');
        }
      }, 2000);
    }
  }

  /**
   * Attempt to send the first message if all conditions are met:
   * - Not already sent
   * - Plivo stream is ready
   * - OpenAI session is connected
   * - Agent has a first message configured
   */
  private static trySendFirstMessage(session: AudioBridgeSession): void {
    if (session.firstMessageSent) return;
    if (!session.plivoStreamReady) return;
    if (session.status !== 'connected') return;
    if (!session.agentConfig.firstMessage) return;

    session.firstMessageSent = true;
    logger.info(`Plivo stream ready, sending first message for ${session.callUuid}`, undefined, 'AudioBridge');
    this.sendAgentMessage(session, session.agentConfig.firstMessage);
  }

  /**
   * Send a text message for the agent to speak
   * Uses response.create with instructions to speak the exact greeting text
   * per official OpenAI Realtime API documentation
   */
  private static sendAgentMessage(session: AudioBridgeSession, text: string): void {
    const { openaiWs, callUuid } = session;
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    logger.info(`Sending first message for ${callUuid}: "${text.substring(0, 50)}..."`, undefined, 'AudioBridge');

    // ponytail: line-connect noise/click right at pickup can trip VAD's
    // speech_started within milliseconds of the greeting starting, cancelling
    // it before a single word plays. Give the greeting a short grace window
    // where a false-positive barge-in is ignored instead of killing it.
    session.greetingGraceUntil = Date.now() + 1500;

    // Use response.create with instructions to speak the specific first message.
    // When the Hindi persona is active, deliver the greeting IN Hindi (conveying
    // meaning) instead of word-for-word, so a first message written in any
    // language still opens the call in the agent's Hindi tone.
    // ponytail: marker string must match buildIndianPersona()'s persona text.
    const hindiPersona = (session.agentConfig.systemPrompt || '').includes('everyday Hindi by DEFAULT');
    const instructions = hindiPersona
      ? `IMPORTANT: Greet the caller now by conveying the following message in natural, everyday spoken Hindi (Hinglish is fine) — keep the meaning but say it in Hindi even if the text below is in English. Then STOP and WAIT for the user to respond. Do NOT add any follow-up questions or extra content. Message: "${text}"`
      : `IMPORTANT: Say ONLY the following greeting message word-for-word, then STOP and WAIT for the user to respond. Do NOT add any follow-up questions or additional content. Just say this exact message and wait: "${text}"`;

    openaiWs.send(JSON.stringify({
      type: 'response.create',
      response: { instructions },
    }));
  }

  /**
   * Handle messages from OpenAI Realtime API
   */
  private static async handleOpenAIMessage(session: AudioBridgeSession, data: string): Promise<void> {
    try {
      const message = JSON.parse(data);
      const { callUuid } = session;

      switch (message.type) {
        case 'session.created':
          session.openaiSessionId = message.session?.id || `session-${Date.now()}`;
          logger.info(`Session created: ${session.openaiSessionId}`, undefined, 'AudioBridge');
          break;

        case 'session.updated':
          logger.info(`Session updated for ${callUuid}`, undefined, 'AudioBridge');
          break;

        case 'response.audio.delta':
        case 'response.output_audio.delta':
          // Receive audio chunk from OpenAI (PCM16 24kHz base64)
          if (message.delta) {
            const pcmBase64 = message.delta;
            const pcmBuffer = Buffer.from(pcmBase64, 'base64');

            // Convert PCM16 24kHz to mulaw 8kHz for Plivo
            const mulawBuffer = this.pcm16ToMulaw(pcmBuffer);
            const mulawBase64 = mulawBuffer.toString('base64');

            // Send to Plivo via callback
            if (session.onAudioCallback) {
              session.onAudioCallback(mulawBase64);
            }

            // Send directly to Plivo WebSocket
            // Plivo bidirectional streams use 'playAudio' event (not 'media' like Twilio)
            if (session.plivoWs && session.plivoWs.readyState === WebSocket.OPEN) {
              const mediaMessage: Record<string, unknown> = {
                event: 'playAudio',
                media: {
                  contentType: 'audio/x-mulaw',
                  sampleRate: 8000,
                  payload: mulawBase64,
                },
              };
              session.plivoWs.send(JSON.stringify(mediaMessage));
            }
          }
          break;

        case 'response.audio.done':
        case 'response.output_audio.done':
          logger.info(`Audio response complete for ${callUuid}`, undefined, 'AudioBridge');
          break;

        case 'response.audio_transcript.delta':
        case 'response.output_audio_transcript.delta':
          // Agent speech transcript (streaming)
          if (message.delta && session.onTranscriptCallback) {
            session.onTranscriptCallback(message.delta, false);
          }
          break;

        case 'response.audio_transcript.done':
        case 'response.output_audio_transcript.done':
          // Agent speech transcript (final)
          if (message.transcript) {
            session.transcriptParts.push({
              role: 'assistant',
              text: message.transcript,
              timestamp: new Date(),
            });
            if (session.onTranscriptCallback) {
              session.onTranscriptCallback(message.transcript, true);
            }
            logger.info(`Agent said: "${message.transcript.substring(0, 100)}..."`, undefined, 'AudioBridge');
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User speech transcript
          if (message.transcript) {
            session.transcriptParts.push({
              role: 'user',
              text: message.transcript,
              timestamp: new Date(),
            });
            logger.info(`User said: "${message.transcript.substring(0, 100)}..."`, undefined, 'AudioBridge');
          }
          break;

        case 'input_audio_buffer.speech_started':
          session.lastUserSpeechTime = Date.now();
          if (Date.now() < session.greetingGraceUntil) {
            logger.info('Ignored speech_started during greeting grace window (likely pickup noise)', undefined, 'AudioBridge');
            break;
          }
          logger.info('User started speaking (barge-in detected)', undefined, 'AudioBridge');
          // CRITICAL: Immediately cancel current response and clear audio buffer
          // This prevents the "rushing through" behavior when user interrupts
          this.handleBargeIn(session);
          break;

        case 'input_audio_buffer.speech_stopped':
          logger.info('User stopped speaking', undefined, 'AudioBridge');
          break;

        case 'response.function_call_arguments.done':
          // Tool call from agent - this is the ONLY place we handle tool calls
          // Do NOT also handle in response.done to avoid duplicate execution
          await this.handleToolCall(session, message);
          break;

        case 'response.done':
          // Response complete - tool calls are already handled by response.function_call_arguments.done
          // Do NOT iterate output here as it causes duplicate tool execution
          {
            const outputItems = message.response?.output || [];
            const outputTypes = outputItems.map((o: any) => o.type).join(', ');
            const status = message.response?.status || 'unknown';
            const statusDetails = message.response?.status_details;
            if (statusDetails?.error) {
              logger.error(`Response failed for ${callUuid}: ${statusDetails.error.type} - ${statusDetails.error.message}`, undefined, 'AudioBridge');
            } else {
              logger.info(`Response complete for ${callUuid} (status: ${status}, outputs: ${outputTypes || 'none'})`, undefined, 'AudioBridge');
            }
          }
          break;

        case 'error':
          // Suppress harmless error that occurs during barge-in when trying to cancel an already completed response
          if (message.error?.code === 'response_cancel_not_active') {
            logger.info(`Ignored benign error during barge-in for ${callUuid}: ${message.error.message}`, undefined, 'AudioBridge');
          } else {
            logger.error(`OpenAI error for ${callUuid}`, message.error, 'AudioBridge');
          }
          break;

        default:
          // Log other message types for debugging
          if (message.type && !message.type.includes('delta')) {
            logger.info(`Event: ${message.type}`, undefined, 'AudioBridge');
          }
      }
      // Update activity for pool manager
      openaiPoolManager.updateActivity(session.callUuid);
    } catch (error: any) {
      logger.error('Error handling OpenAI message', error, 'AudioBridge');
    }
  }

  /**
   * Handle tool calls from OpenAI agent
   */
  private static async handleToolCall(
    session: AudioBridgeSession,
    message: { name?: string; call_id?: string; arguments?: string }
  ): Promise<void> {
    const { callUuid } = session;
    const toolName = message.name;
    const callId = message.call_id;

    if (!toolName || !callId) {
      logger.warn(`Invalid tool call for ${callUuid}`, undefined, 'AudioBridge');
      return;
    }

    // Deduplicate: skip if we've already processed this tool call
    if (session.processedToolCallIds.has(callId)) {
      logger.info(`Skipping duplicate tool call: ${toolName} (${callId})`, undefined, 'AudioBridge');
      return;
    }
    session.processedToolCallIds.add(callId);

    logger.info(`Tool call: ${toolName} for ${callUuid}`, undefined, 'AudioBridge');

    try {
      // Parse arguments
      let params: Record<string, unknown> = {};
      if (message.arguments) {
        try {
          params = JSON.parse(message.arguments);
        } catch (e) {
          logger.warn('Failed to parse tool arguments', undefined, 'AudioBridge');
        }
      }

      // Execute tool handler
      let result: unknown;

      // Handle end_call as a special built-in tool (same as Twilio bridge)
      if (toolName === 'end_call') {
        logger.info(`Built-in end_call tool invoked for ${callUuid}`, undefined, 'AudioBridge');
        result = {
          action: 'end_call',
          reason: (params.reason as string) || 'Call ended by agent',
          ...params
        };
      }
      // Handle transfer_call and transfer_* as built-in tools for flow agents
      else if (toolName === 'transfer_call' || toolName.startsWith('transfer_')) {
        logger.info(`Built-in transfer tool invoked: ${toolName} for ${callUuid}`, undefined, 'AudioBridge');

        // Get target number from params or tool metadata
        // Flow transfer nodes use _metadata.phoneNumber, direct transfer uses destination
        let targetNumber = (params.destination as string) || (params.phoneNumber as string) || '';

        // If no destination in params, check if there's a default transfer number in agent config
        if (!targetNumber && session.agentConfig.transferPhoneNumber) {
          targetNumber = session.agentConfig.transferPhoneNumber;
        }

        // If still no number, look for it in the tools array (flow agents store it as _transferNumber)
        // First try to match by the exact tool name, then fall back to any transfer tool
        if (!targetNumber && session.agentConfig.tools) {
          // First pass: look for exact tool name match
          for (const tool of session.agentConfig.tools) {
            const toolAny = tool as unknown as Record<string, unknown>;
            if (tool.name === toolName) {
              if (toolAny._transferNumber) {
                targetNumber = toolAny._transferNumber as string;
                logger.info(`Found transfer number from matching tool ${toolName}: ${targetNumber}`, undefined, 'AudioBridge');
                break;
              } else if (toolAny._metadata && (toolAny._metadata as Record<string, unknown>).phoneNumber) {
                targetNumber = (toolAny._metadata as Record<string, unknown>).phoneNumber as string;
                logger.info(`Found transfer number from matching tool ${toolName} metadata: ${targetNumber}`, undefined, 'AudioBridge');
                break;
              }
            }
          }

          // Second pass: if no match found, look for any transfer tool with a phone number
          if (!targetNumber) {
            for (const tool of session.agentConfig.tools) {
              const toolAny = tool as unknown as Record<string, unknown>;
              if (tool.name === 'transfer_call' || tool.name.startsWith('transfer_')) {
                if (toolAny._transferNumber) {
                  targetNumber = toolAny._transferNumber as string;
                  logger.info(`Found transfer number from tool ${tool.name} _transferNumber: ${targetNumber}`, undefined, 'AudioBridge');
                  break;
                } else if (toolAny._metadata && (toolAny._metadata as Record<string, unknown>).phoneNumber) {
                  targetNumber = (toolAny._metadata as Record<string, unknown>).phoneNumber as string;
                  logger.info(`Found transfer number from tool ${tool.name} _metadata: ${targetNumber}`, undefined, 'AudioBridge');
                  break;
                }
              }
            }
          }
        }

        if (!targetNumber) {
          logger.warn(`No transfer destination found for ${toolName}`, undefined, 'AudioBridge');
          result = {
            error: 'No transfer destination specified',
            message: 'Cannot transfer - no phone number provided.'
          };
        } else {
          result = {
            action: 'transfer',
            phoneNumber: targetNumber,
            reason: (params.reason as string) || (params.context as string) || 'Transfer requested',
          };
        }
      }
      // Handle play_audio tool
      else if (toolName === 'play_audio' || toolName.startsWith('play_audio_')) {
        // First check params (direct call), then look up from tool _metadata (flow compiled tools)
        let audioUrl = params.audioUrl as string || params.audio_url as string || '';

        // If no audioUrl in params, look it up from the tool's _metadata
        if (!audioUrl && session.agentConfig.tools) {
          for (const tool of session.agentConfig.tools) {
            const toolAny = tool as unknown as Record<string, unknown>;
            if (tool.name === toolName) {
              if (toolAny._metadata && (toolAny._metadata as Record<string, unknown>).audioUrl) {
                audioUrl = (toolAny._metadata as Record<string, unknown>).audioUrl as string;
                logger.info(`Found audioUrl from tool ${toolName} _metadata: ${audioUrl}`, undefined, 'AudioBridge');
                break;
              }
            }
          }
        }

        logger.info(`Play audio tool invoked for ${callUuid}: ${audioUrl}`, undefined, 'AudioBridge');

        if (audioUrl) {
          // Execute Plivo Play API to play audio on the call
          const playResult = await this.executePlayAudio(session, audioUrl);
          result = {
            action: 'play_audio',
            audioUrl,
            success: playResult.success,
            message: playResult.success
              ? 'Audio is now playing on the call.'
              : `Audio playback failed: ${playResult.error}`
          };
        } else {
          result = {
            action: 'play_audio',
            audioUrl: '',
            success: false,
            message: 'No audio URL found for playback.'
          };
        }
      }
      // Handle collect_caller_email tool - stores email in call metadata for post-call trigger
      else if (toolName === 'collect_caller_email') {
        logger.info(`collect_caller_email tool invoked for ${callUuid}`, undefined, 'AudioBridge');
        result = await this.handleCollectCallerEmail(session, callUuid, params);
      }
      // Handle send_email messaging tool
      else if (toolName === 'send_email') {
        logger.info(`Messaging send_email tool invoked for ${callUuid}`, undefined, 'AudioBridge');
        result = await this.handleSendEmail(session, params);
      }
      // Handle send_whatsapp messaging tool
      else if (toolName === 'send_whatsapp') {
        logger.info(`Messaging send_whatsapp tool invoked for ${callUuid}`, undefined, 'AudioBridge');
        result = await this.handleSendWhatsApp(session, params);
      } else {
        const handler = session.toolHandlers.get(toolName);

        if (handler) {
          result = await handler(params);
        } else if (session.onToolCallback) {
          result = await session.onToolCallback(toolName, params);
        } else {
          result = { error: `Unknown tool: ${toolName}` };
        }
      }

      logger.info(`Tool ${toolName} result: ${JSON.stringify(result).substring(0, 200)}`, undefined, 'AudioBridge');

      // Update call metadata for successful tool executions (for CRM Lead Processor)
      if (typeof result === 'object' && result !== null) {
        const toolResult = result as Record<string, unknown>;

        // Track successful appointment bookings
        if (toolName === 'book_appointment' && toolResult.success === true) {
          await this.updateCallMetadata(callUuid, {
            appointmentBooked: true,
            hasAppointment: true,
            appointmentData: {
              appointmentId: toolResult.appointmentId,
              message: toolResult.message,
              bookedAt: new Date().toISOString(),
            },
            aiInsights: {
              primaryOutcome: 'appointment_booked',
              appointmentBooked: true,
            },
          });
        }

        // Track successful form submissions
        if (toolName === 'submit_form' && toolResult.success === true) {
          await this.updateCallMetadata(callUuid, {
            formSubmitted: true,
            hasFormSubmission: true,
            formData: {
              submissionId: toolResult.submissionId,
              message: toolResult.message,
              submittedAt: new Date().toISOString(),
            },
            aiInsights: {
              primaryOutcome: 'form_submitted',
              formSubmitted: true,
            },
          });
        }
      }

      // Handle special tool results
      if (typeof result === 'object' && result !== null) {
        const actionResult = result as Record<string, unknown>;

        if (actionResult.action === 'transfer') {
          const targetNumber = actionResult.phoneNumber as string;
          logger.info(`Executing transfer to ${targetNumber}`, undefined, 'AudioBridge');

          const transferResult = await this.executeTransfer(session, targetNumber);
          if (!transferResult.success) {
            result = {
              ...actionResult,
              transferError: transferResult.error,
              message: 'Transfer failed, please try again or inform the caller.'
            };
          } else {
            result = {
              ...actionResult,
              transferSuccess: true,
              message: 'Transfer initiated successfully.'
            };

            // Update metadata for successful transfer
            await this.updateCallMetadata(callUuid, {
              wasTransferred: true,
              hasTransfer: true,
              transferredTo: targetNumber,
              transferredAt: new Date().toISOString(),
              aiInsights: {
                primaryOutcome: 'call_transfer',
                wasTransferred: true,
                transferTarget: targetNumber,
              },
            });
          }
        }

        if (actionResult.action === 'end_call') {
          // Don't hang up if transfer is in progress (session already marked as disconnected)
          if (session.status === 'disconnected') {
            logger.info('Ignoring end_call - session already disconnecting/transferring', undefined, 'AudioBridge');
            result = { ignored: true, reason: 'Session already disconnecting or transfer in progress' };
          } else {
            logger.info(`End call requested: ${actionResult.reason}`, undefined, 'AudioBridge');
            const hangupResult = await this.executeHangup(session);
            if (!hangupResult.success) {
              result = {
                ...actionResult,
                hangupError: hangupResult.error,
                message: 'Failed to end call, please try again.'
              };
            } else {
              result = {
                ...actionResult,
                hangupSuccess: true,
                message: 'Call ended successfully.'
              };
            }
          }
        }
      }

      // Send tool result back to OpenAI
      this.sendToolResult(session, callId, result);

    } catch (error: any) {
      logger.error(`Tool ${toolName} error: ${error.message}`, error, 'AudioBridge');
      this.sendToolResult(session, callId, { error: error.message });
    }
  }

  /**
   * Send tool result back to OpenAI
   * 
   * OpenAI Realtime API tool call handshake:
   * 1. Send `conversation.item.create` with type `function_call_output`, `call_id`, and `output`
   * 2. Send `response.create` to resume the assistant's response generation
   */
  private static sendToolResult(session: AudioBridgeSession, callId: string, result: unknown): void {
    const { openaiWs } = session;
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    // Step 1: Create function call output item per OpenAI Realtime API spec
    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    }));

    // Step 2: Trigger response.create to resume assistant after tool execution
    openaiWs.send(JSON.stringify({
      type: 'response.create',
    }));
  }

  /**
   * Handle incoming audio from Plivo (mulaw 8kHz)
   * 
   * Note: With server-side VAD (turn_detection: server_vad) enabled in session config,
   * OpenAI automatically detects speech boundaries and commits the buffer.
   * No manual `input_audio_buffer.commit` is needed - the server VAD handles this.
   */
  static async handlePlivoAudio(callUuid: string, audioBase64: string): Promise<void> {
    const session = this.activeSessions.get(callUuid);
    if (!session) {
      logger.warn(`No session for call ${callUuid}`, undefined, 'AudioBridge');
      return;
    }

    if (!session.openaiWs || session.openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      // Decode base64 mulaw audio
      const mulawBuffer = Buffer.from(audioBase64, 'base64');

      // Convert mulaw 8kHz to PCM16 24kHz for OpenAI
      const pcmBuffer = this.mulawToPcm16(mulawBuffer);
      const pcmBase64 = pcmBuffer.toString('base64');

      // Send to OpenAI Realtime API
      // Server VAD auto-detects speech end and commits - no manual commit needed
      session.openaiWs.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: pcmBase64,
      }));

    } catch (error: any) {
      logger.error(`Error processing Plivo audio: ${error.message}`, error, 'AudioBridge');
    }
  }

  /**
   * Set the Plivo WebSocket for direct audio streaming
   */
  static setPlivoWebSocket(callUuid: string, plivoWs: WebSocket, streamSid: string): void {
    const session = this.activeSessions.get(callUuid);
    if (session) {
      session.plivoWs = plivoWs;
      session.streamSid = streamSid;
      logger.info(`Plivo WebSocket set for ${callUuid}, streamSid: ${streamSid}`, undefined, 'AudioBridge');
    }
  }

  /**
   * Register callback for audio output (alternative to direct Plivo WebSocket)
   */
  static onAudioOutput(callUuid: string, callback: (audioBase64: string) => void): void {
    const session = this.activeSessions.get(callUuid);
    if (session) {
      session.onAudioCallback = callback;
    }
  }

  /**
   * Register callback for transcript updates
   */
  static onTranscriptUpdate(callUuid: string, callback: (text: string, isFinal: boolean) => void): void {
    const session = this.activeSessions.get(callUuid);
    if (session) {
      session.onTranscriptCallback = callback;
    }
  }

  /**
   * Register callback for tool calls
   */
  static onToolCall(callUuid: string, callback: (toolName: string, params: Record<string, unknown>) => Promise<unknown>): void {
    const session = this.activeSessions.get(callUuid);
    if (session) {
      session.onToolCallback = callback;
    }
  }

  /**
   * Register callback for session end
   */
  static onSessionEnd(callUuid: string, callback: () => void): void {
    const session = this.activeSessions.get(callUuid);
    if (session) {
      session.onEndCallback = callback;
    }
  }

  /**
   * Send a text message to the OpenAI agent (for injecting context)
   */
  static async sendMessage(callUuid: string, message: string): Promise<void> {
    const session = this.activeSessions.get(callUuid);
    if (!session || !session.openaiWs || session.openaiWs.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot send message - no active session for ${callUuid}`, undefined, 'AudioBridge');
      return;
    }

    logger.info(`Injecting message: "${message.substring(0, 50)}..."`, undefined, 'AudioBridge');

    session.openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    }));

    session.openaiWs.send(JSON.stringify({
      type: 'response.create',
    }));
  }

  /**
   * Interrupt the current agent response (user barge-in)
   */
  static interrupt(callUuid: string): void {
    const session = this.activeSessions.get(callUuid);
    if (!session || !session.openaiWs || session.openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    logger.info(`Interrupting response for ${callUuid}`, undefined, 'AudioBridge');

    session.openaiWs.send(JSON.stringify({
      type: 'response.cancel',
    }));

    // Clear Plivo audio buffer
    if (session.plivoWs && session.plivoWs.readyState === WebSocket.OPEN && session.streamSid) {
      session.plivoWs.send(JSON.stringify({
        event: 'clear',
        streamSid: session.streamSid,
      }));
    }
  }

  /**
   * Handle user barge-in (interruption)
   * Called when OpenAI detects user speech starting while agent is speaking
   * This is critical to prevent the "rushing through" behavior
   */
  private static handleBargeIn(session: AudioBridgeSession): void {
    const { callUuid, openaiWs, plivoWs, streamSid } = session;

    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    logger.info(`Handling barge-in for ${callUuid}`, undefined, 'AudioBridge');

    // 1. Cancel the current response from OpenAI
    // This tells OpenAI to stop generating more audio/text
    openaiWs.send(JSON.stringify({
      type: 'response.cancel',
    }));

    // 2. Clear any queued audio that hasn't been sent yet
    // This prevents "rushing through" already-generated audio
    if (plivoWs && plivoWs.readyState === WebSocket.OPEN && streamSid) {
      plivoWs.send(JSON.stringify({
        event: 'clear',
        streamSid: streamSid,
      }));
      logger.info(`Cleared Plivo audio buffer for ${callUuid}`, undefined, 'AudioBridge');
    }
  }

  /**
   * End the audio bridge session
   */
  static async endSession(callUuid: string): Promise<{
    duration: number;
    transcript: string;
    transcriptParts: { role: 'user' | 'assistant'; text: string; timestamp: Date }[];
  }> {
    const session = this.activeSessions.get(callUuid);
    if (!session) {
      // Clean up any stale pending transfer for this call
      this.clearPendingTransfer(callUuid);
      return { duration: 0, transcript: '', transcriptParts: [] };
    }

    logger.info(`Ending session for ${callUuid}`, undefined, 'AudioBridge');

    session.status = 'disconnected';
    session.endedAt = new Date();

    // Close OpenAI WebSocket
    if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
      session.openaiWs.close();
    }

    const duration = Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000);

    // Build transcript
    const transcript = session.transcriptParts
      .map(p => `${p.role === 'user' ? 'User' : 'Agent'}: ${p.text}`)
      .join('\n');

    // Remove from OpenAI pool manager
    openaiPoolManager.removeConnection(callUuid);

    this.activeSessions.delete(callUuid);

    // NOTE: Do NOT clean up pending transfers here!
    // The post-stream handler needs access to pending transfers after the session ends.
    // Pending transfers will be cleaned up by the post-stream handler after execution.
    const hadPendingTransfer = this.getPendingTransfer(callUuid);
    if (hadPendingTransfer) {
      logger.info(`Session ended with pending transfer to ${hadPendingTransfer.targetNumber} - will be handled by post-stream`, undefined, 'AudioBridge');
    }

    logger.info(`Session ended for ${callUuid}, duration: ${duration}s`, undefined, 'AudioBridge');

    return {
      duration,
      transcript,
      transcriptParts: session.transcriptParts,
    };
  }

  /**
   * Execute call transfer using Plivo Transfer API + Stop Stream API:
   * 
   * 1. Call Plivo Transfer API with URL that returns Dial XML
   * 2. Call Plivo Stop Stream API (DELETE) to stop the stream
   * 3. Plivo fetches the transfer XML URL and executes the Dial
   * 
   * This approach requires keepCallAlive="true" in the Stream XML.
   */
  private static async executeTransfer(session: AudioBridgeSession, targetNumber: string): Promise<{ success: boolean; error?: string }> {
    const { callUuid, fromNumber, toNumber, plivoCredentialId, streamSid, callDirection } = session;

    logger.info(`[Transfer] ===== INITIATING TRANSFER (Transfer API + Stop Stream) =====`, undefined, 'AudioBridge');
    logger.info(`[Transfer] Call UUID: ${callUuid}`, undefined, 'AudioBridge');
    logger.info(`[Transfer] Stream ID: ${streamSid}`, undefined, 'AudioBridge');
    logger.info(`[Transfer] Target Number: ${targetNumber}`, undefined, 'AudioBridge');
    logger.info(`[Transfer] From: ${fromNumber}, To: ${toNumber}, Direction: ${callDirection}`, undefined, 'AudioBridge');

    // Wait for AI to finish speaking the transfer announcement
    logger.info(`[Transfer] Waiting 2.5s for AI to complete transfer announcement...`, undefined, 'AudioBridge');
    await new Promise(resolve => setTimeout(resolve, 2500));

    try {
      // Determine the Plivo-owned number based on call direction:
      // - Inbound calls: toNumber is the Plivo number (what customer dialed TO)
      // - Outbound calls: fromNumber is the Plivo number (what we dialed FROM)
      // Plivo requires caller ID to be a verified/owned number
      let callerId: string;

      if (callDirection === 'inbound') {
        callerId = toNumber || fromNumber || '';
        logger.info(`[Transfer] Inbound call - using toNumber as caller ID: ${callerId}`, undefined, 'AudioBridge');
      } else {
        // Outbound or unknown - use fromNumber (the Plivo number we called from)
        callerId = fromNumber || toNumber || '';
        logger.info(`[Transfer] Outbound call - using fromNumber as caller ID: ${callerId}`, undefined, 'AudioBridge');
      }

      const baseUrl = getDomain();

      const transferXmlUrl = `${baseUrl}/api/plivo/voice/transfer?target=${encodeURIComponent(targetNumber)}&callerId=${encodeURIComponent(callerId)}`;

      logger.info(`[Transfer] Step 1: Calling Plivo Transfer API`, undefined, 'AudioBridge');
      logger.info(`[Transfer] Transfer XML URL: ${transferXmlUrl}`, undefined, 'AudioBridge');

      // Get Plivo credentials for the API calls
      const credentials = plivoCredentialId
        ? await db.select().from(plivoCredentials).where(eq(plivoCredentials.id, plivoCredentialId)).limit(1)
        : [];

      if (!credentials.length) {
        throw new Error('Plivo credentials not found');
      }

      const { authId, authToken } = credentials[0];

      // Step 1: Call Update Call API to redirect call to new URL
      // Plivo will fetch the new aleg_url which returns Dial XML
      const transferUrl = `https://api.plivo.com/v1/Account/${authId}/Call/${callUuid}/`;
      logger.info(`[Transfer] Calling Transfer API: ${transferUrl}`, undefined, 'AudioBridge');

      const transferResponse = await axios.post(transferUrl, {
        legs: 'aleg',
        aleg_url: transferXmlUrl,
        aleg_method: 'GET'
      }, {
        auth: {
          username: authId,
          password: authToken
        }
      });

      logger.info(`[Transfer] Transfer API Response: ${transferResponse.status}`, undefined, 'AudioBridge');
      logger.info(`[Transfer] Transfer API Data:`, transferResponse.data, 'AudioBridge');

      // Step 2: Stop the stream using DELETE API
      // This triggers Plivo to fetch the aleg_url we just set
      const stopStreamUrl = `https://api.plivo.com/v1/Account/${authId}/Call/${callUuid}/Stream/`;
      logger.info(`[Transfer] Step 2: Stopping stream to trigger transfer...`, undefined, 'AudioBridge');
      logger.info(`[Transfer] Stop Stream URL: ${stopStreamUrl}`, undefined, 'AudioBridge');

      try {
        const stopResponse = await axios.delete(stopStreamUrl, {
          auth: {
            username: authId,
            password: authToken
          }
        });
        logger.info(`[Transfer] Stop Stream Response: ${stopResponse.status}`, undefined, 'AudioBridge');
      } catch (stopError: any) {
        // Stream might already be stopped, log but continue
        logger.warn(`[Transfer] Stop Stream error (may be ok): ${stopError.message}`, undefined, 'AudioBridge');
      }

      // Step 3: Mark session as disconnected (prevents end_call from triggering during transfer)
      logger.info(`[Transfer] Step 3: Marking session as disconnected`, undefined, 'AudioBridge');
      session.status = 'disconnected';

      // Step 4: Close OpenAI WebSocket (stop AI from generating more audio)
      if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
        logger.info(`[Transfer] Step 4: Closing OpenAI WebSocket...`, undefined, 'AudioBridge');
        session.openaiWs.close(1000, 'Transfer initiated');
      }

      logger.info(`[Transfer] ===== SUCCESS - Transfer initiated =====`, undefined, 'AudioBridge');
      logger.info(`[Transfer] Plivo will now fetch transfer XML and connect to ${targetNumber}`, undefined, 'AudioBridge');
      return { success: true };

    } catch (error: any) {
      logger.error(`[Transfer] ===== ERROR =====`, undefined, 'AudioBridge');
      logger.error(`[Transfer] Error message: ${error.message}`, error, 'AudioBridge');
      if (error.response) {
        logger.error(`[Transfer] Response status: ${error.response.status}`, undefined, 'AudioBridge');
        logger.error(`[Transfer] Response data: ${JSON.stringify(error.response.data)}`, undefined, 'AudioBridge');
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute call hangup via Plivo REST API
   * 
   * Similar to executeTransfer, we need to:
   * 1. Call Plivo Hangup API
   * 2. Close OpenAI WebSocket (stop AI from generating audio)
   * 3. Close Plivo WebSocket (ends stream cleanly)
   */
  private static async executeHangup(session: AudioBridgeSession): Promise<{ success: boolean; error?: string }> {
    const { callUuid, plivoCredentialId } = session;

    logger.info(`[Hangup] ===== INITIATING HANGUP =====`, undefined, 'AudioBridge');
    logger.info(`[Hangup] Call UUID: ${callUuid}`, undefined, 'AudioBridge');

    // Stop recording before hangup
    await this.stopSessionRecording(session);

    try {
      const client = await this.getPlivoClient(plivoCredentialId);
      if (!client) {
        throw new Error('Failed to get Plivo client');
      }

      // Step 1: Call Plivo Hangup API
      logger.info(`[Hangup] Calling Plivo Hangup API...`, undefined, 'AudioBridge');
      await client.calls.hangup(callUuid);
      logger.info(`[Hangup] Plivo API hangup successful`, undefined, 'AudioBridge');

      // Step 2: Mark session as disconnected
      session.status = 'disconnected';
      session.endedAt = new Date();
      logger.info(`[Hangup] Session marked as disconnected`, undefined, 'AudioBridge');

      // Step 3: Close OpenAI WebSocket (stop AI from generating more audio)
      if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
        logger.info(`[Hangup] Closing OpenAI WebSocket...`, undefined, 'AudioBridge');
        session.openaiWs.close();
      }

      // Step 4: Close Plivo WebSocket to end the stream cleanly
      if (session.plivoWs && session.plivoWs.readyState === WebSocket.OPEN) {
        logger.info(`[Hangup] Closing Plivo WebSocket...`, undefined, 'AudioBridge');
        session.plivoWs.close();
      }

      if (session.onEndCallback) {
        session.onEndCallback();
      }

      logger.info(`[Hangup] ===== SUCCESS - Call hung up =====`, undefined, 'AudioBridge');
      return { success: true };

    } catch (error: any) {
      logger.error(`[Hangup] ===== ERROR =====`, undefined, 'AudioBridge');
      logger.error(`[Hangup] Error message: ${error.message}`, error, 'AudioBridge');
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute audio playback via Plivo REST API
   * 
   * Uses Plivo's Play Audio on Call API:
   * POST /v1/Account/{auth_id}/Call/{call_uuid}/Play/
   * 
   * The audio file must be publicly accessible (mp3 or wav)
   */
  private static getMessagingContext(session: AudioBridgeSession, toolName: string): { userId: string; agentId: string; callId?: string; defaultTemplate?: string; fixedVariables?: Record<string, string>; fixedButtonVariables?: Record<number, string> } | null {
    if (!session.agentConfig.tools) return null;
    for (const tool of session.agentConfig.tools) {
      if (tool.name === toolName) {
        const toolAny = tool as unknown as Record<string, unknown>;
        if (toolAny._messagingContext) {
          return toolAny._messagingContext as { userId: string; agentId: string; callId?: string; defaultTemplate?: string; fixedVariables?: Record<string, string>; fixedButtonVariables?: Record<number, string> };
        }
      }
    }
    return null;
  }

  private static async handleCollectCallerEmail(
    session: AudioBridgeSession,
    callUuid: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const emailAddress = params.email_address as string;
    if (!emailAddress) {
      return { success: false, message: 'No email address provided.' };
    }
    try {
      await this.updateCallMetadata(callUuid, { callerEmail: emailAddress });
      logger.info(`Stored callerEmail in metadata: ${emailAddress}`, undefined, 'AudioBridge');
      return { success: true, message: `Email address ${emailAddress} stored for post-call follow-up.` };
    } catch (err: any) {
      logger.error(`Failed to store callerEmail: ${err.message}`, err, 'AudioBridge');
      return { success: false, message: 'Failed to store email address.' };
    }
  }

  private static async handleSendEmail(
    session: AudioBridgeSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const ctx = this.getMessagingContext(session, 'send_email');
    if (!ctx) {
      logger.warn(`No messaging context found for send_email`, undefined, 'AudioBridge');
      return { success: false, message: 'Email tool not properly configured.' };
    }

    const recipientEmail = params.recipient_email as string;
    const templateName = ctx.defaultTemplate || params.template_name as string;
    const dynamicVariables = (params.dynamic_variables as Record<string, string>) || {};

    if (!recipientEmail || !templateName) {
      return { success: false, message: 'Please provide both the email address and template name.' };
    }

    try {
      const autoVars: Record<string, string> = {};

      if (ctx.agentId) {
        try {
          const [agentRow] = await db
            .select({ name: agents.name })
            .from(agents)
            .where(eq(agents.id, ctx.agentId))
            .limit(1);
          if (agentRow?.name) {
            autoVars.agent_name = agentRow.name;
          }
        } catch (e) {
          logger.warn(`Could not look up agent name for auto-injection`, undefined, 'AudioBridge');
        }
      }

      if (session.callUuid) {
        try {
          const [callRecord] = await db
            .select({ metadata: plivoCalls.metadata })
            .from(plivoCalls)
            .where(eq(plivoCalls.plivoCallUuid, session.callUuid))
            .limit(1);
          if (callRecord?.metadata) {
            const meta = callRecord.metadata as Record<string, any>;
            if (meta.appointmentData) {
              const ad = meta.appointmentData;
              if (ad.contactName) autoVars.contact_name = ad.contactName;
              if (ad.appointmentDate) autoVars.appointment_date = ad.appointmentDate;
              if (ad.appointmentTime) autoVars.appointment_time = ad.appointmentTime;
              if (ad.serviceName) autoVars.service_name = ad.serviceName;
              if (ad.duration) autoVars.duration = String(ad.duration);
              if (ad.notes) autoVars.appointment_notes = ad.notes;
            }
          }
        } catch (e) {
          logger.warn(`Could not look up call metadata for auto-injection`, undefined, 'AudioBridge');
        }
      }

      if (ctx.callId) {
        try {
          const [latestAppt] = await db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.callId, ctx.callId),
                eq(appointments.status, 'scheduled')
              )
            )
            .limit(1);
          if (latestAppt) {
            autoVars.contact_name = autoVars.contact_name || latestAppt.contactName;
            autoVars.appointment_date = latestAppt.appointmentDate;
            autoVars.appointment_time = latestAppt.appointmentTime;
            autoVars.service_name = latestAppt.serviceName || '';
            autoVars.duration = String(latestAppt.duration || 30);
            autoVars.appointment_notes = latestAppt.notes || '';
          }
        } catch (e) {
          logger.warn(`Could not look up appointment data for auto-injection`, undefined, 'AudioBridge');
        }
      }

      if (params.contact_name) {
        autoVars.contact_name = params.contact_name as string;
      }

      const mergedVariables = { ...autoVars, ...dynamicVariables };

      const { emailTemplateService } = await import('../../../../plugins/messaging/services/email-template.service');
      const result = await emailTemplateService.sendEmailByName(
        ctx.userId,
        templateName,
        recipientEmail,
        mergedVariables,
        { callId: ctx.callId, agentId: ctx.agentId }
      );

      logger.info(`send_email result: success=${result.success} to=${recipientEmail}`, undefined, 'AudioBridge');

      // Side-effect: persist callerEmail to call metadata for post-call trigger awareness
      if (result.success && session.callUuid) {
        this.updateCallMetadata(session.callUuid, { callerEmail: recipientEmail }).catch(() => { });
      }

      return {
        success: result.success,
        message: result.success
          ? `Email sent successfully to ${recipientEmail}`
          : `Email could not be sent (${result.error}). Do NOT retry this action. Tell the caller politely that the email could not be delivered, then continue the conversation normally.`,
      };
    } catch (error: any) {
      logger.error(`send_email error: ${error.message}`, error, 'AudioBridge');
      return { success: false, message: 'Email sending failed due to a technical error. Do NOT retry. Inform the caller once that the email could not be sent, then continue the conversation.' };
    }
  }

  private static async handleSendWhatsApp(
    session: AudioBridgeSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const ctx = this.getMessagingContext(session, 'send_whatsapp');
    if (!ctx) {
      logger.warn(`No messaging context found for send_whatsapp`, undefined, 'AudioBridge');
      return { success: false, message: 'WhatsApp tool not properly configured.' };
    }

    const templateName = ctx.defaultTemplate || params.template_name as string;
    const language = (params.language as string) || 'en_US';
    let recipientPhone = (params.phone_number as string) || '';

    if (!templateName) {
      return { success: false, message: 'Please provide the WhatsApp template name.' };
    }

    const digits = recipientPhone.replace(/[^0-9]/g, '');
    if (digits.length < 6) {
      if (session.callDirection === 'inbound' && session.fromNumber) {
        recipientPhone = session.fromNumber;
      } else if (session.toNumber) {
        recipientPhone = session.toNumber;
      }
    }

    if (!recipientPhone || recipientPhone.replace(/[^0-9]/g, '').length < 6) {
      return { success: false, message: 'Could not determine the recipient phone number.' };
    }

    const collectedVars = params.variables as Record<string, string> | undefined;
    const fixedVars = ctx.fixedVariables;

    const mergedVars: Record<number, string> = {};
    if (fixedVars) {
      for (const [idx, val] of Object.entries(fixedVars)) {
        mergedVars[parseInt(idx)] = val;
      }
    }
    if (collectedVars && typeof collectedVars === 'object') {
      for (const [key, val] of Object.entries(collectedVars)) {
        if (key.startsWith('var_')) {
          const idx = parseInt(key.replace('var_', ''));
          mergedVars[idx] = String(val || ' ');
        }
      }
    }

    let components: any[] = [];
    const sortedIndices = Object.keys(mergedVars).map(Number).sort((a, b) => a - b);
    if (sortedIndices.length > 0) {
      const parameters = sortedIndices.map(idx => ({
        type: 'text',
        text: mergedVars[idx] || ' ',
      }));
      components = [{ type: 'body', parameters }];
    }

    try {
      const { metaWhatsAppService, MetaWhatsAppService } = await import('../../../../plugins/messaging/services/meta-whatsapp.service');
      const { whatswayService } = await import('../../../../plugins/messaging/services/whatsway.service');

      const metaSettings = await metaWhatsAppService.getSettings(ctx.userId);
      const whatswaySettings = await whatswayService.getSettings(ctx.userId);

      if (metaSettings?.isActive) {
        try {
          const templateDef = await metaWhatsAppService.getTemplateByName(ctx.userId, templateName);
          if (templateDef && templateDef.components) {
            const buttonComponents = MetaWhatsAppService.buildButtonComponents(templateDef.components, ctx.fixedButtonVariables);
            if (buttonComponents.length > 0) {
              components = [...components, ...buttonComponents];
              logger.info(`[send_whatsapp] Auto-added ${buttonComponents.length} button component(s) for template "${templateName}"`, undefined, 'AudioBridge');
            }
          }
        } catch (tmplError: any) {
          logger.warn(`[send_whatsapp] Could not fetch template metadata: ${tmplError.message}`, undefined, 'AudioBridge');
        }
      }

      let sendResult: { messageId: string; status: string } | undefined;

      if (metaSettings?.isActive) {
        sendResult = await metaWhatsAppService.sendTemplate(
          ctx.userId, recipientPhone, templateName, language, components,
          { callId: ctx.callId, agentId: ctx.agentId }
        );
      } else if (whatswaySettings?.isActive) {
        sendResult = await whatswayService.sendTemplate(
          ctx.userId, recipientPhone, templateName, language, components,
          { callId: ctx.callId, agentId: ctx.agentId }
        );
      } else {
        return { success: false, message: 'No WhatsApp provider configured.' };
      }

      try {
        const { whatsAppConversationService } = await import('../../../../plugins/messaging/services/whatsapp-conversation.service');
        const conversation = await whatsAppConversationService.getOrCreateConversation(ctx.userId, recipientPhone);
        await whatsAppConversationService.addMessage({
          conversationId: conversation.id,
          userId: ctx.userId,
          direction: 'outbound',
          senderType: 'agent',
          messageType: 'template',
          content: `[Template: ${templateName}]`,
          templateName,
          metaMessageId: sendResult?.messageId || undefined,
          status: 'sent',
          metadata: { agentId: ctx.agentId, source: 'plivo-openai' },
        });
      } catch (convError: any) {
        logger.warn(`Failed to store WhatsApp in conversations: ${convError.message}`, undefined, 'AudioBridge');
      }

      logger.info(`send_whatsapp result: success=true to=${recipientPhone}`, undefined, 'AudioBridge');
      return { success: true, message: `WhatsApp message sent successfully to ${recipientPhone}` };
    } catch (error: any) {
      logger.error(`send_whatsapp error: ${error.message}`, error, 'AudioBridge');
      return { success: false, message: 'Error sending WhatsApp message.' };
    }
  }

  private static async executePlayAudio(session: AudioBridgeSession, audioUrl: string): Promise<{ success: boolean; error?: string }> {
    const { callUuid, plivoCredentialId } = session;

    logger.info(`[PlayAudio] ===== INITIATING AUDIO PLAYBACK =====`, undefined, 'AudioBridge');
    logger.info(`[PlayAudio] Call UUID: ${callUuid}`, undefined, 'AudioBridge');
    logger.info(`[PlayAudio] Audio URL: ${audioUrl}`, undefined, 'AudioBridge');

    try {
      // Get Plivo credentials
      const credentials = plivoCredentialId
        ? await db.select().from(plivoCredentials).where(eq(plivoCredentials.id, plivoCredentialId)).limit(1)
        : [];

      if (!credentials.length) {
        // Try to get primary credential
        const [primaryCred] = await db
          .select()
          .from(plivoCredentials)
          .where(and(eq(plivoCredentials.isPrimary, true), eq(plivoCredentials.isActive, true)))
          .limit(1);

        if (!primaryCred) {
          throw new Error('Plivo credentials not found');
        }
        credentials.push(primaryCred);
      }

      const { authId, authToken } = credentials[0];

      // Construct full audio URL if it's a relative path
      let fullAudioUrl = audioUrl;
      if (audioUrl.startsWith('/')) {
        const baseUrl = getDomain();
        fullAudioUrl = `${baseUrl}${audioUrl}`;
        logger.info(`[PlayAudio] Converted relative URL to: ${fullAudioUrl}`, undefined, 'AudioBridge');
      }

      // Call Plivo Play API
      // POST https://api.plivo.com/v1/Account/{auth_id}/Call/{call_uuid}/Play/
      const playUrl = `https://api.plivo.com/v1/Account/${authId}/Call/${callUuid}/Play/`;
      logger.info(`[PlayAudio] Calling Plivo Play API: ${playUrl}`, undefined, 'AudioBridge');

      // Fetch audio file to estimate duration
      let estimatedDurationMs = 5000; // Default 5 seconds if we can't estimate
      try {
        const headResponse = await axios.head(fullAudioUrl, { timeout: 5000 });
        const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10);
        const contentType = headResponse.headers['content-type'] || '';

        if (contentLength > 0) {
          // Estimate duration based on file size and typical bitrate
          // MP3: ~128kbps = 16KB/s, WAV: ~176KB/s for 44.1kHz stereo
          let bytesPerSecond = 16000; // Default for MP3 128kbps
          if (contentType.includes('wav') || fullAudioUrl.includes('.wav')) {
            bytesPerSecond = 176000; // WAV 44.1kHz stereo
          }
          estimatedDurationMs = Math.ceil((contentLength / bytesPerSecond) * 1000);
          // Add a small buffer for network latency
          estimatedDurationMs += 500;
          logger.info(`[PlayAudio] Estimated audio duration: ${estimatedDurationMs}ms (file size: ${contentLength} bytes)`, undefined, 'AudioBridge');
        }
      } catch (e) {
        logger.warn(`[PlayAudio] Could not estimate audio duration, using default 5s`, undefined, 'AudioBridge');
      }

      const playResponse = await axios.post(playUrl, {
        urls: fullAudioUrl,
        mix: true,  // Mix audio with call (so both can hear each other)
      }, {
        auth: {
          username: authId,
          password: authToken
        }
      });

      logger.info(`[PlayAudio] Plivo Play API Response: ${playResponse.status}`, undefined, 'AudioBridge');
      logger.info(`[PlayAudio] Response data: ${JSON.stringify(playResponse.data)}`, undefined, 'AudioBridge');
      logger.info(`[PlayAudio] Waiting ${estimatedDurationMs}ms for audio to finish...`, undefined, 'AudioBridge');

      // Wait for estimated audio duration before returning
      await new Promise(resolve => setTimeout(resolve, estimatedDurationMs));

      logger.info(`[PlayAudio] ===== SUCCESS - Audio playback complete =====`, undefined, 'AudioBridge');

      return { success: true };

    } catch (error: any) {
      logger.error(`[PlayAudio] ===== ERROR =====`, undefined, 'AudioBridge');
      logger.error(`[PlayAudio] Error message: ${error.message}`, error, 'AudioBridge');
      if (error.response) {
        logger.error(`[PlayAudio] Response status: ${error.response.status}`, undefined, 'AudioBridge');
        logger.error(`[PlayAudio] Response data: ${JSON.stringify(error.response.data)}`, undefined, 'AudioBridge');
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop recording for a session and save duration
   */
  private static async stopSessionRecording(session: AudioBridgeSession): Promise<void> {
    const { callUuid, recordingId, recordingStartTime, recordingActive, callRecordId, plivoCredentialId } = session;

    // Check recordingActive flag (set when recording is started, even without recordingId)
    if (!recordingActive && !recordingId) {
      logger.info(`[AudioBridge] No recording to stop for ${callUuid}`, undefined, 'AudioBridge');
      return;
    }

    logger.info(`[AudioBridge] Stopping recording for ${callUuid}`, undefined, 'AudioBridge');

    // Calculate recording duration
    let recordingDuration = 0;
    if (recordingStartTime) {
      recordingDuration = Math.round((Date.now() - recordingStartTime.getTime()) / 1000);
    }

    // Call stop API
    const result = await PlivoRecordingService.stopRecording({
      callUuid,
      plivoCredentialId,
    });

    if (result.success) {
      logger.info(`[AudioBridge] ✓ Recording stopped successfully`, undefined, 'AudioBridge');
      logger.info(`[AudioBridge] Recording duration: ${recordingDuration}s`, undefined, 'AudioBridge');
    } else {
      logger.warn(`[AudioBridge] Recording stop returned error (may already be stopped): ${result.error}`, undefined, 'AudioBridge');
    }

    // Clear recording state
    session.recordingId = null;
    session.recordingStartTime = null;
  }

  /**
   * Get or create a Plivo client for API calls
   */
  private static async getPlivoClient(credentialId?: string): Promise<plivo.Client | null> {
    try {
      let credential: { authId: string; authToken: string } | undefined;

      if (credentialId) {
        const [cred] = await db
          .select()
          .from(plivoCredentials)
          .where(and(eq(plivoCredentials.id, credentialId), eq(plivoCredentials.isActive, true)))
          .limit(1);
        credential = cred;
      }

      if (!credential) {
        // Get primary or any active credential
        const [primaryCred] = await db
          .select()
          .from(plivoCredentials)
          .where(and(eq(plivoCredentials.isPrimary, true), eq(plivoCredentials.isActive, true)))
          .limit(1);
        credential = primaryCred;
      }

      if (!credential) {
        const [anyCred] = await db
          .select()
          .from(plivoCredentials)
          .where(eq(plivoCredentials.isActive, true))
          .limit(1);
        credential = anyCred;
      }

      if (!credential) {
        logger.error('No active Plivo credentials found', undefined, 'AudioBridge');
        return null;
      }

      return new plivo.Client(credential.authId, credential.authToken);
    } catch (error: any) {
      logger.error(`Failed to get Plivo client: ${error.message}`, error, 'AudioBridge');
      return null;
    }
  }

  /**
   * Get active session count
   */
  static getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get session by call UUID
   */
  static getSession(callUuid: string): AudioBridgeSession | undefined {
    return this.activeSessions.get(callUuid);
  }

  /**
   * Check if session is active
   */
  static isSessionActive(callUuid: string): boolean {
    const session = this.activeSessions.get(callUuid);
    return session?.status === 'connected';
  }

  /**
   * Convert mulaw 8kHz to PCM16 24kHz for OpenAI
   * Includes upsampling from 8kHz to 24kHz (3x) using linear interpolation
   * 
   * For each pair of input samples, we insert 2 interpolated samples between them:
   * Input:  S0 -------- S1 -------- S2
   * Output: S0, i1, i2, S1, i3, i4, S2, i5, i6
   * Where i1, i2 are linearly interpolated between S0 and S1, etc.
   */
  private static mulawToPcm16(mulawData: Buffer): Buffer {
    const inputLength = mulawData.length;
    if (inputLength === 0) return Buffer.alloc(0);

    // Upsample 3x: 8kHz → 24kHz (3 output samples per input sample)
    const outputLength = inputLength * 3 * 2; // 3x samples, 2 bytes per sample
    const output = Buffer.alloc(outputLength);

    let outIndex = 0;

    // Decode all mulaw samples first for interpolation
    const pcmSamples: number[] = new Array(inputLength);
    for (let i = 0; i < inputLength; i++) {
      pcmSamples[i] = MULAW_DECODE_TABLE[mulawData[i]];
    }

    for (let i = 0; i < inputLength; i++) {
      const currentSample = pcmSamples[i];
      const nextSample = i < inputLength - 1 ? pcmSamples[i + 1] : currentSample;

      // Output 3 samples: current + 2 interpolated toward next
      // Position 0: original sample
      // Position 1: 1/3 of the way to next sample
      // Position 2: 2/3 of the way to next sample
      for (let j = 0; j < 3; j++) {
        const t = j / 3; // 0, 0.333, 0.667
        const interpolatedSample = Math.round(currentSample + (nextSample - currentSample) * t);
        const clampedSample = Math.max(-32768, Math.min(32767, interpolatedSample));

        // Write as little-endian 16-bit signed integer
        output.writeInt16LE(clampedSample, outIndex);
        outIndex += 2;
      }
    }

    return output;
  }

  /**
   * Convert PCM16 24kHz to mulaw 8kHz for Plivo
   * Includes downsampling from 24kHz to 8kHz (1/3) using averaging
   * 
   * For every 3 input samples, we average them into 1 output sample.
   * This provides better quality than simply decimating (taking every 3rd sample)
   * by acting as a simple low-pass filter to prevent aliasing.
   */
  private static pcm16ToMulaw(pcmData: Buffer): Buffer {
    const inputSamples = pcmData.length / 2;
    // Downsample 3x: 24kHz → 8kHz
    const outputLength = Math.floor(inputSamples / 3);
    const output = Buffer.alloc(outputLength);

    for (let i = 0; i < outputLength; i++) {
      // Average 3 consecutive samples for better quality downsampling
      const baseIndex = i * 3;
      let sum = 0;
      let count = 0;

      for (let j = 0; j < 3; j++) {
        const sampleIndex = baseIndex + j;
        const byteOffset = sampleIndex * 2;

        if (byteOffset + 1 < pcmData.length) {
          sum += pcmData.readInt16LE(byteOffset);
          count++;
        }
      }

      // Average the samples (acts as simple low-pass filter)
      const avgSample = count > 0 ? Math.round(sum / count) : 0;
      const clampedSample = Math.max(-32768, Math.min(32767, avgSample));
      output[i] = this.linearToMulaw(clampedSample);
    }

    return output;
  }

  /**
   * Convert linear PCM sample to mulaw byte
   */
  private static linearToMulaw(sample: number): number {
    const MULAW_MAX = 0x1FFF;
    const MULAW_BIAS = 33;
    const CLIP = 32635;

    // Get sign
    const sign = (sample >> 8) & 0x80;
    if (sign !== 0) {
      sample = -sample;
    }

    // Clip
    if (sample > CLIP) {
      sample = CLIP;
    }

    // Add bias
    sample = sample + MULAW_BIAS;

    // Find segment
    let exponent = 7;
    let mask = 0x4000;
    while ((sample & mask) === 0 && exponent > 0) {
      exponent--;
      mask >>= 1;
    }

    // Get mantissa
    const mantissa = (sample >> (exponent + 3)) & 0x0F;

    // Combine and complement
    const mulawByte = ~(sign | (exponent << 4) | mantissa);

    return mulawByte & 0xFF;
  }

  /**
   * Update call metadata in database after successful tool executions
   * This is critical for CRM Lead Processor to detect appointments, forms, and transfers
   * Uses deep merge for nested objects (aiInsights, appointmentData, formData) to preserve existing values
   */
  private static async updateCallMetadata(
    callUuid: string,
    metadataUpdates: Record<string, unknown>
  ): Promise<void> {
    try {
      // Find the call record by plivoCallUuid
      const [existingCall] = await db
        .select()
        .from(plivoCalls)
        .where(eq(plivoCalls.plivoCallUuid, callUuid))
        .limit(1);

      if (!existingCall) {
        logger.warn(`Cannot update metadata - call not found: ${callUuid}`, undefined, 'AudioBridge');
        return;
      }

      // Deep merge existing metadata with new updates
      const existingMetadata = (existingCall.metadata as Record<string, unknown>) || {};
      const updatedMetadata = this.deepMergeMetadata(existingMetadata, metadataUpdates);

      // Update the call record with merged metadata
      // Also update wasTransferred column if it's in the updates
      const updateFields: Record<string, unknown> = {
        metadata: updatedMetadata,
      };

      // Update dedicated columns if present in metadata updates
      if (metadataUpdates.wasTransferred === true) {
        updateFields.wasTransferred = true;
      }
      if (metadataUpdates.transferredTo) {
        updateFields.transferredTo = metadataUpdates.transferredTo;
        updateFields.transferredAt = new Date();
      }

      await db
        .update(plivoCalls)
        .set(updateFields)
        .where(eq(plivoCalls.id, existingCall.id));

      logger.info(`Updated call metadata for ${callUuid}: ${Object.keys(metadataUpdates).join(', ')}`, undefined, 'AudioBridge');
    } catch (error: any) {
      logger.error(`Failed to update call metadata for ${callUuid}`, error, 'AudioBridge');
    }
  }

  /**
   * Deep merge metadata objects, preserving nested values
   * Critical for preserving aiInsights, appointmentData, formData across multiple tool calls
   */
  private static deepMergeMetadata(
    existing: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...existing };

    for (const key of Object.keys(updates)) {
      const existingValue = existing[key];
      const updateValue = updates[key];

      // Deep merge for known nested objects
      if (
        (key === 'aiInsights' || key === 'appointmentData' || key === 'formData') &&
        typeof existingValue === 'object' && existingValue !== null &&
        typeof updateValue === 'object' && updateValue !== null &&
        !Array.isArray(existingValue) && !Array.isArray(updateValue)
      ) {
        result[key] = {
          ...(existingValue as Record<string, unknown>),
          ...(updateValue as Record<string, unknown>),
        };
      } else {
        // For all other keys, new value overwrites
        result[key] = updateValue;
      }
    }

    return result;
  }
}
