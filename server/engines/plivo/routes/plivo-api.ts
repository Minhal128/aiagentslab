'use strict';
/**
 * ============================================================
 * Plivo + OpenAI Engine API Routes
 * 
 * Provides endpoints for:
 * - OpenAI voices list
 * - Model tier configuration
 * - OpenAI credential pool management (admin)
 * - Plivo credential management (admin)
 * ============================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import { OPENAI_VOICES, MODEL_TIER_CONFIG } from '../types';
import type { ModelTier } from '../types';
import { OpenAIPoolService } from '../services/openai-pool.service';
import { PlivoPhoneService } from '../services/plivo-phone.service';
import { db } from '../../../db';
import { plivoCredentials, plivoPhonePricing, openaiCredentials } from '@shared/schema';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDomain } from '../../../utils/domain';
import { checkAdminOrTeamMember, requireAdminPermission, AdminRequest } from '../../../middleware/admin-auth';

interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  isAdmin?: boolean;
  adminTeamMember?: {
    memberId: string;
    teamId: string;
    roleId: string;
    roleName: string;
    email: string;
  };
}

// Middleware to check if user is authenticated
const requireAuth = (req: AuthRequest, res: Response, next: Function) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Middleware to check if user is admin or team member with proper permissions
// Uses checkAdminOrTeamMember for authentication + requireAdminPermission for authorization
const requireAdminAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Use the shared middleware
  await checkAdminOrTeamMember(req as AdminRequest, res, next);
};

export function createPlivoApiRoutes(): Router {
  const router = Router();

  // ============================================================
  // PUBLIC ENDPOINTS (authenticated users)
  // ============================================================

  /**
   * GET /api/plivo/openai/voices
   * Returns list of available OpenAI voices for agent configuration
   */
  router.get('/api/plivo/openai/voices', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      res.json({
        voices: OPENAI_VOICES,
        count: OPENAI_VOICES.length,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error fetching voices:', error);
      res.status(500).json({ error: 'Failed to fetch voices' });
    }
  });

  /**
   * GET /api/plivo/openai/models
   * Returns available models based on user's subscription tier
   */
  router.get('/api/plivo/openai/models', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      // Get user's subscription to determine tier
      const { users } = await import('@shared/schema');
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.userId!))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const tier = OpenAIPoolService.getModelTierForUser(user.planType);
      const models = OpenAIPoolService.getModelsForTier(tier);
      const tierConfig = MODEL_TIER_CONFIG[tier];

      res.json({
        tier,
        models,
        description: tierConfig.description,
        allTiers: MODEL_TIER_CONFIG,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error fetching models:', error);
      res.status(500).json({ error: 'Failed to fetch models' });
    }
  });

  /**
   * GET /api/plivo/openai/models/:tier
   * Returns models for a specific tier
   */
  router.get('/api/plivo/openai/models/:tier', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const tier = req.params.tier as ModelTier;
      
      if (!MODEL_TIER_CONFIG[tier]) {
        return res.status(400).json({ error: 'Invalid tier. Use "free" or "pro"' });
      }

      const models = OpenAIPoolService.getModelsForTier(tier);
      const tierConfig = MODEL_TIER_CONFIG[tier];

      res.json({
        tier,
        models,
        description: tierConfig.description,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error fetching models for tier:', error);
      res.status(500).json({ error: 'Failed to fetch models' });
    }
  });

  // ============================================================
  // ADMIN ENDPOINTS - OpenAI Pool Management
  // ============================================================

  /**
   * GET /api/plivo/admin/openai/pool/stats
   * Returns OpenAI pool statistics (admin only)
   */
  router.get('/api/plivo/admin/openai/pool/stats', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const stats = await OpenAIPoolService.getPoolStats();
      res.json(stats);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching pool stats:', error);
      res.status(500).json({ error: 'Failed to fetch pool stats' });
    }
  });

  /**
   * GET /api/plivo/admin/openai/credentials
   * Returns all OpenAI credentials (without API keys)
   */
  router.get('/api/plivo/admin/openai/credentials', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const credentials = await OpenAIPoolService.getAllWithStats();
      res.json(credentials);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching credentials:', error);
      res.status(500).json({ error: 'Failed to fetch credentials' });
    }
  });

  /**
   * POST /api/plivo/admin/openai/credentials
   * Add a new OpenAI credential to the pool
   */
  router.post('/api/plivo/admin/openai/credentials', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'create'), async (req: AuthRequest, res: Response) => {
    try {
      const { name, apiKey, modelTier, maxConcurrency, maxAgentsThreshold } = req.body;

      if (!name || !apiKey) {
        return res.status(400).json({ error: 'Name and API key are required' });
      }

      const credential = await OpenAIPoolService.addCredential({
        name,
        apiKey,
        modelTier: modelTier || 'free',
        maxConcurrency: maxConcurrency || 50,
        maxAgentsThreshold: maxAgentsThreshold || 100,
        isActive: true,
        healthStatus: 'healthy',
      });

      // Return without API key
      const { apiKey: _, ...safeCredential } = credential;
      res.status(201).json(safeCredential);
    } catch (error: any) {
      console.error('[Plivo API] Error adding credential:', error);
      res.status(500).json({ error: 'Failed to add credential' });
    }
  });

  /**
   * PATCH /api/plivo/admin/openai/credentials/:id
   * Update an OpenAI credential
   */
  router.patch('/api/plivo/admin/openai/credentials/:id', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { name, modelTier, maxConcurrency, maxAgentsThreshold, isActive } = req.body;

      const updated = await OpenAIPoolService.updateCredential(id, {
        name,
        modelTier,
        maxConcurrency,
        maxAgentsThreshold,
        isActive,
      });

      const { apiKey: _, ...safeCredential } = updated;
      res.json(safeCredential);
    } catch (error: any) {
      console.error('[Plivo API] Error updating credential:', error);
      res.status(500).json({ error: 'Failed to update credential' });
    }
  });

  /**
   * DELETE /api/plivo/admin/openai/credentials/:id
   * Delete an OpenAI credential
   */
  router.delete('/api/plivo/admin/openai/credentials/:id', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'delete'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await OpenAIPoolService.deleteCredential(id);
      res.json({ success: true, message: 'Credential deleted' });
    } catch (error: any) {
      console.error('[Plivo API] Error deleting credential:', error);
      res.status(500).json({ error: 'Failed to delete credential' });
    }
  });

  /**
   * POST /api/plivo/admin/openai/credentials/:id/activate
   * Activate an OpenAI credential
   */
  router.post('/api/plivo/admin/openai/credentials/:id/activate', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await OpenAIPoolService.activateCredential(id);
      res.json({ success: true, message: 'Credential activated' });
    } catch (error: any) {
      console.error('[Plivo API] Error activating credential:', error);
      res.status(500).json({ error: 'Failed to activate credential' });
    }
  });

  /**
   * POST /api/plivo/admin/openai/credentials/:id/deactivate
   * Deactivate an OpenAI credential
   */
  router.post('/api/plivo/admin/openai/credentials/:id/deactivate', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await OpenAIPoolService.deactivateCredential(id);
      res.json({ success: true, message: 'Credential deactivated' });
    } catch (error: any) {
      console.error('[Plivo API] Error deactivating credential:', error);
      res.status(500).json({ error: 'Failed to deactivate credential' });
    }
  });

  /**
   * POST /api/plivo/admin/openai/pool/health-check
   * Trigger health checks on all credentials
   */
  router.post('/api/plivo/admin/openai/pool/health-check', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      await OpenAIPoolService.performHealthChecks();
      const stats = await OpenAIPoolService.getPoolStats();
      res.json({ success: true, message: 'Health checks completed', stats });
    } catch (error: any) {
      console.error('[Plivo API] Error performing health checks:', error);
      res.status(500).json({ error: 'Failed to perform health checks' });
    }
  });

  /**
   * POST /api/plivo/admin/openai/pool/recalculate
   * Recalculate agent counts for all credentials
   */
  router.post('/api/plivo/admin/openai/pool/recalculate', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const result = await OpenAIPoolService.recalculateAgentCounts();
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[Plivo API] Error recalculating counts:', error);
      res.status(500).json({ error: 'Failed to recalculate counts' });
    }
  });

  // ============================================================
  // ADMIN ENDPOINTS - Plivo Credentials
  // ============================================================

  /**
   * GET /api/plivo/admin/credentials
   * Returns all Plivo credentials (without auth tokens)
   */
  router.get('/api/plivo/admin/credentials', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const credentials = await db
        .select({
          id: plivoCredentials.id,
          name: plivoCredentials.name,
          authId: plivoCredentials.authId,
          isActive: plivoCredentials.isActive,
          isPrimary: plivoCredentials.isPrimary,
          metadata: plivoCredentials.metadata,
          createdAt: plivoCredentials.createdAt,
          updatedAt: plivoCredentials.updatedAt,
        })
        .from(plivoCredentials)
        .orderBy(desc(plivoCredentials.createdAt));

      res.json(credentials);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching Plivo credentials:', error);
      res.status(500).json({ error: 'Failed to fetch Plivo credentials' });
    }
  });

  /**
   * POST /api/plivo/admin/credentials
   * Add a new Plivo credential
   */
  router.post('/api/plivo/admin/credentials', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'create'), async (req: AuthRequest, res: Response) => {
    try {
      const { name, authId, authToken, isPrimary } = req.body;

      if (!name || !authId || !authToken) {
        return res.status(400).json({ error: 'Name, Auth ID, and Auth Token are required' });
      }

      // If setting as primary, unset other primaries first
      if (isPrimary) {
        await db
          .update(plivoCredentials)
          .set({ isPrimary: false, updatedAt: new Date() });
      }

      const [credential] = await db
        .insert(plivoCredentials)
        .values({
          name,
          authId,
          authToken,
          isPrimary: isPrimary || false,
          isActive: true,
        })
        .returning();

      // Return without auth token
      const { authToken: _, ...safeCredential } = credential;
      res.status(201).json(safeCredential);
    } catch (error: any) {
      console.error('[Plivo API] Error adding Plivo credential:', error);
      res.status(500).json({ error: 'Failed to add Plivo credential' });
    }
  });

  /**
   * PATCH /api/plivo/admin/credentials/:id
   * Update a Plivo credential
   */
  router.patch('/api/plivo/admin/credentials/:id', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { name, isPrimary, isActive } = req.body;

      // If setting as primary, unset other primaries first
      if (isPrimary === true) {
        await db
          .update(plivoCredentials)
          .set({ isPrimary: false, updatedAt: new Date() });
      }

      const [updated] = await db
        .update(plivoCredentials)
        .set({
          ...(name !== undefined && { name }),
          ...(isPrimary !== undefined && { isPrimary }),
          ...(isActive !== undefined && { isActive }),
          updatedAt: new Date(),
        })
        .where(eq(plivoCredentials.id, id))
        .returning();

      // Return without auth token
      const { authToken: _, ...safeCredential } = updated;
      res.json(safeCredential);
    } catch (error: any) {
      console.error('[Plivo API] Error updating Plivo credential:', error);
      res.status(500).json({ error: 'Failed to update Plivo credential' });
    }
  });

  /**
   * DELETE /api/plivo/admin/credentials/:id
   * Delete a Plivo credential
   */
  router.delete('/api/plivo/admin/credentials/:id', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'delete'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(plivoCredentials).where(eq(plivoCredentials.id, id));
      res.json({ success: true, message: 'Plivo credential deleted' });
    } catch (error: any) {
      console.error('[Plivo API] Error deleting Plivo credential:', error);
      res.status(500).json({ error: 'Failed to delete Plivo credential' });
    }
  });

  // ============================================================
  // ADMIN ENDPOINTS - Phone Pricing
  // ============================================================

  /**
   * GET /api/plivo/admin/phone-pricing
   * Returns all phone pricing configurations
   */
  router.get('/api/plivo/admin/phone-pricing', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const pricing = await db
        .select()
        .from(plivoPhonePricing)
        .orderBy(plivoPhonePricing.countryName);

      res.json(pricing);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching phone pricing:', error);
      res.status(500).json({ error: 'Failed to fetch phone pricing' });
    }
  });

  /**
   * POST /api/plivo/admin/phone-pricing
   * Add phone pricing for a country
   */
  router.post('/api/plivo/admin/phone-pricing', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'create'), async (req: AuthRequest, res: Response) => {
    try {
      const { countryCode, countryName, purchaseCredits, monthlyCredits, kycRequired } = req.body;

      if (!countryCode || !countryName) {
        return res.status(400).json({ error: 'Country code and name are required' });
      }

      const [pricing] = await db
        .insert(plivoPhonePricing)
        .values({
          countryCode,
          countryName,
          purchaseCredits: purchaseCredits || 0,
          monthlyCredits: monthlyCredits || 0,
          kycRequired: kycRequired || false,
          isActive: true,
        })
        .returning();

      res.status(201).json(pricing);
    } catch (error: any) {
      console.error('[Plivo API] Error adding phone pricing:', error);
      res.status(500).json({ error: 'Failed to add phone pricing' });
    }
  });

  /**
   * PATCH /api/plivo/admin/phone-pricing/:id
   * Update phone pricing
   */
  router.patch('/api/plivo/admin/phone-pricing/:id', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { purchaseCredits, monthlyCredits, kycRequired, isActive } = req.body;

      const [updated] = await db
        .update(plivoPhonePricing)
        .set({
          purchaseCredits,
          monthlyCredits,
          kycRequired,
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(plivoPhonePricing.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error('[Plivo API] Error updating phone pricing:', error);
      res.status(500).json({ error: 'Failed to update phone pricing' });
    }
  });

  /**
   * DELETE /api/plivo/admin/phone-pricing/:id
   * Delete phone pricing
   */
  router.delete('/api/plivo/admin/phone-pricing/:id', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'delete'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await db.delete(plivoPhonePricing).where(eq(plivoPhonePricing.id, id));
      res.json({ success: true, message: 'Phone pricing deleted' });
    } catch (error: any) {
      console.error('[Plivo API] Error deleting phone pricing:', error);
      res.status(500).json({ error: 'Failed to delete phone pricing' });
    }
  });

  // ============================================================
  // ADMIN ENDPOINTS - Phone Number Sync
  // ============================================================

  /**
   * POST /api/plivo/admin/sync-numbers
   * Sync phone numbers from Plivo API to local database
   * Numbers can be assigned to users or kept as system pool
   */
  router.post('/api/plivo/admin/sync-numbers', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const result = await PlivoPhoneService.syncAccountNumbers();
      
      res.json({
        success: true,
        message: `Synced: ${result.imported} imported, ${result.updated} updated, ${result.removed} removed, ${result.skipped} unchanged`,
        imported: result.imported,
        updated: result.updated,
        removed: result.removed,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error syncing phone numbers:', error);
      res.status(500).json({ error: 'Failed to sync phone numbers' });
    }
  });

  /**
   * GET /api/plivo/admin/phone-numbers
   * List all Plivo phone numbers in the system (admin view)
   */
  router.get('/api/plivo/admin/phone-numbers', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const numbers = await PlivoPhoneService.getAllNumbers();
      res.json(numbers);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching all phone numbers:', error);
      res.status(500).json({ error: 'Failed to fetch phone numbers' });
    }
  });

  /**
   * PATCH /api/plivo/admin/phone-numbers/:id/assign
   * Assign a phone number to a user or mark as system pool
   */
  router.patch('/api/plivo/admin/phone-numbers/:id/assign', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, isSystemPool } = req.body;

      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const updated = await PlivoPhoneService.assignNumberToUser(id, userId, isSystemPool);
      
      res.json(updated);
    } catch (error: any) {
      console.error('[Plivo API] Error assigning phone number:', error);
      res.status(500).json({ error: 'Failed to assign phone number' });
    }
  });

  // ============================================================
  // USER ENDPOINTS - Phone Number Management
  // ============================================================

  /**
   * GET /api/plivo/phone-numbers
   * List user's Plivo phone numbers
   */
  router.get('/api/plivo/phone-numbers', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const numbers = await PlivoPhoneService.getUserNumbers(req.userId!);
      res.json(numbers);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching user phone numbers:', error);
      res.status(500).json({ error: 'Failed to fetch phone numbers' });
    }
  });

  /**
   * GET /api/plivo/phone-numbers/search
   * Search available phone numbers from Plivo
   * Query params: country (required), region, type (local/toll_free/national), pattern, limit
   */
  router.get('/api/plivo/phone-numbers/search', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { country, region, type, pattern, limit } = req.query;

      if (!country || typeof country !== 'string') {
        return res.status(400).json({ error: 'Country code is required' });
      }

      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const numbers = await PlivoPhoneService.searchAvailableNumbers({
        countryCode: country,
        region: region as string | undefined,
        type: type as 'local' | 'toll_free' | 'national' | undefined,
        pattern: pattern as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 20,
      });

      // Also get pricing info for this country
      const pricing = await PlivoPhoneService.getAdminPricing(country);

      res.json({
        numbers,
        pricing: pricing || null,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error searching phone numbers:', error);
      res.status(500).json({ error: 'Failed to search phone numbers' });
    }
  });

  /**
   * GET /api/plivo/phone-numbers/pricing/:countryCode
   * Get pricing for a specific country
   */
  router.get('/api/plivo/phone-numbers/pricing/:countryCode', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { countryCode } = req.params;
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const pricing = await PlivoPhoneService.getAdminPricing(countryCode);

      if (!pricing) {
        return res.status(404).json({ error: 'Pricing not configured for this country' });
      }

      res.json(pricing);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching pricing:', error);
      res.status(500).json({ error: 'Failed to fetch pricing' });
    }
  });

  /**
   * GET /api/plivo/phone-numbers/countries
   * Get all available countries with pricing (active only)
   */
  router.get('/api/plivo/phone-numbers/countries', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const pricing = await db
        .select()
        .from(plivoPhonePricing)
        .where(eq(plivoPhonePricing.isActive, true))
        .orderBy(plivoPhonePricing.countryName);

      res.json(pricing);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  /**
   * POST /api/plivo/phone-numbers/purchase
   * Purchase a phone number
   */
  router.post('/api/plivo/phone-numbers/purchase', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { phoneNumber, country, region, numberType } = req.body;

      if (!phoneNumber || !country) {
        return res.status(400).json({ error: 'Phone number and country are required' });
      }

      // KYC Verification Check for Plivo
      const { globalSettings } = await import('@shared/schema');
      const plivoKycSetting = await db
        .select()
        .from(globalSettings)
        .where(eq(globalSettings.key, 'plivo_kyc_required'))
        .limit(1);
      
      const plivoKycRequired = plivoKycSetting[0]?.value === true || plivoKycSetting[0]?.value === 'true';
      
      if (plivoKycRequired) {
        const { KycService } = await import('../../kyc/services/kyc.service');
        const kycStatus = await KycService.getUserKycStatus(req.userId!);
        
        if (kycStatus.status !== 'approved') {
          return res.status(403).json({
            error: "KYC verification required",
            message: "You must complete KYC verification before purchasing Plivo phone numbers. Please upload your documents in Settings.",
            kycRequired: true,
            kycStatus: kycStatus.status
          });
        }
      }

      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const result = await PlivoPhoneService.purchaseNumber({
        userId: req.userId!,
        phoneNumber,
        country,
        region,
        numberType,
      });

      res.status(201).json(result);
    } catch (error: any) {
      console.error('[Plivo API] Error purchasing phone number:', error);
      res.status(400).json({ error: 'Failed to purchase phone number' });
    }
  });

  /**
   * DELETE /api/plivo/phone-numbers/:id
   * Release a phone number
   */
  router.delete('/api/plivo/phone-numbers/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      // Verify ownership
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const phoneNumber = await PlivoPhoneService.getPhoneNumberById(id);

      if (!phoneNumber) {
        return res.status(404).json({ error: 'Phone number not found' });
      }

      if (phoneNumber.userId !== req.userId) {
        return res.status(403).json({ error: 'Not authorized to release this number' });
      }

      await PlivoPhoneService.releaseNumber(id);
      res.json({ success: true, message: 'Phone number released' });
    } catch (error: any) {
      console.error('[Plivo API] Error releasing phone number:', error);
      res.status(500).json({ error: 'Failed to release phone number' });
    }
  });

  // ============================================================
  // ADMIN ENDPOINTS - Phone Number Sync
  // ============================================================

  /**
   * GET /api/plivo/admin/phone-numbers/account
   * List all phone numbers in the Plivo account (admin only)
   */
  router.get('/api/plivo/admin/phone-numbers/account', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const result = await PlivoPhoneService.listAccountNumbers();
      res.json(result);
    } catch (error: any) {
      console.error('[Plivo API] Error listing account numbers:', error);
      res.status(500).json({ error: 'Failed to list account numbers' });
    }
  });

  /**
   * POST /api/plivo/admin/phone-numbers/sync
   * Sync Plivo account numbers to database (admin only)
   */
  router.post('/api/plivo/admin/phone-numbers/sync', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'update'), async (req: AuthRequest, res: Response) => {
    try {
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const result = await PlivoPhoneService.syncAccountNumbers();
      res.json({
        success: true,
        message: `Synced: ${result.imported} imported, ${result.updated} updated, ${result.removed} removed, ${result.skipped} unchanged`,
        ...result,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error syncing account numbers:', error);
      res.status(500).json({ error: 'Failed to sync account numbers' });
    }
  });

  /**
   * GET /api/plivo/admin/phone-numbers/stats
   * Get phone number statistics (admin only)
   */
  router.get('/api/plivo/admin/phone-numbers/stats', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'read'), async (req: AuthRequest, res: Response) => {
    try {
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      const stats = await PlivoPhoneService.getPhoneStats();
      res.json(stats);
    } catch (error: any) {
      console.error('[Plivo API] Error fetching phone stats:', error);
      res.status(500).json({ error: 'Failed to fetch phone stats' });
    }
  });

  /**
   * DELETE /api/plivo/admin/phone-numbers/:id/unrent
   * Unrent a phone number from Plivo (admin only)
   */
  router.delete('/api/plivo/admin/phone-numbers/:id/unrent', requireAdminAuth, requireAdminPermission('integrations', 'plivo_settings', 'delete'), async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { PlivoPhoneService } = await import('../services/plivo-phone.service');
      await PlivoPhoneService.unrentNumber(id);
      res.json({ success: true, message: 'Phone number unrented successfully' });
    } catch (error: any) {
      console.error('[Plivo API] Error unrenting phone number:', error);
      res.status(500).json({ error: 'Failed to unrent phone number' });
    }
  });

  // ============================================================
  // USER ENDPOINTS - Plivo Incoming Connections
  // ============================================================

  /**
   * GET /api/plivo/incoming-connections
   * List user's Plivo phone numbers with assigned agent info for incoming call routing
   */
  router.get('/api/plivo/incoming-connections', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { plivoPhoneNumbers, agents, campaigns } = await import('@shared/schema');
      const { and, inArray, isNull } = await import('drizzle-orm');
      
      // Get user's Plivo phone numbers with their assigned agents
      const phoneNumbers = await db
        .select({
          id: plivoPhoneNumbers.id,
          phoneNumber: plivoPhoneNumbers.phoneNumber,
          friendlyName: plivoPhoneNumbers.friendlyName,
          country: plivoPhoneNumbers.country,
          region: plivoPhoneNumbers.region,
          status: plivoPhoneNumbers.status,
          assignedAgentId: plivoPhoneNumbers.assignedAgentId,
        })
        .from(plivoPhoneNumbers)
        .where(
          and(
            eq(plivoPhoneNumbers.userId, req.userId!),
            inArray(plivoPhoneNumbers.status, ['active', 'assigned'])
          )
        );

      // Get assigned agent details
      const assignedAgentIds = phoneNumbers
        .filter(pn => pn.assignedAgentId)
        .map(pn => pn.assignedAgentId!);
      
      const assignedAgents = assignedAgentIds.length > 0 
        ? await db
            .select({
              id: agents.id,
              name: agents.name,
              type: agents.type,
              telephonyProvider: agents.telephonyProvider,
            })
            .from(agents)
            .where(inArray(agents.id, assignedAgentIds))
        : [];

      const agentMap = new Map(assignedAgents.map(a => [a.id, a]));

      // Get available Plivo agents (telephonyProvider = 'plivo' and type = 'incoming' only)
      // Flow agents should not appear in incoming connections dropdown
      const availableAgents = await db
        .select({
          id: agents.id,
          name: agents.name,
          type: agents.type,
          telephonyProvider: agents.telephonyProvider,
        })
        .from(agents)
        .where(
          and(
            eq(agents.userId, req.userId!),
            eq(agents.telephonyProvider, 'plivo'),
            eq(agents.type, 'incoming'),
            eq(agents.isActive, true)
          )
        );

      // Check which phones have active campaign conflicts
      const activeStatuses = ['pending', 'running', 'scheduled', 'paused'];
      const phoneIdsToCheck = phoneNumbers.filter(pn => !pn.assignedAgentId).map(pn => pn.id);
      
      const activeCampaigns = phoneIdsToCheck.length > 0 ? await db
        .select({
          phoneNumberId: campaigns.phoneNumberId,
          campaignName: campaigns.name,
          campaignStatus: campaigns.status,
        })
        .from(campaigns)
        .where(
          and(
            inArray(campaigns.phoneNumberId, phoneIdsToCheck),
            inArray(campaigns.status, activeStatuses),
            isNull(campaigns.deletedAt)
          )
        ) : [];

      const conflictMap = new Map<string, { campaignName: string; campaignStatus: string }>();
      for (const campaign of activeCampaigns) {
        if (campaign.phoneNumberId && !conflictMap.has(campaign.phoneNumberId)) {
          conflictMap.set(campaign.phoneNumberId, {
            campaignName: campaign.campaignName,
            campaignStatus: campaign.campaignStatus,
          });
        }
      }

      // Format response
      const connections = phoneNumbers
        .filter(pn => pn.assignedAgentId)
        .map(pn => ({
          phoneNumberId: pn.id,
          phoneNumber: pn.phoneNumber,
          friendlyName: pn.friendlyName,
          country: pn.country,
          agent: agentMap.get(pn.assignedAgentId!) || null,
        }));

      const availablePhoneNumbers = phoneNumbers
        .filter(pn => !pn.assignedAgentId)
        .map(pn => {
          const conflict = conflictMap.get(pn.id);
          return {
            id: pn.id,
            phoneNumber: pn.phoneNumber,
            friendlyName: pn.friendlyName,
            country: pn.country,
            region: pn.region,
            isConflicted: !!conflict,
            conflictReason: conflict 
              ? `Used by campaign "${conflict.campaignName}" (${conflict.campaignStatus})`
              : null,
          };
        });

      res.json({
        connections,
        availablePhoneNumbers,
        availableAgents,
        stats: {
          totalConnections: connections.length,
          availableNumbers: availablePhoneNumbers.filter(pn => !pn.isConflicted).length,
          totalAgents: availableAgents.length,
        },
      });
    } catch (error: any) {
      console.error('[Plivo API] Error fetching incoming connections:', error);
      res.status(500).json({ error: 'Failed to fetch incoming connections' });
    }
  });

  /**
   * POST /api/plivo/incoming-connections
   * Assign an agent to a Plivo phone number for incoming call routing
   */
  router.post('/api/plivo/incoming-connections', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { phoneNumberId, agentId } = req.body;
      const { plivoPhoneNumbers, agents } = await import('@shared/schema');
      const { and } = await import('drizzle-orm');

      if (!phoneNumberId || !agentId) {
        return res.status(400).json({ error: 'Phone number ID and agent ID are required' });
      }

      // Verify phone number belongs to user
      const [phoneNumber] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(
          and(
            eq(plivoPhoneNumbers.id, phoneNumberId),
            eq(plivoPhoneNumbers.userId, req.userId!)
          )
        )
        .limit(1);

      if (!phoneNumber) {
        return res.status(404).json({ error: 'Phone number not found' });
      }

      if (phoneNumber.assignedAgentId) {
        return res.status(400).json({ error: 'Phone number already has an assigned agent' });
      }

      // Verify agent belongs to user and is Plivo-based
      const [agent] = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.userId, req.userId!),
            eq(agents.telephonyProvider, 'plivo')
          )
        )
        .limit(1);

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found or not configured for Plivo' });
      }

      // Assign agent to phone number
      await db
        .update(plivoPhoneNumbers)
        .set({ 
          assignedAgentId: agentId,
          updatedAt: new Date(),
        })
        .where(eq(plivoPhoneNumbers.id, phoneNumberId));

      console.log(`[Plivo API] Assigned agent ${agentId} to phone number ${phoneNumber.phoneNumber}`);

      // Configure Plivo webhooks to route incoming calls to our endpoint
      try {
        const domain = getDomain();
        // Ensure we have a full URL with protocol
        const baseUrl = domain.startsWith('http://') || domain.startsWith('https://') 
          ? domain 
          : `https://${domain}`;
        
        await PlivoPhoneService.configureWebhooks(phoneNumberId, baseUrl);
        console.log(`[Plivo API] Webhooks configured for incoming calls on ${phoneNumber.phoneNumber}`);
      } catch (webhookError: any) {
        console.error(`[Plivo API] Failed to configure webhooks:`, webhookError.message);
        // Continue anyway - agent is assigned, but webhooks may need manual config
      }

      res.json({
        success: true,
        message: 'Agent assigned to phone number successfully',
        phoneNumberId,
        agentId,
        agentName: agent.name,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error assigning agent to phone number:', error);
      res.status(500).json({ error: 'Failed to assign agent' });
    }
  });

  /**
   * DELETE /api/plivo/incoming-connections/:phoneNumberId
   * Unassign agent from a Plivo phone number
   */
  router.delete('/api/plivo/incoming-connections/:phoneNumberId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { phoneNumberId } = req.params;
      const { plivoPhoneNumbers } = await import('@shared/schema');
      const { and } = await import('drizzle-orm');

      // Verify phone number belongs to user
      const [phoneNumber] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(
          and(
            eq(plivoPhoneNumbers.id, phoneNumberId),
            eq(plivoPhoneNumbers.userId, req.userId!)
          )
        )
        .limit(1);

      if (!phoneNumber) {
        return res.status(404).json({ error: 'Phone number not found' });
      }

      if (!phoneNumber.assignedAgentId) {
        return res.status(400).json({ error: 'Phone number has no assigned agent' });
      }

      // Clear webhooks from Plivo
      try {
        await PlivoPhoneService.clearWebhooks(phoneNumberId);
        console.log(`[Plivo API] Webhooks cleared for ${phoneNumber.phoneNumber}`);
      } catch (webhookError: any) {
        console.error(`[Plivo API] Failed to clear webhooks:`, webhookError.message);
        // Continue anyway - agent will still be unassigned
      }

      // Remove agent assignment
      await db
        .update(plivoPhoneNumbers)
        .set({ 
          assignedAgentId: null,
          updatedAt: new Date(),
        })
        .where(eq(plivoPhoneNumbers.id, phoneNumberId));

      console.log(`[Plivo API] Unassigned agent from phone number ${phoneNumber.phoneNumber}`);

      res.json({
        success: true,
        message: 'Agent unassigned from phone number successfully',
        phoneNumberId,
      });
    } catch (error: any) {
      console.error('[Plivo API] Error unassigning agent from phone number:', error);
      res.status(500).json({ error: 'Failed to unassign agent' });
    }
  });

  return router;
}
