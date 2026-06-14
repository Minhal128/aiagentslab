'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs SIP Trunk - Webhook Routes
 * 
 * Handles Plivo SIP trunk webhooks for ElevenLabs integration.
 * ISOLATED from Twilio+ElevenLabs and Plivo+OpenAI systems.
 * ============================================================
 */

import type { Express, Request, Response } from 'express';
import { getSipStreamUrl } from '../config/config';
import { ElevenLabsBridgeService } from '../services/elevenlabs-bridge.service';
import { db } from '../../../db';
import { agents, plivoPhoneNumbers, sipPhoneNumbers, users, flowExecutions, plivoCalls, type InsertPlivoCall } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { deductCallCredits } from '../../../services/credit-service';
import { logger } from '../../../utils/logger';
import { ElevenLabsPoolService } from '../../../services/elevenlabs-pool';

export function setupPlivoElevenLabsWebhooks(app: Express, baseUrl: string): void {
  
  /**
   * Answer URL for SIP trunk calls
   * Returns XML with Stream instruction to connect to our WebSocket
   */
  app.post('/api/plivo-elevenlabs/voice/answer', async (req: Request, res: Response) => {
    try {
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Answer: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoElevenLabs');
      
      const streamUrl = getSipStreamUrl(CallUUID);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });
  
  /**
   * Answer URL with call ID path (for outbound calls)
   */
  app.post('/api/plivo-elevenlabs/voice/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, From, To, Direction } = req.body;

      logger.info(`Answer for ${callId}: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoElevenLabs');

      // Record Plivo's real CallUUID on the outbound row so the status webhook
      // can find it by `plivo_call_uuid`. The row was inserted at dial time
      // with `metadata.internalId = callId` (the synthetic id from the URL).
      if (CallUUID && callId) {
        try {
          await db
            .update(plivoCalls)
            .set({
              plivoCallUuid: CallUUID,
              status: 'in-progress',
              answeredAt: new Date(),
            })
            .where(sql`${plivoCalls.metadata}->>'internalId' = ${callId} AND ${plivoCalls.metadata}->>'engine' = 'plivo-elevenlabs'`);
        } catch (updErr: any) {
          logger.warn(
            `Failed to attach CallUUID ${CallUUID} to outbound call ${callId}: ${updErr?.message || updErr}`,
            undefined,
            'PlivoElevenLabs'
          );
        }
      }

      const streamUrl = getSipStreamUrl(CallUUID);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });
  
  /**
   * Status callback
   */
  app.post('/api/plivo-elevenlabs/voice/status', async (req: Request, res: Response) => {
    try {
      const { CallUUID, CallStatus, Duration, HangupCause } = req.body;
      
      logger.info(`Status: ${CallUUID} -> ${CallStatus} (duration: ${Duration}s, cause: ${HangupCause})`, undefined, 'PlivoElevenLabs');
      
      if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
        const result = await ElevenLabsBridgeService.endSession(CallUUID);
        logger.info(`Session ended: duration=${result.duration}s, transcript parts=${result.transcript.length}`, undefined, 'PlivoElevenLabs');

        // Plivo's reported Duration is authoritative (answered duration only).
        // Fall back to bridge-measured duration if Plivo did not include one.
        const reportedDuration = Duration ? parseInt(String(Duration), 10) : 0;
        const bridgeDuration = result?.duration ? Math.ceil(Number(result.duration)) : 0;
        const durationSeconds = reportedDuration > 0 ? reportedDuration : bridgeDuration;

        // Update flow execution status - find the call by Plivo UUID first
        try {
          const [call] = await db
            .select()
            .from(plivoCalls)
            .where(eq(plivoCalls.plivoCallUuid, CallUUID))
            .limit(1);

          // Update the call record itself (status, duration, endedAt) so the
          // call history reflects the final state. Only update rows that
          // belong to this engine — defensive guard against any future
          // collision with the Plivo+OpenAI engine on the same uuid.
          if (call) {
            const isThisEngine =
              ((call.metadata as Record<string, unknown> | null)?.engine === 'plivo-elevenlabs');
            if (isThisEngine) {
              await db
                .update(plivoCalls)
                .set({
                  status: CallStatus,
                  duration: durationSeconds > 0 ? durationSeconds : (call.duration ?? 0),
                  endedAt: new Date(),
                })
                .where(eq(plivoCalls.id, call.id));
            }
          }

          if (call) {
            const [flowExec] = await db
              .select()
              .from(flowExecutions)
              .where(eq(flowExecutions.callId, call.id))
              .limit(1);
            
            if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
              const execStatus = CallStatus === 'completed' ? 'completed' : 'failed';
              await db
                .update(flowExecutions)
                .set({
                  status: execStatus,
                  completedAt: new Date(),
                  error: CallStatus !== 'completed' ? `Call ended with status: ${CallStatus}` : null,
                })
                .where(eq(flowExecutions.id, flowExec.id));
              logger.info(`Updated flow execution ${flowExec.id} to ${execStatus}`, undefined, 'PlivoElevenLabs');
            }

            // Bill the user for the call. Only on terminal 'completed' status,
            // only for rows owned by this engine, and only when there is a
            // user and a positive duration. `deductCallCredits` is idempotent
            // (advisory lock + uniqueness on
            // `credit_transactions.reference = 'plivo-elevenlabs:<callId>'`)
            // so retries from Plivo will not double-charge.
            if (
              CallStatus === 'completed' &&
              call.userId &&
              durationSeconds >= 1 &&
              ((call.metadata as Record<string, unknown> | null)?.engine === 'plivo-elevenlabs')
            ) {
              const creditsToDeduct = Math.ceil(durationSeconds / 60);
              if (creditsToDeduct > 0) {
                try {
                  const creditResult = await deductCallCredits({
                    userId: call.userId,
                    creditsToDeduct,
                    callId: call.id,
                    fromNumber: call.fromNumber || 'Unknown',
                    toNumber: call.toNumber || 'Unknown',
                    durationSeconds,
                    engine: 'plivo-elevenlabs',
                  });

                  if (!creditResult.success && !creditResult.alreadyDeducted) {
                    logger.error(
                      `Credit deduction failed for plivo-elevenlabs call ${call.id}: ${creditResult.error || 'Unknown error'}`,
                      undefined,
                      'PlivoElevenLabs'
                    );
                    // Mark call as credit_failed (mirrors Twilio+OpenAI
                    // semantics) so admin tooling and Task #165's UI can
                    // surface the billing failure.
                    await db
                      .update(plivoCalls)
                      .set({
                        status: 'credit_failed',
                        metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
                          creditDeductionFailed: true,
                          creditError: creditResult.error || 'Insufficient credits',
                          creditsRequired: creditsToDeduct,
                          engine: 'plivo-elevenlabs',
                        })}::jsonb`,
                      })
                      .where(eq(plivoCalls.id, call.id));
                  } else if (creditResult.success && creditResult.creditsDeducted > 0) {
                    logger.info(
                      `Deducted ${creditResult.creditsDeducted} credits for plivo-elevenlabs call ${call.id} (new balance: ${creditResult.newBalance})`,
                      undefined,
                      'PlivoElevenLabs'
                    );
                  }
                } catch (creditErr: any) {
                  logger.error(
                    `Credit deduction exception for plivo-elevenlabs call ${call.id}: ${creditErr?.message || creditErr}`,
                    creditErr,
                    'PlivoElevenLabs'
                  );
                }
              }
            }

            // Post-call messaging trigger for Plivo-ElevenLabs engine
            if (CallStatus === 'completed' && call.userId && call.agentId) {
              try {
                const [agentRecord] = await db
                  .select({ elevenLabsAgentId: agents.elevenLabsAgentId })
                  .from(agents)
                  .where(eq(agents.id, call.agentId))
                  .limit(1);
                const agentIdForMessaging = agentRecord?.elevenLabsAgentId || call.agentId;
                const callerPhone = call.callDirection === 'inbound'
                  ? (call.fromNumber || '')
                  : (call.toNumber || '');
                const { triggerPostCallMessaging } = await import('../../../services/post-call-messaging');
                triggerPostCallMessaging({
                  elevenLabsAgentId: agentIdForMessaging,
                  userId: call.userId,
                  callerPhone,
                  callId: call.id,
                }).catch(err => logger.error(`Post-call messaging error: ${err.message}`, err, 'PlivoElevenLabs'));
              } catch (msgErr: any) {
                logger.error(`Post-call messaging setup error: ${msgErr.message}`, msgErr, 'PlivoElevenLabs');
              }
            }
          }
        } catch (flowExecError: any) {
          logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'PlivoElevenLabs');
        }
      }
      
      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Status error', error, 'PlivoElevenLabs');
      res.sendStatus(200);
    }
  });
  
  /**
   * Incoming call handler for SIP trunk
   */
  app.post('/api/plivo-elevenlabs/incoming', async (req: Request, res: Response) => {
    try {
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Incoming SIP call: ${CallUUID} from ${From} to ${To}`, undefined, 'PlivoElevenLabs');
      
      let assignedAgentId: string | null = null;

      const [plivoPhone] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(eq(plivoPhoneNumbers.phoneNumber, To))
        .limit(1);
      
      if (plivoPhone?.assignedAgentId) {
        assignedAgentId = plivoPhone.assignedAgentId;
      } else {
        const [sipPhone] = await db
          .select()
          .from(sipPhoneNumbers)
          .where(eq(sipPhoneNumbers.phoneNumber, To))
          .limit(1);
        if (sipPhone?.agentId) {
          assignedAgentId = sipPhone.agentId;
        }
      }
      
      if (!assignedAgentId) {
        logger.error(`Phone not configured: ${To}`, undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, this number is not configured. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, assignedAgentId))
        .limit(1);
      
      if (!agent || !agent.elevenLabsAgentId) {
        logger.error(`Agent not found or no ElevenLabs ID: ${assignedAgentId}`, undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, the agent is not available. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, agent.userId))
        .limit(1);
      
      if (!user || Number(user.credits) < 1) {
        logger.error('Insufficient credits', undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Service temporarily unavailable. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      let elevenLabsApiKey: string | undefined;
      const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      if (credential?.apiKey) {
        elevenLabsApiKey = credential.apiKey;
      } else {
        elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
      }
      if (!elevenLabsApiKey) {
        logger.error('ElevenLabs API key not configured (no pool credential or env var)', undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Service configuration error. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      await ElevenLabsBridgeService.createSession({
        callUuid: CallUUID,
        agentId: agent.elevenLabsAgentId,
        elevenLabsApiKey,
        agentConfig: {
          agentId: agent.elevenLabsAgentId,
          firstMessage: agent.firstMessage || undefined,
          language: agent.language || 'en',
        },
        fromNumber: From,
        toNumber: To,
        direction: 'inbound',
      });

      // Record the inbound call so the status webhook can update its
      // duration/status and bill the user on completion.
      try {
        const insertValues: InsertPlivoCall = {
          userId: agent.userId,
          agentId: agent.id,
          plivoPhoneNumberId: plivoPhone?.id ?? null,
          plivoCallUuid: CallUUID,
          fromNumber: From,
          toNumber: To,
          status: 'in-progress',
          callDirection: 'inbound',
          startedAt: new Date(),
          answeredAt: new Date(),
          metadata: { engine: 'plivo-elevenlabs' },
        };
        await db.insert(plivoCalls).values(insertValues);
      } catch (dbErr: any) {
        logger.error(
          `Failed to insert inbound call record for ${CallUUID}: ${dbErr?.message || dbErr}`,
          dbErr,
          'PlivoElevenLabs'
        );
      }

      const streamUrl = getSipStreamUrl(CallUUID);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Incoming call error', error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>An error occurred. Goodbye.</Speak>
  <Hangup/>
</Response>`);
    }
  });
  
  logger.info('Plivo-ElevenLabs SIP trunk webhook routes registered', undefined, 'PlivoElevenLabs');
}
