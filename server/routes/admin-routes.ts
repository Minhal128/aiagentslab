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
 * 
 * REFACTORED: This file now uses modular route registration.
 * Individual route modules are located in ./admin/ directory.
 * ============================================================
 */
import { Router, Response } from 'express';
import { checkAdminOrTeamMember, AdminRequest } from '../middleware/admin-auth';
import { storage } from '../storage';
import Stripe from 'stripe';
import {
  getStripeCurrency,
} from '../services/stripe-service';

import {
  registerUsersRoutes,
  registerPlansRoutes,
  registerCreditPackagesRoutes,
  registerSettingsRoutes,
  registerConnectionsRoutes,
  registerWebhooksSetupRoutes,
  registerBrandingRoutes,
  registerSmtpRoutes,
  registerSeoRoutes,
  registerPhoneNumbersRoutes,
  registerElevenlabsPoolRoutes,
  registerCallsModerationRoutes,
  registerSystemUpdateRoutes,
  registerCreditBackfillRoutes,
} from './admin/index';

const router = Router();

router.use(checkAdminOrTeamMember);

registerUsersRoutes(router);
registerPlansRoutes(router);
registerCreditPackagesRoutes(router);
registerSettingsRoutes(router);
registerConnectionsRoutes(router);
registerWebhooksSetupRoutes(router);
registerBrandingRoutes(router);
registerSmtpRoutes(router);
registerSeoRoutes(router);
registerPhoneNumbersRoutes(router);
registerElevenlabsPoolRoutes(router);
registerCallsModerationRoutes(router);
registerSystemUpdateRoutes(router);
registerCreditBackfillRoutes(router);

async function getStripeClient(): Promise<Stripe | null> {
  try {
    const dbSetting = await storage.getGlobalSetting('stripe_secret_key');
    const secretKey = (dbSetting?.value as string) || process.env.STRIPE_SECRET_KEY;
    
    if (!secretKey) {
      return null;
    }
    
    return new Stripe(secretKey, { apiVersion: '2025-10-29.clover' });
  } catch (error) {
    console.error('Error initializing Stripe client:', error);
    return null;
  }
}

async function getDefaultCurrency(): Promise<string> {
  try {
    const currencyConfig = await getStripeCurrency();
    return currencyConfig.currency;
  } catch (error) {
    console.error('Error getting default currency:', error);
    return 'USD';
  }
}

router.get('/analytics', async (req: AdminRequest, res: Response) => {
  try {
    const { timeRange = '30d' } = req.query;
    const analytics = await storage.getGlobalAnalytics(timeRange as string);
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/contacts', async (req: AdminRequest, res: Response) => {
  try {
    const { contacts, campaigns, users: usersTable } = await import('@shared/schema');
    const { db } = await import('../db');
    const { eq, desc } = await import('drizzle-orm');
    
    // Get pagination parameters
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
    const offset = (page - 1) * pageSize;
    
    // Fetch all contacts with campaign and user info, ordered by most recent first
    const allContacts = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        email: contacts.email,
        customFields: contacts.customFields,
        status: contacts.status,
        createdAt: contacts.createdAt,
        campaignId: contacts.campaignId,
        campaignName: campaigns.name,
        userId: campaigns.userId,
        userName: usersTable.name,
        userEmail: usersTable.email,
      })
      .from(contacts)
      .leftJoin(campaigns, eq(contacts.campaignId, campaigns.id))
      .leftJoin(usersTable, eq(campaigns.userId, usersTable.id))
      .orderBy(desc(contacts.createdAt));
    
    // Deduplicate by phone number, keeping the most recent record
    const uniqueByPhone = new Map<string, typeof allContacts[0]>();
    for (const contact of allContacts) {
      const phoneKey = contact.phone?.trim().toLowerCase() || '';
      if (phoneKey && !uniqueByPhone.has(phoneKey)) {
        uniqueByPhone.set(phoneKey, contact);
      }
    }
    
    // Convert back to array and sort by createdAt desc
    const uniqueContacts = Array.from(uniqueByPhone.values())
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
    
    const totalItems = uniqueContacts.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const paginatedContacts = uniqueContacts.slice(offset, offset + pageSize);
    
    res.json({
      data: paginatedContacts,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching admin contacts:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

export const adminRouter = router;
export default router;
