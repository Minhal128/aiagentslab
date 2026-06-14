'use strict';
/**
 * ============================================================
 * Plivo Webhook Routes
 * 
 * Handles incoming webhooks from Plivo:
 * - Answer URL: Returns XML with Stream instruction
 * - Status callback: Call status updates
 * - Recording callback: Recording ready notification
 * - KYC callback: Document verification status
 * ============================================================
 */

import type { Express, Request, Response } from 'express';
import { getWebhookUrl, getStreamUrl, generateTransferXML, generateHangupXML } from '../config/plivo-config';
import { PlivoCallService } from '../services/plivo-call.service';
import { CallSummarizationService } from '../services/call-summarization.service';
import { AudioBridgeService } from '../services/audio-bridge.service';
import { db } from '../../../db';
import { plivoCalls, plivoPhoneNumbers, agents, users, flowExecutions, calls } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { OpenAIPoolService } from '../services/openai-pool.service';
import type { PlivoCallStatus } from '../types';
import { logger } from '../../../utils/logger';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { scheduleContactRetry } from '../../../routes/webhooks/helpers';

export function setupPlivoWebhooks(app: Express, baseUrl: string): void {
  /**
   * Answer URL - Called when a call is initiated or received
   * Returns XML to connect the call to the audio stream
   * 
   * For outbound calls: callId is in the URL path
   * For inbound calls: lookup by phone number
   */
  app.post('/api/plivo/voice/answer', async (req: Request, res: Response) => {
    try {
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Answer: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoWebhook');

      const streamUrl = getStreamUrl(baseUrl, CallUUID);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  /**
   * Answer URL with call ID path - for outbound calls
   */
  app.post('/api/plivo/voice/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Answer for call ${callId}: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoWebhook');

      // Update the call record with Plivo UUID
      if (callId && CallUUID) {
        await db
          .update(plivoCalls)
          .set({ plivoCallUuid: CallUUID })
          .where(eq(plivoCalls.id, callId));
      }

      const streamUrl = getStreamUrl(baseUrl, CallUUID);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  /**
   * Status callback - Called when call status changes
   */
  app.post('/api/plivo/voice/status', async (req: Request, res: Response) => {
    try {
      const { CallUUID, CallStatus, Duration, HangupCause, From, To } = req.body;
      
      logger.info(`Status: ${CallUUID} -> ${CallStatus} (duration: ${Duration}s, cause: ${HangupCause})`, undefined, 'PlivoWebhook');

      // Find call by Plivo UUID
      const call = await PlivoCallService.getCallByUuid(CallUUID);
      
      if (call) {
        // Map Plivo status to our status enum
        const statusMap: Record<string, PlivoCallStatus> = {
          'ringing': 'ringing',
          'answered': 'in-progress',
          'in-progress': 'in-progress',
          'completed': 'completed',
          'busy': 'busy',
          'failed': 'failed',
          'no-answer': 'no-answer',
          'canceled': 'canceled',
        };

        const normalizedStatus = statusMap[CallStatus.toLowerCase()] || CallStatus.toLowerCase();
        
        await PlivoCallService.handleCallStatus(call.id, normalizedStatus as PlivoCallStatus, {
          hangupCause: HangupCause,
          rawDuration: Duration,
          from: From,
          to: To,
        });

        if (normalizedStatus === 'completed') {
          CallSummarizationService.summarizeCall(call.id).catch(err => {
            logger.error(`Summarization error for ${call.id}: ${err.message}`, err, 'PlivoWebhook');
          });
        }
        
        // Update flow execution status for terminal call states
        if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(normalizedStatus)) {
          try {
            const [flowExec] = await db
              .select()
              .from(flowExecutions)
              .where(eq(flowExecutions.callId, call.id))
              .limit(1);
            
            if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
              const execStatus = normalizedStatus === 'completed' ? 'completed' : 'failed';
              await db
                .update(flowExecutions)
                .set({
                  status: execStatus,
                  completedAt: new Date(),
                  error: normalizedStatus !== 'completed' ? `Call ended with status: ${normalizedStatus}` : null,
                })
                .where(eq(flowExecutions.id, flowExec.id));
              logger.info(`Updated flow execution ${flowExec.id} to ${execStatus}`, undefined, 'PlivoWebhook');
            }
          } catch (flowExecError: any) {
            logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'PlivoWebhook');
          }

          // Track attempt and schedule retry via shared helper
          if (call.contactId && call.campaignId) {
            scheduleContactRetry(call.contactId, call.campaignId, normalizedStatus).catch((err: any) => {
              logger.warn(`Failed to schedule contact retry: ${err.message}`, undefined, 'PlivoWebhook');
            });
          }
        }

      } else {
        logger.warn(`Call not found for UUID: ${CallUUID}`, undefined, 'PlivoWebhook');
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Status error', error, 'PlivoWebhook');
      res.sendStatus(200); // Always return 200 to prevent retries
    }
  });

  /**
   * Status callback with call ID path
   */
  app.post('/api/plivo/status/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, CallStatus, Duration, HangupCause, From, To } = req.body;
      
      logger.info(`Status for ${callId}: ${CallStatus} (duration: ${Duration}s, cause: ${HangupCause})`, undefined, 'PlivoWebhook');

      // Map Plivo status to our status enum
      const statusMap: Record<string, PlivoCallStatus> = {
        'ringing': 'ringing',
        'answered': 'in-progress',
        'in-progress': 'in-progress',
        'completed': 'completed',
        'busy': 'busy',
        'failed': 'failed',
        'no-answer': 'no-answer',
        'canceled': 'canceled',
      };

      const normalizedStatus = statusMap[CallStatus?.toLowerCase()] || CallStatus?.toLowerCase() || 'failed';
      
      await PlivoCallService.handleCallStatus(callId, normalizedStatus as PlivoCallStatus, {
        hangupCause: HangupCause,
        rawDuration: Duration,
        from: From,
        to: To,
        plivoCallUuid: CallUUID,
      });

      if (normalizedStatus === 'completed') {
        CallSummarizationService.summarizeCall(callId).catch(err => {
          logger.error(`Summarization error for ${callId}: ${err.message}`, err, 'PlivoWebhook');
        });
      }
      
      // Update flow execution status for terminal call states
      if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(normalizedStatus)) {
        try {
          const [flowExec] = await db
            .select()
            .from(flowExecutions)
            .where(eq(flowExecutions.callId, callId))
            .limit(1);
          
          if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
            const execStatus = normalizedStatus === 'completed' ? 'completed' : 'failed';
            await db
              .update(flowExecutions)
              .set({
                status: execStatus,
                completedAt: new Date(),
                error: normalizedStatus !== 'completed' ? `Call ended with status: ${normalizedStatus}` : null,
              })
              .where(eq(flowExecutions.id, flowExec.id));
            logger.info(`Updated flow execution ${flowExec.id} to ${execStatus}`, undefined, 'PlivoWebhook');
          }
        } catch (flowExecError: any) {
          logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'PlivoWebhook');
        }

        // Track attempt and schedule retry via shared helper
        try {
          const [plivoCall] = await db
            .select({ contactId: plivoCalls.contactId, campaignId: plivoCalls.campaignId })
            .from(plivoCalls)
            .where(eq(plivoCalls.id, callId))
            .limit(1);
          if (plivoCall?.contactId && plivoCall?.campaignId) {
            scheduleContactRetry(plivoCall.contactId, plivoCall.campaignId, normalizedStatus).catch((err: any) => {
              logger.warn(`Failed to schedule contact retry: ${err.message}`, undefined, 'PlivoWebhook');
            });
          }
        } catch (retryErr: any) {
          logger.warn(`Failed to lookup plivo call for retry: ${retryErr.message}`, undefined, 'PlivoWebhook');
        }
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Status error', error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Recording callback - Called when recording is ready
   */
  app.post('/api/plivo/voice/recording', async (req: Request, res: Response) => {
    try {
      const { CallUUID, RecordUrl, RecordingDuration } = req.body;
      
      logger.info(`Recording: ${CallUUID} -> ${RecordUrl} (${RecordingDuration}s)`, undefined, 'PlivoWebhook');

      // Find call by Plivo UUID
      const call = await PlivoCallService.getCallByUuid(CallUUID);
      
      if (call) {
        await PlivoCallService.handleRecordingReady(
          call.id,
          RecordUrl,
          parseInt(RecordingDuration) || 0
        );
      } else {
        logger.warn(`Call not found for recording UUID: ${CallUUID}`, undefined, 'PlivoWebhook');
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Recording error', error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Recording callback with call ID path
   */
  app.post('/api/plivo/recording/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, RecordUrl, RecordingDuration } = req.body;
      
      logger.info(`Recording for ${callId}: ${RecordUrl} (${RecordingDuration}s)`, undefined, 'PlivoWebhook');

      await PlivoCallService.handleRecordingReady(
        callId,
        RecordUrl,
        parseInt(RecordingDuration) || 0
      );

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Recording error', error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Recording callback endpoint (new pattern)
   * Called by PlivoRecordingService when recording is ready
   * Plivo sends application/x-www-form-urlencoded with a 'response' field containing JSON string
   */
  app.post('/api/plivo/recording/callback/:callRecordId', async (req: Request, res: Response) => {
    try {
      const { callRecordId } = req.params;
      
      // Log raw request for debugging
      logger.info(`[Recording] ===== CALLBACK RECEIVED =====`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Content-Type: ${req.headers['content-type']}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Raw Body: ${JSON.stringify(req.body)}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Call Record ID: ${callRecordId}`, undefined, 'PlivoWebhook');
      
      // Plivo sends data wrapped in a 'response' field as a JSON string
      // e.g., {"response": "{\"record_url\":\"...\",\"recording_id\":\"...\"}"}
      let data = req.body;
      
      // Check if data is wrapped in 'response' field as JSON string
      if (req.body.response && typeof req.body.response === 'string') {
        try {
          data = JSON.parse(req.body.response);
          logger.info(`[Recording] Parsed response JSON successfully`, undefined, 'PlivoWebhook');
        } catch (parseError) {
          logger.warn(`[Recording] Failed to parse response JSON: ${parseError}`, undefined, 'PlivoWebhook');
        }
      }
      
      // Plivo uses snake_case in the parsed response
      const {
        CallUUID,
        RecordUrl,
        RecordingID,
        RecordingDuration,
        RecordingDurationMs,
        // snake_case variants (actual Plivo format)
        call_uuid,
        record_url,
        recording_id,
        recording_url,
        recording_duration,
        recording_duration_ms
      } = data;
      
      // Resolve field values with fallbacks
      const callUuid = call_uuid || CallUUID;
      const recordingUrl = record_url || recording_url || RecordUrl;
      const recordingIdValue = recording_id || RecordingID;
      const durationSec = parseInt(recording_duration) || parseInt(RecordingDuration) || 
                          Math.round((parseInt(recording_duration_ms) || parseInt(RecordingDurationMs) || 0) / 1000);
      
      logger.info(`[Recording] Plivo Call UUID: ${callUuid}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Recording URL: ${recordingUrl}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Recording ID: ${recordingIdValue}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Duration: ${durationSec}s`, undefined, 'PlivoWebhook');

      if (recordingUrl) {
        await PlivoCallService.handleRecordingReady(
          callRecordId,
          recordingUrl,
          durationSec
        );
        logger.info(`[Recording] ✓ Recording saved for ${callRecordId}`, undefined, 'PlivoWebhook');
      } else {
        logger.warn(`[Recording] No recording URL in callback for ${callRecordId}`, undefined, 'PlivoWebhook');
        logger.warn(`[Recording] Available fields: ${Object.keys(data).join(', ')}`, undefined, 'PlivoWebhook');
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error(`[Recording] Callback error: ${error.message}`, error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Transfer webhook - Returns XML to dial the transfer target
   * Called when a call is redirected for transfer
   * Supports both GET and POST methods for Plivo compatibility
   */
  const handleTransferWebhook = async (req: Request, res: Response) => {
    try {
      const { target, callerId } = req.query;
      const CallUUID = req.body?.CallUUID || req.query?.CallUUID || 'unknown';
      
      logger.info(`[Transfer XML] ===== PLIVO REQUESTED TRANSFER XML =====`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Call UUID: ${CallUUID}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Target: ${target}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Caller ID: ${callerId}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Method: ${req.method}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Query params: ${JSON.stringify(req.query)}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Body: ${JSON.stringify(req.body)}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Headers: ${JSON.stringify(req.headers)}`, undefined, 'PlivoWebhook');

      if (!target || typeof target !== 'string') {
        logger.error('[Transfer XML] Target missing!', undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(generateHangupXML('Sorry, transfer could not be completed.'));
        return;
      }

      const callerIdStr = (callerId as string) || '';
      const xml = generateTransferXML(target, callerIdStr);
      
      logger.info(`[Transfer XML] Returning XML:`, undefined, 'PlivoWebhook');
      logger.info(xml, undefined, 'PlivoWebhook');
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('[Transfer XML] Error generating XML', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(generateHangupXML('Sorry, an error occurred during transfer.'));
    }
  };
  
  // Support both GET and POST for transfer webhook
  app.get('/api/plivo/voice/transfer', handleTransferWebhook);
  app.post('/api/plivo/voice/transfer', handleTransferWebhook);

  /**
   * Hangup webhook - Returns XML to end the call gracefully
   */
  app.post('/api/plivo/voice/hangup', async (req: Request, res: Response) => {
    try {
      const { message } = req.query;
      const { CallUUID } = req.body;
      
      logger.info(`Hangup request for ${CallUUID}`, undefined, 'PlivoWebhook');

      const messageStr = typeof message === 'string' ? message : 'Thank you for calling. Goodbye!';
      const xml = generateHangupXML(messageStr);
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Hangup error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  /**
   * Health check for incoming endpoint - allows testing if URL is reachable
   */
  app.get('/api/plivo/incoming', async (req: Request, res: Response) => {
    logger.info('Incoming endpoint health check (GET)', undefined, 'PlivoWebhook');
    res.json({ status: 'ok', endpoint: '/api/plivo/incoming', method: 'GET', message: 'Plivo incoming webhook endpoint is accessible' });
  });

  /**
   * Incoming call handler - Routes inbound calls to appropriate agents
   */
  app.post('/api/plivo/incoming', async (req: Request, res: Response) => {
    try {
      // Log raw request for debugging
      console.log('📞 [Plivo Incoming] Raw request received:', {
        body: req.body,
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'],
        },
      });
      
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Incoming call: ${CallUUID} from ${From} to ${To}`, undefined, 'PlivoWebhook');

      // Normalize phone numbers - trim whitespace and remove + prefix
      const normalizedTo = (To || '').toString().trim().replace(/^\+/, '');
      const normalizedFrom = (From || '').toString().trim().replace(/^\+/, '');
      
      logger.info(`Normalized To: ${normalizedTo}`, undefined, 'PlivoWebhook');

      // Find the phone number and associated agent
      const [phoneNumber] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(eq(plivoPhoneNumbers.phoneNumber, normalizedTo))
        .limit(1);

      // Trigger inbound_call.received early if we have a phone record
      if (phoneNumber?.userId) {
        try {
          await webhookDeliveryService.triggerEvent(phoneNumber.userId, 'inbound_call.received', {
            callId: null,
            callSid: CallUUID,
            direction: 'inbound',
            status: 'received',
            fromNumber: normalizedFrom,
            toNumber: normalizedTo,
            agentId: phoneNumber.assignedAgentId || null,
            phoneNumberId: phoneNumber.id,
          });
          logger.info(`Triggered inbound_call.received webhook for incoming call ${CallUUID}`, undefined, 'PlivoWebhook');
        } catch (webhookError: any) {
          logger.error(`Failed to trigger inbound_call.received webhook: ${webhookError.message}`, undefined, 'PlivoWebhook');
        }
      }

      if (!phoneNumber) {
        logger.error(`Phone number not found: ${normalizedTo} (raw: ${To})`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, this number is not configured. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Check if there's an assigned agent
      if (!phoneNumber.assignedAgentId) {
        logger.error(`No agent assigned to phone: ${To}`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, this line is not currently available. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Get agent configuration
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, phoneNumber.assignedAgentId))
        .limit(1);

      if (!agent) {
        logger.error(`Agent not found: ${phoneNumber.assignedAgentId}`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, the agent is not available. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Get user for credit check
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, agent.userId))
        .limit(1);

      if (!user || user.credits < 1) {
        logger.error('User has insufficient credits', undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, the service is temporarily unavailable. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Reserve an OpenAI slot
      const tier = OpenAIPoolService.getModelTierForUser(user.planType);
      const openaiCredential = await OpenAIPoolService.reserveSlot(tier);

      if (!openaiCredential) {
        logger.error('No OpenAI capacity available', undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>We are experiencing high demand. Please try again later.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Create incoming call record
      let callRecord: any = null;
      try {
        callRecord = await PlivoCallService.createIncomingCall({
          fromNumber: normalizedFrom,
          toNumber: normalizedTo,
          plivoCallUuid: CallUUID,
          agentId: agent.id,
          plivoPhoneNumberId: phoneNumber.id,
          userId: agent.userId,
          openaiCredentialId: openaiCredential.id,
          plivoCredentialId: phoneNumber.plivoCredentialId || undefined,
        });
      } catch (createError: any) {
        // Release the slot if call record creation fails
        await OpenAIPoolService.releaseSlot(openaiCredential.id);
        throw createError;
      }

      // Trigger inbound_call.answered webhook - call has been answered by AI agent
      try {
        await webhookDeliveryService.triggerEvent(agent.userId, 'inbound_call.answered', {
          callId: callRecord?.id || null,
          callSid: CallUUID,
          direction: 'inbound',
          status: 'in-progress',
          fromNumber: normalizedFrom,
          toNumber: normalizedTo,
          agentId: agent.id,
          phoneNumberId: phoneNumber.id,
        });
        logger.info(`Triggered inbound_call.answered webhook for call ${CallUUID}`, undefined, 'PlivoWebhook');
      } catch (webhookError: any) {
        logger.error(`Failed to trigger inbound_call.answered webhook: ${webhookError.message}`, undefined, 'PlivoWebhook');
      }

      // Return stream XML
      const streamUrl = getStreamUrl(baseUrl, CallUUID);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Incoming call error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, an error occurred. Goodbye.</Speak>
  <Hangup/>
</Response>`);
    }
  });

  /**
   * Transfer XML endpoint - Called by Plivo Transfer API
   * Returns Dial XML to connect the call to the transfer target
   */
  app.get('/api/plivo/voice/transfer', (req: Request, res: Response) => {
    const { target, callerId } = req.query;
    
    logger.info(`[TransferXML] ===== TRANSFER XML ENDPOINT CALLED =====`, undefined, 'PlivoWebhook');
    logger.info(`[TransferXML] Target: ${target}`, undefined, 'PlivoWebhook');
    logger.info(`[TransferXML] Caller ID: ${callerId}`, undefined, 'PlivoWebhook');
    
    if (!target) {
      logger.error(`[TransferXML] No target number provided!`, undefined, 'PlivoWebhook');
      res.set('Content-Type', 'application/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
    
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId || ''}" timeout="30" timeLimit="3600">
    <Number>${target}</Number>
  </Dial>
</Response>`;
    
    logger.info(`[TransferXML] Returning Dial XML:`, undefined, 'PlivoWebhook');
    logger.info(xml, undefined, 'PlivoWebhook');
    logger.info(`[TransferXML] ===== TRANSFER XML SENT =====`, undefined, 'PlivoWebhook');
    
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  });

  /**
   * Post-stream webhook - Fallback handler (kept for compatibility)
   * With the new Transfer API + Stop Stream approach, this is rarely needed
   */
  app.post('/api/plivo/voice/post-stream', (req: Request, res: Response) => {
    const callUuid = req.query.callUuid as string;
    const { CallUUID, StreamAction } = req.body;
    
    logger.info(`[PostStream] ===== POST-STREAM CALLBACK RECEIVED =====`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] Query callUuid: ${callUuid}`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] Body CallUUID: ${CallUUID}`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] StreamAction: ${StreamAction}`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] Full body: ${JSON.stringify(req.body)}`, undefined, 'PlivoWebhook');
    
    // Use query param callUuid or body CallUUID
    const effectiveCallUuid = callUuid || CallUUID;
    
    if (!effectiveCallUuid) {
      logger.error(`[PostStream] No call UUID provided!`, undefined, 'PlivoWebhook');
      res.set('Content-Type', 'application/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
    
    const pendingTransfer = AudioBridgeService.getPendingTransfer(effectiveCallUuid);
    
    if (pendingTransfer) {
      logger.info(`[PostStream] ===== PENDING TRANSFER FOUND =====`, undefined, 'PlivoWebhook');
      logger.info(`[PostStream] Target: ${pendingTransfer.targetNumber}`, undefined, 'PlivoWebhook');
      logger.info(`[PostStream] Caller ID: ${pendingTransfer.callerId}`, undefined, 'PlivoWebhook');
      
      // Clear the pending transfer before responding
      AudioBridgeService.clearPendingTransfer(effectiveCallUuid);
      
      // Return Dial XML to transfer the call
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${pendingTransfer.callerId}">
    <Number>${pendingTransfer.targetNumber}</Number>
  </Dial>
</Response>`;
      
      logger.info(`[PostStream] Returning Dial XML:`, undefined, 'PlivoWebhook');
      logger.info(xml, undefined, 'PlivoWebhook');
      logger.info(`[PostStream] ===== TRANSFER XML SENT =====`, undefined, 'PlivoWebhook');
      
      res.set('Content-Type', 'application/xml');
      return res.send(xml);
    }
    
    logger.info(`[PostStream] No pending transfer found, returning Hangup`, undefined, 'PlivoWebhook');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
    
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  });

  logger.info('Plivo webhook routes registered', undefined, 'PlivoWebhook');
}
