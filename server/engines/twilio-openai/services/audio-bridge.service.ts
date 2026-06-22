'use strict';
/**
 * ============================================================
 * Twilio-OpenAI Audio Bridge Service
 * 
 * Bridges audio between Twilio Media Streams and OpenAI Realtime API.
 * - Receives mulaw 8kHz audio from Twilio WebSocket
 * - Sends directly to OpenAI (supports g711_ulaw format)
 * - Sends OpenAI audio response back to Twilio
 * - Handles tool calls, transcripts, and interruptions
 * - Executes actual Twilio transfers and hangups via REST API
 * ============================================================
 */

import WebSocket from 'ws';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  AgentConfig,
  AgentTool,
  AudioBridgeSession,
  CreateSessionParams,
  TwilioMediaStreamEvent
} from '../types';
import { getTwilioClient } from '../../../services/twilio-connector';
import { getDomain } from '../../../utils/domain';
import { generateTransferTwiML, generateHangupTwiML } from '../config/twilio-openai-config';
import { openaiPoolManager } from '../../../infrastructure';
import { db } from '../../../db';
import { twilioOpenaiCalls, agents, appointments } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const execAsync = promisify(exec);
const fsWriteFile = promisify(fs.writeFile);
const fsUnlink = promisify(fs.unlink);
const fsReadFile = promisify(fs.readFile);

export class TwilioOpenAIAudioBridge {
  private static activeSessions: Map<string, AudioBridgeSession> = new Map();
  private static readonly OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';

  static async createSession(params: CreateSessionParams): Promise<AudioBridgeSession> {
    const { callSid, openaiApiKey, agentConfig, twilioWs, streamSid, fromNumber, toNumber, callDirection } = params;

    console.log(`[TwilioOpenAI Bridge] Creating session for call ${callSid} (direction: ${callDirection || 'unknown'})`);
    console.log(`[TwilioOpenAI Bridge] Voice: ${agentConfig.voice}, Model: ${agentConfig.model}`);

    const session: AudioBridgeSession = {
      callSid,
      streamSid: streamSid || null,
      openaiSessionId: '',
      status: 'connecting',
      startedAt: new Date(),
      endedAt: null,
      openaiWs: null,
      twilioWs: twilioWs || null,
      agentConfig,
      transcriptParts: [],
      toolHandlers: new Map(),
      processedToolCallIds: new Set(),
      onTranscriptCallback: null,
      onToolCallback: null,
      onAudioCallback: null,
      onEndCallback: null,
      endCallbackFired: false,
      firstMessageSent: false,
      twilioStreamReady: false,
      lastUserSpeechTime: Date.now(),
      fromNumber,
      toNumber,
      callDirection,
      pendingAudioQueue: [],
    };

    if (agentConfig.tools) {
      for (const tool of agentConfig.tools) {
        session.toolHandlers.set(tool.name, tool.handler);
      }
    }

    this.activeSessions.set(callSid, session);

    // Ensure pool manager settings are loaded
    if (!openaiPoolManager.isSettingsLoaded()) {
      await openaiPoolManager.loadSettings();
    }

    // Check if we can reserve a slot in the OpenAI pool
    const credentialId = params.credentialId || 'twilio-openai-default';
    if (!openaiPoolManager.canReserveSlot(credentialId)) {
      console.log(`[TwilioOpenAI Bridge] OpenAI pool limit reached for credential ${credentialId}`);
      throw new Error('OpenAI connection limit reached. Please try again later.');
    }

    try {
      await this.connectToOpenAI(session, openaiApiKey);
      return session;
    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] Failed to create session:`, error.message);
      session.status = 'error';
      throw error;
    }
  }

  private static async connectToOpenAI(session: AudioBridgeSession, apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { agentConfig, callSid } = session;

      const wsUrl = `${this.OPENAI_REALTIME_URL}?model=${agentConfig.model}`;

      console.log(`[TwilioOpenAI Bridge] Connecting to OpenAI: ${agentConfig.model}`);

      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      session.openaiWs = ws;

      const connectionTimeoutId = setTimeout(() => {
        if (session.status === 'connecting') {
          this.activeSessions.delete(callSid);
          reject(new Error('OpenAI connection timeout'));
        }
      }, 15000);

      ws.on('open', () => {
        clearTimeout(connectionTimeoutId);
        console.log(`[TwilioOpenAI Bridge] OpenAI connected for ${callSid}`);
        session.status = 'connected';

        // Register connection with the pool manager
        openaiPoolManager.addConnection(
          session.callSid,
          ws,
          '',  // sessionId will be updated later
          'default'  // credentialId
        );

        this.configureSession(session);
        resolve();
      });

      ws.on('message', (data) => {
        this.handleOpenAIMessage(session, data.toString());
        openaiPoolManager.updateActivity(session.callSid);
      });

      ws.on('error', (error) => {
        clearTimeout(connectionTimeoutId);
        console.error(`[TwilioOpenAI Bridge] OpenAI error for ${callSid}:`, error);
        session.status = 'error';
        openaiPoolManager.removeConnection(session.callSid);
        this.activeSessions.delete(callSid);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        console.log(`[TwilioOpenAI Bridge] OpenAI closed for ${callSid}: ${code} ${reason}`);
        session.status = 'disconnected';
        openaiPoolManager.removeConnection(session.callSid);
        this.fireEndCallback(session);
      });
    });
  }

  private static configureSession(session: AudioBridgeSession): void {
    const { agentConfig, openaiWs } = session;
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

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

    // VAD configuration — tuned for phone audio (mulaw 8kHz has lower SNR than broadband)
    const vadSettings = agentConfig.vadSettings || {};
    const vadType = vadSettings.type ?? 'server_vad';
    // 0.5 threshold is more sensitive — phone audio needs lower threshold to detect speech reliably
    const vadThreshold = vadSettings.threshold ?? 0.5;
    // Shorter padding/silence = faster barge-in response
    const vadPrefixPaddingMs = vadSettings.prefixPaddingMs ?? 300;
    const vadSilenceDurationMs = vadSettings.silenceDurationMs ?? 500;
    const vadEagerness = vadSettings.eagerness ?? 'auto';

    console.log(`[TwilioOpenAI Bridge] VAD settings: type=${vadType}, threshold=${vadThreshold}, prefix=${vadPrefixPaddingMs}ms, silence=${vadSilenceDurationMs}ms`);

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
        create_response: true,     // Auto-trigger AI response when user stops speaking
        interrupt_response: true,  // BARGE-IN: stop AI immediately when user speaks
      };

    // Append mandatory behavioral requirements to every session
    const functionCallingRequirements = `

CONVERSATION FLOW — MANDATORY ORDER:
You MUST follow these steps on every call. Do NOT skip or reorder them:
1. GREET the caller warmly by name if known, otherwise say hello and introduce yourself
2. STATE who you are and which company you represent
3. BRIEFLY EXPLAIN what the company does and key services/products (1-2 sentences)
4. ASK how you can help them today — listen to their needs first
5. ONLY AFTER steps 1-4 are complete should you offer to book a meeting or appointment
Never jump to booking without completing the introduction. Never assume the caller knows the company.

LANGUAGE SWITCHING — MANDATORY:
If the caller speaks Hindi, says "Hindi mein batao", switches to Hinglish, or requests any other language:
- STOP your current sentence immediately — do NOT finish it
- Switch to that language in your VERY NEXT word
- Continue the full conversation in that language from that point
- Do NOT wait, do NOT say "let me switch", just switch instantly

COMPANY INFORMATION — MANDATORY:
ALWAYS call lookup_knowledge_base BEFORE stating any facts about the company, products, services, or pricing.
NEVER guess, assume, or make up company details from memory — this causes incorrect information.
If the knowledge base returns no result, say "Let me find that information for you" and do not guess.

FUNCTION CALLING REQUIREMENTS:
1. After collecting all form information, you MUST call submit_form to save the data. Do NOT just say you recorded it.
2. After completing a task, say a friendly closing and ask if there is anything else. Wait for their response.
3. Only call end_call AFTER the user confirms they are done or says goodbye.
4. These function calls are MANDATORY — data is not saved unless you call them.

BACKGROUND NOISE:
Ignore all background noise, music, TV, or ambient sounds. Only respond to the primary caller speaking directly to you.`;

    const enhancedInstructions = agentConfig.systemPrompt + functionCallingRequirements;

    // Correct OpenAI Realtime API session.update format.
    // All fields must be at the TOP LEVEL of session — NOT nested under any 'audio' object.
    // The previous nested audio.input/audio.output structure was invalid and ignored by OpenAI.
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: enhancedInstructions,
        voice: agentConfig.voice,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: turnDetection,
        tools,
        tool_choice: tools.length > 0 ? 'auto' : 'none',
        temperature: agentConfig.temperature ?? 0.7,
      },
    };

    console.log(`[TwilioOpenAI Bridge] Configuring session with ${tools.length} tools`);
    if (tools.length > 0) {
      console.log(`[TwilioOpenAI Bridge] Tools configured:`, tools.map(t => t.name).join(', '));
    }
    openaiWs.send(JSON.stringify(sessionConfig));

    // First message is now sent when Twilio stream starts (see handleTwilioMedia 'start' event)
    // This ensures the audio is not lost before the stream is ready
    if (agentConfig.firstMessage) {
      console.log(`[TwilioOpenAI Bridge] First message configured, will send when Twilio stream starts for ${session.callSid}`);
    }
  }

  private static trySendFirstMessage(session: AudioBridgeSession): void {
    if (session.firstMessageSent) return;
    if (!session.twilioStreamReady) return;
    if (session.status !== 'connected') return;
    if (!session.agentConfig.firstMessage) return;

    session.firstMessageSent = true;
    console.log(`[TwilioOpenAI Bridge] Twilio stream ready, sending first message for ${session.callSid}`);
    this.sendAgentMessage(session, session.agentConfig.firstMessage);
  }

  /**
   * Process pending audio queue after stream becomes ready
   * Plays all queued audio files in order
   */
  private static async processPendingAudioQueue(session: AudioBridgeSession): Promise<void> {
    const { callSid, pendingAudioQueue } = session;

    if (pendingAudioQueue.length === 0) return;

    console.log(`[TwilioOpenAI Bridge] Processing ${pendingAudioQueue.length} pending audio requests for ${callSid}`);

    // Process all queued audio requests
    while (pendingAudioQueue.length > 0) {
      const request = pendingAudioQueue.shift();
      if (!request) break;

      console.log(`[TwilioOpenAI Bridge] Playing queued audio: ${request.audioUrl}`);

      try {
        const result = await this.executePlayAudio(session, request.audioUrl);
        if (result.success) {
          console.log(`[TwilioOpenAI Bridge] Queued audio played successfully`);
        } else {
          console.error(`[TwilioOpenAI Bridge] Queued audio playback failed: ${result.error}`);
        }

        // Small delay between queued audio files
        if (pendingAudioQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        console.error(`[TwilioOpenAI Bridge] Error playing queued audio: ${error.message}`);
      }
    }

    console.log(`[TwilioOpenAI Bridge] Finished processing pending audio queue for ${callSid}`);
  }

  /**
   * Send a text message for the agent to speak
   * Uses response.create with instructions to speak the exact greeting text
   * per official OpenAI Realtime API documentation
   */
  private static sendAgentMessage(session: AudioBridgeSession, text: string): void {
    const { openaiWs, callSid } = session;
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    console.log(`[TwilioOpenAI Bridge] Sending first message for ${callSid}: "${text.substring(0, 50)}..."`);

    // Use response.create with instructions to speak the exact greeting
    // This is the official way to have the agent say a specific first message
    openaiWs.send(JSON.stringify({
      type: 'response.create',
      response: {
        instructions: `Say exactly this greeting to start the conversation, do not add anything else: "${text}"`,
      },
    }));
  }

  private static async handleOpenAIMessage(session: AudioBridgeSession, data: string): Promise<void> {
    try {
      const message = JSON.parse(data);
      const { callSid } = session;

      switch (message.type) {
        case 'session.created':
          session.openaiSessionId = message.session?.id || `session-${Date.now()}`;
          console.log(`[TwilioOpenAI Bridge] Session created: ${session.openaiSessionId}`);
          break;

        case 'session.updated':
          console.log(`[TwilioOpenAI Bridge] Session updated for ${callSid}`);
          break;

        case 'response.audio.delta':
        case 'response.output_audio.delta':
          if (message.delta) {
            if (session.onAudioCallback) {
              session.onAudioCallback(message.delta);
            }

            if (session.twilioWs && session.twilioWs.readyState === WebSocket.OPEN && session.streamSid) {
              session.twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: session.streamSid,
                media: {
                  payload: message.delta,
                },
              }));
            }
          }
          break;

        case 'response.audio.done':
        case 'response.output_audio.done':
          console.log(`[TwilioOpenAI Bridge] Audio response complete for ${callSid}`);
          break;

        case 'response.audio_transcript.delta':
        case 'response.output_audio_transcript.delta':
          if (message.delta && session.onTranscriptCallback) {
            session.onTranscriptCallback(message.delta, false);
          }
          break;

        case 'response.audio_transcript.done':
        case 'response.output_audio_transcript.done':
          if (message.transcript) {
            session.transcriptParts.push({
              role: 'assistant',
              text: message.transcript,
              timestamp: new Date(),
            });
            if (session.onTranscriptCallback) {
              session.onTranscriptCallback(message.transcript, true);
            }
            console.log(`[TwilioOpenAI Bridge] Agent: "${message.transcript.substring(0, 100)}..."`);
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          if (message.transcript) {
            session.transcriptParts.push({
              role: 'user',
              text: message.transcript,
              timestamp: new Date(),
            });
            console.log(`[TwilioOpenAI Bridge] User: "${message.transcript.substring(0, 100)}..."`);
          }
          break;

        case 'input_audio_buffer.speech_started':
          session.lastUserSpeechTime = Date.now();
          console.log(`[TwilioOpenAI Bridge] User started speaking (barge-in detected)`);
          // CRITICAL: Immediately cancel current response and clear audio buffer
          // This prevents the "rushing through" behavior when user interrupts
          this.handleBargeIn(session);
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log(`[TwilioOpenAI Bridge] User stopped speaking`);
          break;

        case 'response.function_call_arguments.done':
          await this.handleToolCall(session, message);
          break;

        case 'response.done':
          if (message.response?.output) {
            for (const item of message.response.output) {
              if (item.type === 'function_call') {
                await this.handleToolCall(session, {
                  name: item.name,
                  call_id: item.call_id,
                  arguments: item.arguments,
                });
              }
            }
          }
          break;

        case 'error':
          if (message.error?.code === 'response_cancel_not_active') {
            // Harmless timing error during barge-in — response already finished before cancel arrived
          } else {
            console.error(`[TwilioOpenAI Bridge] OpenAI error for ${callSid}:`, message.error);
          }
          break;

        default:
          if (message.type && !message.type.includes('delta')) {
            console.log(`[TwilioOpenAI Bridge] Event: ${message.type}`);
          }
      }
    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] Error handling message:`, error.message);
    }
  }

  private static async handleToolCall(
    session: AudioBridgeSession,
    message: { name?: string; call_id?: string; arguments?: string }
  ): Promise<void> {
    const { callSid } = session;
    const toolName = message.name;
    const callId = message.call_id;

    if (!toolName || !callId) {
      console.warn(`[TwilioOpenAI Bridge] Invalid tool call for ${callSid}`);
      return;
    }

    // Deduplicate: skip if we've already processed this tool call
    if (session.processedToolCallIds.has(callId)) {
      console.log(`[TwilioOpenAI Bridge] Skipping duplicate tool call: ${toolName} (${callId})`);
      return;
    }
    session.processedToolCallIds.add(callId);

    console.log(`[TwilioOpenAI Bridge] Tool call: ${toolName} for ${callSid}`);

    try {
      let params: Record<string, unknown> = {};
      if (message.arguments) {
        try {
          params = JSON.parse(message.arguments);
        } catch (e) {
          console.warn(`[TwilioOpenAI Bridge] Failed to parse tool arguments`);
        }
      }

      let result: unknown;

      // Handle end_call as a special built-in tool
      if (toolName === 'end_call') {
        console.log(`[TwilioOpenAI Bridge] Built-in end_call tool invoked for ${callSid}`);
        result = {
          action: 'end_call',
          reason: (params.reason as string) || 'Call ended by agent',
          ...params
        };
      }
      // Handle transfer_call and transfer_* as built-in tools for flow agents
      else if (toolName === 'transfer_call' || toolName.startsWith('transfer_')) {
        console.log(`[TwilioOpenAI Bridge] Built-in transfer tool invoked: ${toolName} for ${callSid}`);

        // Get target number from params or tool metadata
        let targetNumber = (params.destination as string) || (params.phoneNumber as string) || '';

        // If no destination in params, look for it in the tools array (flow agents store it as _transferNumber)
        // First try to match by the exact tool name, then fall back to any transfer tool
        if (!targetNumber && session.agentConfig.tools) {
          // First pass: look for exact tool name match
          for (const tool of session.agentConfig.tools) {
            const toolAny = tool as unknown as Record<string, unknown>;
            if (tool.name === toolName) {
              if (toolAny._transferNumber) {
                targetNumber = toolAny._transferNumber as string;
                console.log(`[TwilioOpenAI Bridge] Found transfer number from matching tool ${toolName}: ${targetNumber}`);
                break;
              } else if (toolAny._metadata && (toolAny._metadata as Record<string, unknown>).phoneNumber) {
                targetNumber = (toolAny._metadata as Record<string, unknown>).phoneNumber as string;
                console.log(`[TwilioOpenAI Bridge] Found transfer number from matching tool ${toolName} metadata: ${targetNumber}`);
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
                  console.log(`[TwilioOpenAI Bridge] Found transfer number from tool ${tool.name} _transferNumber: ${targetNumber}`);
                  break;
                } else if (toolAny._metadata && (toolAny._metadata as Record<string, unknown>).phoneNumber) {
                  targetNumber = (toolAny._metadata as Record<string, unknown>).phoneNumber as string;
                  console.log(`[TwilioOpenAI Bridge] Found transfer number from tool ${tool.name} _metadata: ${targetNumber}`);
                  break;
                }
              }
            }
          }
        }

        if (!targetNumber) {
          console.warn(`[TwilioOpenAI Bridge] No transfer destination found for ${toolName}`);
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
                console.log(`[TwilioOpenAI Bridge] Found audioUrl from tool ${toolName} _metadata: ${audioUrl}`);
                break;
              }
            }
          }
        }

        console.log(`[TwilioOpenAI Bridge] Play audio tool invoked for ${callSid}: ${audioUrl}`);

        if (audioUrl) {
          // Check if stream is ready, if not queue the request
          if (!session.twilioStreamReady || !session.streamSid) {
            console.log(`[TwilioOpenAI Bridge] Stream not ready, queueing audio playback for ${callSid}`);
            session.pendingAudioQueue.push({
              audioUrl,
              callId,
              timestamp: new Date(),
            });
            result = {
              action: 'play_audio',
              audioUrl,
              success: true,
              queued: true,
              message: 'Audio playback queued - will play when stream is ready.'
            };
          } else {
            // Execute Twilio audio playback via WebSocket streaming
            const playResult = await this.executePlayAudio(session, audioUrl);
            result = {
              action: 'play_audio',
              audioUrl,
              success: playResult.success,
              message: playResult.success
                ? 'Audio is now playing on the call.'
                : `Audio playback failed: ${playResult.error}`
            };
          }
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
        console.log(`[TwilioOpenAI Bridge] collect_caller_email tool invoked for ${callSid}`);
        result = await this.handleCollectCallerEmail(session, callSid, params);
      }
      // Handle send_email messaging tool
      else if (toolName === 'send_email') {
        console.log(`[TwilioOpenAI Bridge] Messaging send_email tool invoked for ${callSid}`);
        result = await this.handleSendEmail(session, params);
      }
      // Handle send_whatsapp messaging tool
      else if (toolName === 'send_whatsapp') {
        console.log(`[TwilioOpenAI Bridge] Messaging send_whatsapp tool invoked for ${callSid}`);
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

      console.log(`[TwilioOpenAI Bridge] Tool ${toolName} result:`, JSON.stringify(result).substring(0, 200));

      // Update call metadata for successful tool executions (for CRM Lead Processor)
      if (typeof result === 'object' && result !== null) {
        const toolResult = result as Record<string, unknown>;

        // Track successful appointment bookings
        if (toolName === 'book_appointment' && toolResult.success === true) {
          await this.updateCallMetadata(callSid, {
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
          await this.updateCallMetadata(callSid, {
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

      if (typeof result === 'object' && result !== null) {
        const actionResult = result as Record<string, unknown>;

        // Track successful transfers
        if (actionResult.action === 'transfer') {
          const targetNumber = actionResult.phoneNumber as string;
          console.log(`[TwilioOpenAI Bridge] Executing transfer to ${targetNumber}`);

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
            await this.updateCallMetadata(callSid, {
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
            console.log(`[TwilioOpenAI Bridge] Ignoring end_call - session already disconnecting/transferring`);
            result = { ignored: true, reason: 'Session already disconnecting or transfer in progress' };
          } else {
            console.log(`[TwilioOpenAI Bridge] Executing end call: ${actionResult.reason}`);
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

      this.sendToolResult(session, callId, result);

    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] Tool ${toolName} error:`, error.message);
      this.sendToolResult(session, callId, { error: error.message });
    }
  }

  private static sendToolResult(session: AudioBridgeSession, callId: string, result: unknown): void {
    const { openaiWs } = session;
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    }));

    openaiWs.send(JSON.stringify({
      type: 'response.create',
    }));
  }

  /**
   * Update call metadata in database after successful tool executions
   * This is critical for CRM Lead Processor to detect appointments, forms, and transfers
   * Uses deep merge for nested objects (aiInsights, appointmentData, formData) to preserve existing values
   */
  private static async updateCallMetadata(
    callSid: string,
    metadataUpdates: Record<string, unknown>
  ): Promise<void> {
    try {
      // Find the call record by callSid (stored in twilioCallSid column)
      const [existingCall] = await db
        .select()
        .from(twilioOpenaiCalls)
        .where(eq(twilioOpenaiCalls.twilioCallSid, callSid))
        .limit(1);

      if (!existingCall) {
        console.warn(`[TwilioOpenAI Bridge] Cannot update metadata - call not found: ${callSid}`);
        return;
      }

      // Deep merge existing metadata with new updates
      // This preserves existing nested values while adding new ones
      const existingMetadata = (existingCall.metadata as Record<string, unknown>) || {};
      const updatedMetadata = this.deepMergeMetadata(existingMetadata, metadataUpdates);

      await db
        .update(twilioOpenaiCalls)
        .set({ metadata: updatedMetadata })
        .where(eq(twilioOpenaiCalls.id, existingCall.id));

      console.log(`[TwilioOpenAI Bridge] Updated call metadata for ${callSid}:`, Object.keys(metadataUpdates));
    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] Failed to update call metadata:`, error.message);
    }
  }

  /**
   * Deep merge metadata objects, preserving existing nested values
   * Specifically handles aiInsights, appointmentData, formData to avoid overwriting
   */
  private static deepMergeMetadata(
    existing: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...existing };

    for (const key of Object.keys(updates)) {
      const existingValue = result[key];
      const newValue = updates[key];

      // Deep merge for known nested objects
      if (
        key === 'aiInsights' ||
        key === 'appointmentData' ||
        key === 'formData'
      ) {
        if (
          typeof existingValue === 'object' &&
          existingValue !== null &&
          !Array.isArray(existingValue) &&
          typeof newValue === 'object' &&
          newValue !== null &&
          !Array.isArray(newValue)
        ) {
          result[key] = {
            ...(existingValue as Record<string, unknown>),
            ...(newValue as Record<string, unknown>)
          };
        } else {
          result[key] = newValue;
        }
      } else {
        // Shallow merge for other keys
        result[key] = newValue;
      }
    }

    return result;
  }

  static handleTwilioMedia(callSid: string, event: TwilioMediaStreamEvent): void {
    const session = this.activeSessions.get(callSid);
    if (!session) {
      return;
    }

    switch (event.event) {
      case 'connected':
        console.log(`[TwilioOpenAI Bridge] Twilio stream connected for ${callSid}`);
        break;

      case 'start':
        if (event.start) {
          session.streamSid = event.start.streamSid;
          session.twilioStreamReady = true;
          console.log(`[TwilioOpenAI Bridge] Stream started: ${event.start.streamSid}, callSid: ${event.start.callSid}`);
          this.trySendFirstMessage(session);

          // Process any pending audio requests that were queued before stream was ready
          if (session.pendingAudioQueue.length > 0) {
            console.log(`[TwilioOpenAI Bridge] Processing ${session.pendingAudioQueue.length} queued audio requests`);
            this.processPendingAudioQueue(session);
          }
        }
        break;

      case 'media':
        if (event.media?.payload && session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
          session.openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: event.media.payload,
          }));
        }
        break;

      case 'stop':
        console.log(`[TwilioOpenAI Bridge] Stream stopped for ${callSid}`);
        break;

      case 'mark':
        if (event.mark) {
          console.log(`[TwilioOpenAI Bridge] Mark received: ${event.mark.name}`);
        }
        break;
    }
  }

  static setTwilioWebSocket(callSid: string, twilioWs: WebSocket, streamSid: string): void {
    const session = this.activeSessions.get(callSid);
    if (session) {
      session.twilioWs = twilioWs;
      session.streamSid = streamSid;
      console.log(`[TwilioOpenAI Bridge] Twilio WebSocket set for ${callSid}, streamSid: ${streamSid}`);
    }
  }

  static onAudioOutput(callSid: string, callback: (audioBase64: string) => void): void {
    const session = this.activeSessions.get(callSid);
    if (session) {
      session.onAudioCallback = callback;
    }
  }

  static onTranscriptUpdate(callSid: string, callback: (text: string, isFinal: boolean) => void): void {
    const session = this.activeSessions.get(callSid);
    if (session) {
      session.onTranscriptCallback = callback;
    }
  }

  static onToolCall(callSid: string, callback: (toolName: string, params: Record<string, unknown>) => Promise<unknown>): void {
    const session = this.activeSessions.get(callSid);
    if (session) {
      session.onToolCallback = callback;
    }
  }

  static onSessionEnd(callSid: string, callback: (sessionData: { transcript: string; duration: number; openaiSessionId: string }) => void): void {
    const session = this.activeSessions.get(callSid);
    if (session) {
      session.onEndCallback = callback;
    }
  }

  static async sendMessage(callSid: string, message: string): Promise<void> {
    const session = this.activeSessions.get(callSid);
    if (!session || !session.openaiWs || session.openaiWs.readyState !== WebSocket.OPEN) {
      console.warn(`[TwilioOpenAI Bridge] Cannot send message - no active session for ${callSid}`);
      return;
    }

    console.log(`[TwilioOpenAI Bridge] Injecting message: "${message.substring(0, 50)}..."`);

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

  static interrupt(callSid: string): void {
    const session = this.activeSessions.get(callSid);
    if (!session || !session.openaiWs || session.openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    console.log(`[TwilioOpenAI Bridge] Interrupting response for ${callSid}`);

    session.openaiWs.send(JSON.stringify({
      type: 'response.cancel',
    }));

    if (session.twilioWs && session.twilioWs.readyState === WebSocket.OPEN && session.streamSid) {
      session.twilioWs.send(JSON.stringify({
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
    const { callSid, openaiWs, twilioWs, streamSid } = session;

    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    console.log(`[TwilioOpenAI Bridge] Handling barge-in for ${callSid}`);

    // 1. Cancel the current response from OpenAI
    // This tells OpenAI to stop generating more audio/text
    openaiWs.send(JSON.stringify({
      type: 'response.cancel',
    }));

    // 2. Clear any queued audio that hasn't been sent yet
    // This prevents "rushing through" already-generated audio
    if (twilioWs && twilioWs.readyState === WebSocket.OPEN && streamSid) {
      twilioWs.send(JSON.stringify({
        event: 'clear',
        streamSid: streamSid,
      }));
      console.log(`[TwilioOpenAI Bridge] Cleared Twilio audio buffer for ${callSid}`);
    }

    // 3. Optionally clear OpenAI's input audio buffer to start fresh
    // (commented out as it may discard user's speech - let VAD handle this)
    // openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
  }

  static async endSession(callSid: string): Promise<{
    duration: number;
    transcript: string;
    transcriptParts: { role: 'user' | 'assistant'; text: string; timestamp: Date }[];
  }> {
    const session = this.activeSessions.get(callSid);
    if (!session) {
      return { duration: 0, transcript: '', transcriptParts: [] };
    }

    console.log(`[TwilioOpenAI Bridge] Ending session for ${callSid}`);

    // Remove connection from the pool manager
    openaiPoolManager.removeConnection(callSid);

    session.status = 'disconnected';
    session.endedAt = new Date();

    if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
      session.openaiWs.close();
    }

    const duration = session.endedAt
      ? Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000)
      : 0;

    const transcript = session.transcriptParts
      .map(p => `${p.role === 'user' ? 'User' : 'Agent'}: ${p.text}`)
      .join('\n');

    this.activeSessions.delete(callSid);

    return {
      duration,
      transcript,
      transcriptParts: session.transcriptParts,
    };
  }

  static getSession(callSid: string): AudioBridgeSession | undefined {
    return this.activeSessions.get(callSid);
  }

  static remapSession(oldCallSid: string, newCallSid: string): boolean {
    const session = this.activeSessions.get(oldCallSid);
    if (!session) {
      console.warn(`[TwilioOpenAI Bridge] Cannot remap session - not found: ${oldCallSid}`);
      return false;
    }
    session.callSid = newCallSid;
    this.activeSessions.delete(oldCallSid);
    this.activeSessions.set(newCallSid, session);
    console.log(`[TwilioOpenAI Bridge] Remapped session from ${oldCallSid} to ${newCallSid}`);
    return true;
  }

  static getActiveSessions(): Map<string, AudioBridgeSession> {
    return this.activeSessions;
  }

  /**
   * Execute actual call transfer via Twilio REST API
   * Updates the live call with TwiML to dial the transfer number
   * Uses the Twilio phone number (fromNumber) as the callerId since Twilio requires verified/owned caller IDs
   */
  private static async executeTransfer(session: AudioBridgeSession, targetNumber: string): Promise<{ success: boolean; error?: string }> {
    const { callSid, fromNumber, toNumber, callDirection } = session;

    try {
      // Wait for AI to finish speaking the transfer announcement
      // This prevents the call from being transferred mid-sentence
      console.log(`[TwilioOpenAI Bridge] Waiting 2.5s for AI to complete transfer announcement...`);
      await new Promise(resolve => setTimeout(resolve, 2500));

      const client = await getTwilioClient();

      // Call direction is REQUIRED for transfers to determine correct Twilio caller ID
      if (!callDirection) {
        console.error(`[TwilioOpenAI Bridge] Transfer failed - callDirection is missing for ${callSid}. fromNumber: ${fromNumber}, toNumber: ${toNumber}`);
        throw new Error('Cannot transfer call - callDirection is missing. This indicates a session setup issue.');
      }

      // Determine the Twilio-owned number based on call direction:
      // - Outbound calls: fromNumber is the Twilio number (what we dial FROM)
      // - Inbound calls: toNumber is the Twilio number (what customer dialed TO)
      // Twilio requires caller ID to be a verified/owned number
      let callerId: string | undefined;

      if (callDirection === 'inbound') {
        // Inbound: toNumber is the Twilio number the customer called
        callerId = toNumber;
        console.log(`[TwilioOpenAI Bridge] Inbound call - using toNumber as caller ID: ${callerId}`);
      } else {
        // Outbound: fromNumber is the Twilio number we called from
        callerId = fromNumber;
        console.log(`[TwilioOpenAI Bridge] Outbound call - using fromNumber as caller ID: ${callerId}`);
      }

      if (!callerId) {
        console.error(`[TwilioOpenAI Bridge] Transfer failed - caller ID is missing. Direction: ${callDirection}, fromNumber: ${fromNumber}, toNumber: ${toNumber}`);
        throw new Error(`Cannot transfer call - Twilio caller ID is missing for ${callDirection} call`);
      }

      console.log(`[TwilioOpenAI Bridge] Transfer using Twilio caller ID: ${callerId}`);
      const twiml = generateTransferTwiML(targetNumber, callerId);

      console.log(`[TwilioOpenAI Bridge] Updating call ${callSid} with transfer TwiML to ${targetNumber} (callerId: ${callerId})`);

      await client.calls(callSid).update({
        twiml: twiml,
      });

      console.log(`[TwilioOpenAI Bridge] Transfer initiated successfully for ${callSid}`);

      if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
        session.openaiWs.close(1000, 'Call transferred');
      }

      session.status = 'disconnected';
      session.endedAt = new Date();

      this.fireEndCallback(session);

      return { success: true };

    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] Transfer failed for ${callSid}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute actual call hangup via Twilio REST API
   * Updates the live call with TwiML to end the call gracefully
   */
  private static async executeHangup(session: AudioBridgeSession): Promise<{ success: boolean; error?: string }> {
    const { callSid } = session;

    try {
      const client = await getTwilioClient();

      const twiml = generateHangupTwiML('Thank you for calling. Goodbye!');

      console.log(`[TwilioOpenAI Bridge] Hanging up call ${callSid}`);

      await client.calls(callSid).update({
        twiml: twiml,
      });

      console.log(`[TwilioOpenAI Bridge] Hangup successful for ${callSid}`);

      session.status = 'disconnected';
      session.endedAt = new Date();

      if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
        session.openaiWs.close(1000, 'Call ended');
      }

      this.fireEndCallback(session);

      return { success: true };

    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] Hangup failed for ${callSid}:`, error.message);
      return { success: false, error: error.message };
    }
  }

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
    callSid: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const emailAddress = params.email_address as string;
    if (!emailAddress) {
      return { success: false, message: 'No email address provided.' };
    }
    try {
      await this.updateCallMetadata(callSid, { callerEmail: emailAddress });
      console.log(`[TwilioOpenAI Bridge] Stored callerEmail in metadata: ${emailAddress}`);
      return { success: true, message: `Email address ${emailAddress} stored for post-call follow-up.` };
    } catch (err: any) {
      console.error(`[TwilioOpenAI Bridge] Failed to store callerEmail: ${err.message}`);
      return { success: false, message: 'Failed to store email address.' };
    }
  }

  private static async handleSendEmail(
    session: AudioBridgeSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const ctx = this.getMessagingContext(session, 'send_email');
    if (!ctx) {
      console.warn(`[TwilioOpenAI Bridge] No messaging context found for send_email`);
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
          console.warn(`[TwilioOpenAI Bridge] Could not look up agent name for auto-injection`);
        }
      }

      if (session.callSid) {
        try {
          const [callRecord] = await db
            .select({ metadata: twilioOpenaiCalls.metadata })
            .from(twilioOpenaiCalls)
            .where(eq(twilioOpenaiCalls.twilioCallSid, session.callSid))
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
          console.warn(`[TwilioOpenAI Bridge] Could not look up call metadata for auto-injection`);
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
          console.warn(`[TwilioOpenAI Bridge] Could not look up appointment data for auto-injection`);
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

      console.log(`[TwilioOpenAI Bridge] send_email result: success=${result.success} to=${recipientEmail}`);

      // Side-effect: persist callerEmail to call metadata for post-call trigger awareness
      if (result.success && session.callSid) {
        this.updateCallMetadata(session.callSid, { callerEmail: recipientEmail }).catch(() => { });
      }

      return {
        success: result.success,
        message: result.success
          ? `Email sent successfully to ${recipientEmail}`
          : `Failed to send email: ${result.error}`,
      };
    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] send_email error: ${error.message}`);
      return { success: false, message: 'Error sending email.' };
    }
  }

  private static async handleSendWhatsApp(
    session: AudioBridgeSession,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const ctx = this.getMessagingContext(session, 'send_whatsapp');
    if (!ctx) {
      console.warn(`[TwilioOpenAI Bridge] No messaging context found for send_whatsapp`);
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
              console.log(`[TwilioOpenAI Bridge] Auto-added ${buttonComponents.length} button component(s) for template "${templateName}"`);
            }
          }
        } catch (tmplError: any) {
          console.warn(`[TwilioOpenAI Bridge] Could not fetch template metadata: ${tmplError.message}`);
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
          metadata: { agentId: ctx.agentId, source: 'twilio-openai' },
        });
      } catch (convError: any) {
        console.warn(`[TwilioOpenAI Bridge] Failed to store WhatsApp in conversations: ${convError.message}`);
      }

      console.log(`[TwilioOpenAI Bridge] send_whatsapp result: success=true to=${recipientPhone}`);
      return { success: true, message: `WhatsApp message sent successfully to ${recipientPhone}` };
    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] send_whatsapp error: ${error.message}`);
      return { success: false, message: 'Error sending WhatsApp message.' };
    }
  }

  /**
   * Execute audio playback by streaming audio through the Twilio Media Stream WebSocket
   * 
   * For Twilio Media Streams (bidirectional), we send audio as 'media' events
   * The audio must be in mulaw 8kHz format, base64 encoded
   */
  private static async executePlayAudio(session: AudioBridgeSession, audioUrl: string): Promise<{ success: boolean; error?: string }> {
    const { callSid, twilioWs, streamSid, twilioStreamReady } = session;

    console.log(`[TwilioOpenAI Bridge] ===== INITIATING AUDIO PLAYBACK =====`);
    console.log(`[TwilioOpenAI Bridge] Call SID: ${callSid}`);
    console.log(`[TwilioOpenAI Bridge] Audio URL: ${audioUrl}`);
    console.log(`[TwilioOpenAI Bridge] Stream ready: ${twilioStreamReady}, streamSid: ${streamSid}`);

    // Verify stream is ready before attempting playback
    if (!twilioStreamReady) {
      console.error(`[TwilioOpenAI Bridge] Twilio stream not ready for audio playback`);
      return { success: false, error: 'Twilio stream not ready - please wait for call to connect' };
    }

    if (!twilioWs || twilioWs.readyState !== WebSocket.OPEN) {
      console.error(`[TwilioOpenAI Bridge] Twilio WebSocket not available for audio playback`);
      return { success: false, error: 'Twilio WebSocket not available' };
    }

    if (!streamSid) {
      console.error(`[TwilioOpenAI Bridge] Stream SID not available for audio playback`);
      return { success: false, error: 'Stream SID not available' };
    }

    try {
      // Construct full audio URL if it's a relative path
      let fullAudioUrl = audioUrl;
      if (audioUrl.startsWith('/')) {
        const baseUrl = getDomain();
        fullAudioUrl = `${baseUrl}${audioUrl}`;
        console.log(`[TwilioOpenAI Bridge] Converted relative URL to: ${fullAudioUrl}`);
      }

      // Fetch the audio file
      console.log(`[TwilioOpenAI Bridge] Fetching audio file...`);
      const response = await axios.get(fullAudioUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const audioBuffer = Buffer.from(response.data);
      console.log(`[TwilioOpenAI Bridge] Audio file fetched, size: ${audioBuffer.length} bytes`);

      // For Twilio Media Streams, audio must be mulaw 8kHz
      // If the file is a WAV with mulaw encoding, extract the audio data
      // If it's raw mulaw, use it directly
      // If it's MP3 or other format, we need to convert it (complex - skip for now)

      let mulawData: Buffer;
      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('audio/wav') || contentType.includes('audio/x-wav') ||
        audioUrl.endsWith('.wav') || audioUrl.includes('.wav')) {
        // WAV file - try to extract raw audio data (skip header)
        // Standard WAV header is 44 bytes, but can vary
        // Look for 'data' chunk
        const dataIndex = audioBuffer.indexOf(Buffer.from('data'));
        if (dataIndex > 0 && dataIndex + 8 < audioBuffer.length) {
          // Skip 'data' + 4 bytes of chunk size
          mulawData = audioBuffer.slice(dataIndex + 8);
          console.log(`[TwilioOpenAI Bridge] Extracted audio data from WAV, size: ${mulawData.length} bytes`);
        } else {
          // Fallback: skip first 44 bytes (standard header)
          mulawData = audioBuffer.slice(44);
          console.log(`[TwilioOpenAI Bridge] Using fallback WAV extraction, size: ${mulawData.length} bytes`);
        }
      } else if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3') ||
        audioUrl.endsWith('.mp3') || audioUrl.includes('.mp3')) {
        // MP3 file - convert to mulaw 8kHz WAV using ffmpeg
        console.log(`[TwilioOpenAI Bridge] MP3 format detected - converting to mulaw 8kHz...`);

        const convertedData = await this.convertAudioToMulaw(audioBuffer, 'mp3');
        if (!convertedData) {
          return {
            success: false,
            error: 'Failed to convert MP3 audio to mulaw format.'
          };
        }
        mulawData = convertedData;
        console.log(`[TwilioOpenAI Bridge] Converted MP3 to mulaw, size: ${mulawData.length} bytes`);
      } else {
        // Assume it's already raw mulaw data
        mulawData = audioBuffer;
        console.log(`[TwilioOpenAI Bridge] Using audio data directly, size: ${mulawData.length} bytes`);
      }

      // Stream audio in chunks (160 bytes = 20ms of 8kHz mulaw audio)
      const chunkSize = 160;
      const totalChunks = Math.ceil(mulawData.length / chunkSize);
      console.log(`[TwilioOpenAI Bridge] Streaming ${totalChunks} audio chunks...`);

      let chunksSent = 0;
      for (let offset = 0; offset < mulawData.length; offset += chunkSize) {
        const chunk = mulawData.slice(offset, offset + chunkSize);
        const payload = chunk.toString('base64');

        if (twilioWs.readyState !== WebSocket.OPEN) {
          console.warn(`[TwilioOpenAI Bridge] WebSocket closed during playback at chunk ${chunksSent}`);
          break;
        }

        twilioWs.send(JSON.stringify({
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: payload,
          },
        }));

        chunksSent++;

        // Add small delay every 50 chunks to prevent flooding
        if (chunksSent % 50 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Send a mark event to track when playback completes
      const markName = `audio_playback_${Date.now()}`;
      twilioWs.send(JSON.stringify({
        event: 'mark',
        streamSid: streamSid,
        mark: {
          name: markName,
        },
      }));

      // Calculate playback duration and wait for audio to finish
      // Mulaw 8kHz = 8000 samples/second, 1 byte per sample
      const audioDurationMs = Math.ceil((mulawData.length / 8000) * 1000);
      console.log(`[TwilioOpenAI Bridge] Audio duration: ${audioDurationMs}ms, waiting for playback...`);

      // Wait for estimated playback duration plus buffer
      await new Promise(resolve => setTimeout(resolve, audioDurationMs + 500));

      console.log(`[TwilioOpenAI Bridge] ===== SUCCESS - Audio playback complete =====`);
      console.log(`[TwilioOpenAI Bridge] Sent ${chunksSent} chunks, mark: ${markName}`);

      return { success: true };

    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] ===== ERROR =====`);
      console.error(`[TwilioOpenAI Bridge] Error message: ${error.message}`);
      if (error.response) {
        console.error(`[TwilioOpenAI Bridge] Response status: ${error.response.status}`);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper to fire end callback only once with session data
   */
  private static fireEndCallback(session: AudioBridgeSession): void {
    if (session.endCallbackFired || !session.onEndCallback) {
      return;
    }

    session.endCallbackFired = true;
    session.endedAt = session.endedAt || new Date();

    const duration = session.endedAt
      ? Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000)
      : 0;

    const transcript = session.transcriptParts
      .map(p => `${p.role === 'user' ? 'User' : 'Agent'}: ${p.text}`)
      .join('\n');

    session.onEndCallback({
      transcript,
      duration,
      openaiSessionId: session.openaiSessionId || ''
    });
  }

  /**
   * Convert audio to mulaw 8kHz format using ffmpeg
   * Supports MP3, WAV, and other common audio formats
   */
  private static async convertAudioToMulaw(audioBuffer: Buffer, inputFormat: string): Promise<Buffer | null> {
    const tempId = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `${tempId}.${inputFormat}`);
    const outputPath = path.join(tempDir, `${tempId}_mulaw.raw`);

    try {
      // Write input file
      await fsWriteFile(inputPath, audioBuffer);
      console.log(`[TwilioOpenAI Bridge] Wrote temp audio file: ${inputPath} (${audioBuffer.length} bytes)`);

      // Convert using ffmpeg to raw mulaw 8kHz mono
      // -f mulaw outputs raw mulaw without WAV header
      const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -ar 8000 -ac 1 -f mulaw "${outputPath}"`;
      console.log(`[TwilioOpenAI Bridge] Running ffmpeg conversion...`);

      await execAsync(ffmpegCmd);

      // Read converted output
      const mulawData = await fsReadFile(outputPath);
      console.log(`[TwilioOpenAI Bridge] Conversion complete: ${mulawData.length} bytes of mulaw audio`);

      // Clean up temp files
      await fsUnlink(inputPath).catch(() => { });
      await fsUnlink(outputPath).catch(() => { });

      return mulawData;

    } catch (error: any) {
      console.error(`[TwilioOpenAI Bridge] FFmpeg conversion failed: ${error.message}`);

      // Clean up temp files on error
      await fsUnlink(inputPath).catch(() => { });
      await fsUnlink(outputPath).catch(() => { });

      return null;
    }
  }
}
