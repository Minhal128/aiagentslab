'use strict';
/**
 * ============================================================
 * Twilio-OpenAI Webhook Routes
 * 
 * Handles incoming Twilio webhooks for the OpenAI Realtime engine.
 * Completely isolated from the Twilio + ElevenLabs integration.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../db';
import { agents, twilioOpenaiCalls, phoneNumbers, incomingConnections, users, creditTransactions, flows, contacts } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { 
  generateTwiML, 
  getStreamWebhookUrl,
  getStatusWebhookUrl,
  TWILIO_OPENAI_CONFIG
} from '../config/twilio-openai-config';
import { OpenAIPoolService } from '../../plivo/services/openai-pool.service';
import { OpenAIAgentFactory } from '../services/openai-agent-factory';
import { TwilioOpenAIAudioBridge } from '../services/audio-bridge.service';
import { logger } from '../../../utils/logger';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { validateTwilioWebhook } from '../../../middleware/webhookValidation';
import type { TwilioWebhookParams } from '../types';
import { scheduleContactRetry } from '../../../routes/webhooks/helpers';

const router = Router();

// Apply Twilio webhook signature validation to all voice routes
router.use('/voice/*', validateTwilioWebhook);

/**
 * Normalize phone number for database lookup.
 * Database stores phone numbers with + prefix (e.g., +14159038188).
 * Twilio may send with or without + prefix.
 */
function normalizePhoneForLookup(phone: string): string {
  // Remove spaces, dashes, parentheses but KEEP the + if present
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // Ensure + prefix for E.164 format matching
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

/**
 * Normalize phone number for storage (preserves + prefix).
 */
function normalizePhoneForStorage(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

router.post('/voice/incoming', async (req: Request, res: Response) => {
  const params = req.body as TwilioWebhookParams;
  const { CallSid, From, To, Direction } = params;

  logger.info(`Incoming call: ${CallSid}`, undefined, 'TwilioOpenAI');
  logger.info(`From: ${From}, To: ${To}, Direction: ${Direction}`, undefined, 'TwilioOpenAI');

  // Trigger inbound_call.received early - we have the call but haven't processed it yet
  // This fires before any validation to capture ALL incoming calls
  let phoneRecordForWebhook: any = null;
  let agentForWebhook: any = null;

  try {
    const normalizedTo = normalizePhoneForLookup(To);
    
    const [phoneRecord] = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.phoneNumber, normalizedTo))
      .limit(1);

    phoneRecordForWebhook = phoneRecord;

    // Trigger inbound_call.received as soon as we have the phone record
    if (phoneRecord?.userId) {
      try {
        await webhookDeliveryService.triggerEvent(phoneRecord.userId, 'inbound_call.received', {
          callId: null,
          callSid: CallSid,
          direction: 'inbound',
          status: 'received',
          fromNumber: normalizePhoneForStorage(From),
          toNumber: normalizedTo,
          agentId: null,
          phoneNumberId: phoneRecord.id,
        });
        logger.info(`Triggered inbound_call.received webhook for incoming call ${CallSid}`, undefined, 'TwilioOpenAI');
      } catch (webhookError: any) {
        logger.error(`Failed to trigger inbound_call.received webhook: ${webhookError.message}`, undefined, 'TwilioOpenAI');
      }
    }

    if (!phoneRecord) {
      logger.info(`Phone number not found: ${normalizedTo}`, undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, this number is not configured for AI calls.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    const [connection] = await db
      .select()
      .from(incomingConnections)
      .where(eq(incomingConnections.phoneNumberId, phoneRecord.id))
      .limit(1);

    if (!connection) {
      logger.info(`No agent connection for: ${normalizedTo}`, undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, no AI agent is available for this number.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, connection.agentId))
      .limit(1);

    if (!agent) {
      logger.info(`Agent not found: ${connection.agentId}`, undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, the AI agent is not available.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    // Check user has credits before connecting
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, phoneRecord.userId || ''))
      .limit(1);

    if (!user || user.credits < 1) {
      logger.info(`Insufficient credits for user: ${phoneRecord.userId}`, undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, there are no credits available for this call. Please top up your account.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    const credential = await OpenAIPoolService.reserveSlot();
    if (!credential) {
      logger.info('No OpenAI capacity available', undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, all AI agents are busy. Please try again later.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    const callId = nanoid();
    
    // Store agent configuration in metadata for the stream handler to use
    // Session will be created when the WebSocket stream connects (on 'start' event)
    // This prevents the 5-8 second delay where audio was lost before stream connected
    const callMetadata: Record<string, unknown> = {
      incomingCall: true,
      agentId: agent.id,
      userId: phoneRecord.userId,
      knowledgeBaseIds: agent.knowledgeBaseIds || [],
      transferEnabled: agent.transferEnabled,
      transferPhoneNumber: agent.transferPhoneNumber,
      endConversationEnabled: agent.endConversationEnabled,
      detectLanguageEnabled: agent.detectLanguageEnabled,
      appointmentBookingEnabled: agent.appointmentBookingEnabled,
      messagingEmailEnabled: agent.messagingEmailEnabled,
      messagingWhatsappEnabled: agent.messagingWhatsappEnabled,
      messagingEmailTemplate: agent.messagingEmailTemplate,
      messagingWhatsappTemplate: agent.messagingWhatsappTemplate,
      messagingWhatsappVariables: agent.messagingWhatsappVariables,
      systemPrompt: agent.systemPrompt,
      firstMessage: agent.firstMessage,
      temperature: agent.temperature,
      language: agent.language || 'en',
    };
    
    // For flow agents, load and store compiled flow data including tools with metadata
    if (agent.type === 'flow' && agent.flowId) {
      logger.info(`Loading flow data for incoming call to flow agent ${agent.id}`, undefined, 'TwilioOpenAI');
      const [flow] = await db
        .select()
        .from(flows)
        .where(eq(flows.id, agent.flowId))
        .limit(1);
      
      if (flow && flow.compiledSystemPrompt && flow.compiledTools) {
        callMetadata.isFlowAgent = true;
        callMetadata.flowId = flow.id;
        callMetadata.systemPrompt = flow.compiledSystemPrompt;
        callMetadata.firstMessage = flow.compiledFirstMessage || agent.firstMessage;
        // Store compiled tools with their _metadata intact for rehydration in stream handler
        callMetadata.compiledTools = flow.compiledTools;
        logger.info(`Stored ${(flow.compiledTools as any[]).length} compiled flow tools for incoming call`, undefined, 'TwilioOpenAI');
      }
    }
    
    await db.insert(twilioOpenaiCalls).values({
      id: callId,
      userId: phoneRecord.userId,
      agentId: agent.id,
      twilioPhoneNumberId: phoneRecord.id,
      openaiCredentialId: credential.id,
      twilioCallSid: CallSid,
      fromNumber: normalizePhoneForStorage(From),
      toNumber: normalizedTo,
      openaiVoice: (agent.openaiVoice as any) || TWILIO_OPENAI_CONFIG.defaultVoice,
      openaiModel: TWILIO_OPENAI_CONFIG.openaiRealtimeModel,
      status: 'in-progress',
      callDirection: 'inbound',
      startedAt: new Date(),
      answeredAt: new Date(),
      metadata: callMetadata,
    });

    // NOTE: Recording is now started in the WebSocket stream 'start' event handler
    // (twilio-openai-stream.ts). That fires unconditionally for both inbound and
    // outbound calls as soon as Twilio begins streaming audio, with no dependency
    // on the status callback being delivered.

    // NOTE: Session creation is now deferred to the stream handler
    // This ensures the Twilio WebSocket is connected before OpenAI starts sending audio
    logger.info(`Incoming call ${callId} prepared, session will be created when stream connects`, undefined, 'TwilioOpenAI');

    // Trigger call.started webhook event for incoming calls
    try {
      await webhookDeliveryService.triggerEvent(phoneRecord.userId!, 'call.started', {
        call: {
          id: callId,
          callSid: CallSid,
          direction: 'inbound',
          status: 'in-progress',
          startedAt: new Date().toISOString(),
          fromNumber: normalizePhoneForStorage(From),
          toNumber: normalizedTo,
        },
        agent: {
          id: agent.id,
          name: agent.name || null,
        },
        campaign: null,
      });
      logger.info(`Triggered call.started webhook for incoming call ${callId}`, undefined, 'TwilioOpenAI');
    } catch (webhookError: any) {
      logger.error(`Failed to trigger call.started webhook: ${webhookError.message}`, undefined, 'TwilioOpenAI');
    }

    // Trigger inbound_call.answered webhook - the call has been answered by the AI agent
    try {
      await webhookDeliveryService.triggerEvent(phoneRecord.userId!, 'inbound_call.answered', {
        callId: callId,
        callSid: CallSid,
        direction: 'inbound',
        status: 'in-progress',
        fromNumber: normalizePhoneForStorage(From),
        toNumber: normalizedTo,
        agentId: agent.id,
        phoneNumberId: phoneRecord.id,
      });
      logger.info(`Triggered inbound_call.answered webhook for call ${callId}`, undefined, 'TwilioOpenAI');
    } catch (webhookError: any) {
      logger.error(`Failed to trigger inbound_call.answered webhook: ${webhookError.message}`, undefined, 'TwilioOpenAI');
    }

    const streamUrl = getStreamWebhookUrl(CallSid);
    const twiml = generateTwiML({
      streamUrl,
      customParameters: {
        callId,
        agentId: agent.id,
      },
    });

    logger.info(`Call ${callId} connected to stream: ${streamUrl}`, undefined, 'TwilioOpenAI');

    res.type('text/xml');
    res.send(twiml);

  } catch (error: any) {
    logger.error('Error handling incoming call', error, 'TwilioOpenAI');
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, an error occurred. Please try again.</Say>
  <Hangup/>
</Response>`);
  }
});

router.post('/voice/answer', async (req: Request, res: Response) => {
  const params = req.body as TwilioWebhookParams;
  const { CallSid, From, To } = params;
  
  logger.info(`Outbound call answered: ${CallSid}`, undefined, 'TwilioOpenAI');

  try {
    const [callRecord] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(eq(twilioOpenaiCalls.twilioCallSid, CallSid))
      .limit(1);

    if (!callRecord) {
      logger.info(`Call record not found for: ${CallSid}`, undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Call setup error. Goodbye.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    await db
      .update(twilioOpenaiCalls)
      .set({ 
        status: 'in-progress',
        answeredAt: new Date(),
      })
      .where(eq(twilioOpenaiCalls.id, callRecord.id));

    const session = TwilioOpenAIAudioBridge.getSession(CallSid);
    if (!session) {
      logger.info(`No session found for: ${CallSid}`, undefined, 'TwilioOpenAI');
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Session not found. Goodbye.</Say>
  <Hangup/>
</Response>`);
      return;
    }

    // Recording is initiated in the WebSocket stream 'start' event handler
    // (twilio-openai-stream.ts) for both inbound and outbound calls, which is
    // more reliable than status callbacks that Twilio only fires for inbound
    // calls when a Status Callback URL is configured at the phone-number level.

    const streamUrl = getStreamWebhookUrl(CallSid);
    const twiml = generateTwiML({
      streamUrl,
      customParameters: {
        callId: callRecord.id,
        agentId: callRecord.agentId || '',
      },
    });

    res.type('text/xml');
    res.send(twiml);

  } catch (error: any) {
    logger.error('Error handling answer', error, 'TwilioOpenAI');
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred.</Say>
  <Hangup/>
</Response>`);
  }
});

router.post('/voice/status', async (req: Request, res: Response) => {
  const params = req.body as TwilioWebhookParams;
  const { CallSid, CallStatus, CallDuration, RecordingUrl, RecordingDuration } = params;

  logger.info(`Call status update: ${CallSid} -> ${CallStatus}`, undefined, 'TwilioOpenAI');

  try {
    const [callRecord] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(eq(twilioOpenaiCalls.twilioCallSid, CallSid))
      .limit(1);

    if (!callRecord) {
      logger.info(`Call record not found for status update: ${CallSid}`, undefined, 'TwilioOpenAI');
      res.sendStatus(200);
      return;
    }

    // Trigger webhook events for specific call statuses
    if (callRecord.userId) {
      try {
        const webhookPayload = {
          callId: callRecord.id,
          callSid: CallSid,
          direction: callRecord.callDirection || 'outbound',
          status: CallStatus,
          fromNumber: callRecord.fromNumber,
          toNumber: callRecord.toNumber,
          contactId: callRecord.contactId,
          campaignId: callRecord.campaignId,
        };

        if (CallStatus === 'ringing') {
          await webhookDeliveryService.triggerEvent(callRecord.userId, 'call.ringing', webhookPayload, callRecord.campaignId);
          logger.info(`Triggered call.ringing webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
        } else if (CallStatus === 'in-progress') {
          await webhookDeliveryService.triggerEvent(callRecord.userId, 'call.answered', webhookPayload, callRecord.campaignId);
          logger.info(`Triggered call.answered webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
          // Recording is now started in the WebSocket stream 'start' event handler
          // (twilio-openai-stream.ts), not here, so no recordings.create() call needed.
        } else if (CallStatus === 'no-answer') {
          await webhookDeliveryService.triggerEvent(callRecord.userId, 'call.no_answer', webhookPayload, callRecord.campaignId);
          logger.info(`Triggered call.no_answer webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
        } else if (CallStatus === 'busy') {
          await webhookDeliveryService.triggerEvent(callRecord.userId, 'call.busy', webhookPayload, callRecord.campaignId);
          logger.info(`Triggered call.busy webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
        }

        // Check for voicemail detection from Twilio AMD (Answering Machine Detection)
        const AnsweredBy = (params as any).AnsweredBy;
        if (AnsweredBy === 'machine_start' || AnsweredBy === 'machine_end_beep' || AnsweredBy === 'machine_end_silence') {
          await webhookDeliveryService.triggerEvent(callRecord.userId, 'call.voicemail', webhookPayload, callRecord.campaignId);
          logger.info(`Triggered call.voicemail webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
        }
      } catch (webhookError: any) {
        logger.error(`Failed to trigger status webhook for call ${callRecord.id}: ${webhookError.message}`, webhookError, 'TwilioOpenAI');
      }
    }

    const updates: any = {
      status: CallStatus as any,
    };

    // Capture recording data if available from status callback (add .mp3 extension for direct access)
    if (RecordingUrl) {
      updates.recordingUrl = RecordingUrl.endsWith('.mp3') ? RecordingUrl : `${RecordingUrl}.mp3`;
    }
    if (RecordingDuration) {
      updates.recordingDuration = parseInt(RecordingDuration, 10);
    }

    if (CallStatus === 'completed' || CallStatus === 'busy' || 
        CallStatus === 'failed' || CallStatus === 'no-answer' || CallStatus === 'canceled') {
      updates.endedAt = new Date();
      
      const duration = CallDuration ? parseInt(CallDuration, 10) : 0;
      if (duration > 0) {
        updates.duration = duration;
      }

      const sessionResult = await TwilioOpenAIAudioBridge.endSession(CallSid);
      if (sessionResult.transcript) {
        updates.transcript = sessionResult.transcript;
      }

      if (callRecord.openaiCredentialId) {
        await OpenAIPoolService.releaseSlot(callRecord.openaiCredentialId);
      }

      // Deduct credits using Twilio's authoritative `CallDuration` (answered
      // duration only — excludes ringing/setup time). This is the single
      // billing trigger for OUTBOUND Twilio+OpenAI calls; inbound calls bill
      // via the `onSessionEnd` callback registered in the stream route's
      // `initializeSession` (since Twilio does not fire status callbacks for
      // inbound numbers without an account-level callback URL, which we don't
      // set). `deductCallCredits` is idempotent — uses a Postgres advisory
      // lock + uniqueness check on
      // `credit_transactions.reference = 'twilio-openai:<callId>'` — so even
      // if both paths fire for the same call, only one transaction is created.
      if (CallStatus === 'completed' && callRecord.userId && duration >= 1) {
        const creditsToDeduct = Math.ceil(duration / 60);
        if (creditsToDeduct > 0) {
          try {
            const { deductCallCredits } = await import('../../../services/credit-service');
            const creditResult = await deductCallCredits({
              userId: callRecord.userId,
              creditsToDeduct,
              callId: callRecord.id,
              fromNumber: callRecord.fromNumber || 'Unknown',
              toNumber: callRecord.toNumber || 'Unknown',
              durationSeconds: duration,
              engine: 'twilio-openai',
            });
            if (creditResult.success && creditResult.creditsDeducted > 0) {
              logger.info(
                `Credits deducted (status webhook) for call ${callRecord.id}: ${creditResult.creditsDeducted} credits, new balance: ${creditResult.newBalance}`,
                undefined,
                'TwilioOpenAI',
              );
            } else if (creditResult.alreadyDeducted) {
              logger.info(
                `Credits already deducted for call ${callRecord.id} (status webhook no-op)`,
                undefined,
                'TwilioOpenAI',
              );
            } else if (!creditResult.success) {
              logger.error(
                `Credit deduction failed (status webhook) for call ${callRecord.id}: ${creditResult.error}`,
                undefined,
                'TwilioOpenAI',
              );
              updates.status = 'credit_failed';
              updates.metadata = sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ creditError: creditResult.error, creditsRequired: creditsToDeduct })}::jsonb`;
            }
          } catch (creditErr: any) {
            logger.error(
              `Unexpected error during credit deduction for call ${callRecord.id}: ${creditErr.message}`,
              creditErr,
              'TwilioOpenAI',
            );
          }
        }
      }

      // Track attempt and schedule retry via shared helper (handles all engines uniformly)
      if (callRecord.contactId && callRecord.campaignId) {
        scheduleContactRetry(callRecord.contactId, callRecord.campaignId, CallStatus).catch((err: any) => {
          logger.error(`Failed to schedule contact retry: ${err.message}`, undefined, 'TwilioOpenAI');
        });
      }

      // Trigger call.completed webhook event
      if (callRecord.userId && (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer')) {
        try {
          await webhookDeliveryService.triggerEvent(callRecord.userId, 'call.completed', {
            call: {
              id: callRecord.id,
              callSid: CallSid,
              direction: callRecord.callDirection || 'outbound',
              status: CallStatus,
              duration: duration,
              startedAt: callRecord.startedAt?.toISOString() || null,
              endedAt: new Date().toISOString(),
              fromNumber: callRecord.fromNumber || null,
              toNumber: callRecord.toNumber || null,
              transcript: updates.transcript || null,
              recordingUrl: updates.recordingUrl || callRecord.recordingUrl || null,
            },
            agent: callRecord.agentId ? { id: callRecord.agentId } : null,
            campaign: callRecord.campaignId ? { id: callRecord.campaignId } : null,
          });
          logger.info(`Triggered call.completed webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
        } catch (webhookError: any) {
          logger.error(`Failed to trigger call.completed webhook: ${webhookError.message}`, undefined, 'TwilioOpenAI');
        }
      }

      // Trigger inbound_call.completed or inbound_call.missed for inbound calls
      if (callRecord.userId && callRecord.callDirection === 'inbound') {
        try {
          const inboundPayload = {
            callId: callRecord.id,
            callSid: CallSid,
            direction: 'inbound',
            status: CallStatus,
            fromNumber: callRecord.fromNumber,
            toNumber: callRecord.toNumber,
            agentId: callRecord.agentId,
            phoneNumberId: callRecord.twilioPhoneNumberId,
            duration: duration,
          };

          if (CallStatus === 'completed') {
            await webhookDeliveryService.triggerEvent(callRecord.userId, 'inbound_call.completed', inboundPayload);
            logger.info(`Triggered inbound_call.completed webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
          } else if (CallStatus === 'no-answer' || CallStatus === 'canceled') {
            await webhookDeliveryService.triggerEvent(callRecord.userId, 'inbound_call.missed', inboundPayload);
            logger.info(`Triggered inbound_call.missed webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
          }
        } catch (webhookError: any) {
          logger.error(`Failed to trigger inbound call webhook: ${webhookError.message}`, undefined, 'TwilioOpenAI');
        }
      }

      // Trigger flow.completed or flow.failed for flow-based agents
      if (callRecord.userId && callRecord.agentId) {
        try {
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, callRecord.agentId))
            .limit(1);

          if (agent && agent.type === 'flow' && agent.flowId) {
            const [flow] = await db
              .select()
              .from(flows)
              .where(eq(flows.id, agent.flowId))
              .limit(1);

            const flowPayload = {
              flowId: agent.flowId,
              flowName: flow?.name || 'Unknown Flow',
              callId: callRecord.id,
              callSid: CallSid,
              agentId: agent.id,
              userId: callRecord.userId,
              duration: duration,
            };

            if (CallStatus === 'completed') {
              await webhookDeliveryService.triggerEvent(callRecord.userId, 'flow.completed', {
                ...flowPayload,
                nodesExecuted: flow?.nodes ? (flow.nodes as any[]).length : 0,
              });
              logger.info(`Triggered flow.completed webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
            } else if (CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
              await webhookDeliveryService.triggerEvent(callRecord.userId, 'flow.failed', {
                ...flowPayload,
                error: {
                  code: 'CALL_ENDED',
                  message: `Call ended with status: ${CallStatus}`,
                },
              });
              logger.info(`Triggered flow.failed webhook for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
            }
          }
        } catch (flowWebhookError: any) {
          logger.error(`Failed to trigger flow webhook: ${flowWebhookError.message}`, undefined, 'TwilioOpenAI');
        }
      }

    }

    await db
      .update(twilioOpenaiCalls)
      .set(updates)
      .where(eq(twilioOpenaiCalls.id, callRecord.id));

    // CRM Lead Creation for outbound calls (campaigns) - inbound calls are handled in stream handler
    // Only process completed outbound calls to avoid duplicate processing
    // NOTE: Must run AFTER the DB update above so CRM processor sees status='completed'
    if (callRecord.userId && CallStatus === 'completed' && callRecord.callDirection === 'outbound') {
      try {
        const { CRMLeadProcessor } = await import('../../crm/lead-processor.service');
        const result = await CRMLeadProcessor.processTwilioOpenAICall(callRecord.id);
        if (result?.leadId) {
          logger.info(`CRM lead created from outbound call: ${result.leadId} (${result.qualification.category})`, undefined, 'TwilioOpenAI');
        } else if (result) {
          logger.info(`Outbound call ${callRecord.id} did not qualify for CRM lead`, undefined, 'TwilioOpenAI');
        }
      } catch (crmError: any) {
        logger.error(`Failed to create CRM lead from outbound call: ${crmError.message}`, crmError, 'TwilioOpenAI');
      }
    }

    if (CallStatus === 'completed' && callRecord.userId && callRecord.agentId) {
      try {
        const callerPhone = callRecord.callDirection === 'inbound'
          ? (callRecord.fromNumber || params.From || '')
          : (callRecord.toNumber || params.To || '');
        const { triggerPostCallMessaging } = await import('../../../services/post-call-messaging');
        triggerPostCallMessaging({
          elevenLabsAgentId: callRecord.agentId,
          userId: callRecord.userId,
          callerPhone,
          callId: callRecord.id,
        }).catch(err => logger.error(`Post-call messaging error: ${err.message}`, err, 'TwilioOpenAI'));
        logger.info(`Triggered post-call messaging for call ${callRecord.id}`, undefined, 'TwilioOpenAI');
      } catch (msgErr: any) {
        logger.error(`Post-call messaging setup error: ${msgErr.message}`, msgErr, 'TwilioOpenAI');
      }
    }

    res.sendStatus(200);

  } catch (error: any) {
    logger.error('Error handling status', error, 'TwilioOpenAI');
    res.sendStatus(200);
  }
});

/**
 * Recording status callback - called when recording completes
 */
router.post('/voice/recording', async (req: Request, res: Response) => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration, RecordingStatus } = req.body;

  logger.info(`Recording status: ${RecordingSid} for call ${CallSid} -> ${RecordingStatus}`, undefined, 'TwilioOpenAI');

  try {
    if (RecordingStatus !== 'completed') {
      res.sendStatus(200);
      return;
    }

    const [callRecord] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(eq(twilioOpenaiCalls.twilioCallSid, CallSid))
      .limit(1);

    if (!callRecord) {
      logger.info(`Call record not found for recording: ${CallSid}`, undefined, 'TwilioOpenAI');
      res.sendStatus(200);
      return;
    }

    // Save recording URL (append .mp3 for direct audio access)
    const recordingUrlWithFormat = RecordingUrl ? `${RecordingUrl}.mp3` : null;
    
    await db
      .update(twilioOpenaiCalls)
      .set({
        recordingUrl: recordingUrlWithFormat,
        recordingDuration: RecordingDuration ? parseInt(RecordingDuration, 10) : null,
      })
      .where(eq(twilioOpenaiCalls.id, callRecord.id));

    logger.info(`Recording saved for call ${callRecord.id}: ${recordingUrlWithFormat}`, undefined, 'TwilioOpenAI');

    res.sendStatus(200);

  } catch (error: any) {
    logger.error('Error handling recording status', error, 'TwilioOpenAI');
    res.sendStatus(200);
  }
});

export default router;
