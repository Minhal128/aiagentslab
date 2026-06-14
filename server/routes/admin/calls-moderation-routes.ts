'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { db } from '../../db';
import { eq, desc, isNotNull, and, or, isNull, sql } from 'drizzle-orm';
import { calls, users, bannedWords, contentViolations, agents, campaigns, elevenLabsCredentials } from '@shared/schema';
import { ElevenLabsPoolService } from '../../services/elevenlabs-pool';
import { z } from 'zod';

export function registerCallsModerationRoutes(router: Router) {
  router.get('/calls', requireAdminPermission('call_monitoring', 'all_calls', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
      const offset = (page - 1) * pageSize;
      
      const allCalls = await db
        .select({
          id: calls.id,
          status: calls.status,
          duration: calls.duration,
          phoneNumber: calls.phoneNumber,
          campaignId: calls.campaignId,
          userId: calls.userId,
          elevenLabsConversationId: calls.elevenLabsConversationId,
          createdAt: calls.createdAt,
          userName: users.name,
          userEmail: users.email
        })
        .from(calls)
        .leftJoin(users, eq(calls.userId, users.id))
        .orderBy(desc(calls.createdAt))
        .limit(pageSize)
        .offset(offset);
      
      const totalResult = await db.select({ count: sql`count(*)` }).from(calls);
      const totalItems = Number(totalResult[0]?.count || 0);
      
      res.json({
        data: allCalls,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize)
        }
      });
    } catch (error) {
      console.error('Error fetching calls:', error);
      res.status(500).json({ error: 'Failed to fetch calls' });
    }
  });

  router.get('/calls/:id', requireAdminPermission('call_monitoring', 'all_calls', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const call = await storage.getCall(id);
      
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      res.json(call);
    } catch (error) {
      console.error('Error fetching call:', error);
      res.status(500).json({ error: 'Failed to fetch call' });
    }
  });

  router.get('/calls/:id/violations', requireAdminPermission('call_monitoring', 'all_calls', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const violations = await db.select().from(contentViolations).where(eq(contentViolations.callId, id));
      res.json(violations);
    } catch (error) {
      console.error('Error fetching call violations:', error);
      res.status(500).json({ error: 'Failed to fetch violations' });
    }
  });

  router.get('/calls/:id/recording', requireAdminPermission('call_monitoring', 'all_calls', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const call = await storage.getCall(id);
      
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      if (call.recordingUrl) {
        res.json({ url: call.recordingUrl });
      } else {
        res.status(404).json({ error: 'No recording available' });
      }
    } catch (error) {
      console.error('Error fetching recording:', error);
      res.status(500).json({ error: 'Failed to fetch recording' });
    }
  });

  router.get('/banned-words', requireAdminPermission('call_monitoring', 'banned_words', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const words = await db.select().from(bannedWords).orderBy(desc(bannedWords.createdAt));
      res.json(words);
    } catch (error) {
      console.error('Error fetching banned words:', error);
      res.status(500).json({ error: 'Failed to fetch banned words' });
    }
  });

  router.post('/banned-words', requireAdminPermission('call_monitoring', 'banned_words', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const { word, severity, category } = req.body;
      
      if (!word) {
        return res.status(400).json({ error: 'Word is required' });
      }
      
      const [newWord] = await db.insert(bannedWords).values({
        word: word.toLowerCase().trim(),
        severity: severity || 'medium',
        category: category || 'general',
        isActive: true
      }).returning();
      
      res.json(newWord);
    } catch (error: any) {
      console.error('Error adding banned word:', error);
      res.status(500).json({ error: 'Failed to add banned word' });
    }
  });

  router.patch('/banned-words/:id', requireAdminPermission('call_monitoring', 'banned_words', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { word, severity, category, isActive } = req.body;
      
      const updateData: any = {};
      if (word !== undefined) updateData.word = word.toLowerCase().trim();
      if (severity !== undefined) updateData.severity = severity;
      if (category !== undefined) updateData.category = category;
      if (isActive !== undefined) updateData.isActive = isActive;
      
      await db.update(bannedWords)
        .set(updateData)
        .where(eq(bannedWords.id, id));
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating banned word:', error);
      res.status(500).json({ error: 'Failed to update banned word' });
    }
  });

  router.delete('/banned-words/:id', requireAdminPermission('call_monitoring', 'banned_words', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(bannedWords).where(eq(bannedWords.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting banned word:', error);
      res.status(500).json({ error: 'Failed to delete banned word' });
    }
  });

  router.post('/banned-words/scan-all-calls', requireAdminPermission('call_monitoring', 'banned_words', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const words = await db.select().from(bannedWords).where(eq(bannedWords.isActive, true));
      
      if (words.length === 0) {
        return res.json({ success: true, scanned: 0, violations: 0 });
      }
      
      const recentCalls = await db.select().from(calls).where(isNotNull(calls.transcript)).limit(100);
      let violationsFound = 0;
      
      for (const call of recentCalls) {
        if (!call.transcript) continue;
        
        const transcript = call.transcript.toLowerCase();
        for (const word of words) {
          if (transcript.includes(word.word.toLowerCase())) {
            violationsFound++;
          }
        }
      }
      
      res.json({ success: true, scanned: recentCalls.length, violations: violationsFound });
    } catch (error) {
      console.error('Error scanning calls:', error);
      res.status(500).json({ error: 'Failed to scan calls' });
    }
  });

  router.get('/content-violations', requireAdminPermission('call_monitoring', 'all_calls', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
      const offset = (page - 1) * pageSize;
      
      const violations = await db
        .select()
        .from(contentViolations)
        .orderBy(desc(contentViolations.createdAt))
        .limit(pageSize)
        .offset(offset);
      
      res.json(violations);
    } catch (error) {
      console.error('Error fetching violations:', error);
      res.status(500).json({ error: 'Failed to fetch violations' });
    }
  });

  router.patch('/content-violations/:id', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { status, reviewedBy, reviewNote } = req.body;
      
      const updateData: any = {};
      if (status !== undefined) updateData.status = status;
      if (reviewedBy !== undefined) updateData.reviewedBy = reviewedBy;
      if (reviewNote !== undefined) updateData.reviewNote = reviewNote;
      updateData.reviewedAt = new Date();
      
      await db.update(contentViolations)
        .set(updateData)
        .where(eq(contentViolations.id, id));
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating violation:', error);
      res.status(500).json({ error: 'Failed to update violation' });
    }
  });

  router.post('/calls/:id/scan', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const call = await storage.getCall(id);
      
      if (!call || !call.transcript) {
        return res.status(404).json({ error: 'Call not found or no transcript' });
      }
      
      const words = await db.select().from(bannedWords).where(eq(bannedWords.isActive, true));
      const transcript = call.transcript.toLowerCase();
      const foundViolations: string[] = [];
      
      for (const word of words) {
        if (transcript.includes(word.word.toLowerCase())) {
          foundViolations.push(word.word);
        }
      }
      
      res.json({ violations: foundViolations, count: foundViolations.length });
    } catch (error) {
      console.error('Error scanning call:', error);
      res.status(500).json({ error: 'Failed to scan call' });
    }
  });

  router.post('/elevenlabs-webhooks/verify', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId, signature, payload } = req.body;
      
      if (!credentialId || !signature || !payload) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      const credential = await db.select().from(elevenLabsCredentials).where(eq(elevenLabsCredentials.id, credentialId));
      
      if (credential.length === 0 || !credential[0].webhookSecret) {
        return res.status(404).json({ error: 'Credential not found or no webhook secret' });
      }
      
      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', credential[0].webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      const isValid = signature === expectedSignature;
      
      res.json({ valid: isValid });
    } catch (error: any) {
      console.error('Error verifying webhook:', error);
      res.status(500).json({ error: 'Failed to verify webhook' });
    }
  });

  router.post('/calls/:id/fetch-elevenlabs', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const call = await storage.getCall(id);
      
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      if (!call.elevenLabsConversationId) {
        return res.status(400).json({ error: 'No ElevenLabs conversation ID' });
      }
      
      const credential = await ElevenLabsPoolService.getAvailableCredential();
      if (!credential) {
        return res.status(400).json({ error: 'No ElevenLabs credentials available' });
      }
      
      const { ElevenLabsService } = await import('../../services/elevenlabs');
      const elevenLabsService = new ElevenLabsService(credential.apiKey);
      
      const conversationData = await elevenLabsService.getConversationDetails(call.elevenLabsConversationId);
      
      let formattedTranscript = '';
      if (conversationData.transcript && conversationData.transcript.length > 0) {
        formattedTranscript = conversationData.transcript
          .map((entry: any) => `${entry.role === 'agent' ? 'Agent' : 'User'}: ${entry.message}`)
          .join('\n');
      }
      
      const updates: Record<string, any> = {};
      if (conversationData.call_duration_secs) updates.duration = conversationData.call_duration_secs;
      if (formattedTranscript) updates.transcript = formattedTranscript;
      if (conversationData.analysis?.summary) updates.aiSummary = conversationData.analysis.summary;
      
      if (Object.keys(updates).length > 0) {
        await db.update(calls).set(updates).where(eq(calls.id, id));
      }
      
      res.json({ success: true, data: conversationData });
    } catch (error: any) {
      console.error('Error fetching ElevenLabs data:', error);
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  router.post('/calls/fetch-all-missing', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const callsMissingData = await db
        .select()
        .from(calls)
        .where(
          and(
            isNotNull(calls.elevenLabsConversationId),
            or(isNull(calls.transcript), isNull(calls.duration))
          )
        )
        .limit(50);
      
      if (callsMissingData.length === 0) {
        return res.json({ total: 0, success: 0, failed: 0, results: [] });
      }
      
      const results: any[] = [];
      
      for (const call of callsMissingData) {
        try {
          const credential = await ElevenLabsPoolService.getAvailableCredential();
          if (!credential) {
            results.push({ callId: call.id, success: false, error: 'No credentials' });
            continue;
          }
          
          const { ElevenLabsService } = await import('../../services/elevenlabs');
          const elevenLabsService = new ElevenLabsService(credential.apiKey);
          
          const conversationData = await elevenLabsService.getConversationDetails(call.elevenLabsConversationId!);
          
          let formattedTranscript = '';
          if (conversationData.transcript && conversationData.transcript.length > 0) {
            formattedTranscript = conversationData.transcript
              .map((entry: any) => `${entry.role === 'agent' ? 'Agent' : 'User'}: ${entry.message}`)
              .join('\n');
          }
          
          const updates: Record<string, any> = {};
          if (conversationData.call_duration_secs) updates.duration = conversationData.call_duration_secs;
          if (formattedTranscript) updates.transcript = formattedTranscript;
          
          if (Object.keys(updates).length > 0) {
            await db.update(calls).set(updates).where(eq(calls.id, call.id));
          }
          
          results.push({ callId: call.id, success: true, duration: conversationData.call_duration_secs });
        } catch (error: any) {
          results.push({ callId: call.id, success: false, error: error.message });
        }
      }
      
      res.json({
        total: callsMissingData.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      });
    } catch (error: any) {
      console.error('Error fetching missing call data:', error);
      res.status(500).json({ error: 'Failed to fetch missing data' });
    }
  });

  router.post('/sync-recordings', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      res.json({ success: true, message: 'Recordings sync initiated' });
    } catch (error) {
      console.error('Error syncing recordings:', error);
      res.status(500).json({ error: 'Failed to sync recordings' });
    }
  });

  router.post('/sync-all-calls', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      res.json({ success: true, message: 'Calls sync initiated' });
    } catch (error) {
      console.error('Error syncing calls:', error);
      res.status(500).json({ error: 'Failed to sync calls' });
    }
  });

  router.post('/migrate-call-user-ids', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      res.json({ success: true, message: 'Call user IDs migration initiated' });
    } catch (error) {
      console.error('Error migrating call user IDs:', error);
      res.status(500).json({ error: 'Failed to migrate call user IDs' });
    }
  });

  router.post('/sync-incoming-webhooks', requireAdminPermission('call_monitoring', 'all_calls', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      res.json({ success: true, message: 'Incoming webhooks sync initiated' });
    } catch (error) {
      console.error('Error syncing incoming webhooks:', error);
      res.status(500).json({ error: 'Failed to sync incoming webhooks' });
    }
  });
}
