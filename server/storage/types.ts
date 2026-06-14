'use strict';
import type {
  User, InsertUser,
  Agent, InsertAgent,
  KnowledgeBase as KnowledgeBaseType, InsertKnowledgeBase,
  Campaign, InsertCampaign,
  Contact, InsertContact,
  Call, InsertCall,
  CreditTransaction, InsertCreditTransaction,
  Tool, InsertTool,
  Voice, InsertVoice,
  Plan, InsertPlan,
  UserSubscription, InsertUserSubscription,
  PhoneNumber, InsertPhoneNumber,
  UsageRecord, InsertUsageRecord,
  GlobalSettings, InsertGlobalSettings,
  CreditPackage, InsertCreditPackage,
  Webhook, InsertWebhook,
  WebhookLog, InsertWebhookLog,
  PhoneNumberRental, InsertPhoneNumberRental,
  Notification, InsertNotification,
  EmailTemplate, InsertEmailTemplate,
  PromptTemplate, InsertPromptTemplate,
  AgentVersion, InsertAgentVersion,
  SeoSettings, InsertSeoSettings,
  AnalyticsScript, InsertAnalyticsScript,
  PaymentTransaction, InsertPaymentTransaction,
  Refund, InsertRefund,
  Invoice, InsertInvoice,
  PaymentWebhookQueue, InsertPaymentWebhookQueue,
  EmailNotificationSettings, InsertEmailNotificationSettings,
  BannedWord, InsertBannedWord,
  ContentViolation, InsertContentViolation,
} from "@shared/schema";

export interface EffectiveLimits {
  maxAgents: number;
  maxCampaigns: number;
  maxContactsPerCampaign: number;
  maxWebhooks: number;
  maxKnowledgeBases: number;
  maxFlows: number;
  maxPhoneNumbers: number;
  includedCredits: number;
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

export interface IUserStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserCredits(userId: string, credits: number): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getAllAdminUsers(): Promise<User[]>;
  updateUser(id: string, user: Partial<User>): Promise<void>;
  getUserById(id: string): Promise<User | undefined>;
  getUserEffectiveLimits(userId: string): Promise<EffectiveLimits>;
}

export interface IAgentStorage {
  getAgent(id: string): Promise<Agent | undefined>;
  getUserAgents(userId: string): Promise<Agent[]>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  updateAgent(id: string, agent: Partial<InsertAgent>): Promise<void>;
  deleteAgent(id: string): Promise<void>;
  getAgentVersion(id: string): Promise<AgentVersion | undefined>;
  getAgentVersions(agentId: string): Promise<AgentVersion[]>;
  getAgentVersionByNumber(agentId: string, versionNumber: number): Promise<AgentVersion | undefined>;
  getLatestAgentVersion(agentId: string): Promise<AgentVersion | undefined>;
  createAgentVersion(version: InsertAgentVersion): Promise<AgentVersion>;
}

export interface IKnowledgeBaseStorage {
  getKnowledgeBaseItem(id: string): Promise<KnowledgeBaseType | undefined>;
  getUserKnowledgeBase(userId: string): Promise<KnowledgeBaseType[]>;
  getUserKnowledgeBaseCount(userId: string): Promise<number>;
  createKnowledgeBaseItem(item: InsertKnowledgeBase): Promise<KnowledgeBaseType>;
  updateKnowledgeBaseItem(id: string, item: Partial<InsertKnowledgeBase>): Promise<void>;
  deleteKnowledgeBaseItem(id: string): Promise<void>;
}

export interface ICampaignStorage {
  getCampaign(id: string): Promise<Campaign | undefined>;
  getCampaignIncludingDeleted(id: string): Promise<Campaign | undefined>;
  getUserCampaigns(userId: string): Promise<Campaign[]>;
  getUserDeletedCampaigns(userId: string): Promise<Campaign[]>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: string, campaign: Partial<InsertCampaign>): Promise<void>;
  deleteCampaign(id: string): Promise<void>;
  restoreCampaign(id: string): Promise<void>;
}

export interface IContactStorage {
  getContact(id: string): Promise<Contact | undefined>;
  getCampaignContacts(campaignId: string): Promise<Contact[]>;
  getUserContacts(userId: string): Promise<any[]>;
  getUserContactsDeduplicated(userId: string): Promise<any[]>;
  createContact(contact: InsertContact): Promise<Contact>;
  createContacts(contacts: InsertContact[]): Promise<Contact[]>;
}

export interface ICallStorage {
  getCall(id: string): Promise<Call | undefined>;
  getCampaignCalls(campaignId: string): Promise<Call[]>;
  getUserCalls(userId: string): Promise<Call[]>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, call: Partial<InsertCall>): Promise<void>;
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
  getCallsWithTranscripts(): Promise<Call[]>;
}

export interface ICreditStorage {
  getCreditTransaction(id: string): Promise<CreditTransaction | undefined>;
  getUserCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  createCreditTransaction(transaction: InsertCreditTransaction): Promise<CreditTransaction>;
  addCreditsAtomic(userId: string, credits: number, description: string, stripePaymentId: string): Promise<void>;
}

export interface IToolStorage {
  getTool(id: string): Promise<Tool | undefined>;
  getUserTools(userId: string): Promise<Tool[]>;
  createTool(tool: InsertTool): Promise<Tool>;
  updateTool(id: string, tool: Partial<InsertTool>): Promise<void>;
  deleteTool(id: string): Promise<void>;
}

export interface IVoiceStorage {
  getVoice(id: string): Promise<Voice | undefined>;
  getUserVoices(userId: string): Promise<Voice[]>;
  createVoice(voice: InsertVoice): Promise<Voice>;
  deleteVoice(id: string): Promise<void>;
}

export interface IPlanStorage {
  getPlan(id: string): Promise<Plan | undefined>;
  getAllPlans(): Promise<Plan[]>;
  createPlan(plan: InsertPlan): Promise<Plan>;
  updatePlan(id: string, plan: Partial<InsertPlan>): Promise<void>;
  deletePlan(id: string): Promise<void>;
}

export interface IPhoneNumberStorage {
  getPhoneNumber(id: string): Promise<PhoneNumber | undefined>;
  getUserPhoneNumbers(userId: string): Promise<PhoneNumber[]>;
  getAllPhoneNumbers(): Promise<PhoneNumber[]>;
  getSystemPhoneNumbers(): Promise<PhoneNumber[]>;
  createPhoneNumber(phoneNumber: InsertPhoneNumber): Promise<PhoneNumber>;
  updatePhoneNumber(id: string, phoneNumber: Partial<InsertPhoneNumber>): Promise<void>;
  deletePhoneNumber(id: string): Promise<void>;
  createPhoneNumberRental(rental: InsertPhoneNumberRental): Promise<PhoneNumberRental>;
  getPhoneNumberRentals(phoneNumberId: string): Promise<PhoneNumberRental[]>;
}

export interface ISubscriptionStorage {
  getUserSubscription(userId: string): Promise<any>;
  getUserSubscriptionByPaystackCode(subscriptionCode: string): Promise<UserSubscription | undefined>;
  getAllUserSubscriptions(): Promise<UserSubscription[]>;
  createUserSubscription(subscription: InsertUserSubscription): Promise<UserSubscription>;
  updateUserSubscription(id: string, subscription: Partial<InsertUserSubscription>): Promise<void>;
  updateUserSubscriptionByUserId(userId: string, subscription: Partial<InsertUserSubscription>): Promise<void>;
}

export interface ISettingsStorage {
  getGlobalSetting(key: string): Promise<GlobalSettings | undefined>;
  updateGlobalSetting(key: string, value: any): Promise<void>;
  getCreditPackage(id: string): Promise<CreditPackage | undefined>;
  getAllCreditPackages(): Promise<CreditPackage[]>;
  createCreditPackage(pack: InsertCreditPackage): Promise<CreditPackage>;
  updateCreditPackage(id: string, pack: Partial<InsertCreditPackage>): Promise<void>;
  getSeoSettings(): Promise<SeoSettings | undefined>;
  updateSeoSettings(settings: Partial<InsertSeoSettings>): Promise<SeoSettings>;
  getAnalyticsScript(id: string): Promise<AnalyticsScript | undefined>;
  getAllAnalyticsScripts(): Promise<AnalyticsScript[]>;
  getEnabledAnalyticsScripts(): Promise<AnalyticsScript[]>;
  createAnalyticsScript(script: InsertAnalyticsScript): Promise<AnalyticsScript>;
  updateAnalyticsScript(id: string, script: Partial<InsertAnalyticsScript>): Promise<void>;
  deleteAnalyticsScript(id: string): Promise<void>;
}

export interface IUsageStorage {
  createUsageRecord(record: InsertUsageRecord): Promise<UsageRecord>;
  getUserUsageRecords(userId: string): Promise<UsageRecord[]>;
}

export interface IAnalyticsStorage {
  getUserAnalytics(userId: string, timeRange: string, callType?: string): Promise<any>;
  getGlobalAnalytics(timeRange: string): Promise<any>;
}

export interface IWebhookStorage {
  getWebhook(id: string): Promise<Webhook | undefined>;
  getUserWebhooks(userId: string): Promise<Webhook[]>;
  getUserWebhookCount(userId: string): Promise<number>;
  getWebhooksForEvent(userId: string, event: string, campaignId?: string): Promise<Webhook[]>;
  createWebhook(webhook: InsertWebhook): Promise<Webhook>;
  updateWebhook(id: string, webhook: Partial<InsertWebhook>): Promise<void>;
  deleteWebhook(id: string): Promise<void>;
  getWebhookLog(id: number): Promise<WebhookLog | undefined>;
  getWebhookLogs(webhookId: string, limit?: number): Promise<WebhookLog[]>;
  createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog>;
  updateWebhookLog(id: number, log: Partial<InsertWebhookLog>): Promise<void>;
  getFailedWebhookLogs(limit?: number): Promise<WebhookLog[]>;
}

export interface INotificationStorage {
  getNotification(id: string): Promise<Notification | undefined>;
  getUserNotifications(userId: string, limit?: number): Promise<Notification[]>;
  getBannerNotifications(userId: string): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  dismissNotification(id: string, userId?: string): Promise<void>;
  deleteNotification(id: string): Promise<void>;
}

export interface ITemplateStorage {
  getEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(templateType: string): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(id: string, data: Partial<EmailTemplate>): Promise<void>;
  createEmailTemplate(data: InsertEmailTemplate): Promise<EmailTemplate>;
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  getUserPromptTemplates(userId: string): Promise<PromptTemplate[]>;
  getSystemPromptTemplates(): Promise<PromptTemplate[]>;
  getPublicPromptTemplates(): Promise<PromptTemplate[]>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, template: Partial<InsertPromptTemplate>): Promise<void>;
  deletePromptTemplate(id: string): Promise<void>;
  incrementPromptTemplateUsage(id: string): Promise<void>;
}

export interface IPaymentStorage {
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
  getRefund(id: string): Promise<Refund | undefined>;
  getTransactionRefunds(transactionId: string): Promise<Refund[]>;
  getUserRefunds(userId: string): Promise<Refund[]>;
  getAllRefunds(): Promise<Refund[]>;
  createRefund(refund: InsertRefund): Promise<Refund>;
  updateRefund(id: string, refund: Partial<InsertRefund>): Promise<void>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined>;
  getTransactionInvoice(transactionId: string): Promise<Invoice | undefined>;
  getUserInvoices(userId: string): Promise<Invoice[]>;
  getAllInvoices(): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, invoice: Partial<InsertInvoice>): Promise<void>;
  getNextInvoiceNumber(): Promise<string>;
  getWebhookQueueItem(id: string): Promise<PaymentWebhookQueue | undefined>;
  getPendingWebhooks(): Promise<PaymentWebhookQueue[]>;
  getWebhookByEventId(gateway: string, eventId: string): Promise<PaymentWebhookQueue | undefined>;
  createWebhookQueueItem(item: InsertPaymentWebhookQueue): Promise<PaymentWebhookQueue>;
  updateWebhookQueueItem(id: string, item: Partial<InsertPaymentWebhookQueue>): Promise<void>;
  getExpiredWebhooks(): Promise<PaymentWebhookQueue[]>;
  getRetryableWebhooks(): Promise<PaymentWebhookQueue[]>;
}

export interface IEmailSettingsStorage {
  getEmailNotificationSetting(eventType: string): Promise<EmailNotificationSettings | undefined>;
  getAllEmailNotificationSettings(): Promise<EmailNotificationSettings[]>;
  getEmailNotificationSettingsByCategory(category: string): Promise<EmailNotificationSettings[]>;
  createEmailNotificationSetting(setting: InsertEmailNotificationSettings): Promise<EmailNotificationSettings>;
  updateEmailNotificationSetting(eventType: string, setting: Partial<InsertEmailNotificationSettings>): Promise<void>;
}

export interface IModerationStorage {
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
  getBannedWords(): Promise<BannedWord[]>;
  getActiveBannedWords(): Promise<BannedWord[]>;
  createBannedWord(data: InsertBannedWord): Promise<BannedWord>;
  updateBannedWord(id: string, data: Partial<InsertBannedWord>): Promise<BannedWord | undefined>;
  deleteBannedWord(id: string): Promise<boolean>;
}

export interface IStorage extends
  IUserStorage,
  IAgentStorage,
  IKnowledgeBaseStorage,
  ICampaignStorage,
  IContactStorage,
  ICallStorage,
  ICreditStorage,
  IToolStorage,
  IVoiceStorage,
  IPlanStorage,
  IPhoneNumberStorage,
  ISubscriptionStorage,
  ISettingsStorage,
  IUsageStorage,
  IAnalyticsStorage,
  IWebhookStorage,
  INotificationStorage,
  ITemplateStorage,
  IPaymentStorage,
  IEmailSettingsStorage,
  IModerationStorage {}

export type {
  User, InsertUser,
  Agent, InsertAgent,
  KnowledgeBaseType, InsertKnowledgeBase,
  Campaign, InsertCampaign,
  Contact, InsertContact,
  Call, InsertCall,
  CreditTransaction, InsertCreditTransaction,
  Tool, InsertTool,
  Voice, InsertVoice,
  Plan, InsertPlan,
  UserSubscription, InsertUserSubscription,
  PhoneNumber, InsertPhoneNumber,
  UsageRecord, InsertUsageRecord,
  GlobalSettings, InsertGlobalSettings,
  CreditPackage, InsertCreditPackage,
  Webhook, InsertWebhook,
  WebhookLog, InsertWebhookLog,
  PhoneNumberRental, InsertPhoneNumberRental,
  Notification, InsertNotification,
  EmailTemplate, InsertEmailTemplate,
  PromptTemplate, InsertPromptTemplate,
  AgentVersion, InsertAgentVersion,
  SeoSettings, InsertSeoSettings,
  AnalyticsScript, InsertAnalyticsScript,
  PaymentTransaction, InsertPaymentTransaction,
  Refund, InsertRefund,
  Invoice, InsertInvoice,
  PaymentWebhookQueue, InsertPaymentWebhookQueue,
  EmailNotificationSettings, InsertEmailNotificationSettings,
  BannedWord, InsertBannedWord,
  ContentViolation, InsertContentViolation,
};
