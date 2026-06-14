'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { z } from 'zod';
import { db } from '../../db';
import { eq } from 'drizzle-orm';
import { emailService } from '../../services/email-service';

export function registerUsersRoutes(router: Router) {
  router.get('/users/search', requireAdminPermission('users', 'view_users', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const search = (req.query.search as string || '').toLowerCase().trim();
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
      
      const allUsers = await storage.getAllUsers();
      
      let filteredUsers = allUsers;
      if (search) {
        filteredUsers = allUsers.filter(user => 
          user.email.toLowerCase().includes(search) ||
          (user.name && user.name.toLowerCase().includes(search))
        );
      }
      
      const results = filteredUsers.slice(0, limit).map(user => ({
        id: user.id,
        email: user.email,
        name: user.name || null
      }));
      
      res.json({
        users: results,
        total: filteredUsers.length,
        hasMore: filteredUsers.length > limit
      });
    } catch (error) {
      console.error('Error searching users:', error);
      res.status(500).json({ error: 'Failed to search users' });
    }
  });

  router.get('/users', requireAdminPermission('users', 'view_users', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const pageSize = parseInt(req.query.pageSize as string, 10) || 25;
      const search = (req.query.search as string || '').toLowerCase().trim();
      const offset = (page - 1) * pageSize;

      const allUsers = await storage.getAllUsers();
      
      let filteredUsers = allUsers;
      if (search) {
        filteredUsers = allUsers.filter(user => 
          user.email.toLowerCase().includes(search) ||
          (user.name && user.name.toLowerCase().includes(search))
        );
      }
      
      const totalItems = filteredUsers.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      
      const paginatedUsers = filteredUsers.slice(offset, offset + pageSize);
      
      const usersWithDetails = await Promise.all(paginatedUsers.map(async (user) => {
        const subscription = await storage.getUserSubscription(user.id);
        const plan = user.planType ? await storage.getPlanByName(user.planType) : null;
        
        return {
          ...user,
          subscription,
          plan,
          password: undefined,
          stripeCustomerId: undefined,
          stripeSubscriptionId: undefined
        };
      }));
      
      res.json({
        data: usersWithDetails,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages
        }
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  router.patch('/users/:userId', requireAdminPermission('users', 'edit_users', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { userId } = req.params;
      
      const allPlans = await storage.getAllPlans();
      const validPlanNames = allPlans.map(p => p.name);
      const validPlanNamesLower = validPlanNames.map(n => n.toLowerCase());
      
      const normalizePlanType = (val: string | undefined): string | undefined => {
        if (!val) return val;
        const idx = validPlanNamesLower.indexOf(val.toLowerCase());
        return idx >= 0 ? validPlanNames[idx] : val;
      };
      
      let updateData;
      try {
        const parsed = z.object({
          isActive: z.boolean().optional(),
          planType: z.string().optional().refine(
            (val) => !val || validPlanNamesLower.includes(val.toLowerCase()),
            { message: `Plan must be one of: ${validPlanNames.join(', ')}` }
          ),
          credits: z.number().optional(),
          role: z.enum(['user', 'manager', 'admin']).optional(),
          maxWebhooks: z.number().min(0).max(100).optional()
        }).parse(req.body);
        
        updateData = {
          ...parsed,
          planType: normalizePlanType(parsed.planType)
        };
      } catch (validationError: any) {
        if (validationError.errors) {
          return res.status(400).json({ 
            error: 'Validation failed', 
            details: validationError.errors 
          });
        }
        throw validationError;
      }
      
      const userBeforeUpdate = await storage.getUser(userId);
      if (!userBeforeUpdate) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await storage.updateUser(userId, updateData);
      
      if (updateData.isActive === false && userBeforeUpdate?.isActive === true) {
        try {
          await emailService.sendAccountSuspended(userId, "Account suspended by administrator");
          console.log(`[Admin] Sent suspension email to user ${userId}`);
        } catch (emailError) {
          console.error(`Failed to send suspension email to user ${userId}:`, emailError);
        }
      }
      
      if (updateData.isActive === true && userBeforeUpdate?.isActive === false) {
        try {
          await emailService.sendAccountReactivated(userId);
          console.log(`[Admin] Sent reactivation email to user ${userId}`);
        } catch (emailError) {
          console.error(`Failed to send reactivation email to user ${userId}:`, emailError);
        }
      }
      
      if (updateData.planType) {
        const plan = await storage.getPlanByName(updateData.planType);
        if (plan) {
          const existingSubscription = await storage.getUserSubscription(userId);
          
          if (existingSubscription && existingSubscription.id) {
            await storage.updateUserSubscription(existingSubscription.id, {
              planId: plan.id,
              status: 'active',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
          } else {
            await storage.createUserSubscription({
              userId,
              planId: plan.id,
              status: 'active',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
          }
          
          const oldPlanType = userBeforeUpdate?.planType?.toLowerCase();
          const newPlanType = updateData.planType.toLowerCase();
          const isPaidPlan = plan.monthlyPrice && parseFloat(plan.monthlyPrice.toString()) > 0;
          
          if (isPaidPlan && oldPlanType === 'free') {
            try {
              await emailService.sendMembershipUpgrade(userId, plan.displayName || plan.name);
              console.log(`[Admin] Sent membership upgrade email to user ${userId}`);
            } catch (emailError) {
              console.error(`Failed to send membership upgrade email to user ${userId}:`, emailError);
            }
          }
          
          console.log(`[Admin] User ${userId} plan changed from ${oldPlanType} to ${newPlanType}`);
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  router.post('/users', async (req: AdminRequest, res: Response) => {
    try {
      const bcrypt = await import('bcrypt');
      const { users } = await import('@shared/schema');
      
      const allPlans = await storage.getAllPlans();
      const validPlanNames = allPlans.map(p => p.name);
      const validPlanNamesLower = validPlanNames.map(n => n.toLowerCase());
      const defaultPlan = validPlanNamesLower.includes('free') 
        ? validPlanNames.find(n => n.toLowerCase() === 'free') || 'free'
        : validPlanNames[0] || 'free';
      
      const normalizePlanType = (val: string): string => {
        const idx = validPlanNamesLower.indexOf(val.toLowerCase());
        return idx >= 0 ? validPlanNames[idx] : val;
      };
      
      const createUserSchema = z.object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().min(1),
        role: z.enum(['user', 'manager', 'admin']).default('user'),
        planType: z.string().default(defaultPlan).refine(
          (val) => validPlanNamesLower.includes(val.toLowerCase()),
          { message: `Plan must be one of: ${validPlanNames.join(', ')}` }
        ),
        credits: z.number().min(0).default(0),
        isActive: z.boolean().default(true)
      });
      
      const parsedData = createUserSchema.parse(req.body);
      
      const userData = {
        ...parsedData,
        planType: normalizePlanType(parsedData.planType)
      };
      
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      
      const [newUser] = await db.insert(users).values({
        email: userData.email,
        password: hashedPassword,
        name: userData.name,
        role: userData.role,
        planType: userData.planType,
        credits: userData.credits,
        isActive: userData.isActive,
      }).returning();
      
      const plan = await storage.getPlanByName(userData.planType);
      if (plan) {
        await storage.createUserSubscription({
          userId: newUser.id,
          planId: plan.id,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
      }
      
      console.log(`✅ [Admin] Created new user: ${userData.email}`);
      
      res.status(201).json({ 
        success: true, 
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          planType: newUser.planType,
          credits: newUser.credits,
          isActive: newUser.isActive,
        }
      });
    } catch (error: any) {
      console.error('Error creating user:', error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  router.delete('/users/:userId', async (req: AdminRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const schema = await import('@shared/schema');
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      console.log(`🗑️ [Admin] Starting cascade delete for user: ${user.email} (${userId})`);
      
      const userForms = await db.select({ id: schema.forms.id }).from(schema.forms).where(eq(schema.forms.userId, userId));
      for (const form of userForms) {
        await db.delete(schema.formSubmissions).where(eq(schema.formSubmissions.formId, form.id));
        await db.delete(schema.formFields).where(eq(schema.formFields.formId, form.id));
      }
      await db.delete(schema.forms).where(eq(schema.forms.userId, userId));
      
      await db.delete(schema.appointments).where(eq(schema.appointments.userId, userId));
      await db.delete(schema.appointmentSettings).where(eq(schema.appointmentSettings.userId, userId));
      
      const userWebhooks = await db.select({ id: schema.webhookSubscriptions.id }).from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.userId, userId));
      for (const webhook of userWebhooks) {
        await db.delete(schema.webhookDeliveryLogs).where(eq(schema.webhookDeliveryLogs.webhookId, webhook.id));
      }
      await db.delete(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.userId, userId));
      
      await db.delete(schema.knowledgeProcessingQueue).where(eq(schema.knowledgeProcessingQueue.userId, userId));
      await db.delete(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.userId, userId));
      await db.delete(schema.userKnowledgeStorageLimits).where(eq(schema.userKnowledgeStorageLimits.userId, userId));
      
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.promptTemplates).where(eq(schema.promptTemplates.userId, userId));
      await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
      await db.delete(schema.legacyWebhooks).where(eq(schema.legacyWebhooks.userId, userId));
      await db.delete(schema.usageRecords).where(eq(schema.usageRecords.userId, userId));
      await db.delete(schema.phoneNumberRentals).where(eq(schema.phoneNumberRentals.userId, userId));
      await db.delete(schema.userSubscriptions).where(eq(schema.userSubscriptions.userId, userId));
      await db.delete(schema.tools).where(eq(schema.tools.userId, userId));
      await db.delete(schema.voices).where(eq(schema.voices.userId, userId));
      await db.delete(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId));
      
      const userFlows = await db.select({ id: schema.flows.id }).from(schema.flows).where(eq(schema.flows.userId, userId));
      for (const flow of userFlows) {
        await db.delete(schema.flowExecutions).where(eq(schema.flowExecutions.flowId, flow.id));
      }
      
      await db.delete(schema.calls).where(eq(schema.calls.userId, userId));
      
      const userCampaigns = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.userId, userId));
      for (const campaign of userCampaigns) {
        await db.delete(schema.contacts).where(eq(schema.contacts.campaignId, campaign.id));
      }
      
      await db.delete(schema.campaigns).where(eq(schema.campaigns.userId, userId));
      await db.delete(schema.flows).where(eq(schema.flows.userId, userId));
      await db.delete(schema.incomingConnections).where(eq(schema.incomingConnections.userId, userId));
      await db.delete(schema.phoneNumbers).where(eq(schema.phoneNumbers.userId, userId));
      await db.delete(schema.incomingAgents).where(eq(schema.incomingAgents.userId, userId));
      await db.delete(schema.knowledgeBase).where(eq(schema.knowledgeBase.userId, userId));
      await db.delete(schema.sipCalls).where(eq(schema.sipCalls.userId, userId));
      await db.delete(schema.agents).where(eq(schema.agents.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      
      console.log(`✅ [Admin] Successfully deleted user and all data: ${user.email}`);
      
      res.json({ success: true, message: `User ${user.email} and all associated data have been permanently deleted` });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  router.post('/users/:userId/recover', async (req: AdminRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { users } = await import('@shared/schema');
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await db.update(users)
        .set({ 
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          isActive: true
        })
        .where(eq(users.id, userId));
      
      res.json({ success: true, message: 'User account has been recovered' });
    } catch (error) {
      console.error('Error recovering user:', error);
      res.status(500).json({ error: 'Failed to recover user' });
    }
  });

  router.get('/contacts', async (req: AdminRequest, res: Response) => {
    try {
      const { contacts, campaigns, users: usersTable } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      
      const page = parseInt(req.query.page as string, 10) || 1;
      const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
      const offset = (page - 1) * pageSize;
      
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
      
      const uniqueByPhone = new Map<string, typeof allContacts[0]>();
      for (const contact of allContacts) {
        const phoneKey = contact.phone?.trim().toLowerCase() || '';
        if (phoneKey && !uniqueByPhone.has(phoneKey)) {
          uniqueByPhone.set(phoneKey, contact);
        }
      }
      
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

  router.get('/users/:userId/webhooks', async (req: AdminRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const webhooks = await storage.getUserWebhookSubscriptions(userId);
      res.json(webhooks);
    } catch (error) {
      console.error('Error fetching user webhooks:', error);
      res.status(500).json({ error: 'Failed to fetch webhooks' });
    }
  });

  router.delete('/users/:userId/webhooks/:webhookId', async (req: AdminRequest, res: Response) => {
    try {
      const { userId, webhookId } = req.params;
      
      const webhook = await storage.getWebhookSubscription(webhookId);
      if (!webhook || webhook.userId !== userId) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      await storage.deleteWebhookSubscription(webhookId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting user webhook:', error);
      res.status(500).json({ error: 'Failed to delete webhook' });
    }
  });

  router.post('/users/:id/block', async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await storage.updateUser(id, {
        isActive: false,
        blockedReason: reason || 'Blocked by administrator'
      });
      
      res.json({ success: true, message: 'User blocked successfully' });
    } catch (error) {
      console.error('Error blocking user:', error);
      res.status(500).json({ error: 'Failed to block user' });
    }
  });

  router.post('/users/:id/unblock', async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      await storage.updateUser(id, {
        isActive: true,
        blockedReason: null
      });
      
      res.json({ success: true, message: 'User unblocked successfully' });
    } catch (error) {
      console.error('Error unblocking user:', error);
      res.status(500).json({ error: 'Failed to unblock user' });
    }
  });
}
