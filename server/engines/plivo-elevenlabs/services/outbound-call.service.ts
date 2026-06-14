'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs Outbound Call Service
 * 
 * Handles outbound calls via Plivo SIP trunk to ElevenLabs.
 * Creates the ElevenLabs bridge session BEFORE initiating the Plivo call
 * to ensure audio streaming works correctly.
 * ============================================================
 */

import { ElevenLabsBridgeService, CreateBridgeSessionParams } from './elevenlabs-bridge.service';
import { getSipWebhookUrl } from '../config/config';
import { db } from '../../../db';
import { plivoCalls, type InsertPlivoCall } from '@shared/schema';

export interface OutboundCallParams {
  toNumber: string;
  fromNumber: string;
  agentId: string;
  elevenLabsApiKey: string;
  agentConfig?: {
    agentId: string;
    firstMessage?: string;
    language?: string;
    voiceId?: string;
    dynamicData?: Record<string, string>;
  };
  plivoAuthId: string;
  plivoAuthToken: string;
  // Tracking fields - required for billing & call records.
  // dbAgentId is the local agents.id (FK), distinct from agentId which may be
  // the ElevenLabs agent id passed to the bridge.
  userId?: string;
  dbAgentId?: string;
  campaignId?: string;
  contactId?: string;
  plivoPhoneNumberId?: string;
}

export interface OutboundCallResult {
  success: boolean;
  callUuid?: string;
  callRecordId?: string;
  error?: string;
}

export class PlivoElevenLabsOutboundService {
  
  /**
   * Initiate an outbound call
   * 
   * IMPORTANT: Creates ElevenLabs bridge session BEFORE calling Plivo
   * to ensure session exists when stream connects.
   */
  static async makeCall(params: OutboundCallParams): Promise<OutboundCallResult> {
    const {
      toNumber,
      fromNumber,
      agentId,
      elevenLabsApiKey,
      agentConfig,
      plivoAuthId,
      plivoAuthToken,
    } = params;
    
    const callUuid = `plivo-el-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log(`[Plivo-ElevenLabs Outbound] Initiating call ${callUuid} to ${toNumber}`);
    
    // Insert the call record FIRST (before dialing Plivo). This avoids a race
    // where Plivo's terminal status webhook arrives before our INSERT commits.
    // We store the synthetic `callUuid` in metadata.internalId; the real
    // Plivo-assigned CallUUID is written into the plivo_call_uuid column when
    // the /voice/:callId answer webhook fires, so /voice/status can find the
    // row by Plivo's CallUUID (the only identifier the status webhook has).
    let callRecordId: string | undefined;
    try {
      const insertValues: InsertPlivoCall = {
        userId: params.userId ?? null,
        campaignId: params.campaignId ?? null,
        contactId: params.contactId ?? null,
        agentId: params.dbAgentId ?? null,
        plivoPhoneNumberId: params.plivoPhoneNumberId ?? null,
        plivoCallUuid: null,
        fromNumber,
        toNumber,
        status: 'initiated',
        callDirection: 'outbound',
        startedAt: new Date(),
        metadata: { engine: 'plivo-elevenlabs', internalId: callUuid },
      };
      const [row] = await db.insert(plivoCalls).values(insertValues).returning({ id: plivoCalls.id });
      callRecordId = row?.id;
    } catch (dbErr: any) {
      console.error(`[Plivo-ElevenLabs Outbound] Failed to insert call record for ${callUuid}:`, dbErr?.message || dbErr);
    }

    try {
      const sessionParams: CreateBridgeSessionParams = {
        callUuid,
        agentId: agentConfig?.agentId || agentId,
        elevenLabsApiKey,
        agentConfig,
        fromNumber,
        toNumber,
        direction: 'outbound',
      };
      
      await ElevenLabsBridgeService.createSession(sessionParams);
      console.log(`[Plivo-ElevenLabs Outbound] Bridge session created for ${callUuid}`);
      
      const answerUrl = getSipWebhookUrl(`/voice/${callUuid}`);
      const statusUrl = getSipWebhookUrl('/voice/status');
      
      const plivoClient = await this.getPlivoClient(plivoAuthId, plivoAuthToken);
      
      const response = await plivoClient.calls.create(
        fromNumber,
        toNumber,
        answerUrl,
        {
          answerMethod: 'POST',
          hangupUrl: statusUrl,
          hangupMethod: 'POST',
          callbackUrl: statusUrl,
          callbackMethod: 'POST',
        }
      );

      console.log(`[Plivo-ElevenLabs Outbound] Plivo call initiated: ${response.requestUuid}`);

      return {
        success: true,
        callUuid,
        callRecordId,
      };
      
    } catch (error: any) {
      console.error(`[Plivo-ElevenLabs Outbound] Call failed:`, error.message);
      
      await ElevenLabsBridgeService.endSession(callUuid);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Get Plivo client instance
   */
  private static async getPlivoClient(authId: string, authToken: string): Promise<any> {
    const plivo = await import('plivo');
    return new plivo.Client(authId, authToken);
  }
}
