'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { db } from '../../db';
import { eq } from 'drizzle-orm';
import { elevenLabsCredentials, syncedVoices, users } from '@shared/schema';
import { ElevenLabsPoolService } from '../../services/elevenlabs-pool';
import { VoiceSyncService } from '../../services/voice-sync';
import { z } from 'zod';

export function registerElevenlabsPoolRoutes(router: Router) {
  router.get('/elevenlabs-pool', requireAdminPermission('settings', 'elevenlabs_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const credentials = await ElevenLabsPoolService.getAllWithStats();
      res.json(credentials);
    } catch (error) {
      console.error('Error fetching ElevenLabs pool:', error);
      res.status(500).json({ error: 'Failed to fetch ElevenLabs pool' });
    }
  });

  router.get('/elevenlabs-pool/stats', requireAdminPermission('settings', 'elevenlabs_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const stats = await ElevenLabsPoolService.getPoolStats();
      res.json(stats);
    } catch (error) {
      console.error('Error fetching pool stats:', error);
      res.status(500).json({ error: 'Failed to fetch pool stats' });
    }
  });

  router.post('/elevenlabs-pool', requireAdminPermission('settings', 'elevenlabs_settings', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        apiKey: z.string().min(1),
        webhookSecret: z.string().optional(),
        usageThreshold: z.number().optional(),
        isActive: z.boolean().optional()
      });
      
      const data = schema.parse(req.body);
      
      const credential = await ElevenLabsPoolService.addCredential({
        name: data.name,
        apiKey: data.apiKey,
        webhookSecret: data.webhookSecret || null,
        maxAgentsThreshold: data.usageThreshold || 100,
        isActive: data.isActive !== false
      });
      
      setImmediate(async () => {
        try {
          console.log(`🔊 [Voice Sync] Syncing voices after adding credential: ${data.name}`);
          await VoiceSyncService.syncAllVoices();
          console.log(`🔊 [Voice Sync] Voice sync complete after credential addition`);
        } catch (syncError: any) {
          console.warn(`⚠️ [Voice Sync] Post-credential-add sync failed (non-fatal):`, syncError.message || syncError);
        }
      });
      
      res.json(credential);
    } catch (error: any) {
      console.error('Error adding ElevenLabs credential:', error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to add credential' });
    }
  });

  router.post('/elevenlabs-pool/test', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
      }
      
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': apiKey }
      });
      
      if (response.ok) {
        const userData = await response.json();
        res.json({ success: true, user: userData });
      } else {
        res.json({ success: false, error: 'Invalid API key' });
      }
    } catch (error: any) {
      res.json({ success: false, error: 'Failed to test API key' });
    }
  });

  router.patch('/elevenlabs-pool/:credentialId/deactivate', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId } = req.params;
      await ElevenLabsPoolService.deactivateCredential(credentialId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deactivating credential:', error);
      res.status(500).json({ error: 'Failed to deactivate credential' });
    }
  });

  router.patch('/elevenlabs-pool/:credentialId/activate', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId } = req.params;
      await db.update(elevenLabsCredentials)
        .set({ isActive: true })
        .where(eq(elevenLabsCredentials.id, credentialId));
      res.json({ success: true });
    } catch (error) {
      console.error('Error activating credential:', error);
      res.status(500).json({ error: 'Failed to activate credential' });
    }
  });

  router.delete('/elevenlabs-pool/:credentialId', requireAdminPermission('settings', 'elevenlabs_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId } = req.params;
      const result = await ElevenLabsPoolService.deleteCredential(credentialId);
      
      setImmediate(async () => {
        try {
          console.log(`🔊 [Voice Sync] Syncing voices after removing credential`);
          await VoiceSyncService.syncAllVoices();
          console.log(`🔊 [Voice Sync] Voice sync complete after credential removal`);
        } catch (syncError: any) {
          console.warn(`⚠️ [Voice Sync] Post-credential-remove sync failed (non-fatal):`, syncError.message || syncError);
        }
      });
      
      res.json({ 
        success: true, 
        message: result.autoReassigned
          ? `Credential deleted. ${result.unassignedAgents} agent(s) were automatically reassigned to remaining active credential(s).`
          : result.unassignedAgents > 0
            ? `Credential deleted. ${result.unassignedAgents} agent(s) need a new credential - please add one and click Sync Agents.`
            : 'Credential deleted successfully.',
        unassignedAgents: result.unassignedAgents,
        autoReassigned: result.autoReassigned,
      });
    } catch (error: any) {
      console.error('Error removing credential:', error);
      res.status(500).json({ error: 'Failed to remove credential' });
    }
  });

  router.post('/elevenlabs-pool/health-check', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      await ElevenLabsPoolService.performHealthChecks();
      res.json({ success: true, message: 'Health check completed' });
    } catch (error) {
      console.error('Error running health check:', error);
      res.status(500).json({ error: 'Failed to run health check' });
    }
  });

  router.post('/elevenlabs-pool/sync-agents', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const result = await ElevenLabsPoolService.syncExistingAgents();
      res.json({ 
        success: true, 
        message: result.total > 0 
          ? `Successfully assigned ${result.total} agent(s) to the pool` 
          : 'All agents are already properly assigned',
        ...result
      });
    } catch (error: any) {
      console.error('Error syncing agents:', error);
      res.status(500).json({ error: 'Failed to sync agents' });
    }
  });

  router.get('/elevenlabs-pool/:credentialId/users', requireAdminPermission('settings', 'elevenlabs_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId } = req.params;
      
      const usersOnCredential = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.elevenLabsCredentialId, credentialId));
      
      res.json(usersOnCredential);
    } catch (error) {
      console.error('Error fetching users on credential:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  router.patch('/elevenlabs-pool/:credentialId/threshold', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId } = req.params;
      const { threshold } = req.body;
      
      if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
        return res.status(400).json({ error: 'Threshold must be a number between 0 and 100' });
      }
      
      await db.update(elevenLabsCredentials)
        .set({ maxAgentsThreshold: threshold })
        .where(eq(elevenLabsCredentials.id, credentialId));
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating threshold:', error);
      res.status(500).json({ error: 'Failed to update threshold' });
    }
  });

  router.post('/elevenlabs-pool/migrate-user', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { userId, targetCredentialId } = req.body;
      
      if (!userId || !targetCredentialId) {
        return res.status(400).json({ error: 'User ID and target credential ID are required' });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const credential = await db.select().from(elevenLabsCredentials).where(eq(elevenLabsCredentials.id, targetCredentialId));
      if (credential.length === 0) {
        return res.status(404).json({ error: 'Credential not found' });
      }
      
      await db.update(users)
        .set({ elevenLabsCredentialId: targetCredentialId })
        .where(eq(users.id, userId));
      
      res.json({ success: true, message: 'User migrated successfully' });
    } catch (error: any) {
      console.error('Error migrating user:', error);
      res.status(500).json({ error: 'Failed to migrate user' });
    }
  });

  router.get('/elevenlabs-pool/retry-queue', requireAdminPermission('settings', 'elevenlabs_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      res.json([]);
    } catch (error) {
      console.error('Error fetching retry queue:', error);
      res.status(500).json({ error: 'Failed to fetch retry queue' });
    }
  });

  router.post('/elevenlabs-pool/process-retry-queue', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      res.json({ success: true, message: 'Retry queue processed' });
    } catch (error) {
      console.error('Error processing retry queue:', error);
      res.status(500).json({ error: 'Failed to process retry queue' });
    }
  });

  router.post('/elevenlabs-pool/sync-voice', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { voiceId, credentialId } = req.body;
      
      if (!voiceId || !credentialId) {
        return res.status(400).json({ error: 'Voice ID and credential ID are required' });
      }
      
      const voices = await db.select().from(syncedVoices).where(eq(syncedVoices.voiceId, voiceId));
      const voiceInfo = voices[0];
      if (!voiceInfo?.publicOwnerId) {
        return res.status(400).json({ error: 'Voice metadata not found. Cannot sync without public owner ID.' });
      }
      const credential = await db.select().from(elevenLabsCredentials).where(eq(elevenLabsCredentials.id, credentialId)).limit(1);
      if (!credential[0]) {
        return res.status(404).json({ error: 'Credential not found' });
      }
      await VoiceSyncService.syncVoiceToCredential(voiceId, voiceInfo.publicOwnerId, voiceInfo.voiceName || null, credential[0]);
      
      res.json({ success: true, message: 'Voice synced successfully' });
    } catch (error: any) {
      console.error('Error syncing voice:', error);
      res.status(500).json({ error: 'Failed to sync voice' });
    }
  });

  router.get('/elevenlabs-pool/:credentialId/voices', requireAdminPermission('settings', 'elevenlabs_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { credentialId } = req.params;
      
      const voices = await db
        .select()
        .from(syncedVoices)
        .where(eq(syncedVoices.credentialId, credentialId));
      
      res.json(voices);
    } catch (error) {
      console.error('Error fetching credential voices:', error);
      res.status(500).json({ error: 'Failed to fetch voices' });
    }
  });

  router.get('/elevenlabs-pool/voice-status/:voiceId', requireAdminPermission('settings', 'elevenlabs_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { voiceId } = req.params;
      
      const voices = await db
        .select()
        .from(syncedVoices)
        .where(eq(syncedVoices.voiceId, voiceId));
      
      res.json({ voiceId, syncedTo: voices.map(v => v.credentialId) });
    } catch (error) {
      console.error('Error fetching voice status:', error);
      res.status(500).json({ error: 'Failed to fetch voice status' });
    }
  });

  router.post('/elevenlabs-pool/retry-voice-sync', requireAdminPermission('settings', 'elevenlabs_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { voiceId, credentialId } = req.body;
      
      if (!voiceId || !credentialId) {
        return res.status(400).json({ error: 'Voice ID and credential ID are required' });
      }
      
      const voices = await db.select().from(syncedVoices).where(eq(syncedVoices.voiceId, voiceId));
      const voiceInfo = voices[0];
      await VoiceSyncService.retryFailedSyncs(voiceId, voiceInfo?.publicOwnerId || '', voiceInfo?.voiceName || null);
      
      res.json({ success: true, message: 'Voice sync retry initiated' });
    } catch (error: any) {
      console.error('Error retrying voice sync:', error);
      res.status(500).json({ error: 'Failed to retry voice sync' });
    }
  });
}
