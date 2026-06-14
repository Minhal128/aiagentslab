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
import { db } from "./db";
import { nanoid } from "nanoid";
import { 
  users, agents, knowledgeBase, campaigns, contacts, calls, 
  creditTransactions, tools, voices, plans, userSubscriptions,
  phoneNumbers, usageRecords, globalSettings, creditPackages,
  webhookSubscriptions, webhookDeliveryLogs, phoneNumberRentals, notifications,
  incomingConnections, emailTemplates, appointments, forms, formSubmissions,
  promptTemplates, agentVersions, seoSettings, analyticsScripts,
  paymentTransactions, refunds, invoices, paymentWebhookQueue, emailNotificationSettings,
  bannedWords, contentViolations, twilioOpenaiCalls, plivoCalls, demoSessions, websiteWidgets, sipCalls, leads,
  type User, type InsertUser,
  type Agent, type InsertAgent,
  type KnowledgeBase as KnowledgeBaseType, type InsertKnowledgeBase,
  type Campaign, type InsertCampaign,
  type Contact, type InsertContact,
  type Call, type InsertCall,
  type CreditTransaction, type InsertCreditTransaction,
  type Tool, type InsertTool,
  type Voice, type InsertVoice,
  type Plan, type InsertPlan,
  type UserSubscription, type InsertUserSubscription,
  type PhoneNumber, type InsertPhoneNumber,
  type UsageRecord, type InsertUsageRecord,
  type GlobalSettings, type InsertGlobalSettings,
  type CreditPackage, type InsertCreditPackage,
  type Webhook, type InsertWebhook,
  type WebhookLog, type InsertWebhookLog,
  type PhoneNumberRental, type InsertPhoneNumberRental,
  type Notification, type InsertNotification,
  type EmailTemplate, type InsertEmailTemplate,
  type PromptTemplate, type InsertPromptTemplate,
  type AgentVersion, type InsertAgentVersion,
  type SeoSettings, type InsertSeoSettings,
  type AnalyticsScript, type InsertAnalyticsScript,
  type PaymentTransaction, type InsertPaymentTransaction,
  type Refund, type InsertRefund,
  type Invoice, type InsertInvoice,
  type PaymentWebhookQueue, type InsertPaymentWebhookQueue,
  type EmailNotificationSettings, type InsertEmailNotificationSettings,
  type BannedWord, type InsertBannedWord,
  type ContentViolation, type InsertContentViolation,
  type DemoSession, type InsertDemoSession
} from "@shared/schema";
import { eq, sql, and, gte, lte, lt, desc, asc, isNull, isNotNull, or, inArray } from "drizzle-orm";
import { calculateGlobalAnalytics, calculateUserAnalytics, calculateDashboardData } from "./storage/analytics-helpers";

// Effective limits type - merges plan limits with per-user subscription overrides
export interface EffectiveLimits {
  maxAgents: number;
  maxCampaigns: number;
  maxContactsPerCampaign: number;
  maxWebhooks: number;
  maxKnowledgeBases: number;
  maxFlows: number;
  maxPhoneNumbers: number;
  includedCredits: number;
  // Source tracking for admin UI
  sources: {
    maxAgents: 'plan' | 'override';
    maxCampaigns: 'plan' | 'override';
    maxContactsPerCampaign: 'plan' | 'override';
    maxWebhooks: 'plan' | 'override';
    maxKnowledgeBases: 'plan' | 'override';
    maxFlows: 'plan' | 'override';
    maxPhoneNumbers: 'plan' | 'override';
    includedCredits: 'plan' | 'override';
  };
  planName: string;
  planDisplayName: string;
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserCredits(userId: string, credits: number): Promise<void>;

  // Agents
  getAgent(id: string): Promise<Agent | undefined>;
  getUserAgents(userId: string): Promise<Agent[]>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  updateAgent(id: string, agent: Partial<InsertAgent>): Promise<void>;
  deleteAgent(id: string): Promise<void>;

  // Knowledge Base
  getKnowledgeBaseItem(id: string): Promise<KnowledgeBaseType | undefined>;
  getUserKnowledgeBase(userId: string): Promise<KnowledgeBaseType[]>;
  getUserKnowledgeBaseCount(userId: string): Promise<number>;
  createKnowledgeBaseItem(item: InsertKnowledgeBase): Promise<KnowledgeBaseType>;
  updateKnowledgeBaseItem(id: string, item: Partial<InsertKnowledgeBase>): Promise<void>;
  deleteKnowledgeBaseItem(id: string): Promise<void>;

  // Campaigns
  getCampaign(id: string): Promise<Campaign | undefined>;
  getCampaignIncludingDeleted(id: string): Promise<Campaign | undefined>;
  getUserCampaigns(userId: string): Promise<Campaign[]>;
  getUserDeletedCampaigns(userId: string): Promise<Campaign[]>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: string, campaign: Partial<InsertCampaign>): Promise<void>;
  deleteCampaign(id: string): Promise<void>;
  restoreCampaign(id: string): Promise<void>;

  // Contacts
  getContact(id: string): Promise<Contact | undefined>;
  getCampaignContacts(campaignId: string): Promise<Contact[]>;
  getUserContacts(userId: string): Promise<any[]>;
  getUserContactsDeduplicated(userId: string): Promise<any[]>;
  createContact(contact: InsertContact): Promise<Contact>;
  createContacts(contacts: InsertContact[]): Promise<Contact[]>;

  // Calls
  getCall(id: string): Promise<Call | undefined>;
  getCampaignCalls(campaignId: string): Promise<Call[]>;
  getUserCalls(userId: string): Promise<Call[]>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, call: Partial<InsertCall>): Promise<void>;

  // Credit Transactions
  getCreditTransaction(id: string): Promise<CreditTransaction | undefined>;
  getUserCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  createCreditTransaction(transaction: InsertCreditTransaction): Promise<CreditTransaction>;
  addCreditsAtomic(userId: string, credits: number, description: string, stripePaymentId: string): Promise<void>;

  // Tools
  getTool(id: string): Promise<Tool | undefined>;
  getUserTools(userId: string): Promise<Tool[]>;
  createTool(tool: InsertTool): Promise<Tool>;

  // Phone Number Rentals
  createPhoneNumberRental(rental: InsertPhoneNumberRental): Promise<PhoneNumberRental>;
  getPhoneNumberRentals(phoneNumberId: string): Promise<PhoneNumberRental[]>;
  updateTool(id: string, tool: Partial<InsertTool>): Promise<void>;
  deleteTool(id: string): Promise<void>;

  // Voices
  getVoice(id: string): Promise<Voice | undefined>;
  getUserVoices(userId: string): Promise<Voice[]>;
  createVoice(voice: InsertVoice): Promise<Voice>;
  deleteVoice(id: string): Promise<void>;

  // Plans
  getPlan(id: string): Promise<Plan | undefined>;
  getAllPlans(): Promise<Plan[]>;
  createPlan(plan: InsertPlan): Promise<Plan>;
  updatePlan(id: string, plan: Partial<InsertPlan>): Promise<void>;
  deletePlan(id: string): Promise<void>;

  // Global Settings  
  getGlobalSetting(key: string): Promise<GlobalSettings | undefined>;
  updateGlobalSetting(key: string, value: any): Promise<void>;
  
  // Credit Packages
  getCreditPackage(id: string): Promise<CreditPackage | undefined>;
  getAllCreditPackages(): Promise<CreditPackage[]>;
  createCreditPackage(pack: InsertCreditPackage): Promise<CreditPackage>;
  updateCreditPackage(id: string, pack: Partial<InsertCreditPackage>): Promise<void>;
  
  // Admin Functions
  getAllUsers(): Promise<User[]>;
  getAllAdminUsers(): Promise<User[]>;
  updateUser(id: string, user: Partial<User>): Promise<void>;
  getSystemPhoneNumbers(): Promise<PhoneNumber[]>;
  getGlobalAnalytics(timeRange: string): Promise<any>;

  // User Subscriptions
  getUserSubscription(userId: string): Promise<any>; // Returns subscription with embedded plan or null
  getUserSubscriptionByPaystackCode(subscriptionCode: string): Promise<UserSubscription | undefined>; // Find by Paystack subscription code
  getAllUserSubscriptions(): Promise<UserSubscription[]>; // Returns all subscriptions for webhook lookups
  createUserSubscription(subscription: InsertUserSubscription): Promise<UserSubscription>;
  updateUserSubscription(id: string, subscription: Partial<InsertUserSubscription>): Promise<void>;
  updateUserSubscriptionByUserId(userId: string, subscription: Partial<InsertUserSubscription>): Promise<void>;
  
  // Effective Limits - Merges plan limits with per-user subscription overrides
  getUserEffectiveLimits(userId: string): Promise<EffectiveLimits>;

  // Phone Numbers
  getPhoneNumber(id: string): Promise<PhoneNumber | undefined>;
  getUserPhoneNumbers(userId: string): Promise<PhoneNumber[]>;
  getAllPhoneNumbers(): Promise<PhoneNumber[]>;
  createPhoneNumber(phoneNumber: InsertPhoneNumber): Promise<PhoneNumber>;
  updatePhoneNumber(id: string, phoneNumber: Partial<InsertPhoneNumber>): Promise<void>;
  deletePhoneNumber(id: string): Promise<void>;

  // Usage Records
  createUsageRecord(record: InsertUsageRecord): Promise<UsageRecord>;
  getUserUsageRecords(userId: string): Promise<UsageRecord[]>;
  
  // Analytics
  getUserAnalytics(userId: string, timeRange: string, callType?: string): Promise<any>;

  // Webhooks (Subscriptions)
  getWebhook(id: string): Promise<Webhook | undefined>;
  getUserWebhooks(userId: string): Promise<Webhook[]>;
  getUserWebhookCount(userId: string): Promise<number>;
  getWebhooksForEvent(userId: string, event: string, campaignId?: string): Promise<Webhook[]>;
  createWebhook(webhook: InsertWebhook): Promise<Webhook>;
  updateWebhook(id: string, webhook: Partial<InsertWebhook>): Promise<void>;
  deleteWebhook(id: string): Promise<void>;

  // Webhook Delivery Logs
  getWebhookLog(id: number): Promise<WebhookLog | undefined>;
  getWebhookLogs(webhookId: string, limit?: number): Promise<WebhookLog[]>;
  createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog>;
  updateWebhookLog(id: number, log: Partial<InsertWebhookLog>): Promise<void>;
  getFailedWebhookLogs(limit?: number): Promise<WebhookLog[]>;

  // Notifications
  getNotification(id: string): Promise<Notification | undefined>;
  getUserNotifications(userId: string, limit?: number): Promise<Notification[]>;
  getBannerNotifications(userId: string): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  dismissNotification(id: string, userId?: string): Promise<void>;
  deleteNotification(id: string): Promise<void>;

  // Email Templates
  getEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(templateType: string): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(id: string, data: Partial<EmailTemplate>): Promise<void>;
  createEmailTemplate(data: InsertEmailTemplate): Promise<EmailTemplate>;

  // Prompt Templates
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  getUserPromptTemplates(userId: string): Promise<PromptTemplate[]>;
  getSystemPromptTemplates(): Promise<PromptTemplate[]>;
  getPublicPromptTemplates(): Promise<PromptTemplate[]>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, template: Partial<InsertPromptTemplate>): Promise<void>;
  deletePromptTemplate(id: string): Promise<void>;
  incrementPromptTemplateUsage(id: string): Promise<void>;

  // Agent Versions
  getAgentVersion(id: string): Promise<AgentVersion | undefined>;
  getAgentVersions(agentId: string): Promise<AgentVersion[]>;
  getAgentVersionByNumber(agentId: string, versionNumber: number): Promise<AgentVersion | undefined>;
  getLatestAgentVersion(agentId: string): Promise<AgentVersion | undefined>;
  createAgentVersion(version: InsertAgentVersion): Promise<AgentVersion>;

  // SEO Settings
  getSeoSettings(): Promise<SeoSettings | undefined>;
  updateSeoSettings(settings: Partial<InsertSeoSettings>): Promise<SeoSettings>;

  // Analytics Scripts
  getAnalyticsScript(id: string): Promise<AnalyticsScript | undefined>;
  getAllAnalyticsScripts(): Promise<AnalyticsScript[]>;
  getEnabledAnalyticsScripts(): Promise<AnalyticsScript[]>;
  createAnalyticsScript(script: InsertAnalyticsScript): Promise<AnalyticsScript>;
  updateAnalyticsScript(id: string, script: Partial<InsertAnalyticsScript>): Promise<void>;
  deleteAnalyticsScript(id: string): Promise<void>;

  // Payment Transactions
  getPaymentTransaction(id: string): Promise<PaymentTransaction | undefined>;
  getPaymentTransactionByGatewayId(gateway: string, gatewayTransactionId: string): Promise<PaymentTransaction | undefined>;
  getUserPaymentTransactions(userId: string): Promise<PaymentTransaction[]>;
  getAllPaymentTransactions(filters?: { gateway?: string; type?: string; status?: string; startDate?: Date; endDate?: Date }): Promise<PaymentTransaction[]>;
  createPaymentTransaction(transaction: InsertPaymentTransaction): Promise<PaymentTransaction>;
  updatePaymentTransaction(id: string, transaction: Partial<InsertPaymentTransaction>): Promise<void>;
  getPaymentAnalytics(startDate?: Date, endDate?: Date): Promise<{
    totalRevenue: number;
    revenueByGateway: Record<string, number>;
    revenueByType: Record<string, number>;
    transactionCount: number;
    transactionsByStatus: Record<string, number>;
    refundCount: number;
    totalRefunded: number;
  }>;

  // Refunds
  getRefund(id: string): Promise<Refund | undefined>;
  getTransactionRefunds(transactionId: string): Promise<Refund[]>;
  getUserRefunds(userId: string): Promise<Refund[]>;
  getAllRefunds(): Promise<Refund[]>;
  createRefund(refund: InsertRefund): Promise<Refund>;
  updateRefund(id: string, refund: Partial<InsertRefund>): Promise<void>;

  // Invoices
  getInvoice(id: string): Promise<Invoice | undefined>;
  getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined>;
  getTransactionInvoice(transactionId: string): Promise<Invoice | undefined>;
  getUserInvoices(userId: string): Promise<Invoice[]>;
  getAllInvoices(): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, invoice: Partial<InsertInvoice>): Promise<void>;
  getNextInvoiceNumber(): Promise<string>;

  // Payment Webhook Queue
  getWebhookQueueItem(id: string): Promise<PaymentWebhookQueue | undefined>;
  getPendingWebhooks(): Promise<PaymentWebhookQueue[]>;
  getWebhookByEventId(gateway: string, eventId: string): Promise<PaymentWebhookQueue | undefined>;
  createWebhookQueueItem(item: InsertPaymentWebhookQueue): Promise<PaymentWebhookQueue>;
  updateWebhookQueueItem(id: string, item: Partial<InsertPaymentWebhookQueue>): Promise<void>;
  getExpiredWebhooks(): Promise<PaymentWebhookQueue[]>;
  getRetryableWebhooks(): Promise<PaymentWebhookQueue[]>;

  // Email Notification Settings
  getEmailNotificationSetting(eventType: string): Promise<EmailNotificationSettings | undefined>;
  getAllEmailNotificationSettings(): Promise<EmailNotificationSettings[]>;
  getEmailNotificationSettingsByCategory(category: string): Promise<EmailNotificationSettings[]>;
  createEmailNotificationSetting(setting: InsertEmailNotificationSettings): Promise<EmailNotificationSettings>;
  updateEmailNotificationSetting(eventType: string, setting: Partial<InsertEmailNotificationSettings>): Promise<void>;

  // Admin Call Monitoring
  getAdminCalls(options: {
    page?: number;
    pageSize?: number;
    userId?: string;
    status?: string;
    hasViolations?: boolean;
    startDate?: Date;
    endDate?: Date;
    search?: string;
  }): Promise<{
    data: any[];
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  }>;
  getAdminCallById(id: string): Promise<any | undefined>;
  getUserById(id: string): Promise<User | undefined>;

  // Content Violations
  getViolationsByCallId(callId: string): Promise<ContentViolation[]>;
  getContentViolations(options: {
    page?: number;
    pageSize?: number;
    userId?: string;
    status?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    data: any[];
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  }>;
  updateContentViolation(id: string, data: Partial<InsertContentViolation>): Promise<ContentViolation | undefined>;
  createContentViolation(data: InsertContentViolation): Promise<ContentViolation>;

  // Banned Words
  getBannedWords(): Promise<BannedWord[]>;
  getActiveBannedWords(): Promise<BannedWord[]>;
  createBannedWord(data: InsertBannedWord): Promise<BannedWord>;
  updateBannedWord(id: string, data: Partial<InsertBannedWord>): Promise<BannedWord | undefined>;
  deleteBannedWord(id: string): Promise<boolean>;

  // Calls with transcripts (for violation scanning)
  getCallsWithTranscripts(): Promise<Call[]>;
}

export class DbStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserCredits(userId: string, credits: number): Promise<void> {
    await db.update(users).set({ credits }).where(eq(users.id, userId));
  }

  // Agents
  async getAgent(id: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }

  async getUserAgents(userId: string): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.userId, userId));
  }

  async createAgent(insertAgent: InsertAgent): Promise<Agent> {
    const [agent] = await db.insert(agents).values(insertAgent).returning();
    return agent;
  }

  async updateAgent(id: string, agent: Partial<InsertAgent>): Promise<void> {
    await db.update(agents).set(agent).where(eq(agents.id, id));
  }

  async deleteAgent(id: string): Promise<void> {
    await db.delete(agents).where(eq(agents.id, id));
  }

  // Knowledge Base
  async getKnowledgeBaseItem(id: string): Promise<KnowledgeBaseType | undefined> {
    const [item] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, id));
    return item;
  }

  async getUserKnowledgeBase(userId: string): Promise<KnowledgeBaseType[]> {
    return db.select().from(knowledgeBase).where(eq(knowledgeBase.userId, userId));
  }

  async getUserKnowledgeBaseCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId));
    return Number(result[0]?.count || 0);
  }

  async createKnowledgeBaseItem(insertItem: InsertKnowledgeBase): Promise<KnowledgeBaseType> {
    const [item] = await db.insert(knowledgeBase).values(insertItem).returning();
    return item;
  }

  async updateKnowledgeBaseItem(id: string, item: Partial<InsertKnowledgeBase>): Promise<void> {
    await db.update(knowledgeBase).set(item).where(eq(knowledgeBase.id, id));
  }

  async deleteKnowledgeBaseItem(id: string): Promise<void> {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
  }

  // Campaigns
  async getCampaign(id: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns).where(and(
      eq(campaigns.id, id),
      isNull(campaigns.deletedAt)
    ));
    return campaign;
  }

  async getCampaignIncludingDeleted(id: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign;
  }

  async getUserCampaigns(userId: string): Promise<Campaign[]> {
    return db.select().from(campaigns).where(and(
      eq(campaigns.userId, userId),
      isNull(campaigns.deletedAt)
    )).orderBy(desc(campaigns.createdAt));
  }

  async getUserDeletedCampaigns(userId: string): Promise<Campaign[]> {
    return db.select().from(campaigns).where(and(
      eq(campaigns.userId, userId),
      isNotNull(campaigns.deletedAt)
    )).orderBy(desc(campaigns.createdAt));
  }

  async createCampaign(insertCampaign: InsertCampaign): Promise<Campaign> {
    const [campaign] = await db.insert(campaigns).values(insertCampaign).returning();
    return campaign;
  }

  async updateCampaign(id: string, campaign: Partial<InsertCampaign>): Promise<void> {
    await db.update(campaigns).set(campaign).where(eq(campaigns.id, id));
  }

  async deleteCampaign(id: string): Promise<void> {
    await db.update(campaigns).set({ deletedAt: new Date() }).where(eq(campaigns.id, id));
  }

  async restoreCampaign(id: string): Promise<void> {
    await db.update(campaigns).set({ deletedAt: null }).where(eq(campaigns.id, id));
  }

  // Contacts
  async getContact(id: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  async getCampaignContacts(campaignId: string): Promise<Contact[]> {
    return db.select().from(contacts).where(eq(contacts.campaignId, campaignId));
  }

  async getUserContacts(userId: string): Promise<any[]> {
    const results = await db.select({
      contact: contacts,
      campaign: campaigns,
    })
      .from(contacts)
      .innerJoin(campaigns, eq(contacts.campaignId, campaigns.id))
      .where(and(
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt)
      ));
    return results.map(r => ({
      ...r.contact,
      campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
    }));
  }

  async getUserContactsDeduplicated(userId: string): Promise<any[]> {
    const normalizePhone = (phone: string): string => {
      let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
      if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
      if (!cleaned.startsWith('+') && cleaned.length >= 10) cleaned = '+' + cleaned;
      return cleaned;
    };

    // Get all user contacts with their campaigns, ordered by createdAt DESC for deterministic selection
    const results = await db.select({
      contact: contacts,
      campaign: campaigns,
    })
      .from(contacts)
      .innerJoin(campaigns, eq(contacts.campaignId, campaigns.id))
      .where(and(
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt)
      ))
      .orderBy(desc(contacts.createdAt));

    // Group by phone number
    const phoneGroups = new Map<string, {
      phone: string;
      email: string | null;
      names: Set<string>;
      namesList: Array<{ firstName: string; lastName: string | null }>;
      campaigns: Set<string>;
      campaignsList: Array<{ id: string; name: string }>;
      statuses: Set<string>;
      latestContactId: string;
      latestStatus: string;
      latestEmail: string | null;
      latestCreatedAt: Date;
      source: 'campaign' | 'call';
      callCount: number;
    }>();

    for (const result of results) {
      const { contact, campaign } = result;
      const phone = normalizePhone(contact.phone);

      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: contact.email,
          names: new Set(),
          namesList: [],
          campaigns: new Set(),
          campaignsList: [],
          statuses: new Set(),
          latestContactId: contact.id,
          latestStatus: contact.status,
          latestEmail: contact.email,
          latestCreatedAt: contact.createdAt,
          source: 'campaign',
          callCount: 0,
        });
      }

      const group = phoneGroups.get(phone)!;

      // Add unique name using Set for O(1) lookup
      const nameKey = `${contact.firstName.toLowerCase()}|${(contact.lastName || '').toLowerCase()}`;
      if (!group.names.has(nameKey)) {
        group.names.add(nameKey);
        group.namesList.push({
          firstName: contact.firstName,
          lastName: contact.lastName,
        });
      }

      // Add unique campaign using Set for O(1) lookup
      if (!group.campaigns.has(campaign.id) && campaign) {
        group.campaigns.add(campaign.id);
        group.campaignsList.push({
          id: campaign.id,
          name: campaign.name,
        });
      }

      // Collect all unique statuses
      group.statuses.add(contact.status);

      // Update to most recent contact if this one is newer
      if (contact.createdAt > group.latestCreatedAt) {
        group.latestContactId = contact.id;
        group.latestStatus = contact.status;
        group.latestEmail = contact.email;
        group.latestCreatedAt = contact.createdAt;
      }
    }

    // Get unique phone numbers from calls that don't have contact records
    // This captures incoming calls and test calls that weren't part of a campaign contact list
    const callsWithoutContacts = await db.select({
      phoneNumber: calls.phoneNumber,
      callDirection: calls.callDirection,
      createdAt: calls.createdAt,
      status: calls.status,
    })
      .from(calls)
      .where(and(
        eq(calls.userId, userId),
        isNull(calls.contactId),
        isNotNull(calls.phoneNumber)
      ))
      .orderBy(desc(calls.createdAt));

    for (const call of callsWithoutContacts) {
      const rawPhone = call.phoneNumber;
      if (!rawPhone || rawPhone === 'Unknown Caller' || rawPhone === 'unknown') continue;
      const phone = normalizePhone(rawPhone);

      const callStatus = call.callDirection === 'incoming' ? 'incoming_call' : 'outgoing_call';

      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: null,
          names: new Set(),
          namesList: [],
          campaigns: new Set(),
          campaignsList: [],
          statuses: new Set([callStatus]),
          latestContactId: `call-${phone}`, // Virtual ID for call-only contacts
          latestStatus: callStatus,
          latestEmail: null,
          latestCreatedAt: call.createdAt,
          source: 'call',
          callCount: 1,
        });
      } else {
        // Phone exists - increment call count and update metadata if newer
        const group = phoneGroups.get(phone)!;
        group.callCount = (group.callCount || 0) + 1;
        group.statuses.add(callStatus);
        
        // Update to most recent call if this one is newer
        if (call.createdAt > group.latestCreatedAt) {
          group.latestStatus = callStatus;
          group.latestCreatedAt = call.createdAt;
        }
      }
    }

    const leadsResults = await db.select({
      phone: leads.phone,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      stage: leads.stage,
      sourceType: leads.sourceType,
      createdAt: leads.createdAt,
      id: leads.id,
    })
      .from(leads)
      .where(eq(leads.userId, userId))
      .orderBy(desc(leads.createdAt));

    for (const lead of leadsResults) {
      if (!lead.phone || lead.phone === 'Unknown Caller' || lead.phone === 'unknown') continue;
      const phone = normalizePhone(lead.phone);

      const leadStatus = `lead_${lead.stage || 'new'}`;
      const leadSource = lead.sourceType === 'campaign' ? 'campaign' as const : 'call' as const;

      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: lead.email,
          names: new Set(),
          namesList: [],
          campaigns: new Set(),
          campaignsList: [],
          statuses: new Set([leadStatus]),
          latestContactId: lead.id,
          latestStatus: leadStatus,
          latestEmail: lead.email,
          latestCreatedAt: lead.createdAt,
          source: leadSource,
          callCount: 0,
        });
        if (lead.firstName) {
          const nameKey = `${lead.firstName.toLowerCase()}|${(lead.lastName || '').toLowerCase()}`;
          phoneGroups.get(phone)!.names.add(nameKey);
          phoneGroups.get(phone)!.namesList.push({
            firstName: lead.firstName,
            lastName: lead.lastName,
          });
        }
      } else {
        const group = phoneGroups.get(phone)!;
        group.statuses.add(leadStatus);
        if (lead.email) {
          group.latestEmail = lead.email;
        }
        if (lead.firstName) {
          const nameKey = `${lead.firstName.toLowerCase()}|${(lead.lastName || '').toLowerCase()}`;
          if (!group.names.has(nameKey)) {
            group.names.add(nameKey);
            group.namesList.unshift({
              firstName: lead.firstName,
              lastName: lead.lastName,
            });
          }
        }
        if (lead.createdAt > group.latestCreatedAt) {
          group.latestContactId = lead.id;
          group.latestStatus = leadStatus;
          group.latestCreatedAt = lead.createdAt;
        }
      }
    }

    const twilioOpenaiCallsResults = await db.select({
      fromNumber: twilioOpenaiCalls.fromNumber,
      toNumber: twilioOpenaiCalls.toNumber,
      callDirection: twilioOpenaiCalls.callDirection,
      createdAt: twilioOpenaiCalls.createdAt,
      status: twilioOpenaiCalls.status,
    })
      .from(twilioOpenaiCalls)
      .where(and(
        eq(twilioOpenaiCalls.userId, userId),
        isNull(twilioOpenaiCalls.contactId)
      ))
      .orderBy(desc(twilioOpenaiCalls.createdAt));

    for (const call of twilioOpenaiCallsResults) {
      const rawTwPhone = call.callDirection === 'inbound' ? call.fromNumber : call.toNumber;
      if (!rawTwPhone || rawTwPhone === 'Unknown Caller' || rawTwPhone === 'unknown') continue;
      const phone = normalizePhone(rawTwPhone);

      const callStatus = call.callDirection === 'inbound' ? 'incoming_call' : 'outgoing_call';

      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: null,
          names: new Set(),
          namesList: [],
          campaigns: new Set(),
          campaignsList: [],
          statuses: new Set([callStatus]),
          latestContactId: `twilio-openai-call-${phone}`,
          latestStatus: callStatus,
          latestEmail: null,
          latestCreatedAt: call.createdAt,
          source: 'call',
          callCount: 1,
        });
      } else {
        const group = phoneGroups.get(phone)!;
        group.callCount = (group.callCount || 0) + 1;
        group.statuses.add(callStatus);
        if (call.createdAt > group.latestCreatedAt) {
          group.latestStatus = callStatus;
          group.latestCreatedAt = call.createdAt;
        }
      }
    }

    const plivoCallsResults = await db.select({
      fromNumber: plivoCalls.fromNumber,
      toNumber: plivoCalls.toNumber,
      callDirection: plivoCalls.callDirection,
      createdAt: plivoCalls.createdAt,
      status: plivoCalls.status,
    })
      .from(plivoCalls)
      .where(and(
        eq(plivoCalls.userId, userId),
        isNull(plivoCalls.contactId)
      ))
      .orderBy(desc(plivoCalls.createdAt));

    for (const call of plivoCallsResults) {
      const rawPlPhone = call.callDirection === 'inbound' ? call.fromNumber : call.toNumber;
      if (!rawPlPhone || rawPlPhone === 'Unknown Caller' || rawPlPhone === 'unknown') continue;
      const phone = normalizePhone(rawPlPhone);

      const callStatus = call.callDirection === 'inbound' ? 'incoming_call' : 'outgoing_call';

      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: null,
          names: new Set(),
          namesList: [],
          campaigns: new Set(),
          campaignsList: [],
          statuses: new Set([callStatus]),
          latestContactId: `plivo-call-${phone}`,
          latestStatus: callStatus,
          latestEmail: null,
          latestCreatedAt: call.createdAt,
          source: 'call',
          callCount: 1,
        });
      } else {
        const group = phoneGroups.get(phone)!;
        group.callCount = (group.callCount || 0) + 1;
        group.statuses.add(callStatus);
        if (call.createdAt > group.latestCreatedAt) {
          group.latestStatus = callStatus;
          group.latestCreatedAt = call.createdAt;
        }
      }
    }

    const sipCallsResults = await db.select({
      fromNumber: sipCalls.fromNumber,
      toNumber: sipCalls.toNumber,
      direction: sipCalls.direction,
      createdAt: sipCalls.createdAt,
      status: sipCalls.status,
    })
      .from(sipCalls)
      .where(and(
        eq(sipCalls.userId, userId),
        isNull(sipCalls.contactId)
      ))
      .orderBy(desc(sipCalls.createdAt));

    for (const call of sipCallsResults) {
      const rawSipPhone = call.direction === 'inbound' ? call.fromNumber : call.toNumber;
      if (!rawSipPhone || rawSipPhone === 'Unknown Caller' || rawSipPhone === 'unknown') continue;
      const phone = normalizePhone(rawSipPhone);

      const callStatus = call.direction === 'inbound' ? 'incoming_call' : 'outgoing_call';

      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: null,
          names: new Set(),
          namesList: [],
          campaigns: new Set(),
          campaignsList: [],
          statuses: new Set([callStatus]),
          latestContactId: `sip-call-${phone}`,
          latestStatus: callStatus,
          latestEmail: null,
          latestCreatedAt: call.createdAt || new Date(0),
          source: 'call',
          callCount: 1,
        });
      } else {
        const group = phoneGroups.get(phone)!;
        group.callCount = (group.callCount || 0) + 1;
        group.statuses.add(callStatus);
        if (call.createdAt && call.createdAt > group.latestCreatedAt) {
          group.latestStatus = callStatus;
          group.latestCreatedAt = call.createdAt;
        }
      }
    }

    // Convert map to array using status from most recent contact
    return Array.from(phoneGroups.values()).map(group => ({
      id: group.latestContactId,
      phone: group.phone,
      email: group.latestEmail,
      names: group.namesList,
      campaigns: group.campaignsList,
      status: group.latestStatus,
      allStatuses: Array.from(group.statuses),
      source: group.source,
      callCount: group.callCount,
    }));
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const [contact] = await db.insert(contacts).values(insertContact).returning();
    return contact;
  }

  async createContacts(insertContacts: InsertContact[]): Promise<Contact[]> {
    return db.insert(contacts).values(insertContacts).returning();
  }

  async deleteContact(id: string): Promise<void> {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  // Calls
  async getCall(id: string): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }

  async getCallWithDetails(id: string): Promise<any | undefined> {
    // First check ElevenLabs calls table
    const elevenLabsResults = await db.select({
      call: calls,
      campaign: campaigns,
      contact: contacts,
      incomingConnection: incomingConnections,
      widget: websiteWidgets,
    })
      .from(calls)
      .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(calls.contactId, contacts.id))
      .leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id))
      .leftJoin(websiteWidgets, eq(calls.widgetId, websiteWidgets.id))
      .where(eq(calls.id, id));
    
    if (elevenLabsResults.length > 0) {
      const r = elevenLabsResults[0];
      // Extract engine from metadata if available (for widget calls that store engine in metadata)
      const metadataEngine = (r.call.metadata as any)?.engine;
      const engine = metadataEngine || 'elevenlabs';
      return {
        ...r.call,
        engine: engine as 'elevenlabs' | 'openai' | 'twilio-openai' | 'plivo-openai',
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: r.incomingConnection ? { id: r.incomingConnection.id, agentId: r.incomingConnection.agentId } : null,
        widget: r.widget ? { id: r.widget.id, name: r.widget.name } : null,
      };
    }

    // If not found, check Twilio+OpenAI calls table
    const twilioOpenAIResults = await db.select({
      call: twilioOpenaiCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents,
    })
      .from(twilioOpenaiCalls)
      .leftJoin(campaigns, eq(twilioOpenaiCalls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(twilioOpenaiCalls.contactId, contacts.id))
      .leftJoin(agents, eq(twilioOpenaiCalls.agentId, agents.id))
      .where(eq(twilioOpenaiCalls.id, id));

    if (twilioOpenAIResults.length > 0) {
      const r = twilioOpenAIResults[0];
      return {
        id: r.call.id,
        userId: r.call.userId,
        campaignId: r.call.campaignId,
        contactId: r.call.contactId,
        agentId: r.call.agentId,
        phoneNumber: r.call.fromNumber,
        fromNumber: r.call.fromNumber,
        toNumber: r.call.toNumber,
        twilioSid: r.call.twilioCallSid,
        status: r.call.status,
        callDirection: r.call.callDirection === 'inbound' ? 'incoming' : (r.call.callDirection === 'outbound' ? 'outgoing' : r.call.callDirection),
        duration: r.call.duration,
        recordingUrl: r.call.recordingUrl,
        transcript: r.call.transcript,
        aiSummary: r.call.aiSummary,
        sentiment: r.call.sentiment,
        wasTransferred: r.call.wasTransferred,
        transferredTo: r.call.transferredTo,
        transferredAt: r.call.transferredAt,
        startedAt: r.call.startedAt,
        endedAt: r.call.endedAt,
        createdAt: r.call.createdAt,
        metadata: r.call.metadata,
        engine: 'twilio-openai' as const,
        openaiSessionId: r.call.openaiSessionId,
        openaiVoice: r.call.openaiVoice,
        openaiModel: r.call.openaiModel,
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: null,
        agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
      };
    }

    // If not found, check Plivo+OpenAI calls table
    const plivoResults = await db.select({
      call: plivoCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents,
    })
      .from(plivoCalls)
      .leftJoin(campaigns, eq(plivoCalls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(plivoCalls.contactId, contacts.id))
      .leftJoin(agents, eq(plivoCalls.agentId, agents.id))
      .where(eq(plivoCalls.id, id));

    if (plivoResults.length > 0) {
      const r = plivoResults[0];
      return {
        id: r.call.id,
        userId: r.call.userId,
        campaignId: r.call.campaignId,
        contactId: r.call.contactId,
        agentId: r.call.agentId,
        phoneNumber: r.call.fromNumber,
        fromNumber: r.call.fromNumber,
        toNumber: r.call.toNumber,
        plivoCallUuid: r.call.plivoCallUuid,
        status: r.call.status,
        callDirection: r.call.callDirection === 'inbound' ? 'incoming' : (r.call.callDirection === 'outbound' ? 'outgoing' : r.call.callDirection),
        duration: r.call.duration,
        recordingUrl: r.call.recordingUrl,
        transcript: r.call.transcript,
        aiSummary: r.call.aiSummary,
        sentiment: r.call.sentiment,
        leadQualityScore: r.call.leadQualityScore,
        keyPoints: r.call.keyPoints,
        nextActions: r.call.nextActions,
        wasTransferred: r.call.wasTransferred,
        transferredTo: r.call.transferredTo,
        transferredAt: r.call.transferredAt,
        startedAt: r.call.startedAt,
        answeredAt: r.call.answeredAt,
        endedAt: r.call.endedAt,
        createdAt: r.call.createdAt,
        metadata: r.call.metadata,
        engine: 'plivo-openai' as const,
        openaiSessionId: r.call.openaiSessionId,
        openaiVoice: r.call.openaiVoice,
        openaiModel: r.call.openaiModel,
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: null,
        agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
      };
    }

    // If not found, check SIP calls table (ElevenLabs SIP + OpenAI SIP engines)
    const sipResults = await db.select({
      call: sipCalls,
      agent: agents,
      contact: contacts,
    })
      .from(sipCalls)
      .leftJoin(agents, eq(sipCalls.agentId, agents.id))
      .leftJoin(contacts, eq(sipCalls.contactId, contacts.id))
      .where(eq(sipCalls.id, id));

    if (sipResults.length > 0) {
      const r = sipResults[0];
      return {
        id: r.call.id,
        userId: r.call.userId,
        campaignId: r.call.campaignId,
        contactId: r.call.contactId,
        agentId: r.call.agentId,
        phoneNumber: r.call.direction === 'inbound' ? r.call.fromNumber : r.call.toNumber,
        fromNumber: r.call.fromNumber,
        toNumber: r.call.toNumber,
        status: r.call.status,
        callDirection: r.call.direction === 'inbound' ? 'incoming' : 'outgoing',
        duration: r.call.durationSeconds,
        recordingUrl: r.call.recordingUrl,
        transcript: r.call.transcript,
        aiSummary: r.call.aiSummary,
        sentiment: r.call.sentiment || (r.call.metadata as any)?.sentiment || null,
        classification: r.call.classification || (r.call.metadata as any)?.classification || null,
        startedAt: r.call.startedAt,
        answeredAt: r.call.answeredAt,
        endedAt: r.call.endedAt,
        createdAt: r.call.createdAt,
        metadata: r.call.metadata,
        engine: r.call.engine as 'elevenlabs-sip' | 'openai-sip',
        sipTrunkId: r.call.sipTrunkId,
        sipPhoneNumberId: r.call.sipPhoneNumberId,
        elevenLabsConversationId: r.call.elevenlabsConversationId,
        elevenlabsConversationId: r.call.elevenlabsConversationId,
        externalCallId: r.call.externalCallId,
        openaiCallId: r.call.openaiCallId,
        creditsUsed: r.call.creditsUsed,
        sipHeaders: r.call.sipHeaders,
        campaign: null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: null,
        agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
      };
    }

    return undefined;
  }

  async getCampaignCalls(campaignId: string): Promise<Call[]> {
    return db.select().from(calls).where(eq(calls.campaignId, campaignId));
  }

  async getUserCalls(userId: string): Promise<Call[]> {
    // Use direct userId filter for guaranteed isolation, with fallback for legacy calls
    const results = await db.select({ calls })
      .from(calls)
      .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
      .leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id))
      .where(
        or(
          eq(calls.userId, userId),
          and(isNotNull(calls.campaignId), eq(campaigns.userId, userId)),
          and(isNotNull(calls.incomingConnectionId), eq(incomingConnections.userId, userId))
        )
      );
    return results.map(r => r.calls);
  }

  async getUserCallsWithDetails(userId: string): Promise<any[]> {
    // Fetch ElevenLabs calls (from calls table)
    const elevenLabsResults = await db.select({
      call: calls,
      campaign: campaigns,
      contact: contacts,
      incomingConnection: incomingConnections,
      widget: websiteWidgets,
    })
      .from(calls)
      .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(calls.contactId, contacts.id))
      .leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id))
      .leftJoin(websiteWidgets, eq(calls.widgetId, websiteWidgets.id))
      .where(
        or(
          // Primary filter: Direct user ownership (guaranteed isolation)
          eq(calls.userId, userId),
          // Fallback for legacy calls: Check via campaign ownership
          and(isNotNull(calls.campaignId), eq(campaigns.userId, userId)),
          // Fallback for legacy calls: Check via incoming connection ownership
          and(isNotNull(calls.incomingConnectionId), eq(incomingConnections.userId, userId))
        )
      )
      .orderBy(sql`${calls.createdAt} DESC`);
    
    const elevenLabsCalls = elevenLabsResults.map(r => {
      // Extract engine from metadata if available (for widget calls that store engine in metadata)
      const metadataEngine = (r.call.metadata as any)?.engine;
      const engine = metadataEngine || 'elevenlabs';
      return {
        ...r.call,
        engine: engine as 'elevenlabs' | 'openai' | 'twilio-openai' | 'plivo-openai',
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: r.incomingConnection ? { id: r.incomingConnection.id, agentId: r.incomingConnection.agentId } : null,
        widget: r.widget ? { id: r.widget.id, name: r.widget.name } : null,
      };
    });

    // Fetch Twilio+OpenAI calls - user ownership only (strict isolation)
    const twilioOpenAIResults = await db.select({
      call: twilioOpenaiCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents,
    })
      .from(twilioOpenaiCalls)
      .leftJoin(campaigns, eq(twilioOpenaiCalls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(twilioOpenaiCalls.contactId, contacts.id))
      .leftJoin(agents, eq(twilioOpenaiCalls.agentId, agents.id))
      .where(eq(twilioOpenaiCalls.userId, userId))
      .orderBy(sql`${twilioOpenaiCalls.createdAt} DESC`);

    const twilioOpenAICalls = twilioOpenAIResults.map(r => ({
      id: r.call.id,
      userId: r.call.userId,
      campaignId: r.call.campaignId,
      contactId: r.call.contactId,
      agentId: r.call.agentId,
      phoneNumber: r.call.fromNumber,
      fromNumber: r.call.fromNumber,
      toNumber: r.call.toNumber,
      twilioSid: r.call.twilioCallSid,
      status: r.call.status,
      callDirection: r.call.callDirection === 'inbound' ? 'incoming' : 'outgoing',
      duration: r.call.duration,
      recordingUrl: r.call.recordingUrl,
      transcript: r.call.transcript,
      aiSummary: r.call.aiSummary,
      sentiment: r.call.sentiment,
      wasTransferred: r.call.wasTransferred,
      transferredTo: r.call.transferredTo,
      transferredAt: r.call.transferredAt,
      startedAt: r.call.startedAt,
      endedAt: r.call.endedAt,
      createdAt: r.call.createdAt,
      metadata: r.call.metadata,
      engine: 'twilio-openai' as const,
      openaiSessionId: r.call.openaiSessionId,
      openaiVoice: r.call.openaiVoice,
      openaiModel: r.call.openaiModel,
      campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
      contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
      incomingConnection: null,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
    }));

    // Fetch Plivo+OpenAI calls - user ownership only (strict isolation)
    const plivoResults = await db.select({
      call: plivoCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents,
    })
      .from(plivoCalls)
      .leftJoin(campaigns, eq(plivoCalls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(plivoCalls.contactId, contacts.id))
      .leftJoin(agents, eq(plivoCalls.agentId, agents.id))
      .where(eq(plivoCalls.userId, userId))
      .orderBy(sql`${plivoCalls.createdAt} DESC`);

    const plivoOpenAICalls = plivoResults.map(r => ({
      id: r.call.id,
      userId: r.call.userId,
      campaignId: r.call.campaignId,
      contactId: r.call.contactId,
      agentId: r.call.agentId,
      phoneNumber: r.call.fromNumber,
      fromNumber: r.call.fromNumber,
      toNumber: r.call.toNumber,
      plivoCallUuid: r.call.plivoCallUuid,
      status: r.call.status,
      callDirection: r.call.callDirection === 'inbound' ? 'incoming' : 'outgoing',
      duration: r.call.duration,
      recordingUrl: r.call.recordingUrl,
      transcript: r.call.transcript,
      aiSummary: r.call.aiSummary,
      sentiment: r.call.sentiment,
      leadQualityScore: r.call.leadQualityScore,
      keyPoints: r.call.keyPoints,
      nextActions: r.call.nextActions,
      wasTransferred: r.call.wasTransferred,
      transferredTo: r.call.transferredTo,
      transferredAt: r.call.transferredAt,
      startedAt: r.call.startedAt,
      answeredAt: r.call.answeredAt,
      endedAt: r.call.endedAt,
      createdAt: r.call.createdAt,
      metadata: r.call.metadata,
      engine: 'plivo-openai' as const,
      openaiSessionId: r.call.openaiSessionId,
      openaiVoice: r.call.openaiVoice,
      openaiModel: r.call.openaiModel,
      campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
      contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
      incomingConnection: null,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
    }));

    // Fetch SIP calls (ElevenLabs SIP and OpenAI SIP) - user ownership only
    const sipCallResults = await db.select({
      call: sipCalls,
      agent: agents,
      contact: contacts,
    })
      .from(sipCalls)
      .leftJoin(agents, eq(sipCalls.agentId, agents.id))
      .leftJoin(contacts, eq(sipCalls.contactId, contacts.id))
      .where(eq(sipCalls.userId, userId))
      .orderBy(sql`${sipCalls.createdAt} DESC`);

    const sipCallsFormatted = sipCallResults.map(r => ({
      id: r.call.id,
      userId: r.call.userId,
      campaignId: r.call.campaignId,
      contactId: r.call.contactId,
      agentId: r.call.agentId,
      phoneNumber: r.call.direction === 'inbound' ? r.call.fromNumber : r.call.toNumber,
      fromNumber: r.call.fromNumber,
      toNumber: r.call.toNumber,
      status: r.call.status,
      callDirection: r.call.direction === 'inbound' ? 'incoming' : 'outgoing',
      duration: r.call.durationSeconds,
      recordingUrl: r.call.recordingUrl,
      transcript: r.call.transcript,
      aiSummary: r.call.aiSummary,
      sentiment: r.call.sentiment || (r.call.metadata as any)?.sentiment || null,
      classification: r.call.classification || (r.call.metadata as any)?.classification || null,
      startedAt: r.call.startedAt,
      answeredAt: r.call.answeredAt,
      endedAt: r.call.endedAt,
      createdAt: r.call.createdAt,
      metadata: r.call.metadata,
      engine: r.call.engine as 'elevenlabs-sip' | 'openai-sip',
      sipTrunkId: r.call.sipTrunkId,
      sipPhoneNumberId: r.call.sipPhoneNumberId,
      elevenLabsConversationId: r.call.elevenlabsConversationId,
      elevenlabsConversationId: r.call.elevenlabsConversationId,
      creditsUsed: r.call.creditsUsed,
      campaign: null,
      contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
      incomingConnection: null,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
    }));

    // Drop pre-created `calls` placeholders when the real OpenAI-engine row exists (same campaign + contact).
    // Otherwise the Calls page shows duplicate rows: one empty "elevenlabs" shell and one with transcript/recording.
    const twilioOpenAIByCampaignContact = new Set(
      twilioOpenAICalls
        .filter((c) => c.campaignId && c.contactId)
        .map((c) => `${c.campaignId}:${c.contactId}`)
    );
    const plivoByCampaignContact = new Set(
      plivoOpenAICalls
        .filter((c) => c.campaignId && c.contactId)
        .map((c) => `${c.campaignId}:${c.contactId}`)
    );

    const filteredElevenLabsCalls = elevenLabsCalls.filter((c) => {
      if (!c.campaignId || !c.contactId) return true;
      const md = (c.metadata || {}) as Record<string, unknown>;
      if (md.batchCall !== true) return true;
      const key = `${c.campaignId}:${c.contactId}`;
      if (md.telephonyProvider === 'twilio_openai' && twilioOpenAIByCampaignContact.has(key)) {
        return false;
      }
      if (md.telephonyProvider === 'plivo' && plivoByCampaignContact.has(key)) {
        return false;
      }
      return true;
    });

    // Merge and sort by createdAt descending
    const allCalls = [...filteredElevenLabsCalls, ...twilioOpenAICalls, ...plivoOpenAICalls, ...sipCallsFormatted];
    allCalls.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    return allCalls;
  }

  async createCall(insertCall: InsertCall): Promise<Call> {
    const [call] = await db.insert(calls).values(insertCall).returning();
    return call;
  }

  async updateCall(id: string, call: Partial<InsertCall>): Promise<void> {
    await db.update(calls).set(call).where(eq(calls.id, id));
  }

  // Credit Transactions
  async getCreditTransaction(id: string): Promise<CreditTransaction | undefined> {
    const [transaction] = await db.select().from(creditTransactions).where(eq(creditTransactions.id, id));
    return transaction;
  }

  async getUserCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId));
  }

  async createCreditTransaction(insertTransaction: InsertCreditTransaction): Promise<CreditTransaction> {
    const [transaction] = await db.insert(creditTransactions).values(insertTransaction).returning();
    return transaction;
  }

  // Atomic credit purchase: creates transaction + adds credits in single DB transaction
  async addCreditsAtomic(userId: string, credits: number, description: string, stripePaymentId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // First create transaction record (fails on duplicate stripePaymentId)
      await tx.insert(creditTransactions).values({
        userId,
        type: 'credit',
        amount: credits,
        description,
        stripePaymentId,
      });

      // Then atomically increment user credits using SQL
      await tx.execute(sql`
        UPDATE users 
        SET credits = COALESCE(credits, 0) + ${credits}
        WHERE id = ${userId}
      `);
    });
  }

  // Tools
  async getTool(id: string): Promise<Tool | undefined> {
    const [tool] = await db.select().from(tools).where(eq(tools.id, id));
    return tool;
  }

  async getUserTools(userId: string): Promise<Tool[]> {
    return db.select().from(tools).where(eq(tools.userId, userId));
  }

  async createTool(insertTool: InsertTool): Promise<Tool> {
    const [tool] = await db.insert(tools).values(insertTool).returning();
    return tool;
  }

  async updateTool(id: string, tool: Partial<InsertTool>): Promise<void> {
    await db.update(tools).set(tool).where(eq(tools.id, id));
  }

  async deleteTool(id: string): Promise<void> {
    await db.delete(tools).where(eq(tools.id, id));
  }

  // Phone Number Rentals
  async createPhoneNumberRental(insertRental: InsertPhoneNumberRental): Promise<PhoneNumberRental> {
    const [rental] = await db.insert(phoneNumberRentals).values(insertRental).returning();
    return rental;
  }

  async getPhoneNumberRentals(phoneNumberId: string): Promise<PhoneNumberRental[]> {
    return db.select().from(phoneNumberRentals)
      .where(eq(phoneNumberRentals.phoneNumberId, phoneNumberId))
      .orderBy(desc(phoneNumberRentals.createdAt));
  }

  // Voices
  async getVoice(id: string): Promise<Voice | undefined> {
    const [voice] = await db.select().from(voices).where(eq(voices.id, id));
    return voice;
  }

  async getUserVoices(userId: string): Promise<Voice[]> {
    return db.select().from(voices).where(eq(voices.userId, userId));
  }

  async createVoice(insertVoice: InsertVoice): Promise<Voice> {
    const [voice] = await db.insert(voices).values(insertVoice).returning();
    return voice;
  }

  async deleteVoice(id: string): Promise<void> {
    await db.delete(voices).where(eq(voices.id, id));
  }

  // Plans
  async getPlan(id: string): Promise<Plan | undefined> {
    const [plan] = await db.select().from(plans).where(eq(plans.id, id));
    return plan;
  }

  async getPlanByName(name: string): Promise<Plan | undefined> {
    const [plan] = await db.select().from(plans).where(eq(plans.name, name));
    return plan;
  }

  async getAllPlans(): Promise<Plan[]> {
    return db.select().from(plans).where(eq(plans.isActive, true));
  }

  async createPlan(insertPlan: InsertPlan): Promise<Plan> {
    const [plan] = await db.insert(plans).values(insertPlan).returning();
    return plan;
  }
  
  async updatePlan(id: string, plan: Partial<InsertPlan>): Promise<void> {
    const result = await db.update(plans).set(plan).where(eq(plans.id, id)).returning({ id: plans.id });
    if (result.length === 0) {
      throw new Error(`Failed to update plan: Plan with id '${id}' not found`);
    }
  }

  async deletePlan(id: string): Promise<void> {
    await db.delete(plans).where(eq(plans.id, id));
  }

  // Global Settings
  async getGlobalSetting(key: string): Promise<GlobalSettings | undefined> {
    const [setting] = await db.select().from(globalSettings).where(eq(globalSettings.key, key));
    if (setting && setting.value !== null && setting.value !== undefined) {
      // Handle double-encoded JSON strings (legacy data fix)
      // If value is a string that looks like a JSON-encoded string (starts/ends with quotes), parse it
      let val = setting.value;
      if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
        try {
          val = JSON.parse(val);
        } catch {
          // Keep original value if parsing fails
        }
      }
      return { ...setting, value: val };
    }
    return setting;
  }

  async updateGlobalSetting(key: string, value: any): Promise<void> {
    // Use raw SQL to properly store values in jsonb column without double-encoding
    // This ensures strings are stored as JSON strings, not as JSON strings of JSON strings
    try {
      const jsonValue = JSON.stringify(value);
      await db.execute(sql`
        INSERT INTO global_settings (id, key, value, updated_at)
        VALUES (gen_random_uuid(), ${key}, ${jsonValue}::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET 
          value = ${jsonValue}::jsonb,
          updated_at = NOW()
      `);
      console.log(`✅ [Settings] Saved setting '${key}' successfully`);
    } catch (error: any) {
      console.error(`❌ [Settings] Failed to save setting '${key}':`, error.message);
      throw new Error(`Failed to save setting '${key}': ${error.message}`);
    }
  }

  // Credit Packages
  async getCreditPackage(id: string): Promise<CreditPackage | undefined> {
    const [pack] = await db.select().from(creditPackages).where(eq(creditPackages.id, id));
    return pack;
  }

  async getAllCreditPackages(): Promise<CreditPackage[]> {
    return db.select().from(creditPackages).where(eq(creditPackages.isActive, true));
  }

  async createCreditPackage(insertPack: InsertCreditPackage): Promise<CreditPackage> {
    const [pack] = await db.insert(creditPackages).values(insertPack).returning();
    return pack;
  }

  async updateCreditPackage(id: string, pack: Partial<InsertCreditPackage>): Promise<void> {
    const result = await db.update(creditPackages).set(pack).where(eq(creditPackages.id, id)).returning({ id: creditPackages.id });
    if (result.length === 0) {
      throw new Error(`Failed to update credit package: Package with id '${id}' not found`);
    }
  }

  // Admin Functions
  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getAllAdminUsers(): Promise<User[]> {
    return db.select().from(users).where(
      sql`${users.role} = 'admin'`
    ).orderBy(desc(users.createdAt));
  }

  async updateUser(id: string, user: Partial<User>): Promise<void> {
    const result = await db.update(users).set(user).where(eq(users.id, id)).returning({ id: users.id });
    if (result.length === 0) {
      throw new Error(`Failed to update user: User with id '${id}' not found`);
    }
  }

  async getSystemPhoneNumbers(): Promise<any[]> {
    // Get all phone numbers with user information
    const results = await db.select({
      phone: phoneNumbers,
      user: users,
    })
      .from(phoneNumbers)
      .leftJoin(users, eq(phoneNumbers.userId, users.id));
    
    return results.map(r => ({
      ...r.phone,
      userEmail: r.user?.email,
    }));
  }

  async getGlobalAnalytics(timeRange: string) {
    return calculateGlobalAnalytics(timeRange);
  }

  // User Subscriptions
  async getUserSubscription(userId: string): Promise<any> {
    // Left join to get subscription with plan details - ORDER BY createdAt DESC to get the most recent
    const result = await db
      .select({
        subscription: userSubscriptions,
        plan: plans,
      })
      .from(userSubscriptions)
      .leftJoin(plans, eq(userSubscriptions.planId, plans.id))
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);

    if (result.length > 0 && result[0].subscription && result[0].plan) {
      // Return subscription with embedded plan
      return {
        ...result[0].subscription,
        plan: result[0].plan,
      };
    }

    // No subscription exists - return free plan fallback
    const [freePlan] = await db.select().from(plans).where(eq(plans.name, 'free')).limit(1);
    if (!freePlan) {
      return null;
    }

    // Return a virtual subscription with free plan
    return null; // Let frontend handle free tier separately
  }

  async getAllUserSubscriptions(): Promise<UserSubscription[]> {
    return await db.select().from(userSubscriptions);
  }

  async getUserSubscriptionByPaystackCode(subscriptionCode: string): Promise<UserSubscription | undefined> {
    const [subscription] = await db.select().from(userSubscriptions)
      .where(eq(userSubscriptions.paystackSubscriptionCode, subscriptionCode))
      .limit(1);
    return subscription;
  }

  async createUserSubscription(insertSubscription: InsertUserSubscription): Promise<UserSubscription> {
    const [subscription] = await db.insert(userSubscriptions).values(insertSubscription).returning();
    return subscription;
  }

  async updateUserSubscription(id: string, subscription: Partial<InsertUserSubscription>): Promise<void> {
    await db.update(userSubscriptions).set(subscription).where(eq(userSubscriptions.id, id));
  }

  async updateUserSubscriptionByUserId(userId: string, subscription: Partial<InsertUserSubscription>): Promise<void> {
    await db.update(userSubscriptions)
      .set({ ...subscription, updatedAt: new Date() })
      .where(eq(userSubscriptions.userId, userId));
  }

  // Get effective limits for a user - merges plan defaults with per-user overrides
  async getUserEffectiveLimits(userId: string): Promise<EffectiveLimits> {
    // Get user's subscription with plan
    const subscriptionWithPlan = await this.getUserSubscription(userId);
    
    // Default free tier limits if no subscription
    const defaultLimits: EffectiveLimits = {
      maxAgents: 1,
      maxCampaigns: 1,
      maxContactsPerCampaign: 5,
      maxWebhooks: 3,
      maxKnowledgeBases: 5,
      maxFlows: 3,
      maxPhoneNumbers: 0,
      includedCredits: 0,
      sources: {
        maxAgents: 'plan',
        maxCampaigns: 'plan',
        maxContactsPerCampaign: 'plan',
        maxWebhooks: 'plan',
        maxKnowledgeBases: 'plan',
        maxFlows: 'plan',
        maxPhoneNumbers: 'plan',
        includedCredits: 'plan',
      },
      planName: 'free',
      planDisplayName: 'Free',
    };
    
    if (!subscriptionWithPlan || !subscriptionWithPlan.plan) {
      // Try to get free plan from database
      const [freePlan] = await db.select().from(plans).where(eq(plans.name, 'free')).limit(1);
      if (freePlan) {
        return {
          maxAgents: freePlan.maxAgents,
          maxCampaigns: freePlan.maxCampaigns,
          maxContactsPerCampaign: freePlan.maxContactsPerCampaign,
          maxWebhooks: freePlan.maxWebhooks ?? 3,
          maxKnowledgeBases: freePlan.maxKnowledgeBases ?? 5,
          maxFlows: freePlan.maxFlows ?? 3,
          maxPhoneNumbers: freePlan.maxPhoneNumbers ?? 0,
          includedCredits: freePlan.includedCredits,
          sources: {
            maxAgents: 'plan',
            maxCampaigns: 'plan',
            maxContactsPerCampaign: 'plan',
            maxWebhooks: 'plan',
            maxKnowledgeBases: 'plan',
            maxFlows: 'plan',
            maxPhoneNumbers: 'plan',
            includedCredits: 'plan',
          },
          planName: freePlan.name,
          planDisplayName: freePlan.displayName,
        };
      }
      return defaultLimits;
    }
    
    const plan = subscriptionWithPlan.plan;
    const sub = subscriptionWithPlan;
    
    // Calculate effective limits - override takes precedence if set (not null)
    return {
      maxAgents: sub.overrideMaxAgents ?? plan.maxAgents,
      maxCampaigns: sub.overrideMaxCampaigns ?? plan.maxCampaigns,
      maxContactsPerCampaign: sub.overrideMaxContactsPerCampaign ?? plan.maxContactsPerCampaign,
      maxWebhooks: sub.overrideMaxWebhooks ?? plan.maxWebhooks ?? 3,
      maxKnowledgeBases: sub.overrideMaxKnowledgeBases ?? plan.maxKnowledgeBases ?? 5,
      maxFlows: sub.overrideMaxFlows ?? plan.maxFlows ?? 3,
      maxPhoneNumbers: sub.overrideMaxPhoneNumbers ?? plan.maxPhoneNumbers ?? 0,
      includedCredits: sub.overrideIncludedCredits ?? plan.includedCredits,
      sources: {
        maxAgents: sub.overrideMaxAgents !== null ? 'override' : 'plan',
        maxCampaigns: sub.overrideMaxCampaigns !== null ? 'override' : 'plan',
        maxContactsPerCampaign: sub.overrideMaxContactsPerCampaign !== null ? 'override' : 'plan',
        maxWebhooks: sub.overrideMaxWebhooks !== null ? 'override' : 'plan',
        maxKnowledgeBases: sub.overrideMaxKnowledgeBases !== null ? 'override' : 'plan',
        maxFlows: sub.overrideMaxFlows !== null ? 'override' : 'plan',
        maxPhoneNumbers: sub.overrideMaxPhoneNumbers !== null ? 'override' : 'plan',
        includedCredits: sub.overrideIncludedCredits !== null ? 'override' : 'plan',
      },
      planName: plan.name,
      planDisplayName: plan.displayName,
    };
  }

  // Phone Numbers
  async getPhoneNumber(id: string): Promise<PhoneNumber | undefined> {
    const [phoneNumber] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
    return phoneNumber;
  }

  async getUserPhoneNumbers(userId: string): Promise<PhoneNumber[]> {
    return db.select().from(phoneNumbers).where(eq(phoneNumbers.userId, userId));
  }

  async getAllPhoneNumbers(): Promise<PhoneNumber[]> {
    return db.select().from(phoneNumbers);
  }

  async createPhoneNumber(insertPhoneNumber: InsertPhoneNumber): Promise<PhoneNumber> {
    const [phoneNumber] = await db.insert(phoneNumbers).values(insertPhoneNumber).returning();
    return phoneNumber;
  }

  async updatePhoneNumber(id: string, phoneNumber: Partial<InsertPhoneNumber>): Promise<void> {
    await db.update(phoneNumbers).set(phoneNumber).where(eq(phoneNumbers.id, id));
  }

  async deletePhoneNumber(id: string): Promise<void> {
    await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id));
  }

  // Usage Records
  async createUsageRecord(insertRecord: InsertUsageRecord): Promise<UsageRecord> {
    const [record] = await db.insert(usageRecords).values(insertRecord).returning();
    return record;
  }

  async getUserUsageRecords(userId: string): Promise<UsageRecord[]> {
    return db.select().from(usageRecords).where(eq(usageRecords.userId, userId));
  }

  // Analytics methods - delegate to extracted helper functions
  async getUserAnalytics(userId: string, timeRange: string = '7days', callType: string = 'all') {
    return calculateUserAnalytics(userId, timeRange, callType);
  }

  async getDashboardData(userId: string) {
    return calculateDashboardData(userId);
  }

  // Webhooks (Subscriptions)
  async getWebhook(id: string): Promise<Webhook | undefined> {
    const [webhook] = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
    return webhook;
  }

  async getUserWebhooks(userId: string): Promise<Webhook[]> {
    return await db.select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.userId, userId))
      .orderBy(desc(webhookSubscriptions.createdAt));
  }

  async getUserWebhookCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.userId, userId));
    return Number(result[0]?.count || 0);
  }

  async getWebhooksForEvent(userId: string, event: string, campaignId?: string): Promise<Webhook[]> {
    const allUserWebhooks = await db.select()
      .from(webhookSubscriptions)
      .where(and(
        eq(webhookSubscriptions.userId, userId),
        eq(webhookSubscriptions.isActive, true)
      ));
    
    return allUserWebhooks.filter(webhook => {
      if (!webhook.events.includes(event)) return false;
      if (campaignId && webhook.campaignIds && webhook.campaignIds.length > 0) {
        return webhook.campaignIds.includes(campaignId);
      }
      return true;
    });
  }

  async createWebhook(webhook: InsertWebhook): Promise<Webhook> {
    const [newWebhook] = await db.insert(webhookSubscriptions).values({
      ...webhook,
      id: nanoid(),
    } as typeof webhookSubscriptions.$inferInsert).returning();
    return newWebhook;
  }

  async updateWebhook(id: string, webhook: Partial<InsertWebhook>): Promise<void> {
    const updateData = { ...webhook, updatedAt: new Date() } as typeof webhookSubscriptions.$inferInsert;
    await db.update(webhookSubscriptions)
      .set(updateData)
      .where(eq(webhookSubscriptions.id, id));
  }

  async deleteWebhook(id: string): Promise<void> {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
  }

  // Webhook Delivery Logs
  async getWebhookLog(id: number): Promise<WebhookLog | undefined> {
    const [log] = await db.select().from(webhookDeliveryLogs).where(eq(webhookDeliveryLogs.id, id));
    return log;
  }

  async getWebhookLogs(webhookId: string, limit: number = 50): Promise<WebhookLog[]> {
    return await db.select()
      .from(webhookDeliveryLogs)
      .where(eq(webhookDeliveryLogs.webhookId, webhookId))
      .orderBy(desc(webhookDeliveryLogs.createdAt))
      .limit(limit);
  }

  async createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog> {
    const [newLog] = await db.insert(webhookDeliveryLogs).values(log).returning();
    return newLog;
  }

  async updateWebhookLog(id: number, log: Partial<InsertWebhookLog>): Promise<void> {
    await db.update(webhookDeliveryLogs)
      .set(log)
      .where(eq(webhookDeliveryLogs.id, id));
  }

  async getFailedWebhookLogs(limit: number = 100): Promise<WebhookLog[]> {
    return await db.select()
      .from(webhookDeliveryLogs)
      .where(and(
        eq(webhookDeliveryLogs.success, false),
        isNotNull(webhookDeliveryLogs.nextRetryAt)
      ))
      .orderBy(asc(webhookDeliveryLogs.nextRetryAt))
      .limit(limit);
  }

  // Notifications
  async getNotification(id: string): Promise<Notification | undefined> {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    return notification;
  }

  async getUserNotifications(userId: string, limit = 50): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return Number(result[0]?.count || 0);
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }

  async markNotificationAsRead(id: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId));
  }

  async getBannerNotifications(userId: string): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        or(
          eq(notifications.displayType, 'banner'),
          eq(notifications.displayType, 'both')
        ),
        eq(notifications.isDismissed, false),
        or(
          isNull(notifications.expiresAt),
          gte(notifications.expiresAt, new Date())
        )
      ))
      .orderBy(desc(notifications.priority), desc(notifications.createdAt));
  }

  async dismissNotification(id: string, userId?: string): Promise<void> {
    if (userId) {
      await db.update(notifications)
        .set({ isDismissed: true })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    } else {
      await db.update(notifications)
        .set({ isDismissed: true })
        .where(eq(notifications.id, id));
    }
  }

  async deleteNotification(id: string): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  // Email Templates
  async getEmailTemplates(): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates).orderBy(emailTemplates.templateType);
  }

  async getEmailTemplate(templateType: string): Promise<EmailTemplate | undefined> {
    const [template] = await db.select()
      .from(emailTemplates)
      .where(eq(emailTemplates.templateType, templateType));
    return template;
  }

  async updateEmailTemplate(id: string, data: Partial<EmailTemplate>): Promise<void> {
    await db.update(emailTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(emailTemplates.id, id));
  }

  async createEmailTemplate(data: InsertEmailTemplate): Promise<EmailTemplate> {
    const [template] = await db.insert(emailTemplates).values(data).returning();
    return template;
  }

  // Prompt Templates
  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    const [template] = await db.select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id));
    return template;
  }

  async getUserPromptTemplates(userId: string): Promise<PromptTemplate[]> {
    return await db.select()
      .from(promptTemplates)
      .where(eq(promptTemplates.userId, userId))
      .orderBy(desc(promptTemplates.createdAt));
  }

  async getSystemPromptTemplates(): Promise<PromptTemplate[]> {
    return await db.select()
      .from(promptTemplates)
      .where(eq(promptTemplates.isSystemTemplate, true))
      .orderBy(asc(promptTemplates.category), asc(promptTemplates.name));
  }

  async getPublicPromptTemplates(): Promise<PromptTemplate[]> {
    return await db.select()
      .from(promptTemplates)
      .where(eq(promptTemplates.isPublic, true))
      .orderBy(desc(promptTemplates.usageCount), asc(promptTemplates.name));
  }

  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const [newTemplate] = await db.insert(promptTemplates).values(template).returning();
    return newTemplate;
  }

  async updatePromptTemplate(id: string, template: Partial<InsertPromptTemplate>): Promise<void> {
    await db.update(promptTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(eq(promptTemplates.id, id));
  }

  async deletePromptTemplate(id: string): Promise<void> {
    await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  }

  async incrementPromptTemplateUsage(id: string): Promise<void> {
    await db.update(promptTemplates)
      .set({ 
        usageCount: sql`${promptTemplates.usageCount} + 1`,
        updatedAt: new Date()
      })
      .where(eq(promptTemplates.id, id));
  }

  // Agent Versions
  async getAgentVersion(id: string): Promise<AgentVersion | undefined> {
    const [version] = await db.select()
      .from(agentVersions)
      .where(eq(agentVersions.id, id));
    return version;
  }

  async getAgentVersions(agentId: string): Promise<AgentVersion[]> {
    return await db.select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.versionNumber));
  }

  async getAgentVersionByNumber(agentId: string, versionNumber: number): Promise<AgentVersion | undefined> {
    const [version] = await db.select()
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.versionNumber, versionNumber)
      ));
    return version;
  }

  async getLatestAgentVersion(agentId: string): Promise<AgentVersion | undefined> {
    const [version] = await db.select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.versionNumber))
      .limit(1);
    return version;
  }

  async createAgentVersion(version: InsertAgentVersion): Promise<AgentVersion> {
    const [newVersion] = await db.insert(agentVersions).values(version as typeof agentVersions.$inferInsert).returning();
    return newVersion;
  }

  // SEO Settings
  async getSeoSettings(): Promise<SeoSettings | undefined> {
    const [settings] = await db.select().from(seoSettings).limit(1);
    return settings;
  }

  async updateSeoSettings(settings: Partial<InsertSeoSettings>): Promise<SeoSettings> {
    const existing = await this.getSeoSettings();
    
    if (existing) {
      const updateData = { ...settings, updatedAt: new Date() } as typeof seoSettings.$inferInsert;
      const [updated] = await db.update(seoSettings)
        .set(updateData)
        .where(eq(seoSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(seoSettings)
        .values(settings as typeof seoSettings.$inferInsert)
        .returning();
      return created;
    }
  }

  // Analytics Scripts
  async getAnalyticsScript(id: string): Promise<AnalyticsScript | undefined> {
    const [script] = await db.select().from(analyticsScripts).where(eq(analyticsScripts.id, id));
    return script;
  }

  async getAllAnalyticsScripts(): Promise<AnalyticsScript[]> {
    return db.select()
      .from(analyticsScripts)
      .orderBy(desc(analyticsScripts.loadPriority), asc(analyticsScripts.createdAt));
  }

  async getEnabledAnalyticsScripts(): Promise<AnalyticsScript[]> {
    return db.select()
      .from(analyticsScripts)
      .where(eq(analyticsScripts.enabled, true))
      .orderBy(desc(analyticsScripts.loadPriority), asc(analyticsScripts.createdAt));
  }

  async createAnalyticsScript(script: InsertAnalyticsScript): Promise<AnalyticsScript> {
    const [created] = await db.insert(analyticsScripts).values(script as typeof analyticsScripts.$inferInsert).returning();
    return created;
  }

  async updateAnalyticsScript(id: string, script: Partial<InsertAnalyticsScript>): Promise<void> {
    const updateData: Partial<typeof analyticsScripts.$inferInsert> = { ...script, updatedAt: new Date() };
    await db.update(analyticsScripts)
      .set(updateData)
      .where(eq(analyticsScripts.id, id));
  }

  async deleteAnalyticsScript(id: string): Promise<void> {
    await db.delete(analyticsScripts).where(eq(analyticsScripts.id, id));
  }

  // Payment Transactions
  async getPaymentTransaction(id: string): Promise<PaymentTransaction | undefined> {
    const [transaction] = await db.select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, id));
    return transaction;
  }

  async getPaymentTransactionByGatewayId(gateway: string, gatewayTransactionId: string): Promise<PaymentTransaction | undefined> {
    const [transaction] = await db.select()
      .from(paymentTransactions)
      .where(and(
        eq(paymentTransactions.gateway, gateway),
        eq(paymentTransactions.gatewayTransactionId, gatewayTransactionId)
      ));
    return transaction;
  }

  async getUserPaymentTransactions(userId: string): Promise<PaymentTransaction[]> {
    return db.select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.userId, userId))
      .orderBy(desc(paymentTransactions.createdAt));
  }

  async getAllPaymentTransactions(filters?: { gateway?: string; type?: string; status?: string; startDate?: Date; endDate?: Date }): Promise<PaymentTransaction[]> {
    const conditions = [];
    
    if (filters?.gateway) {
      conditions.push(eq(paymentTransactions.gateway, filters.gateway));
    }
    if (filters?.type) {
      conditions.push(eq(paymentTransactions.type, filters.type));
    }
    if (filters?.status) {
      conditions.push(eq(paymentTransactions.status, filters.status));
    }
    if (filters?.startDate) {
      conditions.push(gte(paymentTransactions.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(paymentTransactions.createdAt, filters.endDate));
    }

    if (conditions.length > 0) {
      return db.select()
        .from(paymentTransactions)
        .where(and(...conditions))
        .orderBy(desc(paymentTransactions.createdAt));
    }

    return db.select()
      .from(paymentTransactions)
      .orderBy(desc(paymentTransactions.createdAt));
  }

  async createPaymentTransaction(transaction: InsertPaymentTransaction): Promise<PaymentTransaction> {
    const [created] = await db.insert(paymentTransactions)
      .values(transaction)
      .returning();
    return created;
  }

  async updatePaymentTransaction(id: string, transaction: Partial<InsertPaymentTransaction>): Promise<void> {
    await db.update(paymentTransactions)
      .set({ ...transaction, updatedAt: new Date() })
      .where(eq(paymentTransactions.id, id));
  }

  async getPaymentAnalytics(startDate?: Date, endDate?: Date): Promise<{
    totalRevenue: number;
    revenueByGateway: Record<string, number>;
    revenueByType: Record<string, number>;
    transactionCount: number;
    transactionsByStatus: Record<string, number>;
    refundCount: number;
    totalRefunded: number;
  }> {
    // Include completed, refunded, and partially_refunded transactions for revenue
    // These all represent successful payments that were collected
    const revenueStatuses = ['completed', 'refunded', 'partially_refunded'];
    const conditions: any[] = [];
    if (startDate) conditions.push(gte(paymentTransactions.createdAt, startDate));
    if (endDate) conditions.push(lte(paymentTransactions.createdAt, endDate));

    const transactions = await db.select()
      .from(paymentTransactions)
      .where(
        conditions.length > 0
          ? and(
              inArray(paymentTransactions.status, revenueStatuses),
              ...conditions
            )
          : inArray(paymentTransactions.status, revenueStatuses)
      );

    // Get all transactions within date range (ignoring status filter for counts)
    const dateConditions: any[] = [];
    if (startDate) dateConditions.push(gte(paymentTransactions.createdAt, startDate));
    if (endDate) dateConditions.push(lte(paymentTransactions.createdAt, endDate));

    const allTransactions = await db.select()
      .from(paymentTransactions)
      .where(dateConditions.length > 0 ? and(...dateConditions) : undefined);

    // Get refund data within date range
    const refundConditions: any[] = [];
    if (startDate) refundConditions.push(gte(refunds.createdAt, startDate));
    if (endDate) refundConditions.push(lte(refunds.createdAt, endDate));

    const allRefunds = await db.select()
      .from(refunds)
      .where(refundConditions.length > 0 ? and(...refundConditions) : undefined);

    let totalRevenue = 0;
    const revenueByGateway: Record<string, number> = {};
    const revenueByType: Record<string, number> = {};
    const transactionsByStatus: Record<string, number> = {};

    for (const tx of transactions) {
      const amount = parseFloat(tx.amount || '0');
      totalRevenue += amount;
      revenueByGateway[tx.gateway] = (revenueByGateway[tx.gateway] || 0) + amount;
      revenueByType[tx.type] = (revenueByType[tx.type] || 0) + amount;
    }

    for (const tx of allTransactions) {
      transactionsByStatus[tx.status] = (transactionsByStatus[tx.status] || 0) + 1;
    }

    // Calculate refund totals
    let totalRefunded = 0;
    for (const refund of allRefunds) {
      totalRefunded += parseFloat(refund.amount || '0');
    }

    return {
      totalRevenue,
      revenueByGateway,
      revenueByType,
      transactionCount: allTransactions.length,
      transactionsByStatus,
      refundCount: allRefunds.length,
      totalRefunded,
    };
  }

  // Refunds
  async getRefund(id: string): Promise<Refund | undefined> {
    const [refund] = await db.select()
      .from(refunds)
      .where(eq(refunds.id, id));
    return refund;
  }

  async getTransactionRefunds(transactionId: string): Promise<Refund[]> {
    return db.select()
      .from(refunds)
      .where(eq(refunds.transactionId, transactionId))
      .orderBy(desc(refunds.createdAt));
  }

  async getUserRefunds(userId: string): Promise<Refund[]> {
    return db.select()
      .from(refunds)
      .where(eq(refunds.userId, userId))
      .orderBy(desc(refunds.createdAt));
  }

  async getAllRefunds(): Promise<Refund[]> {
    return db.select()
      .from(refunds)
      .orderBy(desc(refunds.createdAt));
  }

  async createRefund(refund: InsertRefund): Promise<Refund> {
    const [created] = await db.insert(refunds)
      .values(refund)
      .returning();
    return created;
  }

  async updateRefund(id: string, refund: Partial<InsertRefund>): Promise<void> {
    await db.update(refunds)
      .set({ ...refund, updatedAt: new Date() })
      .where(eq(refunds.id, id));
  }

  // Invoices
  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select()
      .from(invoices)
      .where(eq(invoices.id, id));
    return invoice;
  }

  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select()
      .from(invoices)
      .where(eq(invoices.invoiceNumber, invoiceNumber));
    return invoice;
  }

  async getTransactionInvoice(transactionId: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select()
      .from(invoices)
      .where(eq(invoices.transactionId, transactionId));
    return invoice;
  }

  async getUserInvoices(userId: string): Promise<Invoice[]> {
    return db.select()
      .from(invoices)
      .where(eq(invoices.userId, userId))
      .orderBy(desc(invoices.createdAt));
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return db.select()
      .from(invoices)
      .orderBy(desc(invoices.createdAt));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [created] = await db.insert(invoices)
      .values(invoice)
      .returning();
    return created;
  }

  async updateInvoice(id: string, invoice: Partial<InsertInvoice>): Promise<void> {
    await db.update(invoices)
      .set({ ...invoice, updatedAt: new Date() })
      .where(eq(invoices.id, id));
  }

  async getNextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    
    // Get configurable prefix from global_settings (default: INV)
    const [prefixSetting] = await db.select()
      .from(globalSettings)
      .where(eq(globalSettings.key, 'invoice_prefix'));
    let rawPrefix = prefixSetting?.value ? String(prefixSetting.value).replace(/"/g, '') : 'INV';
    // Sanitize prefix: only allow alphanumeric and underscore, max 10 chars
    const prefix = rawPrefix.replace(/[^A-Za-z0-9_]/g, '').substring(0, 10) || 'INV';
    
    // Get configurable starting number from global_settings (default: 1)
    const [startSetting] = await db.select()
      .from(globalSettings)
      .where(eq(globalSettings.key, 'invoice_start_number'));
    const startNumber = startSetting?.value ? parseInt(String(startSetting.value).replace(/"/g, ''), 10) || 1 : 1;
    
    // Find the maximum invoice number for this prefix and year
    // Extract the numeric suffix and find the max to avoid ordering issues
    const likePattern = `${prefix}-${year}-%`;
    const result = await db.execute(sql`
      SELECT MAX(CAST(SPLIT_PART(${invoices.invoiceNumber}, '-', 3) AS INTEGER)) as max_num
      FROM ${invoices}
      WHERE ${invoices.invoiceNumber} LIKE ${likePattern}
    `);

    // Start with configured starting number
    let nextNum = startNumber;
    const maxNum = result.rows?.[0]?.max_num;
    if (maxNum !== null && maxNum !== undefined && !isNaN(Number(maxNum))) {
      // Use the higher of (maxNum + 1) or startNumber to respect configured minimum
      nextNum = Math.max(Number(maxNum) + 1, startNumber);
    }

    return `${prefix}-${year}-${String(nextNum).padStart(5, '0')}`;
  }

  async getNextRefundNoteNumber(): Promise<string> {
    // Get configurable prefix from global_settings (default: RF for Refund)
    const [prefixSetting] = await db.select()
      .from(globalSettings)
      .where(eq(globalSettings.key, 'refund_note_prefix'));
    let rawPrefix = prefixSetting?.value ? String(prefixSetting.value).replace(/"/g, '') : 'RF';
    const prefix = rawPrefix.replace(/[^A-Za-z0-9]/g, '').substring(0, 10) || 'RF';
    
    // Find the maximum refund note number with simple format (RF01, RF02, etc.)
    // Extract numeric suffix from refund_note_number like 'RF01', 'RF02', etc.
    const result = await db.execute(sql`
      SELECT MAX(
        CAST(
          REGEXP_REPLACE(refund_note_number, '^[A-Za-z]+', '', 'g') 
          AS INTEGER
        )
      ) as max_num
      FROM refunds
      WHERE refund_note_number ~ ${`^${prefix}[0-9]+$`}
    `);

    let nextNum = 1;
    const maxNum = result.rows?.[0]?.max_num;
    if (maxNum !== null && maxNum !== undefined && !isNaN(Number(maxNum))) {
      nextNum = Number(maxNum) + 1;
    }

    // Simple format: RF01, RF02, RF03...
    return `${prefix}${String(nextNum).padStart(2, '0')}`;
  }

  // Payment Webhook Queue
  async getWebhookQueueItem(id: string): Promise<PaymentWebhookQueue | undefined> {
    const [item] = await db.select()
      .from(paymentWebhookQueue)
      .where(eq(paymentWebhookQueue.id, id));
    return item;
  }

  async getPendingWebhooks(): Promise<PaymentWebhookQueue[]> {
    return db.select()
      .from(paymentWebhookQueue)
      .where(eq(paymentWebhookQueue.status, 'pending'))
      .orderBy(asc(paymentWebhookQueue.receivedAt));
  }

  async getWebhookByEventId(gateway: string, eventId: string): Promise<PaymentWebhookQueue | undefined> {
    const [item] = await db.select()
      .from(paymentWebhookQueue)
      .where(and(
        eq(paymentWebhookQueue.gateway, gateway),
        eq(paymentWebhookQueue.eventId, eventId)
      ));
    return item;
  }

  async createWebhookQueueItem(item: InsertPaymentWebhookQueue): Promise<PaymentWebhookQueue> {
    const [created] = await db.insert(paymentWebhookQueue)
      .values(item)
      .returning();
    return created;
  }

  async updateWebhookQueueItem(id: string, item: Partial<InsertPaymentWebhookQueue>): Promise<void> {
    await db.update(paymentWebhookQueue)
      .set(item)
      .where(eq(paymentWebhookQueue.id, id));
  }

  async getExpiredWebhooks(): Promise<PaymentWebhookQueue[]> {
    const now = new Date();
    return db.select()
      .from(paymentWebhookQueue)
      .where(and(
        eq(paymentWebhookQueue.status, 'pending'),
        lte(paymentWebhookQueue.expiresAt, now)
      ));
  }

  async getRetryableWebhooks(): Promise<PaymentWebhookQueue[]> {
    const now = new Date();
    return db.select()
      .from(paymentWebhookQueue)
      .where(and(
        or(
          eq(paymentWebhookQueue.status, 'pending'),
          eq(paymentWebhookQueue.status, 'failed')
        ),
        sql`${paymentWebhookQueue.attemptCount} < ${paymentWebhookQueue.maxAttempts}`,
        or(
          isNull(paymentWebhookQueue.nextRetryAt),
          lte(paymentWebhookQueue.nextRetryAt, now)
        ),
        gte(paymentWebhookQueue.expiresAt, now)
      ))
      .orderBy(asc(paymentWebhookQueue.receivedAt));
  }

  // Email Notification Settings
  async getEmailNotificationSetting(eventType: string): Promise<EmailNotificationSettings | undefined> {
    const [setting] = await db.select()
      .from(emailNotificationSettings)
      .where(eq(emailNotificationSettings.eventType, eventType));
    return setting;
  }

  async getAllEmailNotificationSettings(): Promise<EmailNotificationSettings[]> {
    return db.select()
      .from(emailNotificationSettings)
      .orderBy(asc(emailNotificationSettings.category), asc(emailNotificationSettings.eventType));
  }

  async getEmailNotificationSettingsByCategory(category: string): Promise<EmailNotificationSettings[]> {
    return db.select()
      .from(emailNotificationSettings)
      .where(eq(emailNotificationSettings.category, category))
      .orderBy(asc(emailNotificationSettings.eventType));
  }

  async createEmailNotificationSetting(setting: InsertEmailNotificationSettings): Promise<EmailNotificationSettings> {
    const [created] = await db.insert(emailNotificationSettings)
      .values(setting)
      .returning();
    return created;
  }

  async updateEmailNotificationSetting(eventType: string, setting: Partial<InsertEmailNotificationSettings>): Promise<void> {
    await db.update(emailNotificationSettings)
      .set({ ...setting, updatedAt: new Date() })
      .where(eq(emailNotificationSettings.eventType, eventType));
  }

  // Admin Call Monitoring
  async getAdminCalls(options: {
    page?: number;
    pageSize?: number;
    userId?: string;
    status?: string;
    hasViolations?: boolean;
    startDate?: Date;
    endDate?: Date;
    search?: string;
  }): Promise<{
    data: any[];
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  }> {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const conditions: any[] = [];

    if (options.userId) {
      conditions.push(eq(calls.userId, options.userId));
    }
    if (options.status) {
      conditions.push(eq(calls.status, options.status));
    }
    if (options.startDate) {
      conditions.push(gte(calls.createdAt, options.startDate));
    }
    if (options.endDate) {
      conditions.push(lte(calls.createdAt, options.endDate));
    }
    if (options.search) {
      conditions.push(
        or(
          sql`${calls.phoneNumber} ILIKE ${`%${options.search}%`}`,
          sql`${calls.transcript} ILIKE ${`%${options.search}%`}`
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const violationCountSubquery = db
      .select({
        callId: contentViolations.callId,
        count: sql<number>`count(*)`.as('violation_count'),
        summary: sql<string>`string_agg(${contentViolations.detectedWord}, ', ' ORDER BY ${contentViolations.createdAt} DESC)`.as('violation_summary'),
      })
      .from(contentViolations)
      .groupBy(contentViolations.callId)
      .as('violation_counts');

    let query = db
      .select({
        call: calls,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
        },
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
        },
        violationCount: sql<number>`COALESCE(${violationCountSubquery.count}, 0)`,
        violationSummary: sql<string>`${violationCountSubquery.summary}`,
      })
      .from(calls)
      .leftJoin(users, eq(calls.userId, users.id))
      .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
      .leftJoin(violationCountSubquery, eq(calls.id, violationCountSubquery.callId));

    if (whereClause) {
      query = query.where(whereClause) as typeof query;
    }

    if (options.hasViolations === true) {
      query = query.where(sql`COALESCE(${violationCountSubquery.count}, 0) > 0`) as typeof query;
    } else if (options.hasViolations === false) {
      query = query.where(sql`COALESCE(${violationCountSubquery.count}, 0) = 0`) as typeof query;
    }

    const results = await query
      .orderBy(desc(calls.createdAt))
      .limit(pageSize)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(calls)
      .where(whereClause);
    const totalItems = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      data: results.map((r) => ({
        ...r.call,
        user: r.user,
        campaign: r.campaign,
        violationCount: Number(r.violationCount),
        violationSummary: r.violationSummary || null,
      })),
      pagination: { page, pageSize, totalItems, totalPages },
    };
  }

  async getAdminCallById(id: string): Promise<any | undefined> {
    const [result] = await db
      .select({
        call: calls,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
        },
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
        },
        contact: {
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          phone: contacts.phone,
          email: contacts.email,
        },
      })
      .from(calls)
      .leftJoin(users, eq(calls.userId, users.id))
      .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
      .leftJoin(contacts, eq(calls.contactId, contacts.id))
      .where(eq(calls.id, id));

    if (!result) return undefined;

    const violations = await this.getViolationsByCallId(id);

    return {
      ...result.call,
      user: result.user,
      campaign: result.campaign,
      contact: result.contact,
      violations,
    };
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.getUser(id);
  }

  // Content Violations
  async getViolationsByCallId(callId: string): Promise<ContentViolation[]> {
    return db
      .select()
      .from(contentViolations)
      .where(eq(contentViolations.callId, callId))
      .orderBy(desc(contentViolations.createdAt));
  }

  async getContentViolations(options: {
    page?: number;
    pageSize?: number;
    userId?: string;
    status?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    data: any[];
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  }> {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const conditions: any[] = [];

    if (options.userId) {
      conditions.push(eq(contentViolations.userId, options.userId));
    }
    if (options.status) {
      conditions.push(eq(contentViolations.status, options.status));
    }
    if (options.severity) {
      conditions.push(eq(contentViolations.severity, options.severity));
    }
    if (options.startDate) {
      conditions.push(gte(contentViolations.createdAt, options.startDate));
    }
    if (options.endDate) {
      conditions.push(lte(contentViolations.createdAt, options.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let query = db
      .select({
        violation: contentViolations,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
        },
        call: {
          id: calls.id,
          phoneNumber: calls.phoneNumber,
          status: calls.status,
        },
      })
      .from(contentViolations)
      .leftJoin(users, eq(contentViolations.userId, users.id))
      .leftJoin(calls, eq(contentViolations.callId, calls.id));

    if (whereClause) {
      query = query.where(whereClause) as typeof query;
    }

    const results = await query
      .orderBy(desc(contentViolations.createdAt))
      .limit(pageSize)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(contentViolations)
      .where(whereClause);
    const totalItems = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      data: results.map((r) => ({
        ...r.violation,
        user: r.user,
        call: r.call,
      })),
      pagination: { page, pageSize, totalItems, totalPages },
    };
  }

  async updateContentViolation(id: string, data: Partial<InsertContentViolation>): Promise<ContentViolation | undefined> {
    const [updated] = await db.update(contentViolations).set(data).where(eq(contentViolations.id, id)).returning();
    return updated;
  }

  async createContentViolation(data: InsertContentViolation): Promise<ContentViolation> {
    const [violation] = await db.insert(contentViolations).values(data).returning();
    return violation;
  }

  // Banned Words
  async getBannedWords(): Promise<BannedWord[]> {
    return db.select().from(bannedWords).orderBy(asc(bannedWords.word));
  }

  async getActiveBannedWords(): Promise<BannedWord[]> {
    return db.select().from(bannedWords).where(eq(bannedWords.isActive, true)).orderBy(asc(bannedWords.word));
  }

  async createBannedWord(data: InsertBannedWord): Promise<BannedWord> {
    const [word] = await db.insert(bannedWords).values(data).returning();
    return word;
  }

  async updateBannedWord(id: string, data: Partial<InsertBannedWord>): Promise<BannedWord | undefined> {
    const [updated] = await db.update(bannedWords).set({ ...data, updatedAt: new Date() }).where(eq(bannedWords.id, id)).returning();
    return updated;
  }

  async deleteBannedWord(id: string): Promise<boolean> {
    const result = await db.delete(bannedWords).where(eq(bannedWords.id, id)).returning();
    return result.length > 0;
  }

  async getCallsWithTranscripts(): Promise<Call[]> {
    return db
      .select()
      .from(calls)
      .where(and(
        isNotNull(calls.transcript),
        sql`${calls.transcript} != ''`
      ));
  }

  // Demo Sessions - Browser-based demo calls
  async createDemoSession(data: InsertDemoSession): Promise<DemoSession> {
    const [session] = await db.insert(demoSessions).values(data).returning();
    return session;
  }

  async getDemoSession(id: string): Promise<DemoSession | undefined> {
    const [session] = await db.select().from(demoSessions).where(eq(demoSessions.id, id));
    return session;
  }

  async getDemoSessionByToken(token: string): Promise<DemoSession | undefined> {
    const [session] = await db.select().from(demoSessions).where(eq(demoSessions.sessionToken, token));
    return session;
  }

  async updateDemoSession(id: string, data: Partial<InsertDemoSession>): Promise<void> {
    await db.update(demoSessions).set(data).where(eq(demoSessions.id, id));
  }

  async getActiveDemoSessionCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(demoSessions)
      .where(eq(demoSessions.status, 'active'));
    return Number(result[0]?.count || 0);
  }

  async getRecentDemoSessionByIp(ip: string, cooldownMinutes: number): Promise<DemoSession | undefined> {
    const cooldownTime = new Date(Date.now() - cooldownMinutes * 60 * 1000);
    const [session] = await db
      .select()
      .from(demoSessions)
      .where(and(
        eq(demoSessions.visitorIp, ip),
        gte(demoSessions.createdAt, cooldownTime)
      ))
      .orderBy(desc(demoSessions.createdAt))
      .limit(1);
    return session;
  }

  async getDemoSessionStats(days: number = 30): Promise<{
    totalSessions: number;
    completedSessions: number;
    averageDuration: number;
    languageBreakdown: Record<string, number>;
  }> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const sessions = await db
      .select()
      .from(demoSessions)
      .where(gte(demoSessions.createdAt, startDate));

    const completed = sessions.filter(s => s.status === 'completed');
    const totalDuration = completed.reduce((sum, s) => sum + (s.duration || 0), 0);
    
    const languageBreakdown: Record<string, number> = {};
    for (const session of sessions) {
      languageBreakdown[session.language] = (languageBreakdown[session.language] || 0) + 1;
    }

    return {
      totalSessions: sessions.length,
      completedSessions: completed.length,
      averageDuration: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
      languageBreakdown,
    };
  }
}

export const storage = new DbStorage();
