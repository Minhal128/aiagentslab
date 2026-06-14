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

import { Router, Response } from "express";
import { RouteContext, AuthRequest } from "./common";
import { calls, agents, incomingConnections, sipCalls } from "@shared/schema";
import { eq } from "drizzle-orm";
import { ElevenLabsService } from "../services/elevenlabs";
import { ElevenLabsPoolService } from "../services/elevenlabs-pool";
import { getTwilioClient } from "../services/twilio-connector";
import { fetchElevenLabsConversation } from "./webhook-routes";
import PDFDocument from "pdfkit";

function formatDurationPDF(seconds: number): string {
  if (!seconds) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function createAnalyticsRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { db, storage, authenticateToken, authenticateHybrid, recordingService, elevenLabsService } = ctx;

  // Get all user calls with pagination support
  router.get("/api/calls", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const enrichedCalls = await storage.getUserCallsWithDetails(req.userId!);

      const requestsPagination = req.query.page !== undefined || req.query.pageSize !== undefined;
      
      if (requestsPagination) {
        const page = parseInt(req.query.page as string, 10) || 1;
        const pageSize = parseInt(req.query.pageSize as string, 10) || 25;
        const offset = (page - 1) * pageSize;

        const totalItems = enrichedCalls.length;
        const totalPages = Math.ceil(totalItems / pageSize);

        const paginatedCalls = enrichedCalls.slice(offset, offset + pageSize);

        res.json({
          data: paginatedCalls,
          pagination: {
            page,
            pageSize,
            totalItems,
            totalPages
          }
        });
      } else {
        res.json(enrichedCalls);
      }
    } catch (error: any) {
      console.error("Get calls error:", error);
      res.status(500).json({ error: "Failed to get calls" });
    }
  });

  // Get single call details
  router.get("/api/calls/:id", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const callWithDetails = await storage.getCallWithDetails(req.params.id);
      if (!callWithDetails) {
        return res.status(404).json({ error: "Call not found" });
      }

      if (callWithDetails.userId === req.userId) {
        // Direct ownership - allow access
      } else if (callWithDetails.campaignId) {
        const campaign = await storage.getCampaignIncludingDeleted(callWithDetails.campaignId);
        if (!campaign || campaign.userId !== req.userId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else if (callWithDetails.incomingConnectionId) {
        const [connection] = await db
          .select()
          .from(incomingConnections)
          .where(eq(incomingConnections.id, callWithDetails.incomingConnectionId))
          .limit(1);
        if (!connection || connection.userId !== req.userId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(callWithDetails);
    } catch (error: any) {
      console.error("Get call error:", error);
      res.status(500).json({ error: "Failed to get call" });
    }
  });

  // Download call recording - handles all 3 engines: ElevenLabs+Twilio, Twilio+OpenAI, Plivo+OpenAI
  router.get("/api/calls/:id/recording", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      // Use getCallWithDetails which checks both calls and twilioOpenaiCalls tables
      const callWithDetails = await storage.getCallWithDetails(req.params.id);
      if (!callWithDetails) {
        return res.status(404).json({ error: "Call not found" });
      }

      if (callWithDetails.userId === req.userId) {
        // Direct ownership - allow access
      } else if (callWithDetails.campaignId) {
        const campaign = await storage.getCampaignIncludingDeleted(callWithDetails.campaignId);
        if (!campaign || campaign.userId !== req.userId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else if (callWithDetails.incomingConnectionId) {
        const [connection] = await db
          .select()
          .from(incomingConnections)
          .where(eq(incomingConnections.id, callWithDetails.incomingConnectionId))
          .limit(1);
        if (!connection || connection.userId !== req.userId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else {
        return res.status(403).json({ error: "Access denied" });
      }

      // Handle OpenAI widget calls - WebRTC calls don't have server-side recordings
      if (callWithDetails.engine === 'openai') {
        console.log(`🎙️ [Recording] OpenAI widget call ${callWithDetails.id} - WebRTC calls don't have server-side recordings`);
        return res.status(404).json({ 
          error: "Recording not available", 
          details: "OpenAI widget calls use WebRTC and don't have server-side recordings. The conversation transcript is available instead." 
        });
      }

      // Handle Twilio+OpenAI calls - fetch recording directly from Twilio using twilioSid
      if (callWithDetails.engine === 'twilio-openai') {
        console.log(`🎙️ [Recording] Fetching Twilio+OpenAI recording for call ${callWithDetails.id}`);
        
        if (callWithDetails.twilioSid) {
          const twilioResult = await recordingService.fetchTwilioRecordingBySid(callWithDetails.twilioSid);
          if (twilioResult) {
            res.setHeader('Content-Type', twilioResult.contentType);
            res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(twilioResult.audioBuffer);
          }
        } else {
          console.warn(`⚠️ [Recording] Call ${callWithDetails.id} has no twilioSid — cannot fetch recording from Twilio API`);
        }
        
        // Try using stored recording URL as fallback
        if (callWithDetails.recordingUrl) {
          const urlResult = await recordingService.fetchTwilioRecordingByUrl(callWithDetails.recordingUrl);
          if (urlResult) {
            res.setHeader('Content-Type', urlResult.contentType);
            res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(urlResult.audioBuffer);
          }
        }
        
        console.warn(`⚠️ [Recording] No recording found for Twilio+OpenAI call ${callWithDetails.id}. twilioSid: ${callWithDetails.twilioSid || 'MISSING'}, storedRecordingUrl: ${callWithDetails.recordingUrl || 'NONE'}. If recordings are visible on the Twilio/ElevenLabs dashboard but not here, check that APP_DOMAIN is correctly set and the recording callback URL (${callWithDetails.twilioSid ? '/api/twilio-openai/voice/recording' : 'N/A'}) is reachable from Twilio's servers.`);
        return res.status(404).json({ 
          error: "Recording not available", 
          details: "No recording found for this Twilio+OpenAI call. If the call just ended, recordings may take up to 60 seconds to become available. If the issue persists, check that APP_DOMAIN is set correctly and the server is publicly accessible for Twilio webhooks." 
        });
      }

      // Handle Plivo+OpenAI calls - fetch recording from Plivo API or stored URL
      if (callWithDetails.engine === 'plivo-openai') {
        console.log(`🎙️ [Recording] Fetching Plivo+OpenAI recording for call ${callWithDetails.id}`);
        
        // Get plivoCallUuid directly or from metadata
        const plivoCallUuid = callWithDetails.plivoCallUuid || (callWithDetails.metadata as any)?.plivoCallUuid;
        const plivoCredentialId = (callWithDetails.metadata as any)?.plivoCredentialId;
        
        // Try fetching from Plivo API using call UUID first (most reliable)
        if (plivoCallUuid) {
          const plivoResult = await recordingService.fetchPlivoRecordingByCallUuid(plivoCallUuid, plivoCredentialId);
          if (plivoResult) {
            res.setHeader('Content-Type', plivoResult.contentType);
            res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(plivoResult.audioBuffer);
          }
        }
        
        // Fallback: Try stored recording URL
        if (callWithDetails.recordingUrl) {
          const urlResult = await recordingService.fetchPlivoRecordingByUrl(callWithDetails.recordingUrl);
          if (urlResult) {
            res.setHeader('Content-Type', urlResult.contentType);
            res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(urlResult.audioBuffer);
          }
        }
        
        return res.status(404).json({ 
          error: "Recording not available", 
          details: "No recording found for this Plivo+OpenAI call. The recording may still be processing." 
        });
      }

      // Handle SIP calls (ElevenLabs SIP + OpenAI SIP)
      if (callWithDetails.engine === 'elevenlabs-sip' || callWithDetails.engine === 'openai-sip') {
        console.log(`🎙️ [Recording] Fetching SIP recording for call ${callWithDetails.id} (engine: ${callWithDetails.engine})`);
        
        if (callWithDetails.recordingUrl) {
          let isTwilioHosted = false;
          try {
            const hostname = new URL(callWithDetails.recordingUrl).hostname;
            isTwilioHosted = hostname === 'twilio.com' || hostname.endsWith('.twilio.com');
          } catch {
            // Invalid URL — treat as non-Twilio and let the raw fetch branch handle/surface the error
          }
          if (isTwilioHosted) {
            // Twilio-hosted recording URLs require Basic Auth — use the authed fetcher
            const authedResult = await recordingService.fetchTwilioRecordingByUrl(callWithDetails.recordingUrl);
            if (authedResult) {
              res.setHeader('Content-Type', authedResult.contentType);
              res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
              res.setHeader('Cache-Control', 'no-cache');
              return res.send(authedResult.audioBuffer);
            }
            console.warn(`⚠️ [Recording] Authed fetch of Twilio-hosted SIP recording failed for call ${callWithDetails.id}`);
          } else {
            try {
              const response = await fetch(callWithDetails.recordingUrl);
              if (response.ok) {
                const audioBuffer = Buffer.from(await response.arrayBuffer());
                const contentType = response.headers.get('content-type') || 'audio/mpeg';
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(audioBuffer);
              }
            } catch (fetchError: any) {
              console.warn(`⚠️ [Recording] Failed to fetch SIP recording URL: ${fetchError.message}`);
            }
          }
        }

        if (callWithDetails.elevenlabsConversationId) {
          const result = await recordingService.getRecordingAudio({
            ...callWithDetails,
            elevenLabsConversationId: callWithDetails.elevenlabsConversationId,
          });
          if ('audioBuffer' in result) {
            res.setHeader('Content-Type', result.contentType);
            res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(result.audioBuffer);
          }
        }
        
        return res.status(404).json({ 
          error: "Recording not available", 
          details: "No recording found for this SIP call" 
        });
      }

      // Handle ElevenLabs calls (existing logic)
      const result = await recordingService.getRecordingAudio(callWithDetails);
      
      if ('audioBuffer' in result) {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `inline; filename="call-recording-${callWithDetails.id}.mp3"`);
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(result.audioBuffer);
      } else {
        return res.status(404).json(result);
      }

    } catch (error: any) {
      console.error("Download recording error:", error);
      res.status(500).json({ error: "Failed to download recording" });
    }
  });

  // Sync missing call recordings from Twilio AND ElevenLabs
  router.post("/api/calls/sync-recordings", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      console.log(`🎙️ [User ${req.userId}] Starting recording sync...`);
      
      const userCalls = await storage.getUserCallsWithDetails(req.userId!);
      
      const twilioCalls = userCalls.filter(
        call => call.twilioSid && !call.recordingUrl && (call.status === 'completed' || call.status === 'answered')
      );
      
      const elevenLabsCalls = userCalls.filter(
        call => call.elevenLabsConversationId && 
          (!call.transcript || !call.aiSummary || !call.duration) && 
          (call.status === 'completed' || call.status === 'answered' || call.status === 'ended')
      );
      
      console.log(`📊 Found ${twilioCalls.length} Twilio calls without recordings for user ${req.userId}`);
      console.log(`📊 Found ${elevenLabsCalls.length} ElevenLabs calls missing metadata for user ${req.userId}`);
      
      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      
      // Sync Twilio recordings
      if (twilioCalls.length > 0) {
        try {
          const twilioClient = await getTwilioClient();
          
          for (const call of twilioCalls) {
            try {
              console.log(`🔍 [Twilio] Fetching recordings for call ${call.id} (Twilio SID: ${call.twilioSid})`);
              
              const recordings = await twilioClient.recordings.list({
                callSid: call.twilioSid!,
                limit: 1
              });
              
              if (recordings.length > 0) {
                const recording = recordings[0];
                const recordingUrl = `https://api.twilio.com${recording.uri.replace('.json', '')}`;
                
                console.log(`✅ [Twilio] Found recording: ${recordingUrl}`);
                
                await db
                  .update(calls)
                  .set({
                    recordingUrl,
                    duration: recording.duration ? parseInt(recording.duration, 10) : call.duration
                  })
                  .where(eq(calls.id, call.id));
                
                successCount++;
              } else {
                console.log(`⚠️  [Twilio] No recording found for call ${call.id}`);
                failCount++;
                errors.push(`[Twilio] No recording for call ${call.id}`);
              }
            } catch (error: any) {
              console.error(`❌ [Twilio] Error for call ${call.id}:`, error.message);
              failCount++;
              errors.push(`[Twilio] Call ${call.id}: ${error.message}`);
            }
          }
        } catch (twilioError: any) {
          console.error(`❌ [Twilio] Failed to get client:`, twilioError.message);
          errors.push(`[Twilio] Client error: ${twilioError.message}`);
        }
      }
      
      // Sync ElevenLabs recordings
      if (elevenLabsCalls.length > 0) {
        for (const call of elevenLabsCalls) {
          try {
            console.log(`🔍 [ElevenLabs] Fetching conversation details for call ${call.id} (Conversation: ${call.elevenLabsConversationId})`);
            
            let elService = elevenLabsService;
            
            if (call.incomingConnectionId) {
              const [connection] = await db
                .select({
                  agentCredentialId: agents.elevenLabsCredentialId
                })
                .from(incomingConnections)
                .leftJoin(agents, eq(incomingConnections.agentId, agents.id))
                .where(eq(incomingConnections.id, call.incomingConnectionId))
                .limit(1);
              
              if (connection?.agentCredentialId) {
                const credential = await ElevenLabsPoolService.getCredentialById(connection.agentCredentialId);
                if (credential) {
                  elService = new ElevenLabsService(credential.apiKey);
                }
              }
            }
            
            const conversationDetails = await elService.getConversationDetails(call.elevenLabsConversationId!);
            
            if (conversationDetails) {
              const updates: any = {};
              
              if (conversationDetails.transcript && !call.transcript) {
                updates.transcript = conversationDetails.transcript;
                console.log(`✅ [ElevenLabs] Found transcript`);
              }
              
              if (conversationDetails.metadata?.call_duration_secs && !call.duration) {
                updates.duration = Math.ceil(conversationDetails.metadata.call_duration_secs);
              }
              
              if (conversationDetails.analysis && !call.aiSummary) {
                updates.aiSummary = typeof conversationDetails.analysis === 'string' 
                  ? conversationDetails.analysis 
                  : JSON.stringify(conversationDetails.analysis);
              }
              
              if (call.status === 'initiated') {
                updates.status = conversationDetails.status === 'done' ? 'completed' : 'ended';
              }
              
              if (Object.keys(updates).length > 0) {
                await db
                  .update(calls)
                  .set(updates)
                  .where(eq(calls.id, call.id));
                
                successCount++;
                console.log(`✅ [ElevenLabs] Updated call ${call.id} with ${Object.keys(updates).length} field(s)`);
              } else {
                console.log(`⚠️  [ElevenLabs] No new data found for call ${call.id}`);
                failCount++;
              }
            } else {
              console.log(`⚠️  [ElevenLabs] No conversation details for call ${call.id}`);
              failCount++;
              errors.push(`[ElevenLabs] No data for call ${call.id}`);
            }
          } catch (error: any) {
            console.error(`❌ [ElevenLabs] Error for call ${call.id}:`, error.message);
            failCount++;
            errors.push(`[ElevenLabs] Call ${call.id}: ${error.message}`);
          }
        }
      }
      
      // Sync SIP ElevenLabs calls (from sip_calls table)
      const sipElevenLabsCalls = userCalls.filter(
        call => call.engine === 'elevenlabs-sip' && 
          call.elevenlabsConversationId &&
          (!call.transcript || !call.aiSummary || !call.duration) && 
          (call.status === 'completed' || call.status === 'answered' || call.status === 'ended')
      );
      
      console.log(`📊 Found ${sipElevenLabsCalls.length} SIP ElevenLabs calls missing metadata for user ${req.userId}`);
      
      if (sipElevenLabsCalls.length > 0) {
        for (const call of sipElevenLabsCalls) {
          try {
            console.log(`🔍 [SIP ElevenLabs] Fetching conversation details for call ${call.id} (Conversation: ${call.elevenlabsConversationId})`);
            
            let elService = elevenLabsService;
            
            if (call.agentId) {
              const [agent] = await db
                .select()
                .from(agents)
                .where(eq(agents.id, call.agentId))
                .limit(1);
              
              if (agent?.elevenLabsCredentialId) {
                const credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
                if (credential) {
                  elService = new ElevenLabsService(credential.apiKey);
                }
              }
            }
            
            const conversationDetails = await elService.getConversationDetails(call.elevenlabsConversationId!);
            
            if (conversationDetails) {
              const updates: any = {};
              
              if (conversationDetails.transcript && !call.transcript) {
                const transcriptText = conversationDetails.transcript.map((entry: any) => 
                  `${entry.role.toUpperCase()} (${entry.time_in_call_secs}s): ${entry.message}`
                ).join('\n');
                updates.transcript = transcriptText;
                console.log(`✅ [SIP ElevenLabs] Found transcript`);
              }
              
              const callDuration = conversationDetails.call_duration_secs || conversationDetails.metadata?.call_duration_secs;
              if (callDuration && !call.duration) {
                updates.durationSeconds = Math.ceil(callDuration);
              }
              
              if (conversationDetails.analysis && !call.aiSummary) {
                updates.aiSummary = typeof conversationDetails.analysis === 'string' 
                  ? conversationDetails.analysis 
                  : (conversationDetails.analysis.summary || JSON.stringify(conversationDetails.analysis));
              }
              
              if (conversationDetails.recording_url && !call.recordingUrl) {
                updates.recordingUrl = conversationDetails.recording_url;
              }
              
              if (call.status === 'initiated') {
                updates.status = conversationDetails.status === 'done' ? 'completed' : 'ended';
              }
              
              if (Object.keys(updates).length > 0) {
                await db
                  .update(sipCalls)
                  .set(updates)
                  .where(eq(sipCalls.id, call.id));
                
                successCount++;
                console.log(`✅ [SIP ElevenLabs] Updated call ${call.id} with ${Object.keys(updates).length} field(s)`);
              } else {
                console.log(`⚠️  [SIP ElevenLabs] No new data found for call ${call.id}`);
                failCount++;
              }
            } else {
              console.log(`⚠️  [SIP ElevenLabs] No conversation details for call ${call.id}`);
              failCount++;
              errors.push(`[SIP ElevenLabs] No data for call ${call.id}`);
            }
          } catch (error: any) {
            console.error(`❌ [SIP ElevenLabs] Error for call ${call.id}:`, error.message);
            failCount++;
            errors.push(`[SIP ElevenLabs] Call ${call.id}: ${error.message}`);
          }
        }
      }
      
      const summary = {
        total: twilioCalls.length + elevenLabsCalls.length + sipElevenLabsCalls.length,
        twilioCalls: twilioCalls.length,
        elevenLabsCalls: elevenLabsCalls.length,
        sipElevenLabsCalls: sipElevenLabsCalls.length,
        success: successCount,
        failed: failCount,
        errors: errors.length > 0 ? errors : undefined
      };
      
      console.log(`✅ [User ${req.userId}] Recording sync complete:`, summary);
      
      res.json(summary);
    } catch (error: any) {
      console.error('❌ [User] Error syncing recordings:', error);
      res.status(500).json({ error: 'Failed to sync recordings' });
    }
  });

  // ElevenLabs conversation fetch
  router.post("/api/calls/:callId/fetch-conversation", authenticateToken, fetchElevenLabsConversation);

  // Dashboard Data
  router.get("/api/dashboard", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const dashboardData = await storage.getDashboardData(req.userId!);
      res.json(dashboardData);
    } catch (error: any) {
      console.error("Get dashboard data error:", error);
      res.status(500).json({ error: "Failed to get dashboard data" });
    }
  });
  
  // Analytics
  router.get("/api/analytics", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const timeRange = req.query.timeRange as string || '7days';
      const callType = req.query.callType as string || 'all';
      const analytics = await storage.getUserAnalytics(req.userId!, timeRange, callType);
      res.json(analytics);
    } catch (error: any) {
      console.error("Get analytics error:", error);
      res.status(500).json({ error: "Failed to get analytics" });
    }
  });

  // Analytics PDF Export - Professional Design
  router.post("/api/analytics/export-pdf", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { timeRange = '7days', callType = 'all' } = req.body;
      
      const validTimeRanges = ['7days', '30days', '90days', 'year'];
      const validCallTypes = ['all', 'incoming', 'outgoing', 'batch'];
      
      if (!validTimeRanges.includes(timeRange)) {
        return res.status(400).json({ error: 'Invalid time range' });
      }
      if (!validCallTypes.includes(callType)) {
        return res.status(400).json({ error: 'Invalid call type' });
      }
      
      const rawAnalytics = await storage.getUserAnalytics(req.userId!, timeRange, callType);
      
      const appNameSetting = await storage.getGlobalSetting('app_name');
      const appName = typeof appNameSetting?.value === 'string' ? appNameSetting.value : '';
      
      const analytics = {
        totalCalls: rawAnalytics?.totalCalls ?? 0,
        successRate: rawAnalytics?.successRate ?? 0,
        qualifiedLeads: rawAnalytics?.qualifiedLeads ?? 0,
        avgDuration: rawAnalytics?.avgDuration ?? 0,
        leadDistribution: rawAnalytics?.leadDistribution ?? [],
        sentimentDistribution: rawAnalytics?.sentimentDistribution ?? [],
        campaignPerformance: rawAnalytics?.campaignPerformance ?? [],
        dailyCalls: rawAnalytics?.dailyCalls ?? [],
        typeBreakdown: {
          incoming: rawAnalytics?.typeBreakdown?.incoming ?? 0,
          outgoing: rawAnalytics?.typeBreakdown?.outgoing ?? 0,
          batch: rawAnalytics?.typeBreakdown?.batch ?? 0,
          total: rawAnalytics?.typeBreakdown?.total ?? 0
        }
      };
      
      const user = await storage.getUser(req.userId!);
      
      const doc = new PDFDocument({ 
        margin: 40, 
        size: 'A4',
        bufferPages: true 
      });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-report-${new Date().toISOString().split('T')[0]}.pdf"`);
      
      doc.pipe(res);
      
      const colors = {
        primary: '#2563eb',
        primaryLight: '#dbeafe',
        success: '#16a34a',
        successLight: '#dcfce7',
        warning: '#ca8a04',
        warningLight: '#fef9c3',
        purple: '#7c3aed',
        purpleLight: '#ede9fe',
        text: '#1e293b',
        textMuted: '#64748b',
        border: '#e2e8f0',
        background: '#f8fafc'
      };
      
      const pageWidth = 515;
      const leftMargin = 40;
      
      // Header
      doc.save()
        .rect(0, 0, 595, 120)
        .fill(colors.primary);
      
      doc.fillColor('#ffffff')
        .fontSize(28)
        .font('Helvetica-Bold')
        .text('Analytics Report', leftMargin, 35, { width: pageWidth });
      
      const timeRangeLabels: Record<string, string> = {
        '7days': 'Last 7 Days',
        '30days': 'Last 30 Days',
        '90days': 'Last 90 Days',
        'year': 'This Year'
      };
      const callTypeLabels: Record<string, string> = {
        'all': 'All Calls',
        'incoming': 'Incoming Calls',
        'outgoing': 'Outgoing Calls',
        'batch': 'Batch Calls'
      };
      
      doc.fillColor('#ffffff')
        .fontSize(11)
        .font('Helvetica')
        .text(`${timeRangeLabels[timeRange] || timeRange} | ${callTypeLabels[callType] || callType}`, leftMargin, 72);
      
      doc.fillColor('rgba(255,255,255,0.8)')
        .fontSize(9)
        .text(`Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${user ? ` | ${user.email}` : ''}`, leftMargin, 90);
      
      doc.restore();
      doc.y = 140;
      
      // Key Metrics
      const metrics = [
        { label: 'Total Calls', value: analytics.totalCalls.toLocaleString(), color: colors.primary, bgColor: colors.primaryLight, icon: 'phone' },
        { label: 'Success Rate', value: `${analytics.successRate}%`, color: colors.success, bgColor: colors.successLight, icon: 'check' },
        { label: 'Qualified Leads', value: analytics.qualifiedLeads.toLocaleString(), color: colors.warning, bgColor: colors.warningLight, icon: 'users' },
        { label: 'Avg Duration', value: formatDurationPDF(analytics.avgDuration), color: colors.purple, bgColor: colors.purpleLight, icon: 'clock' }
      ];
      
      const cardWidth = (pageWidth - 30) / 4;
      const cardHeight = 70;
      const startY = doc.y;
      
      metrics.forEach((metric, index) => {
        const x = leftMargin + (index * (cardWidth + 10));
        
        doc.save()
          .roundedRect(x, startY, cardWidth, cardHeight, 8)
          .fill(metric.bgColor);
        
        doc.roundedRect(x, startY, 4, cardHeight, 2)
          .fill(metric.color);
        
        doc.restore();
        
        doc.fillColor(metric.color)
          .fontSize(22)
          .font('Helvetica-Bold')
          .text(metric.value, x + 12, startY + 15, { width: cardWidth - 20 });
        
        doc.fillColor(colors.textMuted)
          .fontSize(9)
          .font('Helvetica')
          .text(metric.label.toUpperCase(), x + 12, startY + 48, { width: cardWidth - 20 });
      });
      
      doc.y = startY + cardHeight + 25;
      
      // Call Type Breakdown
      if (callType === 'all' && analytics.typeBreakdown.total > 0) {
        const sectionY = doc.y;
        
        doc.fillColor(colors.text)
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('Call Type Distribution', leftMargin, sectionY);
        
        doc.y = sectionY + 25;
        
        const breakdownData = [
          { label: 'Incoming', value: analytics.typeBreakdown.incoming, color: colors.success },
          { label: 'Outgoing', value: analytics.typeBreakdown.outgoing, color: colors.primary },
          { label: 'Batch', value: analytics.typeBreakdown.batch, color: colors.purple }
        ];
        
        const total = analytics.typeBreakdown.total;
        const barWidth = pageWidth - 150;
        const barHeight = 24;
        const barY = doc.y;
        
        breakdownData.forEach((item, index) => {
          const y = barY + (index * 35);
          const percentage = total > 0 ? (item.value / total) * 100 : 0;
          const fillWidth = (percentage / 100) * barWidth;
          
          doc.fillColor(colors.text)
            .fontSize(11)
            .font('Helvetica')
            .text(item.label, leftMargin, y + 5, { width: 80 });
          
          doc.save()
            .roundedRect(leftMargin + 85, y, barWidth, barHeight, 4)
            .fill(colors.border);
          
          if (fillWidth > 0) {
            doc.roundedRect(leftMargin + 85, y, Math.max(fillWidth, 8), barHeight, 4)
              .fill(item.color);
          }
          
          doc.restore();
          
          doc.fillColor(fillWidth > 50 ? '#ffffff' : colors.text)
            .fontSize(10)
            .font('Helvetica-Bold')
            .text(`${item.value} (${percentage.toFixed(0)}%)`, leftMargin + 95, y + 6);
        });
        
        doc.y = barY + (breakdownData.length * 35) + 20;
      }
      
      // Lead Distribution
      if (analytics.leadDistribution.length > 0) {
        const sectionY = doc.y;
        
        doc.fillColor(colors.text)
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('Lead Classification', leftMargin, sectionY);
        
        doc.y = sectionY + 25;
        
        const totalLeads = analytics.leadDistribution.reduce((sum: number, item: any) => sum + item.value, 0);
        const barWidth = pageWidth - 150;
        const leadY = doc.y;
        
        analytics.leadDistribution.forEach((item: { name: string; value: number }, index: number) => {
          const y = leadY + (index * 32);
          const percentage = totalLeads > 0 ? (item.value / totalLeads) * 100 : 0;
          const fillWidth = (percentage / 100) * barWidth;
          
          const barColor = item.name.toLowerCase().includes('qualified') ? colors.success :
                          item.name.toLowerCase().includes('hot') ? '#ef4444' :
                          item.name.toLowerCase().includes('warm') ? colors.warning :
                          colors.primary;
          
          doc.fillColor(colors.text)
            .fontSize(10)
            .font('Helvetica')
            .text(item.name, leftMargin, y + 4, { width: 80 });
          
          doc.save()
            .roundedRect(leftMargin + 85, y, barWidth, 20, 3)
            .fill(colors.border);
          
          if (fillWidth > 0) {
            doc.roundedRect(leftMargin + 85, y, Math.max(fillWidth, 6), 20, 3)
              .fill(barColor);
          }
          
          doc.restore();
          
          doc.fillColor(fillWidth > 40 ? '#ffffff' : colors.text)
            .fontSize(9)
            .font('Helvetica-Bold')
            .text(`${item.value}`, leftMargin + 92, y + 5);
        });
        
        doc.y = leadY + (analytics.leadDistribution.length * 32) + 20;
      }
      
      // Call Volume Chart
      if (analytics.dailyCalls.length > 0) {
        if (doc.y > 600) {
          doc.addPage();
          doc.y = 50;
        }
        
        const chartTitle = timeRange === 'year' ? 'Monthly Call Volume' :
                          (timeRange === '30days' || timeRange === '90days') ? 'Weekly Call Volume' :
                          'Daily Call Volume';
        
        const sectionY = doc.y;
        
        doc.fillColor(colors.text)
          .fontSize(14)
          .font('Helvetica-Bold')
          .text(chartTitle, leftMargin, sectionY);
        
        doc.y = sectionY + 25;
        
        const chartHeight = 120;
        const chartWidth = pageWidth;
        const chartY = doc.y;
        const maxCount = Math.max(...analytics.dailyCalls.map((d: any) => d.count), 1);
        const barGap = 4;
        const barMaxWidth = (chartWidth / analytics.dailyCalls.length) - barGap;
        const barActualWidth = Math.min(barMaxWidth, 40);
        
        for (let i = 0; i <= 4; i++) {
          const lineY = chartY + (chartHeight * (1 - i/4));
          doc.save()
            .moveTo(leftMargin, lineY)
            .lineTo(leftMargin + chartWidth, lineY)
            .strokeColor(colors.border)
            .lineWidth(0.5)
            .stroke()
            .restore();
          
          const labelValue = Math.round((maxCount * i) / 4);
          doc.fillColor(colors.textMuted)
            .fontSize(8)
            .text(labelValue.toString(), leftMargin - 25, lineY - 4, { width: 20, align: 'right' });
        }
        
        analytics.dailyCalls.forEach((item: { date: string; count: number }, index: number) => {
          const barHeight = (item.count / maxCount) * chartHeight;
          const x = leftMargin + (index * (chartWidth / analytics.dailyCalls.length)) + (barMaxWidth - barActualWidth) / 2;
          const y = chartY + chartHeight - barHeight;
          
          doc.save()
            .roundedRect(x, y, barActualWidth, barHeight, 3)
            .fill(colors.primary);
          doc.restore();
          
          if (analytics.dailyCalls.length <= 14 || index % Math.ceil(analytics.dailyCalls.length / 10) === 0) {
            const dateObj = new Date(item.date);
            const dateStr = timeRange === 'year' 
              ? dateObj.toLocaleDateString('en-US', { month: 'short' })
              : dateObj.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
            
            doc.fillColor(colors.textMuted)
              .fontSize(7)
              .text(dateStr, x - 5, chartY + chartHeight + 5, { width: barActualWidth + 10, align: 'center' });
          }
        });
        
        doc.y = chartY + chartHeight + 30;
      }
      
      // Campaign Performance Table
      if (analytics.campaignPerformance.length > 0) {
        if (doc.y > 650) {
          doc.addPage();
          doc.y = 50;
        }
        
        const sectionY = doc.y;
        
        doc.fillColor(colors.text)
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('Campaign Performance', leftMargin, sectionY);
        
        doc.y = sectionY + 25;
        
        const tableY = doc.y;
        const col1Width = 300;
        const col2Width = pageWidth - col1Width;
        
        doc.save()
          .rect(leftMargin, tableY, pageWidth, 25)
          .fill(colors.background);
        doc.restore();
        
        doc.fillColor(colors.textMuted)
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('CAMPAIGN', leftMargin + 10, tableY + 8)
          .text('SUCCESS RATE', leftMargin + col1Width + 10, tableY + 8);
        
        analytics.campaignPerformance.forEach((item: { name: string; value: number }, index: number) => {
          const rowY = tableY + 25 + (index * 30);
          
          if (index % 2 === 0) {
            doc.save()
              .rect(leftMargin, rowY, pageWidth, 30)
              .fill('#ffffff');
            doc.restore();
          }
          
          doc.save()
            .moveTo(leftMargin, rowY + 30)
            .lineTo(leftMargin + pageWidth, rowY + 30)
            .strokeColor(colors.border)
            .lineWidth(0.5)
            .stroke()
            .restore();
          
          doc.fillColor(colors.text)
            .fontSize(10)
            .font('Helvetica')
            .text(item.name, leftMargin + 10, rowY + 9, { width: col1Width - 20 });
          
          const badgeColor = item.value >= 70 ? colors.success : 
                            item.value >= 40 ? colors.warning : '#ef4444';
          
          doc.save()
            .roundedRect(leftMargin + col1Width + 10, rowY + 5, 60, 20, 10)
            .fill(badgeColor);
          doc.restore();
          
          doc.fillColor('#ffffff')
            .fontSize(10)
            .font('Helvetica-Bold')
            .text(`${item.value}%`, leftMargin + col1Width + 15, rowY + 9, { width: 50, align: 'center' });
        });
        
        doc.y = tableY + 25 + (analytics.campaignPerformance.length * 30) + 20;
      }
      
      // Footer
      const footerY = 800;
      doc.save()
        .rect(0, footerY, 595, 42)
        .fill(colors.background);
      doc.restore();
      
      doc.fillColor(colors.textMuted)
        .fontSize(8)
        .font('Helvetica')
        .text(`${appName} Analytics Report`, leftMargin, footerY + 15, { width: pageWidth / 2 });
      
      doc.text(`Page 1 of 1`, leftMargin + pageWidth - 80, footerY + 15, { width: 80, align: 'right' });
      
      doc.end();
      
    } catch (error: any) {
      console.error("Export analytics PDF error:", error);
      res.status(500).json({ error: "Failed to export analytics PDF" });
    }
  });

  return router;
}
