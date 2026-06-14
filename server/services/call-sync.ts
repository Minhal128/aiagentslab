'use strict';
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { db } from '../db';
import { calls, agents, campaigns, sipCalls } from '../../shared/schema';
import { eq, or, and, isNull, isNotNull } from 'drizzle-orm';
import { twilioService } from './twilio';
import { ElevenLabsService, elevenLabsService } from './elevenlabs';
import { ElevenLabsPoolService } from './elevenlabs-pool';

export interface SyncResult {
  callId: string;
  success: boolean;
  error?: string;
  skipped?: boolean; // True if sync was skipped due to missing external IDs
  updatedFields: string[];
}

export interface SyncSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number; // Calls skipped due to missing external IDs
  errors?: string[];
  results?: SyncResult[];
}

/**
 * Unified Call Sync Service
 * Fetches and combines call data from both ElevenLabs and Twilio sources
 * to provide the most complete call information possible
 */
export class CallSyncService {
  
  /**
   * Sync a single call from both sources (ElevenLabs + Twilio)
   * Combines data to get the best possible information
   */
  async syncCall(callId: string): Promise<SyncResult> {
    const updatedFields: string[] = [];
    let twilioFetchSuccess = false;
    let elevenLabsFetchSuccess = false;
    
    try {
      // Get the call record
      const [callRecord] = await db
        .select()
        .from(calls)
        .where(eq(calls.id, callId))
        .limit(1);
      
      if (!callRecord) {
        // Check if it's a SIP call (SipCall table)
        const [sipCallRecord] = await db
          .select()
          .from(sipCalls)
          .where(eq(sipCalls.id, callId))
          .limit(1);
          
        if (sipCallRecord) {
          console.log(`🔄 [Sync] Syncing SIP call ${callId}`);
          return this.syncSipCall(callId, sipCallRecord);
        }
        
        return { callId, success: false, error: 'Call not found', updatedFields };
      }

      // Skip if no external IDs to sync from (mark as skipped, not failed)
      if (!callRecord.twilioSid && !callRecord.elevenLabsConversationId) {
        return { callId, success: false, skipped: true, error: 'No external IDs available for sync', updatedFields };
      }

      console.log(`🔄 [Sync] Syncing call ${callId}`);
      console.log(`   Twilio SID: ${callRecord.twilioSid || 'N/A'}`);
      console.log(`   ElevenLabs Conv ID: ${callRecord.elevenLabsConversationId || 'N/A'}`);

      // Prepare update object
      const updates: Record<string, any> = {};
      
      // 1. Fetch from Twilio (for phone numbers, duration, recording)
      if (callRecord.twilioSid) {
        try {
          console.log(`   📞 Fetching from Twilio...`);
          const twilioData = await twilioService.getCallDetails(callRecord.twilioSid);
          
          if (twilioData) {
            twilioFetchSuccess = true;
            
            // Update phone number if missing
            if (!callRecord.phoneNumber && twilioData.to) {
              updates.phoneNumber = twilioData.to;
              updatedFields.push('phoneNumber');
            }
            
            // Update duration if missing or different
            if (!callRecord.duration && twilioData.duration) {
              updates.duration = twilioData.duration;
              updatedFields.push('duration');
            }
            
            // Update recording URL if missing
            if (!callRecord.recordingUrl && twilioData.recordingUrl) {
              updates.recordingUrl = twilioData.recordingUrl;
              updatedFields.push('recordingUrl');
            }
            
            // Update call direction based on Twilio data
            if (!callRecord.callDirection) {
              const direction = twilioData.direction === 'inbound' ? 'incoming' : 'outgoing';
              updates.callDirection = direction;
              updatedFields.push('callDirection');
            }
            
            // Store Twilio metadata
            const existingMetadata = callRecord.metadata as object || {};
            updates.metadata = {
              ...existingMetadata,
              twilioFrom: twilioData.from,
              twilioTo: twilioData.to,
              twilioStatus: twilioData.status,
              twilioDirection: twilioData.direction,
              twilioSyncedAt: new Date().toISOString(),
            };
            
            console.log(`   ✅ Twilio data: from=${twilioData.from}, to=${twilioData.to}, duration=${twilioData.duration}s`);
          }
        } catch (twilioError: any) {
          console.warn(`   ⚠️ Twilio fetch failed: ${twilioError.message}`);
        }
      }
      
      // 2. Fetch from ElevenLabs (for transcript, analysis, conversation data)
      if (callRecord.elevenLabsConversationId) {
        try {
          console.log(`   🤖 Fetching from ElevenLabs...`);
          
          // Get the correct ElevenLabs service for this call's agent
          let agentElevenLabsService: ElevenLabsService = elevenLabsService;
          
          // Try to find the agent and use their credential
          let agentId: string | null = null;
          if (callRecord.campaignId) {
            const [campaign] = await db
              .select()
              .from(campaigns)
              .where(eq(campaigns.id, callRecord.campaignId))
              .limit(1);
            agentId = campaign?.agentId || null;
          }
          
          if (agentId) {
            const [agent] = await db
              .select()
              .from(agents)
              .where(eq(agents.id, agentId))
              .limit(1);
            
            if (agent?.elevenLabsCredentialId) {
              const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
              if (credential) {
                agentElevenLabsService = new ElevenLabsService(credential.apiKey);
              }
            }
          }
          
          const elevenLabsData = await agentElevenLabsService.getConversationDetails(
            callRecord.elevenLabsConversationId
          );
          
          if (elevenLabsData) {
            elevenLabsFetchSuccess = true;
            
            // Update transcript if missing
            if (!callRecord.transcript && elevenLabsData.transcript?.length > 0) {
              const transcriptText = elevenLabsData.transcript.map(entry => 
                `${entry.role.toUpperCase()} (${entry.time_in_call_secs}s): ${entry.message}`
              ).join('\n');
              updates.transcript = transcriptText;
              updatedFields.push('transcript');
            }
            
            // Update AI summary if missing
            // ElevenLabs V3 API uses transcript_summary, with summary as fallback
            const elSummary = elevenLabsData.analysis?.transcript_summary || elevenLabsData.analysis?.summary;
            if (!callRecord.aiSummary && elSummary) {
              updates.aiSummary = elSummary;
              updatedFields.push('aiSummary');
            }
            
            // Update classification based on analysis
            if (!callRecord.classification && elevenLabsData.analysis) {
              const classification = elevenLabsData.analysis.call_successful 
                ? 'completed_successful' 
                : 'completed';
              updates.classification = classification;
              updatedFields.push('classification');
            }
            
            // Update duration from ElevenLabs if Twilio didn't have it
            if (!updates.duration && !callRecord.duration && elevenLabsData.call_duration_secs) {
              updates.duration = elevenLabsData.call_duration_secs;
              updatedFields.push('duration');
            }
            
            // Update phone numbers from ElevenLabs metadata if still missing
            if (!updates.phoneNumber && !callRecord.phoneNumber) {
              const fromNumber = elevenLabsData.metadata?.from_number;
              const toNumber = elevenLabsData.metadata?.to_number;
              if (callRecord.callDirection === 'incoming' && fromNumber) {
                updates.phoneNumber = fromNumber;
                updatedFields.push('phoneNumber');
              } else if (toNumber) {
                updates.phoneNumber = toNumber;
                updatedFields.push('phoneNumber');
              }
            }
            
            // Update recording URL from ElevenLabs if still missing
            if (!updates.recordingUrl && !callRecord.recordingUrl && elevenLabsData.recording_url) {
              updates.recordingUrl = elevenLabsData.recording_url;
              updatedFields.push('recordingUrl');
            }
            
            // Merge ElevenLabs metadata
            const existingMetadata = updates.metadata || callRecord.metadata as object || {};
            updates.metadata = {
              ...existingMetadata,
              elevenLabsStatus: elevenLabsData.status,
              elevenLabsAnalysis: elevenLabsData.analysis,
              elevenLabsFrom: elevenLabsData.metadata?.from_number,
              elevenLabsTo: elevenLabsData.metadata?.to_number,
              elevenLabsSyncedAt: new Date().toISOString(),
            };
            
            console.log(`   ✅ ElevenLabs data: status=${elevenLabsData.status}, transcript=${elevenLabsData.transcript?.length || 0} entries`);
          }
        } catch (elevenLabsError: any) {
          console.warn(`   ⚠️ ElevenLabs fetch failed: ${elevenLabsError.message}`);
        }
      }
      
      // 3. Apply updates if any fields were updated
      if (updatedFields.length > 0) {
        // Update status to completed if we have transcript
        if (updates.transcript && callRecord.status !== 'completed') {
          updates.status = 'completed';
          updatedFields.push('status');
        }
        
        await db
          .update(calls)
          .set(updates)
          .where(eq(calls.id, callId));
        
        console.log(`   ✅ Updated ${updatedFields.length} fields: ${updatedFields.join(', ')}`);
        return { callId, success: true, updatedFields };
      } else if (twilioFetchSuccess || elevenLabsFetchSuccess) {
        // Data was fetched but no new fields to update (already up to date)
        console.log(`   ℹ️ No new data to update (already synced)`);
        return { callId, success: true, updatedFields };
      } else {
        // Neither source returned data
        console.log(`   ⚠️ No data returned from either source`);
        return { callId, success: false, error: 'No data returned from external sources', updatedFields };
      }
      
    } catch (error: any) {
      console.error(`❌ [Sync] Error syncing call ${callId}:`, error.message);
      return { callId, success: false, error: error.message, updatedFields };
    }
  }
  
  /**
   * Sync a SIP call from ElevenLabs API
   */
  private async syncSipCall(callId: string, callRecord: any): Promise<SyncResult> {
    const updatedFields: string[] = [];
    
    if (!callRecord.elevenlabsConversationId) {
      return { callId, success: false, skipped: true, error: 'No ElevenLabs conversation ID', updatedFields };
    }
    
    try {
      let agentElevenLabsService: ElevenLabsService = elevenLabsService;
      
      if (callRecord.agentId) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, callRecord.agentId))
          .limit(1);
        
        if (agent?.elevenLabsCredentialId) {
          const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
          if (credential) {
            agentElevenLabsService = new ElevenLabsService(credential.apiKey);
          }
        }
      }
      
      const elevenLabsData = await agentElevenLabsService.getConversationDetails(callRecord.elevenlabsConversationId);
      if (elevenLabsData) {
        const updates: Record<string, any> = {};
        
        // 1. Transcript (JSONB for SIP calls)
        if (!callRecord.transcript && elevenLabsData.transcript?.length > 0) {
          updates.transcript = elevenLabsData.transcript;
          updatedFields.push('transcript');
        }
        
        // 2. AI Summary
        if (!callRecord.aiSummary && elevenLabsData.analysis) {
          const summary = elevenLabsData.analysis.transcript_summary || elevenLabsData.analysis.summary;
          if (summary) {
            updates.aiSummary = summary;
            updatedFields.push('aiSummary');
          }
        }
        
        // 3. Duration
        if (!callRecord.durationSeconds && elevenLabsData.call_duration_secs) {
          updates.durationSeconds = elevenLabsData.call_duration_secs;
          updatedFields.push('durationSeconds');
        }
        
        // 4. Recording URL
        if (!callRecord.recordingUrl && elevenLabsData.recording_url) {
          updates.recordingUrl = elevenLabsData.recording_url;
          updatedFields.push('recordingUrl');
        }
        
        // 5. Classification & Sentiment
        if (!callRecord.classification && elevenLabsData.analysis) {
          // Re-use logic for classification if needed
          const analysisObj = elevenLabsData.analysis;
          if (analysisObj.sentiment) {
            updates.sentiment = analysisObj.sentiment;
            updatedFields.push('sentiment');
          }
        }

        if (updatedFields.length > 0) {
          await db
            .update(sipCalls)
            .set(updates)
            .where(eq(sipCalls.id, callId));
          
          console.log(`   ✅ Updated SIP call ${callId}: ${updatedFields.join(', ')}`);
          return { callId, success: true, updatedFields };
        }
      }
      
      return { callId, success: true, updatedFields };
    } catch (error: any) {
      console.error(`❌ [Sync] Error syncing SIP call ${callId}:`, error.message);
      return { callId, success: false, error: error.message, updatedFields };
    }
  }
  
  /**
   * Sync all calls that need syncing
   * Targets calls that have either Twilio SID or ElevenLabs conversation ID
   * and are missing data (transcript, recording, duration, etc.)
   */
  async syncAllCalls(): Promise<SyncSummary> {
    console.log('🔄 [Sync] Starting sync for all calls...');
    
    try {
      // 1. Find regular calls that need syncing
      const regularCallsToSync = await db
        .select()
        .from(calls)
        .where(
          and(
            or(
              isNotNull(calls.twilioSid),
              isNotNull(calls.elevenLabsConversationId)
            ),
            or(
              eq(calls.status, 'completed'),
              eq(calls.status, 'answered')
            ),
            or(
              isNull(calls.transcript),
              isNull(calls.recordingUrl),
              isNull(calls.duration)
            )
          )
        );
      
      // 2. Find SIP calls that need syncing
      const sipCallsToSync = await db
        .select()
        .from(sipCalls)
        .where(
          and(
            isNotNull(sipCalls.elevenlabsConversationId),
            or(
              eq(sipCalls.status, 'completed'),
              eq(sipCalls.status, 'answered')
            ),
            or(
              isNull(sipCalls.transcript),
              isNull(sipCalls.aiSummary),
              isNull(sipCalls.recordingUrl)
            )
          )
        );
      
      const allCallsToSync = [
        ...regularCallsToSync.map(c => ({ id: c.id, type: 'regular' })),
        ...sipCallsToSync.map(c => ({ id: c.id, type: 'sip' }))
      ];
      
      console.log(`📊 Found ${allCallsToSync.length} calls to sync (${regularCallsToSync.length} regular, ${sipCallsToSync.length} SIP)`);
      
      const results: SyncResult[] = [];
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      
      // Process calls one at a time to avoid rate limiting
      for (const callInfo of allCallsToSync) {
        const result = await this.syncCall(callInfo.id);
        results.push(result);
        
        if (result.success) {
          successCount++;
        } else if (result.skipped) {
          skippedCount++;
        } else {
          failCount++;
          if (result.error) {
            errors.push(`Call ${callInfo.id} (${callInfo.type}): ${result.error}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      const summary: SyncSummary = {
        total: allCallsToSync.length,
        success: successCount,
        failed: failCount,
        skipped: skippedCount,
        errors: errors.length > 0 ? errors : undefined,
        results
      };
      
      console.log(`✅ [Sync] Complete: ${successCount} successful, ${skippedCount} skipped, ${failCount} failed out of ${allCallsToSync.length}`);
      
      return summary;
      
    } catch (error: any) {
      console.error('❌ [Sync] Error syncing calls:', error);
      return {
        total: 0,
        success: 0,
        failed: 1,
        skipped: 0,
        errors: [error.message]
      };
    }
  }
  
  /**
   * Sync a call from webhook data (combines ElevenLabs webhook + Twilio lookup)
   * Used when processing incoming webhooks to get complete call data
   */
  async syncFromWebhook(params: {
    conversationId: string;
    agentId?: string;
    transcript?: Array<{ role: string; message: string; time_in_call_secs: number }>;
    analysis?: { call_successful?: boolean; summary?: string; transcript_summary?: string; data_collected?: Record<string, any> };
    metadata?: { call_sid?: string; from_number?: string; to_number?: string; direction?: string };
    status?: string;
    callDurationSecs?: number;
  }): Promise<{
    phoneNumber: string | null;
    calledNumber: string | null;
    duration: number | null;
    recordingUrl: string | null;
    transcript: string | null;
    rawTranscript: Array<{ role: string; message: string; time_in_call_secs: number }> | null;
    aiSummary: string | null;
    sentiment: string | null;
    classification: string | null;
    metadata: Record<string, any>;
  }> {
    console.log(`🔄 [Sync] Syncing from webhook for conversation: ${params.conversationId}`);
    
    // Extract phone numbers from all possible nested locations
    // Priority: phone_call object > batch_call object > direct metadata fields
    const webhookMeta = params.metadata as any;
    let phoneNumber: string | null = 
      webhookMeta?.phone_call?.from || 
      webhookMeta?.phone_call?.from_number ||
      webhookMeta?.batch_call?.from ||
      webhookMeta?.from_number || 
      null;
    let calledNumber: string | null = 
      webhookMeta?.phone_call?.to || 
      webhookMeta?.phone_call?.to_number ||
      webhookMeta?.batch_call?.to ||
      webhookMeta?.to_number || 
      null;
    const callSidFromWebhook = 
      webhookMeta?.phone_call?.call_sid ||
      webhookMeta?.phone_call?.twilio_call_sid ||
      webhookMeta?.call_sid ||
      null;
    
    let duration: number | null = params.callDurationSecs || null;
    let recordingUrl: string | null = null;
    const metadata: Record<string, any> = {};
    
    console.log(`   Phone numbers from webhook:`);
    console.log(`     From: ${phoneNumber || 'N/A'}`);
    console.log(`     To: ${calledNumber || 'N/A'}`);
    console.log(`     CallSid: ${callSidFromWebhook || 'N/A'}`);
    
    // Preserve raw transcript array for JSONB storage in SIP calls
    let rawTranscript = (params.transcript && params.transcript.length > 0) ? params.transcript : null;
    
    // Format transcript from webhook data
    let transcript: string | null = null;
    if (params.transcript && params.transcript.length > 0) {
      transcript = params.transcript.map(entry => 
        `${entry.role.toUpperCase()} (${entry.time_in_call_secs}s): ${entry.message}`
      ).join('\n');
    }
    
    // Extract analysis - ElevenLabs sends transcript_summary in analysis object
    // Check multiple possible field names for compatibility
    let analysisObj = params.analysis as any;
    let aiSummary = analysisObj?.transcript_summary || analysisObj?.summary || null;
    
    // Extract lead classification from call analysis
    // Use hot/warm/cold/lost based on call_successful, sentiment, and duration
    let classification: string | null = null;
    let sentimentValue: string | null = null;
    if (analysisObj) {
      const callSuccessful = analysisObj.call_successful === 'success' || analysisObj.call_successful === true;
      const callFailed = analysisObj.call_successful === 'failure' || analysisObj.call_successful === false;
      
      // Extract sentiment from evaluation results if available
      const evaluationResults = analysisObj.evaluation_criteria_results || {};
      const sentimentResult = evaluationResults.sentiment || evaluationResults.customer_sentiment;
      const sentiment = sentimentResult?.result?.toLowerCase() || 
                       analysisObj.sentiment?.toLowerCase() || 
                       null;
      sentimentValue = sentiment;
      
      // Get call duration from webhook or params
      const callDuration = params.callDurationSecs || duration || 0;
      
      if (callFailed) {
        // Failed calls = lost leads
        classification = 'lost';
      } else if (callSuccessful) {
        // Successful calls - classify based on engagement level
        if (sentiment === 'positive' || sentiment === 'very positive' || callDuration >= 180) {
          // Positive sentiment OR engaged for 3+ minutes = hot lead
          classification = 'hot';
        } else if (sentiment === 'negative' || sentiment === 'very negative') {
          // Negative sentiment = cold lead
          classification = 'cold';
        } else if (callDuration >= 60) {
          // Neutral sentiment but decent engagement (1-3 min) = warm lead
          classification = 'warm';
        } else {
          // Short successful call = cold lead
          classification = 'cold';
        }
      } else {
        // Unknown status - mark as cold if we have some data
        classification = callDuration > 0 ? 'cold' : null;
      }
    }
    
    console.log(`   Webhook data extracted:`);
    console.log(`     Transcript: ${transcript ? `${transcript.length} chars, ${params.transcript?.length || 0} turns` : 'N/A'}`);
    console.log(`     AI Summary: ${aiSummary ? `${aiSummary.length} chars` : 'N/A'}`);
    console.log(`     Classification: ${classification || 'N/A'}`);
    
    // PRIMARY: Try to get recording URL from ElevenLabs API (works for all providers including SIP)
    // ElevenLabs is the primary source since it works regardless of telephony provider
    if (params.conversationId) {
      console.log(`   🤖 Fetching ElevenLabs recording for conversation: ${params.conversationId}`);
      try {
        let agentElevenLabsService: ElevenLabsService = elevenLabsService;
        
        if (params.agentId) {
          const [agent] = await db
            .select()
            .from(agents)
            .where(eq(agents.elevenLabsAgentId, params.agentId))
            .limit(1);
          
          if (agent?.elevenLabsCredentialId) {
            const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
            if (credential) {
              agentElevenLabsService = new ElevenLabsService(credential.apiKey);
            }
          }
        }
        
        const convDetails = await agentElevenLabsService.getConversationDetails(params.conversationId);
        if (convDetails) {
          // 1. Recording URL
          if (convDetails.recording_url) {
            recordingUrl = convDetails.recording_url;
            metadata.hasElevenLabsRecording = true;
            console.log(`   ✅ Got ElevenLabs recording URL`);
          } else if (convDetails.has_audio) {
            metadata.hasElevenLabsRecording = true;
            metadata.elevenLabsAudioAvailable = true;
            console.log(`   ℹ️ ElevenLabs has audio but no direct recording URL (on-demand fetch available)`);
          }

          // 2. Backfill Transcript if missing or empty in webhook
          if (!transcript && convDetails.transcript && convDetails.transcript.length > 0) {
            transcript = convDetails.transcript.map((entry: any) => 
              `${entry.role.toUpperCase()} (${entry.time_in_call_secs}s): ${entry.message}`
            ).join('\n');
            console.log(`   ✅ Backfilled transcript from ElevenLabs API (${convDetails.transcript.length} turns)`);
            
            // Also backfill rawTranscript for SIP calls
            if (!rawTranscript) {
              rawTranscript = convDetails.transcript;
            }
          }

          // 3. Backfill AI Summary if missing or empty in webhook
          if (!aiSummary && convDetails.analysis) {
            const apiSummary = convDetails.analysis.transcript_summary || convDetails.analysis.summary;
            if (apiSummary) {
              aiSummary = apiSummary;
              console.log(`   ✅ Backfilled AI Summary from ElevenLabs API`);
            }
          }

          // 4. Backfill Analysis data for classification if missing
          if (!analysisObj && convDetails.analysis) {
            console.log(`   ℹ️ Webhook was missing analysis object, but API has it. Re-running classification...`);
            analysisObj = convDetails.analysis;
            const apiAnalysis = analysisObj;
            const callSuccessful = apiAnalysis.call_successful === 'success' || apiAnalysis.call_successful === true;
            const callFailed = apiAnalysis.call_successful === 'failure' || apiAnalysis.call_successful === false;
            
            const evaluationResults = apiAnalysis.evaluation_criteria_results || {};
            const sentimentResult = evaluationResults.sentiment || evaluationResults.customer_sentiment;
            const sentiment = sentimentResult?.result?.toLowerCase() || 
                             apiAnalysis.sentiment?.toLowerCase() || 
                             null;
            sentimentValue = sentiment;
            
            const callDuration = params.callDurationSecs || duration || 0;
            
            if (callFailed) {
              classification = 'lost';
            } else if (callSuccessful) {
              if (sentiment === 'positive' || sentiment === 'very positive' || callDuration >= 180) {
                classification = 'hot';
              } else if (sentiment === 'negative' || sentiment === 'very negative') {
                classification = 'cold';
              } else if (callDuration >= 60) {
                classification = 'warm';
              } else {
                classification = 'cold';
              }
            } else {
              classification = callDuration > 0 ? 'cold' : null;
            }
            console.log(`   ✅ Re-classified lead as: ${classification}`);
          }
        }
      } catch (elError: any) {
        console.warn(`   ⚠️ ElevenLabs recording fetch failed: ${elError.message}`);
      }
    }
    
    // FALLBACK: Try Twilio for additional data (phone numbers, duration, recording if ElevenLabs didn't have one)
    // Only attempt Twilio lookup for valid Twilio Call SIDs (start with "CA")
    // SIP call IDs (SCL_*), Plivo IDs, and other non-Twilio IDs must be skipped
    const isTwilioSid = callSidFromWebhook?.startsWith('CA');
    if (callSidFromWebhook && isTwilioSid) {
      console.log(`   📞 Fetching Twilio data for SID: ${callSidFromWebhook}`);
      try {
        const twilioData = await twilioService.getCallDetails(callSidFromWebhook);
        
        if (twilioData) {
          if (!phoneNumber && twilioData.from) {
            phoneNumber = twilioData.from;
          }
          if (!calledNumber && twilioData.to) {
            calledNumber = twilioData.to;
          }
          
          if (!duration && twilioData.duration) {
            duration = twilioData.duration;
          }
          
          // Use Twilio recording URL as fallback if ElevenLabs didn't provide one
          if (!recordingUrl && twilioData.recordingUrl) {
            recordingUrl = twilioData.recordingUrl;
            console.log(`   ✅ Using Twilio recording URL as fallback`);
          }
          
          metadata.twilioFrom = twilioData.from;
          metadata.twilioTo = twilioData.to;
          metadata.twilioStatus = twilioData.status;
          metadata.twilioDirection = twilioData.direction;
          
          console.log(`   ✅ Twilio data: from=${twilioData.from}, to=${twilioData.to}`);
        }
      } catch (twilioError: any) {
        console.warn(`   ⚠️ Twilio fetch failed: ${twilioError.message}`);
      }
    } else if (callSidFromWebhook && !isTwilioSid) {
      console.log(`   ℹ️ Skipping Twilio lookup for non-Twilio call SID: ${callSidFromWebhook} (source: ${callSidFromWebhook.startsWith('SCL') ? 'sip' : 'unknown'})`);
    }
    
    // Store ElevenLabs metadata
    metadata.elevenLabsConversationId = params.conversationId;
    metadata.elevenLabsAgentId = params.agentId;
    metadata.elevenLabsStatus = params.status;
    metadata.elevenLabsAnalysis = analysisObj;
    metadata.syncedAt = new Date().toISOString();
    
    // Preserve raw transcript array for JSONB storage in SIP calls
    
    return {
      phoneNumber,
      calledNumber,
      duration,
      recordingUrl,
      transcript,
      rawTranscript,
      aiSummary,
      sentiment: sentimentValue,
      classification,
      metadata
    };
  }
}

export const callSyncService = new CallSyncService();
