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
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, decimal, doublePrecision, serial, date, time, unique, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  planType: text("plan_type").notNull().default("free"), // 'free' or 'pro'
  planExpiresAt: timestamp("plan_expires_at"),
  credits: integer("credits").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  maxWebhooks: integer("max_webhooks").notNull().default(3), // Webhook subscription limit (admin can adjust)
  isDeleted: boolean("is_deleted").notNull().default(false), // Soft delete flag - user requested account deletion
  deletedAt: timestamp("deleted_at"), // When the user requested deletion
  deletedBy: varchar("deleted_by"), // Who deleted: 'user' for self-deletion, admin user ID for admin deletion
  // Timezone preference - IANA timezone string (e.g., "America/New_York", "Europe/London")
  timezone: text("timezone"),
  // GDPR Consent preferences
  cookieConsent: boolean("cookie_consent"), // Essential cookies always enabled, this tracks analytics/marketing consent
  analyticsConsent: boolean("analytics_consent"),
  marketingConsent: boolean("marketing_consent"),
  consentTimestamp: timestamp("consent_timestamp"), // When user gave/updated consent
  termsAcceptedAt: timestamp("terms_accepted_at"), // When user accepted Terms of Service
  privacyAcceptedAt: timestamp("privacy_accepted_at"), // When user accepted Privacy Policy
  // User blocking for content violations
  blockedReason: text("blocked_reason"), // Reason for blocking (e.g., "Content violation: banned words detected")
  blockedAt: timestamp("blocked_at"), // When the user was blocked
  blockedBy: varchar("blocked_by"), // Admin who blocked the user
  // ElevenLabs Multi-Key Pool Affinity - Once assigned, user's agents and phone numbers stay on this key
  elevenLabsCredentialId: varchar("eleven_labs_credential_id"), // References elevenLabsCredentials.id (can't use .references() due to declaration order)
  // User-level KYC for phone number purchases
  kycStatus: text("kyc_status").default("pending"), // pending, submitted, approved, rejected
  kycSubmittedAt: timestamp("kyc_submitted_at"),
  kycApprovedAt: timestamp("kyc_approved_at"),
  kycRejectionReason: text("kyc_rejection_reason"),
  // Billing Details - Stored for payment processing and pre-filling
  billingName: text("billing_name"),
  billingAddressLine1: text("billing_address_line1"),
  billingAddressLine2: text("billing_address_line2"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPostalCode: text("billing_postal_code"),
  billingCountry: text("billing_country"),
  company: text("company"), // Company name for profile and team naming
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// OTP Verifications for signup
export const otpVerifications = pgTable("otp_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  otpCode: text("otp_code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Refresh Tokens for session management
export const refreshTokens = pgTable("refresh_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  isValid: boolean("is_valid").notNull().default(true),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  refreshTokensUserIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
  refreshTokensExpiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
}));

// ElevenLabs API Key Pool
export const elevenLabsCredentials = pgTable("eleven_labs_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // Friendly name for the key (e.g., "Primary Account", "Backup Key 1")
  apiKey: text("api_key").notNull(),
  webhookSecret: text("webhook_secret"), // HMAC secret for verifying webhooks from this ElevenLabs workspace (nullable for migration)
  isActive: boolean("is_active").notNull().default(true),
  maxConcurrency: integer("max_concurrency").notNull().default(30), // ElevenLabs default limit
  currentLoad: integer("current_load").notNull().default(0), // Current active calls using this key
  totalAssignedAgents: integer("total_assigned_agents").notNull().default(0), // How many agents use this key
  totalAssignedUsers: integer("total_assigned_users").notNull().default(0), // How many users are assigned to this key
  maxAgentsThreshold: integer("max_agents_threshold").notNull().default(100), // Soft limit before moving to next key
  lastHealthCheck: timestamp("last_health_check"),
  healthStatus: text("health_status").notNull().default("healthy"), // healthy, degraded, unhealthy
  metadata: jsonb("metadata"), // For storing additional info like account tier, limits, etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Synced Voices - Tracks which shared library voices have been synced to which pool credentials
export const syncedVoices = pgTable("synced_voices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  credentialId: varchar("credential_id").notNull().references(() => elevenLabsCredentials.id, { onDelete: "cascade" }),
  voiceId: text("voice_id").notNull(), // ElevenLabs voice_id
  publicOwnerId: text("public_owner_id").notNull(), // Voice owner's public ID for API call
  voiceName: text("voice_name"), // Cached voice name for display
  status: text("status").notNull().default("synced"), // synced, failed, pending
  errorMessage: text("error_message"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
}, (table) => ({
  credentialVoiceUnique: unique().on(table.credentialId, table.voiceId),
}));

export const agents = pgTable("agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  elevenLabsCredentialId: varchar("eleven_labs_credential_id").references(() => elevenLabsCredentials.id, { onDelete: "set null" }), // Which API key this agent uses
  
  // Telephony Provider Configuration - Determines which engine handles calls
  // 'twilio' = ElevenLabs Conversational AI via Twilio (default)
  // 'plivo' = Plivo telephony + OpenAI Realtime API
  // 'twilio_openai' = Twilio telephony + OpenAI Realtime API
  // 'elevenlabs-sip' = ElevenLabs native SIP (user's own SIP trunk)
  // 'openai-sip' = OpenAI Realtime API with SIP (incoming only)
  telephonyProvider: text("telephony_provider").default("twilio"), // 'twilio' | 'plivo' | 'twilio_openai' | 'elevenlabs-sip' | 'openai-sip'
  
  // SIP Trunk Configuration (used when telephonyProvider='elevenlabs-sip' or 'openai-sip')
  sipTrunkId: varchar("sip_trunk_id"), // References sip_trunks.id for SIP-based engines
  sipPhoneNumberId: varchar("sip_phone_number_id"), // References sip_phone_numbers.id for SIP-based calls
  
  // OpenAI Realtime Configuration (used when telephonyProvider='plivo', 'twilio_openai', or 'openai-sip')
  openaiVoice: text("openai_voice"), // 'alloy' | 'echo' | 'shimmer' | 'ash' | 'ballad' | 'coral' | 'sage' | 'verse' | 'cedar' | 'marin'
  openaiCredentialId: varchar("openai_credential_id"), // References openaiCredentials.id (can't use .references() due to declaration order)
  
  // Agent Type: Determines execution pipeline and usage
  // NO DEFAULT - must be explicitly set to prevent misconfiguration
  type: text("type").notNull(), // 'incoming' (ElevenLabs Conversational AI for receiving calls) or 'flow' (STT+TTS+FlowExecutionBridge for campaigns)
  
  // Incoming Agent Fields (used when type='incoming')
  // Incoming agents are used for receiving calls on purchased phone numbers with call transfer capability
  name: text("name").notNull(),
  voiceTone: text("voice_tone"),
  personality: text("personality"),
  systemPrompt: text("system_prompt"),
  language: text("language").default("en"),
  firstMessage: text("first_message").default("Hello! How can I help you today?"),
  llmModel: text("llm_model").default("gpt-4o-mini"),
  temperature: doublePrecision("temperature").default(0.5),
  elevenLabsAgentId: text("eleven_labs_agent_id"),
  
  // Call Transfer Configuration (for incoming agents)
  transferPhoneNumber: text("transfer_phone_number"),
  transferEnabled: boolean("transfer_enabled").default(false),
  
  // ElevenLabs System Tools Configuration (for incoming agents)
  detectLanguageEnabled: boolean("detect_language_enabled").default(false),
  endConversationEnabled: boolean("end_conversation_enabled").default(false),
  appointmentBookingEnabled: boolean("appointment_booking_enabled").default(false),
  messagingEmailEnabled: boolean("messaging_email_enabled").default(false),
  messagingWhatsappEnabled: boolean("messaging_whatsapp_enabled").default(false),
  messagingEmailTemplate: text("messaging_email_template"),
  messagingWhatsappTemplate: text("messaging_whatsapp_template"),
  messagingWhatsappVariables: text("messaging_whatsapp_variables"),
  expressiveMode: boolean("expressive_mode").default(false),
  
  // Knowledge Base (for incoming agents)
  knowledgeBaseIds: text("knowledge_base_ids").array(),
  
  // Shared Voice Configuration (used by both Incoming and Flow agents)
  elevenLabsVoiceId: text("eleven_labs_voice_id"),
  voiceStability: doublePrecision("voice_stability").default(0.65),
  voiceSimilarityBoost: doublePrecision("voice_similarity_boost").default(0.85),
  voiceSpeed: doublePrecision("voice_speed").default(0.92),
  turnTimeout: doublePrecision("turn_timeout").default(1.5),
  
  // Flow Agent Fields (used when type='flow')
  flowId: varchar("flow_id"), // Reference to flows table for Flow Agents
  maxDurationSeconds: integer("max_duration_seconds").default(600), // Max conversation duration in seconds (default 10 min, range 60-1800)
  
  // Legacy/Common Fields
  agentLink: text("agent_link"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const knowledgeBase = pgTable("knowledge_base", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  url: text("url"),
  fileUrl: text("file_url"),
  elevenLabsDocId: text("eleven_labs_doc_id"),
  metadata: jsonb("metadata"),
  storageSize: integer("storage_size").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Incoming Agents - Completely isolated from campaign agents
// Used for receiving calls on purchased phone numbers with call transfer capability
export const incomingAgents = pgTable("incoming_agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  elevenLabsCredentialId: varchar("eleven_labs_credential_id").references(() => elevenLabsCredentials.id, { onDelete: "set null" }),
  
  // Basic Configuration
  name: text("name").notNull(),
  elevenLabsAgentId: text("eleven_labs_agent_id").notNull(), // Always uses ElevenLabs Conversational AI
  elevenLabsVoiceId: text("eleven_labs_voice_id").notNull(),
  language: text("language").notNull().default("en"),
  
  // AI Configuration
  systemPrompt: text("system_prompt").notNull(),
  personality: text("personality").default("helpful"),
  voiceTone: text("voice_tone").default("professional"),
  firstMessage: text("first_message").notNull().default("Hello! How can I help you today?"),
  llmModel: text("llm_model").default("gpt-4o-mini"),
  temperature: doublePrecision("temperature").default(0.5),
  
  // Call Transfer Configuration
  transferPhoneNumber: text("transfer_phone_number"), // Phone number to transfer calls to
  transferEnabled: boolean("transfer_enabled").notNull().default(false),
  
  // Business Hours Configuration
  businessHoursEnabled: boolean("business_hours_enabled").notNull().default(false),
  businessHoursStart: text("business_hours_start"), // Format: "09:00"
  businessHoursEnd: text("business_hours_end"), // Format: "17:00"
  businessDays: text("business_days").array(), // ["monday", "tuesday", etc.]
  businessHoursTimezone: text("business_hours_timezone").default("America/New_York"),
  afterHoursMessage: text("after_hours_message").default("Thank you for calling. We're currently closed. Please call back during business hours."),
  
  // Knowledge Base
  knowledgeBaseIds: text("knowledge_base_ids").array(),
  
  // Metadata
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  agentsUserIdIdx: index("agents_user_id_idx").on(table.userId),
  agentsCredentialIdIdx: index("agents_credential_id_idx").on(table.elevenLabsCredentialId),
  agentsElevenLabsAgentIdIdx: index("agents_eleven_labs_agent_id_idx").on(table.elevenLabsAgentId),
}));

export const phoneNumbers = pgTable("phone_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Nullable for system pool numbers
  phoneNumber: text("phone_number").notNull().unique(),
  twilioSid: text("twilio_sid").notNull().unique(),
  elevenLabsPhoneNumberId: text("eleven_labs_phone_number_id"), // ElevenLabs phone_number_id for synced numbers
  elevenLabsCredentialId: varchar("eleven_labs_credential_id").references(() => elevenLabsCredentials.id, { onDelete: "set null" }), // Which API key this phone number uses (for multi-API key pool isolation)
  friendlyName: text("friendly_name"),
  country: text("country").notNull().default("US"),
  capabilities: jsonb("capabilities"),
  status: text("status").notNull().default("active"),
  isSystemPool: boolean("is_system_pool").notNull().default(false), // For free plan numbers
  purchasePrice: decimal("purchase_price", { precision: 10, scale: 2 }),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }),
  monthlyCredits: integer("monthly_credits"), // Credits charged per month for user-purchased numbers
  nextBillingDate: timestamp("next_billing_date"), // Next date when credits will be charged
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  credentialsSyncedAt: timestamp("credentials_synced_at"), // Last time Twilio credentials were re-synced into ElevenLabs (null = never explicitly synced)
  
  // DEPRECATED: Use incoming_connections table instead
  assignedIncomingAgentId: varchar("assigned_incoming_agent_id").references(() => incomingAgents.id, { onDelete: "set null" }),
}, (table) => ({
  phoneNumbersUserIdIdx: index("phone_numbers_user_id_idx").on(table.userId),
  phoneNumbersStatusIdx: index("phone_numbers_status_idx").on(table.status),
  phoneNumbersNextBillingDateIdx: index("phone_numbers_next_billing_date_idx").on(table.nextBillingDate),
}));

// Incoming Connections - Links incoming agents (type='incoming') to phone numbers
// One connection per phone number, allowing users to route incoming calls to specific agents
export const incomingConnections = pgTable("incoming_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }), // Must be type='incoming'
  phoneNumberId: varchar("phone_number_id").notNull().references(() => phoneNumbers.id, { onDelete: "cascade" }).unique(), // One connection per phone number
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id").references(() => agents.id, { onDelete: "set null" }),
  voiceId: text("voice_id"),
  phoneNumberId: varchar("phone_number_id").references(() => phoneNumbers.id, { onDelete: "set null" }),
  sipPhoneNumberId: varchar("sip_phone_number_id"), // References sip_phone_numbers.id for SIP-based campaigns (plugin)
  plivoPhoneNumberId: varchar("plivo_phone_number_id"), // References plivo_phone_numbers.id for Plivo-based campaigns
  flowId: varchar("flow_id"),  // Reference to visual conversation flow (mutually exclusive with script)
  name: text("name").notNull(),
  type: text("type").notNull(),
  goal: text("goal"),
  script: text("script"),
  status: text("status").notNull().default("pending"),
  totalContacts: integer("total_contacts").notNull().default(0),
  completedCalls: integer("completed_calls").notNull().default(0),
  successfulCalls: integer("successful_calls").notNull().default(0),
  failedCalls: integer("failed_calls").notNull().default(0),
  scheduledFor: timestamp("scheduled_for"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  deletedAt: timestamp("deleted_at"),
  // Campaign Time Scheduling
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false), // Whether to respect time windows
  scheduleTimeStart: text("schedule_time_start"), // Start time in HH:MM format (e.g., "09:00")
  scheduleTimeEnd: text("schedule_time_end"), // End time in HH:MM format (e.g., "17:00")
  scheduleDays: text("schedule_days").array(), // Array of days: ["monday", "tuesday", "wednesday", etc.]
  scheduleTimezone: text("schedule_timezone").default("America/New_York"), // Timezone for the schedule
  
  // ElevenLabs Batch Calling Integration
  batchJobId: text("batch_job_id"), // ElevenLabs batch job ID when campaign is running
  batchJobStatus: text("batch_job_status"), // pending, in_progress, completed, failed, cancelled
  retryEnabled: boolean("retry_enabled").notNull().default(false), // Whether to auto-retry failed/no-response calls
  
  // Contact Retry System - configures automatic re-calling of contacts that didn't answer
  retryMaxAttempts: integer("retry_max_attempts").default(3), // Max total call attempts per contact (including first)
  retryIntervalMinutes: integer("retry_interval_minutes").default(60), // Minutes between retry passes
  retryOnNoAnswer: boolean("retry_on_no_answer").default(true), // Retry contacts that didn't answer
  retryOnBusy: boolean("retry_on_busy").default(false), // Retry contacts that were busy
  retryOnFailed: boolean("retry_on_failed").default(false), // Retry contacts that failed (technical error)
  batchJobHistory: jsonb("batch_job_history").default([]), // Array of {batchJobId, pass, contactCount, createdAt}
  currentRetryPass: integer("current_retry_pass").default(0), // Which pass we're currently on (0 = initial, 1+ = retries)
  
  // Error tracking for failed campaigns
  errorMessage: text("error_message"), // Detailed error message when campaign fails
  errorCode: text("error_code"), // Error code for categorization (e.g., AGENT_NOT_SYNCED, NO_CONTACTS)
  
  config: jsonb("config"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  campaignsUserIdIdx: index("campaigns_user_id_idx").on(table.userId),
  campaignsStatusIdx: index("campaigns_status_idx").on(table.status),
  campaignsDeletedAtIdx: index("campaigns_deleted_at_idx").on(table.deletedAt),
  campaignsAgentIdIdx: index("campaigns_agent_id_idx").on(table.agentId),
}));

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  phone: text("phone").notNull(),
  email: text("email"),
  customFields: jsonb("custom_fields"),
  status: text("status").notNull().default("pending"),
  // Retry attempt tracking
  attemptCount: integer("attempt_count").default(1), // How many call attempts have been made (1 = first call in progress)
  lastAttemptAt: timestamp("last_attempt_at"), // When the last call was attempted
  nextRetryAt: timestamp("next_retry_at"), // When the next retry is scheduled (null if not queued)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  contactsCampaignIdIdx: index("contacts_campaign_id_idx").on(table.campaignId),
  contactsStatusIdx: index("contacts_status_idx").on(table.status),
  // Note: contacts has no userId column — ownership is via campaignId → campaigns.userId.
}));

export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Direct user ownership for guaranteed isolation
  campaignId: varchar("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }), // Nullable for test/manual/incoming calls
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }), // Nullable for test/incoming calls
  
  // Agent references - either from campaign (agentId via campaigns table) or incoming call (via connection)
  incomingConnectionId: varchar("incoming_connection_id").references(() => incomingConnections.id, { onDelete: "set null" }), // For incoming calls
  
  // Website Widget reference - for calls initiated through embeddable widgets
  widgetId: varchar("widget_id"), // References websiteWidgets.id (added later in schema)
  
  // DEPRECATED: Use incomingConnectionId instead
  incomingAgentId: varchar("incoming_agent_id").references(() => incomingAgents.id, { onDelete: "set null" }),
  
  phoneNumber: text("phone_number"), // Phone number dialed/caller (for test calls without contacts, or incoming caller)
  fromNumber: text("from_number"), // The phone number that initiated the call (caller ID)
  toNumber: text("to_number"), // The phone number that received the call (destination)
  twilioSid: text("twilio_sid"),
  elevenLabsConversationId: text("elevenlabs_conversation_id"), // ElevenLabs conversation ID for fetching details/recordings
  status: text("status").notNull().default("pending"),
  callDirection: text("call_direction").notNull().default("outgoing"), // 'incoming' or 'outgoing'
  duration: integer("duration"),
  recordingUrl: text("recording_url"),
  transcript: text("transcript"),
  aiSummary: text("ai_summary"),
  classification: text("classification"),
  sentiment: text("sentiment"),
  metadata: jsonb("metadata"),
  wasTransferred: boolean("was_transferred").default(false), // Whether call was transferred
  transferredTo: text("transferred_to"), // Number call was transferred to
  transferredAt: timestamp("transferred_at"), // When call was transferred
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  agentId: varchar("agent_id"),
  engineType: text("engine_type"),
  creditsUsed: integer("credits_used").default(0),
}, (table) => ({
  callsUserIdIdx: index("calls_user_id_idx").on(table.userId),
  callsCampaignIdIdx: index("calls_campaign_id_idx").on(table.campaignId),
  callsContactIdIdx: index("calls_contact_id_idx").on(table.contactId),
  callsStatusIdx: index("calls_status_idx").on(table.status),
  callsCreatedAtIdx: index("calls_created_at_idx").on(table.createdAt),
  callsTwilioSidIdx: index("calls_twilio_sid_idx").on(table.twilioSid),
  callsElevenLabsConversationIdIdx: index("calls_elevenlabs_conversation_id_idx").on(table.elevenLabsConversationId),
  callsAgentIdIdx: index("calls_agent_id_idx").on(table.agentId),
}));

export const creditTransactions = pgTable("credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  stripePaymentId: text("stripe_payment_id").unique(), // Unique constraint for idempotency
  widgetId: varchar("widget_id"), // For widget-originated credit deductions
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userReferenceUnique: uniqueIndex("credit_transactions_user_reference_unique")
    .on(table.userId, table.reference)
    .where(sql`reference IS NOT NULL`),
  creditTransactionsUserIdIdx: index("credit_transactions_user_id_idx").on(table.userId),
  creditTransactionsCreatedAtIdx: index("credit_transactions_created_at_idx").on(table.createdAt),
}));

export const tools = pgTable("tools", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const voices = pgTable("voices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  elevenLabsVoiceId: text("eleven_labs_voice_id"),
  gender: text("gender"),
  accent: text("accent"),
  tone: text("tone"),
  isCustom: boolean("is_custom").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// New SaaS Platform Tables
export const plans = pgTable("plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // 'free' or 'pro'
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }).notNull(), // USD price
  yearlyPrice: decimal("yearly_price", { precision: 10, scale: 2 }), // USD price
  razorpayMonthlyPrice: decimal("razorpay_monthly_price", { precision: 10, scale: 2 }), // INR price
  razorpayYearlyPrice: decimal("razorpay_yearly_price", { precision: 10, scale: 2 }), // INR price
  stripeMonthlyPriceId: text("stripe_monthly_price_id"), // Stripe Price ID for monthly plan
  stripeYearlyPriceId: text("stripe_yearly_price_id"), // Stripe Price ID for yearly plan
  stripeProductId: text("stripe_product_id"), // Stripe Product ID
  razorpayPlanId: text("razorpay_plan_id"), // Razorpay Plan ID (monthly)
  razorpayYearlyPlanId: text("razorpay_yearly_plan_id"), // Razorpay Plan ID (yearly)
  
  // PayPal pricing and plan IDs
  paypalMonthlyPrice: decimal("paypal_monthly_price", { precision: 10, scale: 2 }), // PayPal price (supports multiple currencies)
  paypalYearlyPrice: decimal("paypal_yearly_price", { precision: 10, scale: 2 }),
  paypalProductId: text("paypal_product_id"), // PayPal Product ID
  paypalMonthlyPlanId: text("paypal_monthly_plan_id"), // PayPal Plan ID for monthly
  paypalYearlyPlanId: text("paypal_yearly_plan_id"), // PayPal Plan ID for yearly
  
  // Paystack pricing and plan codes (Africa: NGN, GHS, ZAR, KES)
  paystackMonthlyPrice: decimal("paystack_monthly_price", { precision: 10, scale: 2 }),
  paystackYearlyPrice: decimal("paystack_yearly_price", { precision: 10, scale: 2 }),
  paystackMonthlyPlanCode: text("paystack_monthly_plan_code"), // Paystack Plan Code for monthly
  paystackYearlyPlanCode: text("paystack_yearly_plan_code"), // Paystack Plan Code for yearly
  
  // MercadoPago pricing and plan IDs (LATAM: BRL, MXN, ARS, CLP, COP)
  mercadopagoMonthlyPrice: decimal("mercadopago_monthly_price", { precision: 10, scale: 2 }),
  mercadopagoYearlyPrice: decimal("mercadopago_yearly_price", { precision: 10, scale: 2 }),
  mercadopagoMonthlyPlanId: text("mercadopago_monthly_plan_id"), // MercadoPago preapproval_plan_id
  mercadopagoYearlyPlanId: text("mercadopago_yearly_plan_id"),
  
  maxAgents: integer("max_agents").notNull().default(1),
  maxCampaigns: integer("max_campaigns").notNull().default(1),
  maxContactsPerCampaign: integer("max_contacts_per_campaign").notNull().default(5),
  maxWebhooks: integer("max_webhooks").notNull().default(3), // Max webhook subscriptions
  maxKnowledgeBases: integer("max_knowledge_bases").notNull().default(5), // Max knowledge base items
  maxFlows: integer("max_flows").notNull().default(3), // Max flow automations
  maxPhoneNumbers: integer("max_phone_numbers").notNull().default(1), // Max rented phone numbers
  maxWidgets: integer("max_widgets").notNull().default(1), // Max website widgets
  includedCredits: integer("included_credits").notNull().default(0),
  defaultLlmModel: text("default_llm_model"), // For free plan restrictions
  canChooseLlm: boolean("can_choose_llm").notNull().default(false),
  canPurchaseNumbers: boolean("can_purchase_numbers").notNull().default(false),
  useSystemPool: boolean("use_system_pool").notNull().default(true), // Free plan uses system pool
  features: jsonb("features"), // Additional feature flags
  
  // SIP Engine Plugin - Plan-level access control
  sipEnabled: boolean("sip_enabled").notNull().default(false),
  maxConcurrentSipCalls: integer("max_concurrent_sip_calls").notNull().default(1),
  sipEnginesAllowed: text("sip_engines_allowed").array().default(sql`ARRAY['elevenlabs-sip']::text[]`), // ['elevenlabs-sip', 'openai-sip']
  
  // REST API Plugin - Plan-level access control
  restApiEnabled: boolean("rest_api_enabled").notNull().default(false),
  
  // Team Management Plugin - Plan-level access control
  teamManagementEnabled: boolean("team_management_enabled").notNull().default(false),
  maxTeamMembers: integer("max_team_members").notNull().default(0), // 0 = disabled
  maxCustomRoles: integer("max_custom_roles").notNull().default(0), // 0 = disabled
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Global Platform Settings
export const globalSettings = pgTable("global_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// LLM Models - Available models with tier restrictions
export const llmModels = pgTable("llm_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  modelId: text("model_id").notNull().unique(), // e.g., 'gpt-4o-mini', 'claude-3-5-sonnet'
  name: text("name").notNull(), // Display name e.g., 'GPT-4o Mini (OpenAI)'
  provider: text("provider").notNull(), // 'openai', 'anthropic', 'google', 'elevenlabs'
  tier: text("tier").notNull(), // 'free' or 'pro'
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0), // For custom ordering in UI
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Supported Languages - Available languages with provider support
export const supportedLanguages = pgTable("supported_languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(), // ISO 639-1 code e.g., 'en', 'es', 'fr'
  label: text("label").notNull(), // Display name e.g., 'English', 'Spanish'
  providers: text("providers").notNull(), // 'elevenlabs', 'openai', or 'both'
  sortOrder: integer("sort_order").notNull().default(0), // For custom ordering in UI
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Credit Packages
export const creditPackages = pgTable("credit_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  credits: integer("credits").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // USD price
  razorpayPrice: decimal("razorpay_price", { precision: 10, scale: 2 }), // INR price
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  razorpayItemId: text("razorpay_item_id"), // Razorpay Item ID for credit package
  
  // PayPal credit package pricing
  paypalPrice: decimal("paypal_price", { precision: 10, scale: 2 }), // PayPal price
  
  // Paystack credit package pricing (Africa)
  paystackPrice: decimal("paystack_price", { precision: 10, scale: 2 }), // Paystack price
  
  // MercadoPago credit package pricing (LATAM)
  mercadopagoPrice: decimal("mercadopago_price", { precision: 10, scale: 2 }), // MercadoPago price
  
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// User Subscriptions
export const userSubscriptions = pgTable("user_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("active"), // 'active', 'cancelled', 'expired'
  currentPeriodStart: timestamp("current_period_start").notNull().defaultNow(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(), // Unique constraint for idempotency
  razorpaySubscriptionId: text("razorpay_subscription_id").unique(), // Razorpay Subscription ID
  
  // PayPal subscription tracking
  paypalSubscriptionId: text("paypal_subscription_id").unique(), // PayPal Subscription ID
  
  // Paystack subscription tracking (Africa)
  paystackSubscriptionCode: text("paystack_subscription_code").unique(), // Paystack Subscription Code
  paystackCustomerCode: text("paystack_customer_code"), // Paystack Customer Code
  paystackEmailToken: text("paystack_email_token"), // Token for customer management
  
  // MercadoPago subscription tracking (LATAM)
  mercadopagoSubscriptionId: text("mercadopago_subscription_id").unique(), // MercadoPago preapproval ID
  
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  billingPeriod: text("billing_period").notNull().default("monthly"), // 'monthly' or 'yearly'
  
  // Admin-set per-user limit overrides (null = use plan defaults)
  overrideMaxAgents: integer("override_max_agents"), // Override plan's maxAgents
  overrideMaxCampaigns: integer("override_max_campaigns"), // Override plan's maxCampaigns
  overrideMaxContactsPerCampaign: integer("override_max_contacts_per_campaign"), // Override plan's maxContactsPerCampaign
  overrideMaxWebhooks: integer("override_max_webhooks"), // Override plan's maxWebhooks
  overrideMaxKnowledgeBases: integer("override_max_knowledge_bases"), // Override plan's maxKnowledgeBases
  overrideMaxFlows: integer("override_max_flows"), // Override plan's maxFlows
  overrideMaxPhoneNumbers: integer("override_max_phone_numbers"), // Override plan's maxPhoneNumbers
  overrideMaxWidgets: integer("override_max_widgets"), // Override plan's maxWidgets
  overrideIncludedCredits: integer("override_included_credits"), // Override plan's includedCredits
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Phone Number Rental Billing History
export const phoneNumberRentals = pgTable("phone_number_rentals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumberId: varchar("phone_number_id").notNull().references(() => phoneNumbers.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  creditsCharged: integer("credits_charged").notNull(),
  billingDate: timestamp("billing_date").notNull().defaultNow(),
  status: text("status").notNull().default("success"), // 'success', 'failed', 'insufficient_credits'
  transactionId: varchar("transaction_id").references(() => creditTransactions.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Usage Records
export const usageRecords = pgTable("usage_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subscriptionId: varchar("subscription_id").references(() => userSubscriptions.id, { onDelete: "cascade" }),
  callId: varchar("call_id").references(() => calls.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  minutesUsed: integer("minutes_used").notNull().default(0),
  cost: decimal("cost", { precision: 10, scale: 2 }).notNull().default("0.00"),
  billingStatus: text("billing_status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Legacy Webhooks - DEPRECATED: Use webhookSubscriptions from flow-automation
// Uses original database table name 'webhooks' to preserve existing data
export const legacyWebhooks = pgTable("webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Legacy Webhook Delivery Logs - DEPRECATED
// Uses original database table name 'webhook_deliveries' to preserve existing data
export const legacyWebhookDeliveries = pgTable("webhook_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").notNull().references(() => legacyWebhooks.id, { onDelete: "cascade" }),
  callId: varchar("call_id").references(() => calls.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  responseCode: integer("response_code"),
  responseBody: text("response_body"),
  payload: jsonb("payload").notNull(),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(1),
  lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Notifications
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Nullable for broadcast notifications
  type: text("type").notNull(), // low_credits, membership_upgraded, membership_expiry, campaign_completed, campaign_failed, etc.
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"), // Optional link to navigate when clicked
  icon: text("icon"), // Custom icon name (lucide icon name)
  displayType: text("display_type").notNull().default("bell"), // 'bell', 'banner', or 'both'
  priority: integer("priority").notNull().default(0), // For ordering banner notifications (higher = more important)
  dismissible: boolean("dismissible").notNull().default(true), // Whether the notification can be dismissed
  expiresAt: timestamp("expires_at"), // When the notification should expire (null = never)
  isRead: boolean("is_read").notNull().default(false),
  isDismissed: boolean("is_dismissed").notNull().default(false), // For banner dismissals
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Email Templates - Customizable email templates for system notifications
export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateType: text("template_type").notNull().unique(), // 'otp', 'welcome', 'low_credits', 'campaign_complete', 'membership_upgrade', etc.
  name: text("name").notNull(), // Display name for admin
  subject: text("subject").notNull(), // Email subject line with variable support
  htmlBody: text("html_body").notNull(), // HTML email body with variable support
  textBody: text("text_body").notNull(), // Plain text fallback with variable support
  variables: text("variables").array(), // Available variables: ['userName', 'companyName', 'code', etc.]
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Prompt Templates - Reusable system prompts with variable placeholders
// Users can create templates with {{variable}} syntax for personalization
export const promptTemplates = pgTable("prompt_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // null = system template
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"), // 'sales', 'support', 'appointment', 'survey', 'general'
  systemPrompt: text("system_prompt").notNull(),
  firstMessage: text("first_message"),
  variables: text("variables").array(), // Available variables: ['company', 'product', 'customerName', etc.]
  suggestedVoiceTone: text("suggested_voice_tone"), // Recommended voice settings
  suggestedPersonality: text("suggested_personality"),
  isSystemTemplate: boolean("is_system_template").notNull().default(false), // System-provided templates
  isPublic: boolean("is_public").notNull().default(false), // Can be used by other users
  usageCount: integer("usage_count").notNull().default(0), // Track popularity
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Agent Version History - Track changes to agents for rollback and audit
export const agentVersions = pgTable("agent_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: jsonb("snapshot").notNull().$type<{
    name: string;
    type: string;
    voiceTone?: string | null;
    personality?: string | null;
    systemPrompt?: string | null;
    language?: string | null;
    firstMessage?: string | null;
    llmModel?: string | null;
    temperature?: number | null;
    elevenLabsVoiceId?: string | null;
    voiceStability?: number | null;
    voiceSimilarityBoost?: number | null;
    voiceSpeed?: number | null;
    transferPhoneNumber?: string | null;
    transferEnabled?: boolean | null;
    detectLanguageEnabled?: boolean | null;
    endConversationEnabled?: boolean | null;
    knowledgeBaseIds?: string[] | null;
    maxDurationSeconds?: number | null;
    config?: Record<string, unknown> | null;
  }>(),
  changesSummary: text("changes_summary"), // Human-readable summary of what changed
  changedFields: text("changed_fields").array(), // Array of field names that changed
  editedBy: varchar("edited_by").references(() => users.id, { onDelete: "set null" }),
  note: text("note"), // Optional note about why changes were made
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Audit Logs - Track sensitive operations for security and compliance
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(), // e.g., 'user.login', 'admin.user_update', 'payment.subscription_created'
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // User who performed the action
  targetUserId: varchar("target_user_id").references(() => users.id, { onDelete: "set null" }), // User affected by the action
  resourceType: text("resource_type"), // e.g., 'agent', 'campaign', 'payment'
  resourceId: varchar("resource_id"), // ID of the affected resource
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(), // Additional context
  severity: text("severity").notNull().default("info"), // 'info', 'warning', 'error', 'critical'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Platform Languages - UI languages with translations (admin-managed)
export const platformLanguages = pgTable("platform_languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(), // ISO 639-1 code e.g., 'en', 'es', 'ar'
  name: text("name").notNull(), // Display name e.g., 'English', 'Spanish'
  nativeName: text("native_name").notNull(), // Native name e.g., 'English', 'Español'
  flag: text("flag"), // Flag emoji e.g., '🇺🇸', '🇪🇸'
  direction: text("direction").notNull().default("ltr"), // 'ltr' or 'rtl'
  isEnabled: boolean("is_enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // Only one can be default
  sortOrder: integer("sort_order").notNull().default(0),
  translations: jsonb("translations").notNull().$type<Record<string, unknown>>(), // Full translation keys
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  role: true,
});

export const insertElevenLabsCredentialSchema = createInsertSchema(elevenLabsCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  currentLoad: true,
  totalAssignedAgents: true,
});

export const insertSyncedVoiceSchema = createInsertSchema(syncedVoices).omit({
  id: true,
  syncedAt: true,
});

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  createdAt: true,
});

export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({
  id: true,
  createdAt: true,
});

export const insertIncomingAgentSchema = createInsertSchema(incomingAgents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
});

export const insertAgentVersionSchema = createInsertSchema(agentVersions).omit({
  id: true,
  createdAt: true,
});

export const insertIncomingConnectionSchema = createInsertSchema(incomingConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
  completedCalls: true,
  successfulCalls: true,
  failedCalls: true,
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  createdAt: true,
});


export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertToolSchema = createInsertSchema(tools).omit({
  id: true,
  createdAt: true,
});

export const insertVoiceSchema = createInsertSchema(voices).omit({
  id: true,
  createdAt: true,
});

export const insertPlanSchema = createInsertSchema(plans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGlobalSettingsSchema = createInsertSchema(globalSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertLlmModelSchema = createInsertSchema(llmModels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupportedLanguageSchema = createInsertSchema(supportedLanguages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlatformLanguageSchema = createInsertSchema(platformLanguages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCreditPackageSchema = createInsertSchema(creditPackages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // Coerce number inputs to strings for decimal fields (frontend sends numbers)
  price: z.union([z.string(), z.number()]).transform(v => String(v)),
  razorpayPrice: z.union([z.string(), z.number()]).transform(v => v != null ? String(v) : null).nullable().optional(),
  paypalPrice: z.union([z.string(), z.number()]).transform(v => v != null ? String(v) : null).nullable().optional(),
  paystackPrice: z.union([z.string(), z.number()]).transform(v => v != null ? String(v) : null).nullable().optional(),
  mercadopagoPrice: z.union([z.string(), z.number()]).transform(v => v != null ? String(v) : null).nullable().optional(),
});

export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPhoneNumberSchema = createInsertSchema(phoneNumbers).omit({
  id: true,
  createdAt: true,
});

export const insertUsageRecordSchema = createInsertSchema(usageRecords).omit({
  id: true,
  createdAt: true,
});

// Legacy webhook schemas - DEPRECATED: Use flow-automation webhook schemas
export const insertLegacyWebhookSchema = createInsertSchema(legacyWebhooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLegacyWebhookDeliverySchema = createInsertSchema(legacyWebhookDeliveries).omit({
  id: true,
  createdAt: true,
});

export const insertPhoneNumberRentalSchema = createInsertSchema(phoneNumberRentals).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  isRead: true,
  isDismissed: true,
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Twilio Supported Countries for Phone Number Purchasing
export const twilioCountries = pgTable("twilio_countries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 2 }).notNull().unique(), // ISO 3166-1 alpha-2 code (e.g., "US", "GB")
  name: text("name").notNull(),
  dialCode: text("dial_code").notNull(), // International dialing code (e.g., "+1", "+44")
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100), // For display ordering (popular countries first)
});

export const insertTwilioCountrySchema = createInsertSchema(twilioCountries).omit({
  id: true,
});

export type TwilioCountry = typeof twilioCountries.$inferSelect;
export type InsertTwilioCountry = z.infer<typeof insertTwilioCountrySchema>;

// ============================================
// RAG KNOWLEDGE BASE SYSTEM
// ============================================
// Separate from legacy ElevenLabs KB - stores chunks with embeddings locally
// Allows unlimited per-user storage without ElevenLabs 20MB limit

// User storage limits for RAG knowledge base
export const userKnowledgeStorageLimits = pgTable("user_knowledge_storage_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  maxStorageBytes: integer("max_storage_bytes").notNull().default(20971520), // 20MB default per user
  usedStorageBytes: integer("used_storage_bytes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Knowledge chunks with embeddings for RAG retrieval
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  knowledgeBaseId: varchar("knowledge_base_id").notNull().references(() => knowledgeBase.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(), // Order within the document
  chunkText: text("chunk_text").notNull(), // The actual text content
  embedding: jsonb("embedding"), // Vector embedding as JSON array of floats
  tokenCount: integer("token_count").notNull().default(0),
  metadata: jsonb("metadata"), // Page number, section, source info
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Processing queue for async embedding generation
export const knowledgeProcessingQueue = pgTable("knowledge_processing_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  knowledgeBaseId: varchar("knowledge_base_id").notNull().references(() => knowledgeBase.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  errorMessage: text("error_message"),
  totalChunks: integer("total_chunks").default(0),
  processedChunks: integer("processed_chunks").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserKnowledgeStorageLimitSchema = createInsertSchema(userKnowledgeStorageLimits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertKnowledgeChunkSchema = createInsertSchema(knowledgeChunks).omit({
  id: true,
  createdAt: true,
});

export const insertKnowledgeProcessingQueueSchema = createInsertSchema(knowledgeProcessingQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserKnowledgeStorageLimit = typeof userKnowledgeStorageLimits.$inferSelect;
export type InsertUserKnowledgeStorageLimit = z.infer<typeof insertUserKnowledgeStorageLimitSchema>;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type InsertKnowledgeChunk = z.infer<typeof insertKnowledgeChunkSchema>;
export type KnowledgeProcessingQueue = typeof knowledgeProcessingQueue.$inferSelect;
export type InsertKnowledgeProcessingQueue = z.infer<typeof insertKnowledgeProcessingQueueSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type ElevenLabsCredential = typeof elevenLabsCredentials.$inferSelect;
export type InsertElevenLabsCredential = z.infer<typeof insertElevenLabsCredentialSchema>;
export type SyncedVoice = typeof syncedVoices.$inferSelect;
export type InsertSyncedVoice = z.infer<typeof insertSyncedVoiceSchema>;
export type Agent = typeof agents.$inferSelect;
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBase = z.infer<typeof insertKnowledgeBaseSchema>;
export type IncomingAgent = typeof incomingAgents.$inferSelect;
export type InsertIncomingAgent = z.infer<typeof insertIncomingAgentSchema>;
export type IncomingConnection = typeof incomingConnections.$inferSelect;
export type InsertIncomingConnection = z.infer<typeof insertIncomingConnectionSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Call = typeof calls.$inferSelect;
export type InsertCall = z.infer<typeof insertCallSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type Tool = typeof tools.$inferSelect;
export type InsertTool = z.infer<typeof insertToolSchema>;
export type Voice = typeof voices.$inferSelect;
export type InsertVoice = z.infer<typeof insertVoiceSchema>;
export type Plan = typeof plans.$inferSelect;
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type GlobalSettings = typeof globalSettings.$inferSelect;
export type InsertGlobalSettings = z.infer<typeof insertGlobalSettingsSchema>;
export type LlmModel = typeof llmModels.$inferSelect;
export type InsertLlmModel = z.infer<typeof insertLlmModelSchema>;
export type SupportedLanguage = typeof supportedLanguages.$inferSelect;
export type InsertSupportedLanguage = z.infer<typeof insertSupportedLanguageSchema>;
export type PlatformLanguage = typeof platformLanguages.$inferSelect;
export type InsertPlatformLanguage = z.infer<typeof insertPlatformLanguageSchema>;
export type CreditPackage = typeof creditPackages.$inferSelect;
export type InsertCreditPackage = z.infer<typeof insertCreditPackageSchema>;
export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type InsertPhoneNumber = z.infer<typeof insertPhoneNumberSchema>;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type InsertUsageRecord = z.infer<typeof insertUsageRecordSchema>;
// Legacy webhook types - DEPRECATED: Use Webhook/WebhookLog from flow-automation
export type LegacyWebhook = typeof legacyWebhooks.$inferSelect;
export type InsertLegacyWebhook = z.infer<typeof insertLegacyWebhookSchema>;
export type LegacyWebhookDelivery = typeof legacyWebhookDeliveries.$inferSelect;
export type InsertLegacyWebhookDelivery = z.infer<typeof insertLegacyWebhookDeliverySchema>;
export type PhoneNumberRental = typeof phoneNumberRentals.$inferSelect;
export type InsertPhoneNumberRental = z.infer<typeof insertPhoneNumberRentalSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;

export type AgentVersion = typeof agentVersions.$inferSelect;
export type InsertAgentVersion = z.infer<typeof insertAgentVersionSchema>;

// ============================================
// AGENT CONFIG INTERFACE (for agents.config JSONB field)
// ============================================

/**
 * AgentConfig represents the JSONB config stored on agents table.
 * Contains ElevenLabs-specific configuration and transfer rules.
 */
export interface AgentConfig {
  elevenLabsVoiceId?: string;
  model?: string;
  firstMessage?: string;
  temperature?: number;
  transferRules?: TransferRule[];
  knowledgeBaseIds?: string[];
}

/**
 * Transfer rule configuration for call transfers
 */
export interface TransferRule {
  transfer_type: "conference" | "warm_transfer" | "cold_transfer" | "sip_refer";
  number_type: "phone" | "sip_uri";
  destination: string;
  condition?: string;
  customer_message?: string;
  operator_message?: string;
}

/**
 * CallMetadata represents the JSONB metadata stored on calls table.
 * Contains call-specific metadata and tracking information.
 */
export interface CallMetadata {
  elevenLabsNative?: boolean;
  conversationId?: string;
  error?: string;
  [key: string]: unknown; // Allow additional metadata fields
}

// ============================================
// FLOW AUTOMATION TABLES
// ============================================

// Flow node types
export type FlowNodeType = 
  | "message"      // AI speaks text
  | "question"     // AI asks and waits for response
  | "condition"    // Branch based on response
  | "appointment"  // Book appointment
  | "form"         // Collect form data
  | "webhook"      // Fire webhook
  | "transfer"     // Transfer call
  | "delay"        // Pause conversation
  | "play_audio"   // Play audio file
  | "end";         // End call

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: {
    label: string;
    config: NodeConfig;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// Node-specific configurations
export type NodeConfig = 
  | MessageNodeConfig
  | QuestionNodeConfig
  | ConditionNodeConfig
  | AppointmentNodeConfig
  | FormNodeConfig
  | WebhookNodeConfig
  | TransferNodeConfig
  | DelayNodeConfig
  | PlayAudioNodeConfig
  | EndNodeConfig;

export interface MessageNodeConfig {
  type: "message";
  message: string;
  waitForResponse?: boolean; // Default: false - proceed immediately after speaking
}

export interface QuestionNodeConfig {
  type: "question";
  question: string;
  variableName: string;
  expectedResponseType?: "text" | "number" | "yes_no";
  waitForResponse?: boolean; // Default: true - wait for user answer before proceeding
}

export interface ConditionNodeConfig {
  type: "condition";
  conditions: {
    type: "keyword" | "sentiment" | "yes_no";
    value: string;
    targetNodeId: string;
    label: string;
  }[];
  defaultTargetNodeId?: string;
}

export interface AppointmentNodeConfig {
  type: "appointment";
  confirmMessage: string;
  serviceName?: string;
  duration: number;
  waitForResponse?: boolean; // Default: true - wait for data collection to complete
  googleSheetId?: string;   // Spreadsheet ID — used at runtime for row appends
  googleSheetName?: string; // Tab/sheet name — used at runtime for row appends
  googleSheetTitle?: string; // Spreadsheet display name — UI/metadata only, not used at runtime
}

export interface FormNodeConfig {
  type: "form";
  formId: string;
  waitForResponse?: boolean; // Default: true - wait for form data collection to complete
  googleSheetId?: string;   // Spreadsheet ID — used at runtime for row appends
  googleSheetName?: string; // Tab/sheet name — used at runtime for row appends
  googleSheetTitle?: string; // Spreadsheet display name — UI/metadata only, not used at runtime
}

export interface WebhookNodeConfig {
  type: "webhook";
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  payload: Record<string, any>;
}

export interface TransferNodeConfig {
  type: "transfer";
  transferNumber: string;
  message: string;
}

export interface DelayNodeConfig {
  type: "delay";
  seconds: number;
  waitForResponse?: boolean; // Default: false - proceed after delay
}

export interface PlayAudioNodeConfig {
  type: "play_audio";
  audioUrl: string;           // Server URL after upload (e.g., /audio/uuid.mp3)
  audioFileName?: string;     // Original filename for display
  interruptible?: boolean;    // Allow user to interrupt playback (default: false)
  waitForComplete?: boolean;  // Wait for audio to finish before continuing (default: true)
}

export interface EndNodeConfig {
  type: "end";
  message?: string;
  waitForResponse?: boolean; // Not used for end nodes, included for consistency
}

// Voice & Execution Settings
export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  speakingRate?: number;
  pitch?: number;
  style?: number;
}

export interface ExecutionConfig {
  enableRecording?: boolean;
  maxDuration?: number;
  timeoutBehavior?: "end" | "repeat_last";
  noInputRetries?: number;
  enableTranscript?: boolean;
}

// Compiled OpenAI Voice Agent types for flows
export interface CompiledConversationState {
  id: string;
  description: string;
  instructions: string[];
  examples?: string[];
  transitions: Array<{ next_step: string; condition: string }>;
}

export interface CompiledFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

// Flows table
export const flows = pgTable("flows", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  nodes: jsonb("nodes").notNull().$type<FlowNode[]>(),
  edges: jsonb("edges").notNull().$type<FlowEdge[]>(),
  agentId: varchar("agent_id"),
  voiceSettings: jsonb("voice_settings").$type<VoiceSettings>(),
  executionConfig: jsonb("execution_config").$type<ExecutionConfig>(),
  isActive: boolean("is_active").default(true).notNull(),
  isTemplate: boolean("is_template").default(false).notNull(),
  compiledSystemPrompt: text("compiled_system_prompt"),
  compiledFirstMessage: text("compiled_first_message"),
  compiledStates: jsonb("compiled_states").$type<CompiledConversationState[]>(),
  compiledTools: jsonb("compiled_tools").$type<CompiledFunctionTool[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFlowSchema = createInsertSchema(flows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  compiledSystemPrompt: true,
  compiledFirstMessage: true,
  compiledStates: true,
  compiledTools: true,
});
export const createFlowSchema = insertFlowSchema.omit({ userId: true });
export type InsertFlow = z.infer<typeof insertFlowSchema>;
export type CreateFlow = z.infer<typeof createFlowSchema>;
export type Flow = typeof flows.$inferSelect;

// Flow Executions table
export const flowExecutions = pgTable("flow_executions", {
  id: varchar("id").primaryKey(),
  callId: varchar("call_id").notNull(),
  flowId: varchar("flow_id").notNull().references(() => flows.id),
  currentNodeId: varchar("current_node_id"),
  status: varchar("status", { length: 50 }).notNull(),
  variables: jsonb("variables").default({}).$type<Record<string, any>>(),
  pathTaken: jsonb("path_taken").default([]).$type<string[]>(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertFlowExecutionSchema = createInsertSchema(flowExecutions).omit({
  id: true,
  startedAt: true,
});
export type InsertFlowExecution = z.infer<typeof insertFlowExecutionSchema>;
export type FlowExecution = typeof flowExecutions.$inferSelect;

// Flow Test Queue table - holds queued test call requests when pool numbers are all busy
export const flowTestQueue = pgTable("flow_test_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  flowId: varchar("flow_id").notNull().references(() => flows.id, { onDelete: 'cascade' }),
  toPhone: text("to_phone").notNull(),
  status: text("status").notNull().default("waiting"), // waiting / processing / completed / failed / cancelled
  callId: varchar("call_id"),           // set when status=completed
  errorMessage: text("error_message"),  // set when status=failed|cancelled
  processedAt: timestamp("processed_at"), // set when leaving waiting
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFlowTestQueueSchema = createInsertSchema(flowTestQueue).omit({
  id: true,
  createdAt: true,
});
export type InsertFlowTestQueue = z.infer<typeof insertFlowTestQueueSchema>;
export type FlowTestQueueEntry = typeof flowTestQueue.$inferSelect;

// Webhook Subscriptions table
export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  url: text("url").notNull(),
  method: varchar("method", { length: 10 }).default("POST").notNull(),
  headers: jsonb("headers").$type<Record<string, string>>(),
  secret: varchar("secret", { length: 64 }).notNull(),
  authType: varchar("auth_type", { length: 50 }),
  authCredentials: jsonb("auth_credentials").$type<Record<string, string>>(),
  events: jsonb("events").notNull().$type<string[]>(),
  campaignIds: jsonb("campaign_ids").$type<string[] | null>(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Alias for backward compatibility
export const webhooks = webhookSubscriptions;

export const insertWebhookSchema = createInsertSchema(webhooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const createWebhookSchema = insertWebhookSchema.omit({ userId: true });
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type CreateWebhook = z.infer<typeof createWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

// Webhook Delivery Logs table
export const webhookDeliveryLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  webhookId: varchar("webhook_id").references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 100 }).notNull(),
  payload: jsonb("payload").notNull(),
  success: boolean("success").notNull(),
  httpStatus: integer("status_code"),
  responseBody: text("response_body"),
  responseTime: integer("response_time"),
  error: text("error"),
  attemptNumber: integer("attempt").default(1).notNull(),
  maxAttempts: integer("max_attempts").default(3),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhookLogs = webhookDeliveryLogs;

export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogs.$inferSelect;

// Appointments table
export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  callId: varchar("call_id"),
  flowId: varchar("flow_id").references(() => flows.id),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 50 }).notNull(),
  contactEmail: varchar("contact_email", { length: 255 }),
  appointmentDate: date("appointment_date").notNull(),
  appointmentTime: time("appointment_time").notNull(),
  duration: integer("duration").notNull(),
  serviceName: varchar("service_name", { length: 255 }),
  notes: text("notes"),
  status: varchar("status", { length: 50 }).default("scheduled").notNull(),
  statusReason: varchar("status_reason", { length: 500 }),
  googleCalendarEventId: varchar("google_calendar_event_id", { length: 255 }),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const createAppointmentSchema = insertAppointmentSchema.omit({ userId: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type CreateAppointment = z.infer<typeof createAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

// Appointment Settings table
export const appointmentSettings = pgTable("appointment_settings", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  allowOverlapping: boolean("allow_overlapping").default(false).notNull(),
  bufferMinutes: integer("buffer_minutes").default(0).notNull(),
  syncToGoogleCalendar: boolean("sync_to_google_calendar").default(false).notNull(),
  workingHours: jsonb("working_hours").notNull().$type<{
    monday: { start: string; end: string; enabled: boolean };
    tuesday: { start: string; end: string; enabled: boolean };
    wednesday: { start: string; end: string; enabled: boolean };
    thursday: { start: string; end: string; enabled: boolean };
    friday: { start: string; end: string; enabled: boolean };
    saturday: { start: string; end: string; enabled: boolean };
    sunday: { start: string; end: string; enabled: boolean };
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAppointmentSettingsSchema = createInsertSchema(appointmentSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const createAppointmentSettingsSchema = insertAppointmentSettingsSchema.omit({ userId: true });
export type InsertAppointmentSettings = z.infer<typeof insertAppointmentSettingsSchema>;
export type CreateAppointmentSettings = z.infer<typeof createAppointmentSettingsSchema>;
export type AppointmentSettings = typeof appointmentSettings.$inferSelect;

// Forms table
export const forms = pgTable("forms", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFormSchema = createInsertSchema(forms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const createFormSchema = insertFormSchema.omit({ userId: true });
export type InsertForm = z.infer<typeof insertFormSchema>;
export type CreateForm = z.infer<typeof createFormSchema>;
export type Form = typeof forms.$inferSelect;

// Form Fields table
export const formFields = pgTable("form_fields", {
  id: varchar("id").primaryKey(),
  formId: varchar("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  fieldType: varchar("field_type", { length: 50 }).notNull(),
  options: jsonb("options").$type<string[]>(),
  isRequired: boolean("is_required").default(true).notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFormFieldSchema = createInsertSchema(formFields).omit({
  id: true,
  createdAt: true,
});
export type InsertFormField = z.infer<typeof insertFormFieldSchema>;
export type FormField = typeof formFields.$inferSelect;

// Form Submissions table
export const formSubmissions = pgTable("form_submissions", {
  id: varchar("id").primaryKey(),
  formId: varchar("form_id").notNull().references(() => forms.id),
  callId: varchar("call_id"),
  flowExecutionId: varchar("flow_execution_id").references(() => flowExecutions.id),
  contactName: varchar("contact_name", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  responses: jsonb("responses").notNull().$type<{
    fieldId: string;
    question: string;
    answer: string;
  }[]>(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
});

export const insertFormSubmissionSchema = createInsertSchema(formSubmissions).omit({
  id: true,
  submittedAt: true,
});
export type InsertFormSubmission = z.infer<typeof insertFormSubmissionSchema>;
export type FormSubmission = typeof formSubmissions.$inferSelect;

// SEO Settings table - Platform-wide SEO configuration
export interface SitemapUrl {
  url: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
  lastmod?: string;
}

export interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

export interface StructuredDataConfig {
  organizationName: string;
  organizationUrl: string;
  organizationLogo: string;
  organizationDescription: string;
  socialProfiles: string[];
  contactEmail: string;
  contactPhone: string;
}

// FAQ structured data for Google FAQ rich snippets
export interface FaqItem {
  question: string;
  answer: string;
}

// Product structured data for Google Product rich snippets
export interface ProductStructuredData {
  name: string;
  description: string;
  image: string;
  brand: string;
  sku: string;
  price: string;
  priceCurrency: string;
  availability: 'InStock' | 'OutOfStock' | 'PreOrder' | 'Discontinued';
  url: string;
  ratingValue?: string;
  ratingCount?: string;
}

export const seoSettings = pgTable("seo_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Meta Tags - Default values for pages without specific SEO
  defaultTitle: text("default_title").default("AI Calling Platform"),
  defaultDescription: text("default_description").default("Enterprise AI-powered bulk calling platform with voice agents, Twilio integration, and intelligent lead classification."),
  defaultKeywords: text("default_keywords").array().default(sql`ARRAY[]::text[]`),
  defaultOgImage: text("default_og_image").default("/og-image.png"),
  
  // Sitemap Configuration
  sitemapEnabled: boolean("sitemap_enabled").default(true),
  sitemapUrls: jsonb("sitemap_urls").$type<SitemapUrl[]>().default([]),
  sitemapAutoGenerate: boolean("sitemap_auto_generate").default(true),
  
  // Robots.txt Configuration
  robotsEnabled: boolean("robots_enabled").default(true),
  robotsRules: jsonb("robots_rules").$type<RobotsRule[]>().default([
    {
      userAgent: "*",
      allow: ["/", "/pricing", "/features", "/use-cases", "/integrations", "/blog", "/contact", "/about", "/privacy", "/terms"],
      disallow: ["/app/", "/admin/", "/api/"]
    }
  ]),
  robotsCrawlDelay: integer("robots_crawl_delay").default(0),
  
  // Structured Data / Schema.org
  structuredDataEnabled: boolean("structured_data_enabled").default(true),
  structuredData: jsonb("structured_data").$type<StructuredDataConfig>().default({
    organizationName: "",
    organizationUrl: "",
    organizationLogo: "/logo.png",
    organizationDescription: "AI-powered voice agents for automated calling",
    socialProfiles: [],
    contactEmail: "",
    contactPhone: ""
  }),
  
  // FAQ Structured Data for rich snippets
  structuredDataFaq: jsonb("structured_data_faq").$type<FaqItem[]>().default([]),
  structuredDataFaqEnabled: boolean("structured_data_faq_enabled").default(false),
  
  // Product Structured Data for rich snippets
  structuredDataProduct: jsonb("structured_data_product").$type<ProductStructuredData | null>().default(null),
  structuredDataProductEnabled: boolean("structured_data_product_enabled").default(false),
  
  // Social Media Meta Tags
  twitterHandle: text("twitter_handle"),
  facebookAppId: text("facebook_app_id"),
  
  // Advanced Settings
  canonicalBaseUrl: text("canonical_base_url"),
  googleVerification: text("google_verification"),
  bingVerification: text("bing_verification"),
  
  // Audit
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSeoSettingsSchema = createInsertSchema(seoSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSeoSettings = z.infer<typeof insertSeoSettingsSchema>;
export type SeoSettings = typeof seoSettings.$inferSelect;

// ============================================================
// ANALYTICS & TRACKING SCRIPTS
// ============================================================

// Analytics Scripts - Admin-configurable tracking scripts (GTM, GA4, Facebook Pixel, etc.)
export const analyticsScripts = pgTable("analytics_scripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Script Identity
  name: text("name").notNull(), // Display name (e.g., "Google Tag Manager", "Facebook Pixel")
  type: text("type").notNull().default("custom"), // 'gtm', 'ga4', 'facebook_pixel', 'linkedin', 'twitter', 'tiktok', 'hotjar', 'clarity', 'custom'
  
  // Script Content
  code: text("code").notNull(), // Legacy single code field (for backward compatibility)
  headCode: text("head_code"), // Code to inject in <head> section
  bodyCode: text("body_code"), // Code to inject after <body> tag (e.g., GTM noscript)
  
  // Placement Configuration - Array supports multiple placements (e.g., both head and body for some scripts like GTM)
  placement: text("placement").array().notNull().default(sql`ARRAY['head']::text[]`), // Array of 'head' and/or 'body' - where to inject the script
  loadPriority: integer("load_priority").notNull().default(0), // Higher priority = loads first (within placement group)
  
  // Script Attributes (for <script> tag configuration)
  async: boolean("async").default(false), // Add async attribute
  defer: boolean("defer").default(false), // Add defer attribute
  
  // Status
  enabled: boolean("enabled").notNull().default(true),
  
  // Page Scope - Control where scripts are injected
  hideOnInternalPages: boolean("hide_on_internal_pages").notNull().default(false), // Hide on admin/user dashboard pages
  
  // Notes for admin reference
  description: text("description"),
  
  // Audit
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAnalyticsScriptSchema = createInsertSchema(analyticsScripts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAnalyticsScript = z.infer<typeof insertAnalyticsScriptSchema>;
export type AnalyticsScript = typeof analyticsScripts.$inferSelect;

// ============================================================
// PAYMENT TRANSACTIONS & INVOICING SYSTEM
// ============================================================

// Payment Transactions - Unified log of all payments (plans + credits) across all gateways
export const paymentTransactions = pgTable("payment_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Transaction Type
  type: text("type").notNull(), // 'subscription' or 'credits'
  
  // Gateway Information
  gateway: text("gateway").notNull(), // 'stripe', 'razorpay', 'paypal', 'paystack', 'mercadopago'
  gatewayTransactionId: text("gateway_transaction_id"), // Payment intent ID, order ID, etc.
  gatewaySubscriptionId: text("gateway_subscription_id"), // For subscription payments
  
  // Amount & Currency
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  
  // Related Records
  planId: varchar("plan_id").references(() => plans.id, { onDelete: "set null" }),
  creditPackageId: varchar("credit_package_id").references(() => creditPackages.id, { onDelete: "set null" }),
  subscriptionId: varchar("subscription_id").references(() => userSubscriptions.id, { onDelete: "set null" }),
  
  // Transaction Details
  description: text("description").notNull(),
  billingPeriod: text("billing_period"), // 'monthly', 'yearly' for subscriptions
  creditsAwarded: integer("credits_awarded"), // For credit purchases
  
  // Status
  status: text("status").notNull().default("pending"), // 'pending', 'completed', 'failed', 'refunded', 'partially_refunded'
  
  // Invoice Reference
  invoiceId: varchar("invoice_id"), // Will be linked after invoice generation
  
  // Metadata
  metadata: jsonb("metadata"), // Additional gateway-specific data
  
  // Timestamps
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;

// Refunds - Track all refunds across gateways
export const refunds = pgTable("refunds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionId: varchar("transaction_id").notNull().references(() => paymentTransactions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Refund Details
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  
  // Gateway Information
  gateway: text("gateway").notNull(), // Same as original transaction
  gatewayRefundId: text("gateway_refund_id"), // Refund ID from gateway
  
  // Refund Type
  reason: text("reason").notNull(), // 'admin_request', 'chargeback', 'customer_request', 'duplicate', 'fraudulent'
  initiatedBy: text("initiated_by").notNull(), // 'admin', 'customer', 'gateway' (for chargebacks)
  adminId: varchar("admin_id").references(() => users.id, { onDelete: "set null" }), // Admin who processed refund
  
  // Status
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'
  
  // Credits Reversal
  creditsReversed: integer("credits_reversed"), // Credits taken back
  
  // User Suspension (for chargebacks)
  userSuspended: boolean("user_suspended").notNull().default(false),
  
  // Notes
  adminNote: text("admin_note"), // Internal note from admin
  customerNote: text("customer_note"), // Note visible to customer
  
  // Metadata
  metadata: jsonb("metadata"), // Gateway-specific refund data
  
  // Refund Note PDF
  refundNoteNumber: text("refund_note_number"), // e.g., RN-2024-0001
  pdfUrl: text("pdf_url"), // URL to stored refund note PDF
  pdfGeneratedAt: timestamp("pdf_generated_at"),
  
  // Timestamps
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRefundSchema = createInsertSchema(refunds).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRefund = z.infer<typeof insertRefundSchema>;
export type Refund = typeof refunds.$inferSelect;

// Invoices - PDF invoices for all transactions
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionId: varchar("transaction_id").notNull().references(() => paymentTransactions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Invoice Number (human-readable)
  invoiceNumber: text("invoice_number").notNull().unique(), // e.g., INV-2024-00001
  
  // Customer Details (snapshot at time of invoice)
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerAddress: text("customer_address"),
  
  // Invoice Details
  description: text("description").notNull(),
  lineItems: jsonb("line_items").notNull().$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[]>(),
  
  // Amounts
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0.00"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  
  // Gateway & Payment Info
  gateway: text("gateway").notNull(),
  paymentMethod: text("payment_method"), // 'card', 'bank_transfer', etc.
  
  // PDF Storage
  pdfUrl: text("pdf_url"), // URL to stored PDF
  pdfGeneratedAt: timestamp("pdf_generated_at"),
  
  // Status
  status: text("status").notNull().default("draft"), // 'draft', 'sent', 'paid', 'void'
  
  // Email Delivery
  emailSentAt: timestamp("email_sent_at"),
  emailSentTo: text("email_sent_to"),
  
  // Timestamps
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  dueAt: timestamp("due_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Payment Webhook Queue - For retry logic on failed webhook processing
export const paymentWebhookQueue = pgTable("payment_webhook_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Webhook Source
  gateway: text("gateway").notNull(), // 'stripe', 'razorpay', 'paypal', 'paystack', 'mercadopago'
  eventType: text("event_type").notNull(), // e.g., 'payment_intent.succeeded', 'subscription.created'
  eventId: text("event_id").notNull(), // Gateway's event ID for idempotency
  
  // Payload
  payload: jsonb("payload").notNull(), // Full webhook payload
  
  // Processing Status
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed', 'expired'
  
  // Retry Information
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastAttemptAt: timestamp("last_attempt_at"),
  nextRetryAt: timestamp("next_retry_at"),
  
  // Error Tracking
  lastError: text("last_error"),
  errorHistory: jsonb("error_history").$type<{
    attempt: number;
    error: string;
    timestamp: string;
  }[]>(),
  
  // Related Records (if known)
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  transactionId: varchar("transaction_id").references(() => paymentTransactions.id, { onDelete: "set null" }),
  
  // Timestamps
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  expiresAt: timestamp("expires_at").notNull(), // 24 hours from receivedAt
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPaymentWebhookQueueSchema = createInsertSchema(paymentWebhookQueue).omit({
  id: true,
  createdAt: true,
});
export type InsertPaymentWebhookQueue = z.infer<typeof insertPaymentWebhookQueueSchema>;
export type PaymentWebhookQueue = typeof paymentWebhookQueue.$inferSelect;

// Email Notification Settings - Admin-configurable email types
export const emailNotificationSettings = pgTable("email_notification_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Email Type
  eventType: text("event_type").notNull().unique(), // 'welcome', 'purchase_confirmation', 'low_credits', 'campaign_completed', etc.
  displayName: text("display_name").notNull(), // Human-readable name
  description: text("description"), // Description of when this email is sent
  
  // Settings
  isEnabled: boolean("is_enabled").notNull().default(true),
  
  // Template Reference (optional - for custom templates)
  templateId: varchar("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  
  // Thresholds (for certain event types)
  thresholdValue: integer("threshold_value"), // e.g., credit count for low_credits alert
  
  // Metadata
  category: text("category").notNull().default("general"), // 'authentication', 'billing', 'campaigns', 'account', 'general'
  
  // Audit
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmailNotificationSettingsSchema = createInsertSchema(emailNotificationSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmailNotificationSettings = z.infer<typeof insertEmailNotificationSettingsSchema>;
export type EmailNotificationSettings = typeof emailNotificationSettings.$inferSelect;

// Banned Words - Admin-configurable list of prohibited words/phrases for call monitoring
export const bannedWords = pgTable("banned_words", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  word: text("word").notNull(), // The banned word or phrase
  category: text("category").notNull().default("general"), // 'profanity', 'harassment', 'hate_speech', 'threats', 'general'
  severity: text("severity").notNull().default("medium"), // 'low', 'medium', 'high', 'critical'
  isActive: boolean("is_active").notNull().default(true),
  autoBlock: boolean("auto_block").notNull().default(false), // Auto-block user when detected
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBannedWordSchema = createInsertSchema(bannedWords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBannedWord = z.infer<typeof insertBannedWordSchema>;
export type BannedWord = typeof bannedWords.$inferSelect;

// Content Violations - Log of detected banned words in calls
export const contentViolations = pgTable("content_violations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bannedWordId: varchar("banned_word_id").references(() => bannedWords.id, { onDelete: "set null" }),
  detectedWord: text("detected_word").notNull(), // The actual word detected
  context: text("context"), // Surrounding text for context
  severity: text("severity").notNull().default("medium"), // 'low', 'medium', 'high', 'critical'
  status: text("status").notNull().default("pending"), // 'pending', 'reviewed', 'dismissed', 'actioned'
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  actionTaken: text("action_taken"), // 'warning', 'blocked', 'dismissed', etc.
  notes: text("notes"), // Admin notes
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContentViolationSchema = createInsertSchema(contentViolations).omit({
  id: true,
  createdAt: true,
});
export type InsertContentViolation = z.infer<typeof insertContentViolationSchema>;
export type ContentViolation = typeof contentViolations.$inferSelect;

// ============================================================
// PLIVO + OPENAI REALTIME ENGINE TABLES
// Alternative voice AI engine using Plivo for telephony and OpenAI Realtime API
// ============================================================

// OpenAI API Key Pool - Similar to ElevenLabs pool with model tier support
export const openaiCredentials = pgTable("openai_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull(),
  modelTier: text("model_tier").notNull().default("free"), // 'free' (gpt-realtime-mini) or 'pro' (gpt-realtime-1.5)
  isActive: boolean("is_active").notNull().default(true),
  maxConcurrency: integer("max_concurrency").notNull().default(50),
  currentLoad: integer("current_load").notNull().default(0),
  totalAssignedAgents: integer("total_assigned_agents").notNull().default(0),
  totalAssignedUsers: integer("total_assigned_users").notNull().default(0),
  maxAgentsThreshold: integer("max_agents_threshold").notNull().default(100),
  lastHealthCheck: timestamp("last_health_check"),
  healthStatus: text("health_status").notNull().default("healthy"), // healthy, degraded, unhealthy
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOpenaiCredentialSchema = createInsertSchema(openaiCredentials).omit({
  id: true,
  currentLoad: true,
  totalAssignedAgents: true,
  totalAssignedUsers: true,
  lastHealthCheck: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOpenaiCredential = z.infer<typeof insertOpenaiCredentialSchema>;
export type OpenaiCredential = typeof openaiCredentials.$inferSelect;

// Plivo Credentials - Account credentials for Plivo telephony
export const plivoCredentials = pgTable("plivo_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  authId: text("auth_id").notNull(),
  authToken: text("auth_token").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlivoCredentialSchema = createInsertSchema(plivoCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlivoCredential = z.infer<typeof insertPlivoCredentialSchema>;
export type PlivoCredential = typeof plivoCredentials.$inferSelect;

// Plivo Phone Numbers
export const plivoPhoneNumbers = pgTable("plivo_phone_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  plivoCredentialId: varchar("plivo_credential_id").references(() => plivoCredentials.id, { onDelete: "set null" }),
  openaiCredentialId: varchar("openai_credential_id").references(() => openaiCredentials.id, { onDelete: "set null" }),
  phoneNumber: text("phone_number").notNull().unique(),
  plivoNumberId: text("plivo_number_id").notNull().unique(),
  friendlyName: text("friendly_name"),
  country: text("country").notNull(),
  region: text("region"),
  numberType: text("number_type").default("local"), // local, toll_free, national
  capabilities: jsonb("capabilities"), // { voice: true, sms: true }
  status: text("status").notNull().default("active"), // active, pending, released, suspended
  
  // Pricing (admin-configured credits)
  purchaseCredits: integer("purchase_credits").notNull().default(0),
  monthlyCredits: integer("monthly_credits").notNull().default(0),
  nextBillingDate: timestamp("next_billing_date"),
  
  // Incoming agent connection
  assignedAgentId: varchar("assigned_agent_id").references(() => agents.id, { onDelete: "set null" }),
  
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlivoPhoneNumberSchema = createInsertSchema(plivoPhoneNumbers).omit({
  id: true,
  purchasedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlivoPhoneNumber = z.infer<typeof insertPlivoPhoneNumberSchema>;
export type PlivoPhoneNumber = typeof plivoPhoneNumbers.$inferSelect;

// Plivo Calls - Call records with transcripts and AI summaries
export const plivoCalls = pgTable("plivo_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id").references(() => agents.id, { onDelete: "set null" }),
  plivoPhoneNumberId: varchar("plivo_phone_number_id").references(() => plivoPhoneNumbers.id, { onDelete: "set null" }),
  openaiCredentialId: varchar("openai_credential_id").references(() => openaiCredentials.id, { onDelete: "set null" }),
  
  // Plivo identifiers
  plivoCallUuid: text("plivo_call_uuid").unique(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  
  // OpenAI session
  openaiSessionId: text("openai_session_id"),
  openaiVoice: text("openai_voice").default("alloy"),
  openaiModel: text("openai_model").default("gpt-realtime-1.5"),
  
  // Call status
  status: text("status").notNull().default("pending"), // pending, initiated, ringing, in-progress, completed, busy, failed, no-answer, canceled
  callDirection: text("call_direction").notNull().default("outbound"), // inbound, outbound
  duration: integer("duration"), // seconds
  
  // Recording
  recordingId: text("recording_id"),
  recordingUrl: text("recording_url"),
  recordingDuration: integer("recording_duration"),
  
  // AI analysis
  transcript: text("transcript"),
  aiSummary: text("ai_summary"),
  leadQualityScore: integer("lead_quality_score"), // 1-100
  sentiment: text("sentiment"), // positive, neutral, negative
  classification: text("classification"), // hot, warm, cold, lost
  keyPoints: jsonb("key_points"), // string[]
  nextActions: jsonb("next_actions"), // string[]
  
  // Call transfer
  wasTransferred: boolean("was_transferred").default(false),
  transferredTo: text("transferred_to"),
  transferredAt: timestamp("transferred_at"),
  
  // Timestamps
  startedAt: timestamp("started_at"),
  answeredAt: timestamp("answered_at"),
  endedAt: timestamp("ended_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  plivoCallsUserIdIdx: index("plivo_calls_user_id_idx").on(table.userId),
  plivoCallsCampaignIdIdx: index("plivo_calls_campaign_id_idx").on(table.campaignId),
  plivoCallsContactIdIdx: index("plivo_calls_contact_id_idx").on(table.contactId),
  plivoCallsStatusIdx: index("plivo_calls_status_idx").on(table.status),
  plivoCallsCreatedAtIdx: index("plivo_calls_created_at_idx").on(table.createdAt),
  // plivoCalls has no call_id FK — it uses plivoCallUuid as the primary external identifier
  plivoCallsPlivoCallUuidIdx: index("plivo_calls_plivo_call_uuid_idx").on(table.plivoCallUuid),
}));

export const insertPlivoCallSchema = createInsertSchema(plivoCalls).omit({
  id: true,
  createdAt: true,
});
export type InsertPlivoCall = z.infer<typeof insertPlivoCallSchema>;
export type PlivoCall = typeof plivoCalls.$inferSelect;

// Campaign Jobs - For tracking individual call jobs in campaigns
export const campaignJobs = pgTable("campaign_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  contactId: varchar("contact_id").notNull(),
  engine: text("engine").notNull().default("plivo"), // 'plivo' or 'twilio'
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  workerId: text("worker_id"), // For distributed processing
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  completedAt: timestamp("completed_at"),
});

export const insertCampaignJobSchema = createInsertSchema(campaignJobs).omit({
  id: true,
  createdAt: true,
});

export type InsertCampaignJob = z.infer<typeof insertCampaignJobSchema>;
export type CampaignJob = typeof campaignJobs.$inferSelect;

// Plivo Phone Pricing - Admin-configured pricing per country
export const plivoPhonePricing = pgTable("plivo_phone_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  countryCode: text("country_code").notNull().unique(), // ISO 2-letter country code
  countryName: text("country_name").notNull(),
  purchaseCredits: integer("purchase_credits").notNull().default(100),
  monthlyCredits: integer("monthly_credits").notNull().default(50),
  kycRequired: boolean("kyc_required").notNull().default(false), // Whether KYC verification is required for this country
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlivoPhonePricingSchema = createInsertSchema(plivoPhonePricing).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlivoPhonePricing = z.infer<typeof insertPlivoPhonePricingSchema>;
export type PlivoPhonePricing = typeof plivoPhonePricing.$inferSelect;

// ============================================================
// User KYC Documents - For phone number purchase verification
// ============================================================
export const userKycDocuments = pgTable("user_kyc_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(), // photo, company_registration, gst_certificate, authorization_letter
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const insertUserKycDocumentSchema = createInsertSchema(userKycDocuments).omit({
  id: true,
  uploadedAt: true,
});
export type InsertUserKycDocument = z.infer<typeof insertUserKycDocumentSchema>;
export type UserKycDocument = typeof userKycDocuments.$inferSelect;

// ============================================================
// Twilio + OpenAI Realtime Engine - Isolated Call Records
// Separate from Plivo+OpenAI and Twilio+ElevenLabs integrations
// ============================================================
export const twilioOpenaiCalls = pgTable("twilio_openai_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id").references(() => agents.id, { onDelete: "set null" }),
  twilioPhoneNumberId: varchar("twilio_phone_number_id").references(() => phoneNumbers.id, { onDelete: "set null" }),
  openaiCredentialId: varchar("openai_credential_id").references(() => openaiCredentials.id, { onDelete: "set null" }),
  
  twilioCallSid: text("twilio_call_sid").unique(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  
  openaiSessionId: text("openai_session_id"),
  openaiVoice: text("openai_voice").default("alloy"),
  openaiModel: text("openai_model").default("gpt-realtime-1.5"),
  
  status: text("status").notNull().default("pending"),
  callDirection: text("call_direction").notNull().default("outbound"),
  duration: integer("duration"),
  
  recordingUrl: text("recording_url"),
  recordingDuration: integer("recording_duration"),
  
  transcript: text("transcript"),
  aiSummary: text("ai_summary"),
  leadQualityScore: integer("lead_quality_score"),
  sentiment: text("sentiment"),
  classification: text("classification"),
  keyPoints: jsonb("key_points"),
  nextActions: jsonb("next_actions"),
  
  wasTransferred: boolean("was_transferred").default(false),
  transferredTo: text("transferred_to"),
  transferredAt: timestamp("transferred_at"),
  
  startedAt: timestamp("started_at"),
  answeredAt: timestamp("answered_at"),
  endedAt: timestamp("ended_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  twilioOpenaiCallsUserIdIdx: index("twilio_openai_calls_user_id_idx").on(table.userId),
  twilioOpenaiCallsCampaignIdIdx: index("twilio_openai_calls_campaign_id_idx").on(table.campaignId),
  twilioOpenaiCallsContactIdIdx: index("twilio_openai_calls_contact_id_idx").on(table.contactId),
  twilioOpenaiCallsStatusIdx: index("twilio_openai_calls_status_idx").on(table.status),
  twilioOpenaiCallsCreatedAtIdx: index("twilio_openai_calls_created_at_idx").on(table.createdAt),
  // twilioOpenaiCalls has no call_id FK — it uses twilioCallSid as the primary external identifier
  twilioOpenaiCallsTwilioSidIdx: index("twilio_openai_calls_twilio_call_sid_idx").on(table.twilioCallSid),
}));

export const insertTwilioOpenaiCallSchema = createInsertSchema(twilioOpenaiCalls).omit({
  id: true,
  createdAt: true,
});
export type InsertTwilioOpenaiCall = z.infer<typeof insertTwilioOpenaiCallSchema>;
export type TwilioOpenaiCall = typeof twilioOpenaiCalls.$inferSelect;

// ============================================================
// Demo Call Sessions - Browser-based demo calls for visitors
// ============================================================
export const demoSessions = pgTable("demo_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionToken: text("session_token").notNull().unique(),
  visitorIp: text("visitor_ip"),
  visitorFingerprint: text("visitor_fingerprint"),
  language: text("language").notNull().default("en"),
  voice: text("voice").notNull().default("alloy"),
  status: text("status").notNull().default("pending"),
  duration: integer("duration"),
  maxDuration: integer("max_duration").notNull().default(60),
  transcript: text("transcript"),
  openaiSessionId: text("openai_session_id"),
  openaiCredentialId: varchar("openai_credential_id").references(() => openaiCredentials.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDemoSessionSchema = createInsertSchema(demoSessions).omit({
  id: true,
  createdAt: true,
});
export type InsertDemoSession = z.infer<typeof insertDemoSessionSchema>;
export type DemoSession = typeof demoSessions.$inferSelect;

// ============================================================
// CRM Module - Lead Management System
// Isolated module for managing leads from campaigns and incoming calls
// ============================================================

// Lead Stages - User-customizable pipeline stages
export const leadStages = pgTable("lead_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6B7280"), // Hex color for stage header
  order: integer("order").notNull().default(0), // Display order in Kanban
  isDefault: boolean("is_default").notNull().default(false), // System default stages can't be deleted
  isCustom: boolean("is_custom").notNull().default(true), // User-created stages
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadStageSchema = createInsertSchema(leadStages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLeadStage = z.infer<typeof insertLeadStageSchema>;
export type LeadStage = typeof leadStages.$inferSelect;

// Leads - Main CRM leads table
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Source - Either from a campaign or incoming connection
  sourceType: text("source_type").notNull(), // 'campaign' | 'incoming'
  campaignId: varchar("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  incomingConnectionId: varchar("incoming_connection_id").references(() => incomingConnections.id, { onDelete: "cascade" }),
  
  // Contact Information
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone").notNull(),
  email: text("email"),
  company: text("company"),
  customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
  
  // Pipeline Status
  stageId: varchar("stage_id").references(() => leadStages.id, { onDelete: "set null" }),
  stage: text("stage").notNull().default("new"), // Fallback stage name: new, hot, appointment, form_submitted, follow_up, not_interested, no_answer
  
  // AI-Generated Insights
  leadScore: integer("lead_score"), // 1-100 AI-generated score
  aiSummary: text("ai_summary"), // AI-generated call summary
  aiNextAction: text("ai_next_action"), // Suggested next action
  sentiment: text("sentiment"), // positive, neutral, negative
  aiCategory: text("ai_category"), // AI-assigned category: 'warm' | 'hot' | 'appointment_booked' | 'form_submitted' | 'call_transfer' | 'need_follow_up' | null (uncategorized)
  
  // Tool Execution Flags - Show badges on lead card
  hasAppointment: boolean("has_appointment").notNull().default(false),
  hasFormSubmission: boolean("has_form_submission").notNull().default(false),
  hasTransfer: boolean("has_transfer").notNull().default(false),
  hasCallback: boolean("has_callback").notNull().default(false),
  
  // Appointment Details (if hasAppointment)
  appointmentDate: timestamp("appointment_date"),
  appointmentDetails: jsonb("appointment_details").$type<Record<string, unknown>>(),
  
  // Form Submission Details (if hasFormSubmission)
  formData: jsonb("form_data").$type<Record<string, unknown>>(),
  
  // Transfer Details (if hasTransfer)
  transferredTo: text("transferred_to"),
  transferredAt: timestamp("transferred_at"),
  
  // Callback/Follow-up Scheduling
  callbackScheduled: timestamp("callback_scheduled"),
  callbackCompleted: boolean("callback_completed").notNull().default(false),
  
  // Call Reference - Link to the call record
  callId: varchar("call_id").references(() => calls.id, { onDelete: "set null" }),
  plivoCallId: varchar("plivo_call_id").references(() => plivoCalls.id, { onDelete: "set null" }),
  twilioOpenaiCallId: varchar("twilio_openai_call_id").references(() => twilioOpenaiCalls.id, { onDelete: "set null" }),
  
  // Total calls made to this lead (for follow-ups)
  totalCalls: integer("total_calls").notNull().default(1),
  lastCallAt: timestamp("last_call_at"),
  
  // Tags for organization
  tags: text("tags").array(),
  
  // Assignment for team accounts
  assignedUserId: varchar("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// AI Category Types for Lead Qualification
export const AI_LEAD_CATEGORIES = {
  WARM: 'warm',
  HOT: 'hot',
  APPOINTMENT_BOOKED: 'appointment_booked',
  FORM_SUBMITTED: 'form_submitted',
  CALL_TRANSFER: 'call_transfer',
  NEED_FOLLOW_UP: 'need_follow_up',
} as const;

export type AILeadCategory = typeof AI_LEAD_CATEGORIES[keyof typeof AI_LEAD_CATEGORIES];

export const AI_CATEGORY_LABELS: Record<AILeadCategory, string> = {
  [AI_LEAD_CATEGORIES.WARM]: 'Warm Lead',
  [AI_LEAD_CATEGORIES.HOT]: 'Hot Lead',
  [AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED]: 'Appointment Booked',
  [AI_LEAD_CATEGORIES.FORM_SUBMITTED]: 'Form Submitted',
  [AI_LEAD_CATEGORIES.CALL_TRANSFER]: 'Call Transfer',
  [AI_LEAD_CATEGORIES.NEED_FOLLOW_UP]: 'Need Follow Up',
};

export const AI_CATEGORY_COLORS: Record<AILeadCategory, string> = {
  [AI_LEAD_CATEGORIES.WARM]: '#F59E0B',
  [AI_LEAD_CATEGORIES.HOT]: '#EF4444',
  [AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED]: '#10B981',
  [AI_LEAD_CATEGORIES.FORM_SUBMITTED]: '#3B82F6',
  [AI_LEAD_CATEGORIES.CALL_TRANSFER]: '#8B5CF6',
  [AI_LEAD_CATEGORIES.NEED_FOLLOW_UP]: '#F97316',
};

// Priority order for category assignment (first match wins)
// Actions > Follow-up > Score-based categories
export const AI_CATEGORY_PRIORITY: AILeadCategory[] = [
  AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED,
  AI_LEAD_CATEGORIES.FORM_SUBMITTED,
  AI_LEAD_CATEGORIES.CALL_TRANSFER,
  AI_LEAD_CATEGORIES.NEED_FOLLOW_UP,
  AI_LEAD_CATEGORIES.HOT,
  AI_LEAD_CATEGORIES.WARM,
];

// Auto-categorization function - determines the AI category for a lead
export function determineAICategory(lead: {
  hasAppointment?: boolean;
  hasFormSubmission?: boolean;
  hasTransfer?: boolean;
  hasCallback?: boolean;
  callbackScheduled?: Date | string | null;
  leadScore?: number | null;
  sentiment?: string | null;
}): AILeadCategory | null {
  // Priority 1: Action-based categories (concrete actions taken during call)
  if (lead.hasAppointment) return AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED;
  if (lead.hasFormSubmission) return AI_LEAD_CATEGORIES.FORM_SUBMITTED;
  if (lead.hasTransfer) return AI_LEAD_CATEGORIES.CALL_TRANSFER;
  
  // Priority 2: Follow-up needed (callback requested or scheduled)
  if (lead.hasCallback || lead.callbackScheduled) return AI_LEAD_CATEGORIES.NEED_FOLLOW_UP;
  
  // Priority 3: Score-based categories (AI-analyzed lead quality)
  if (lead.leadScore !== null && lead.leadScore !== undefined) {
    if (lead.leadScore >= 70) return AI_LEAD_CATEGORIES.HOT;
    if (lead.leadScore >= 40) return AI_LEAD_CATEGORIES.WARM;
  }
  
  // Priority 4: Sentiment-based fallback for unscored leads
  if (lead.sentiment === 'positive') return AI_LEAD_CATEGORIES.WARM;
  
  // No category - lead doesn't qualify for CRM display
  return null;
}

// Lead Notes - Manual notes added by users
export const leadNotes = pgTable("lead_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadNoteSchema = createInsertSchema(leadNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLeadNote = z.infer<typeof insertLeadNoteSchema>;
export type LeadNote = typeof leadNotes.$inferSelect;

// Lead Activities - Activity timeline for each lead
export const leadActivities = pgTable("lead_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Activity type: 'call' | 'note' | 'stage_change' | 'tag_added' | 'tag_removed' | 'created' | 'updated' | 'transfer' | 'appointment' | 'form_submission'
  activityType: text("activity_type").notNull(),
  
  // Activity details
  title: text("title").notNull(), // Short description: "Stage changed to Hot Lead"
  description: text("description"), // Longer description if needed
  
  // Metadata for different activity types
  metadata: jsonb("metadata").$type<{
    // For stage_change
    fromStage?: string;
    toStage?: string;
    fromStageName?: string;
    toStageName?: string;
    // For call
    callId?: string;
    callDuration?: number;
    callStatus?: string;
    // For note
    noteId?: string;
    noteContent?: string;
    // For tag changes
    tagName?: string;
    // For appointment
    appointmentDate?: string;
    // For transfer
    transferredTo?: string;
  }>(),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeadActivitySchema = createInsertSchema(leadActivities).omit({
  id: true,
  createdAt: true,
});
export type InsertLeadActivity = z.infer<typeof insertLeadActivitySchema>;
export type LeadActivity = typeof leadActivities.$inferSelect;

// ============================================================
// CRM Category Preferences - User customization for AI Kanban
// Stores color overrides and column ordering per user
// ============================================================

export const crmCategoryPreferences = pgTable("crm_category_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Column order - array of category IDs in display order
  columnOrder: text("column_order").array().notNull().default(sql`ARRAY['warm', 'hot', 'appointment_booked', 'form_submitted', 'call_transfer', 'need_follow_up']::text[]`),
  
  // Color overrides - JSON object mapping category ID to hex color
  colorOverrides: jsonb("color_overrides").$type<Record<string, string>>().default({}),
  
  // Per-column sort preferences - JSON object mapping category ID to sort preference
  columnSortPreferences: jsonb("column_sort_preferences").$type<Record<string, 'newest' | 'oldest' | 'score-high' | 'score-low'>>().default({}),
  
  // Filtering Settings
  hideLeadsWithoutPhone: boolean("hide_leads_without_phone").notNull().default(false),
  
  // Pipeline stage mappings - which AI categories go to which pipeline stage
  // Maps aiCategory (hot/warm/cold) to pipeline stage id or name
  categoryPipelineMappings: jsonb("category_pipeline_mappings").$type<Record<string, string>>().default({}),
  
  // Score thresholds for lead classification
  // hot: score >= hotThreshold, warm: score >= warmThreshold, cold: score < warmThreshold
  hotScoreThreshold: integer("hot_score_threshold").default(80),
  warmScoreThreshold: integer("warm_score_threshold").default(50),
  
  // Hide specific classifications from view
  hiddenCategories: text("hidden_categories").array().default(sql`ARRAY[]::text[]`),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrmCategoryPreferencesSchema = createInsertSchema(crmCategoryPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCrmCategoryPreferences = z.infer<typeof insertCrmCategoryPreferencesSchema>;
export type CrmCategoryPreferences = typeof crmCategoryPreferences.$inferSelect;

// ============================================================
// Website Widget Module - Embeddable Voice Widgets
// Isolated module for creating branded voice widgets for customer websites
// ============================================================

export const websiteWidgets = pgTable("website_widgets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Basic Info
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active, paused, disabled
  
  // Agent Configuration - which AI agent powers this widget
  agentId: varchar("agent_id").references(() => agents.id, { onDelete: "set null" }),
  agentType: text("agent_type").notNull().default("natural"), // natural, flow
  
  // Branding
  iconUrl: text("icon_url"), // Custom icon for the chat bubble
  iconPath: text("icon_path"), // File path for uploaded icon
  brandName: text("brand_name"), // Display name shown in widget
  buttonLabel: text("button_label").notNull().default("VOICE CHAT"), // Customizable button text
  primaryColor: text("primary_color").notNull().default("#3B82F6"), // Main color
  accentColor: text("accent_color").notNull().default("#1E40AF"), // Secondary color
  backgroundColor: text("background_color").notNull().default("#FFFFFF"), // Widget background
  textColor: text("text_color").notNull().default("#1F2937"), // Text color
  
  // Terms & Conditions
  requireTermsAcceptance: boolean("require_terms_acceptance").notNull().default(false), // Show terms checkbox before call
  
  // Widget Text Content
  welcomeMessage: text("welcome_message").notNull().default("Hi! Click to start a voice conversation."),
  launcherText: text("launcher_text").notNull().default("Talk to us"),
  offlineMessage: text("offline_message").notNull().default("We're currently unavailable. Please try again later."),
  lowCreditsMessage: text("low_credits_message").notNull().default("Service temporarily unavailable."),
  
  // Domain Whitelisting
  allowedDomains: text("allowed_domains").array().notNull().default(sql`ARRAY[]::text[]`), // Empty = allow all
  
  // Business Hours
  businessHoursEnabled: boolean("business_hours_enabled").notNull().default(false),
  businessHoursStart: text("business_hours_start").default("09:00"), // HH:MM format
  businessHoursEnd: text("business_hours_end").default("17:00"), // HH:MM format
  businessDays: text("business_days").array().default(sql`ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday']::text[]`),
  businessTimezone: text("business_timezone").default("America/New_York"),
  
  // Call Limits & Abuse Prevention
  maxConcurrentCalls: integer("max_concurrent_calls").notNull().default(5),
  maxCallDuration: integer("max_call_duration").notNull().default(300), // seconds (5 minutes default)
  cooldownMinutes: integer("cooldown_minutes").notNull().default(0), // minutes between calls per IP (0 = no cooldown)
  
  // Appointment Booking
  appointmentBookingEnabled: boolean("appointment_booking_enabled").notNull().default(false),
  
  // Embed Token - used to identify widget in public API
  embedToken: text("embed_token").notNull().unique(),
  
  // Analytics
  totalCalls: integer("total_calls").notNull().default(0),
  totalMinutes: integer("total_minutes").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWebsiteWidgetSchema = createInsertSchema(websiteWidgets).omit({
  id: true,
  totalCalls: true,
  totalMinutes: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWebsiteWidget = z.infer<typeof insertWebsiteWidgetSchema>;
export type WebsiteWidget = typeof websiteWidgets.$inferSelect;

// Widget Call Sessions - Track active/completed widget calls
export const widgetCallSessions = pgTable("widget_call_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  widgetId: varchar("widget_id").notNull().references(() => websiteWidgets.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Session Info
  sessionToken: text("session_token").notNull().unique(),
  visitorIp: text("visitor_ip"),
  visitorDomain: text("visitor_domain"), // Domain where widget is embedded
  
  // Call State
  status: text("status").notNull().default("pending"), // pending, connecting, active, completed, failed
  duration: integer("duration"), // seconds
  creditsUsed: integer("credits_used").default(0),
  
  // Recording & Transcript
  recordingUrl: text("recording_url"),
  transcript: text("transcript"),
  aiSummary: text("ai_summary"),
  sentiment: text("sentiment"),
  
  // OpenAI Realtime connection
  openaiSessionId: text("openai_session_id"),
  openaiCredentialId: varchar("openai_credential_id"),
  
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWidgetCallSessionSchema = createInsertSchema(widgetCallSessions).omit({
  id: true,
  createdAt: true,
});
export type InsertWidgetCallSession = z.infer<typeof insertWidgetCallSessionSchema>;
export type WidgetCallSession = typeof widgetCallSessions.$inferSelect;

// ============================================================
// REST API Plugin - API Keys and Audit Logs
// Enables external system integration via authenticated REST API
// ============================================================

// API Scopes - Define what each API key can access
export const API_SCOPES = {
  // Read scopes
  'calls:read': 'View call history and details',
  'campaigns:read': 'View campaigns',
  'agents:read': 'View agents',
  'contacts:read': 'View contacts',
  'knowledge:read': 'View knowledge bases',
  'phone-numbers:read': 'View phone numbers',
  'webhooks:read': 'View webhook subscriptions',
  'credits:read': 'View credit balance and usage',
  'analytics:read': 'View analytics data',
  
  // Write scopes
  'calls:write': 'Trigger and manage calls',
  'campaigns:write': 'Create and manage campaigns',
  'agents:write': 'Create and manage agents',
  'contacts:write': 'Create and manage contacts',
  'knowledge:write': 'Upload knowledge base documents',
  'phone-numbers:write': 'Purchase and assign phone numbers',
  'webhooks:write': 'Manage webhook subscriptions',
  
  // Admin scopes
  'admin': 'Full administrative access',
} as const;

export type ApiScope = keyof typeof API_SCOPES;

// API Keys - User-generated keys for REST API access
export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Key identification
  name: text("name").notNull(), // User-friendly name: "Production Key", "CRM Integration"
  keyPrefix: text("key_prefix").notNull(), // First 8 chars of key for identification: "agl_1234..."
  hashedSecret: text("hashed_secret").notNull(), // bcrypt hash of the secret key
  
  // Permissions
  scopes: text("scopes").array().notNull().default(sql`ARRAY['calls:read', 'calls:write', 'campaigns:read', 'contacts:read']::text[]`),
  
  // Rate limiting
  rateLimit: integer("rate_limit").notNull().default(100), // Requests per minute
  rateLimitWindow: integer("rate_limit_window").notNull().default(60), // Window in seconds
  
  // Security
  ipWhitelist: text("ip_whitelist").array().default(sql`ARRAY[]::text[]`), // Empty = allow all
  expiresAt: timestamp("expires_at"), // Optional expiration
  
  // Status
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  lastUsedIp: text("last_used_ip"),
  totalRequests: integer("total_requests").notNull().default(0),
  
  // Metadata
  description: text("description"),
  metadata: jsonb("metadata"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  lastUsedAt: true,
  lastUsedIp: true,
  totalRequests: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

// API Audit Logs - Track all API requests for security and debugging
export const apiAuditLogs = pgTable("api_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  apiKeyId: varchar("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  
  // Request details
  method: text("method").notNull(), // GET, POST, PUT, DELETE
  endpoint: text("endpoint").notNull(), // /v1/calls, /v1/campaigns/:id
  path: text("path").notNull(), // Full path with params: /v1/campaigns/abc-123
  
  // Request info
  requestBody: jsonb("request_body"), // Sanitized request body (no secrets)
  queryParams: jsonb("query_params"),
  
  // Response info
  statusCode: integer("status_code").notNull(),
  responseTime: integer("response_time"), // Milliseconds
  errorMessage: text("error_message"),
  
  // Client info
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  // Correlation
  requestId: text("request_id").notNull(), // Unique ID for request tracing
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertApiAuditLogSchema = createInsertSchema(apiAuditLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertApiAuditLog = z.infer<typeof insertApiAuditLogSchema>;
export type ApiAuditLog = typeof apiAuditLogs.$inferSelect;

// API Rate Limit Tracking - Sliding window rate limiting
export const apiRateLimits = pgTable("api_rate_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  apiKeyId: varchar("api_key_id").notNull().references(() => apiKeys.id, { onDelete: "cascade" }),
  windowStart: timestamp("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ApiRateLimit = typeof apiRateLimits.$inferSelect;

// ============================================================
// SIP Engine Plugin Tables
// ============================================================

// SIP Trunks - User's SIP trunk configurations
export const sipTrunks = pgTable("sip_trunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  engine: text("engine").notNull(), // 'elevenlabs-sip' | 'openai-sip'
  provider: text("provider").notNull().default("generic"), // SIP provider: twilio, plivo, telnyx, vonage, exotel, bandwidth, didww, zadarma, cloudonix, ringcentral, sinch, infobip, generic
  sipHost: text("sip_host").notNull(),
  sipPort: integer("sip_port").notNull().default(5060),
  transport: text("transport").notNull().default("tls"), // 'udp' | 'tcp' | 'tls' - used for OUTBOUND
  mediaEncryption: text("media_encryption").notNull().default("require"), // 'require' | 'prefer' | 'none'
  // Inbound-specific settings (for receiving calls from provider to ElevenLabs)
  // These can differ from outbound settings - e.g., Twilio uses TCP:5060 for inbound but TLS:5061 for outbound
  inboundTransport: text("inbound_transport").default("tcp"), // 'udp' | 'tcp' | 'tls' - used for INBOUND
  inboundPort: integer("inbound_port").default(5060), // Port for inbound SIP (ElevenLabs listens on this)
  codecsAllowed: text("codecs_allowed").array().default(sql`ARRAY['PCMU', 'PCMA']::text[]`),
  username: text("username"),
  password: text("password"), // Stored encrypted at application layer
  realm: text("realm"),
  registrarHost: text("registrar_host"),
  externalElevenLabsId: text("external_elevenlabs_id"),
  isActive: boolean("is_active").notNull().default(true),
  healthStatus: text("health_status").notNull().default("unknown"),
  lastHealthCheck: timestamp("last_health_check"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSipTrunkSchema = createInsertSchema(sipTrunks).omit({
  id: true,
  healthStatus: true,
  lastHealthCheck: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSipTrunk = z.infer<typeof insertSipTrunkSchema>;
export type SipTrunk = typeof sipTrunks.$inferSelect;

// SIP Phone Numbers - Phone numbers imported from SIP trunks
export const sipPhoneNumbers = pgTable("sip_phone_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sipTrunkId: varchar("sip_trunk_id").notNull().references(() => sipTrunks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  label: text("label"),
  engine: text("engine").notNull(), // Inherited from trunk: 'elevenlabs-sip' | 'openai-sip'
  agentId: varchar("agent_id").references(() => agents.id, { onDelete: "set null" }),
  inboundEnabled: boolean("inbound_enabled").notNull().default(true),
  outboundEnabled: boolean("outbound_enabled").notNull().default(true),
  externalElevenLabsPhoneId: text("external_elevenlabs_phone_id"),
  elevenLabsCredentialId: varchar("eleven_labs_credential_id").references(() => elevenLabsCredentials.id, { onDelete: "set null" }),
  credentialsSyncedAt: timestamp("credentials_synced_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSipPhoneNumberSchema = createInsertSchema(sipPhoneNumbers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSipPhoneNumber = z.infer<typeof insertSipPhoneNumberSchema>;
export type SipPhoneNumber = typeof sipPhoneNumbers.$inferSelect;

// SIP Calls - Call records for SIP engine calls
// Note: Column names match SQL migration (001_sip_tables.sql)
export const sipCalls = pgTable("sip_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id").references(() => agents.id, { onDelete: "set null" }),
  campaignId: varchar("campaign_id").references(() => campaigns.id),
  contactId: varchar("contact_id").references(() => contacts.id),
  sipTrunkId: varchar("sip_trunk_id").references(() => sipTrunks.id),
  sipPhoneNumberId: varchar("sip_phone_number_id").references(() => sipPhoneNumbers.id, { onDelete: "set null" }),
  engine: varchar("engine", { length: 50 }).notNull(), // 'elevenlabs-sip' | 'openai-sip'
  externalCallId: varchar("external_call_id", { length: 255 }),
  openaiCallId: varchar("openai_call_id", { length: 255 }),
  elevenlabsConversationId: varchar("elevenlabs_conversation_id", { length: 255 }),
  fromNumber: varchar("from_number", { length: 50 }),
  toNumber: varchar("to_number", { length: 50 }),
  direction: varchar("direction", { length: 20 }).notNull(), // 'inbound' | 'outbound'
  status: varchar("status", { length: 50 }).default("initiated"),
  durationSeconds: integer("duration_seconds").default(0),
  creditsUsed: decimal("credits_used", { precision: 10, scale: 2 }).default("0"),
  recordingUrl: text("recording_url"),
  transcript: jsonb("transcript"), // Matches SQL migration column name
  aiSummary: text("ai_summary"),
  sentiment: varchar("sentiment", { length: 50 }),
  classification: varchar("classification", { length: 50 }),
  sipHeaders: jsonb("sip_headers"),
  metadata: jsonb("metadata"), // Matches SQL migration column name
  startedAt: timestamp("started_at"),
  answeredAt: timestamp("answered_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  sipCallsUserIdIdx: index("sip_calls_user_id_idx").on(table.userId),
  sipCallsCampaignIdIdx: index("sip_calls_campaign_id_idx").on(table.campaignId),
  sipCallsContactIdIdx: index("sip_calls_contact_id_idx").on(table.contactId),
  sipCallsStatusIdx: index("sip_calls_status_idx").on(table.status),
  sipCallsCreatedAtIdx: index("sip_calls_created_at_idx").on(table.createdAt),
  // sipCalls has no call_id FK — uses externalCallId/openaiCallId/elevenlabsConversationId
  sipCallsExternalCallIdIdx: index("sip_calls_external_call_id_idx").on(table.externalCallId),
  sipCallsElevenlabsConversationIdIdx: index("sip_calls_elevenlabs_conversation_id_idx").on(table.elevenlabsConversationId),
}));

export const insertSipCallSchema = createInsertSchema(sipCalls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSipCall = z.infer<typeof insertSipCallSchema>;
export type SipCall = typeof sipCalls.$inferSelect;

// User Addresses - Addresses submitted by users for phone number regulatory compliance
export const userAddresses = pgTable("user_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Address details
  customerName: text("customer_name").notNull(),
  street: text("street").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(), // State/Province
  postalCode: text("postal_code").notNull(),
  isoCountry: text("iso_country").notNull(), // ISO 3166-1 alpha-2 country code (e.g., AU, GB, DE)
  // Twilio integration
  twilioAddressSid: text("twilio_address_sid"), // Twilio Address SID after creation
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, submitted, verified, rejected
  verificationStatus: text("verification_status"), // Twilio's verification status
  validationStatus: text("validation_status"), // Twilio's validation status
  rejectionReason: text("rejection_reason"), // Reason if rejected
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserAddressSchema = createInsertSchema(userAddresses).omit({
  id: true,
  twilioAddressSid: true,
  status: true,
  verificationStatus: true,
  validationStatus: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserAddress = z.infer<typeof insertUserAddressSchema>;
export type UserAddress = typeof userAddresses.$inferSelect;

// ============================================================
// User Feedback System
// ============================================================
export const userFeedback = pgTable("user_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'bug' | 'feature' | 'improvement' | 'other'
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"), // 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: text("priority").default("medium"), // 'low' | 'medium' | 'high' | 'critical'
  adminResponse: text("admin_response"),
  respondedBy: varchar("responded_by").references(() => users.id),
  respondedAt: timestamp("responded_at"),
  pageUrl: text("page_url"), // Where the feedback was submitted from
  userAgent: text("user_agent"), // Browser/device info for bug reports
  screenshot: text("screenshot"), // Optional base64 screenshot
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserFeedbackSchema = createInsertSchema(userFeedback).omit({
  id: true,
  status: true,
  priority: true,
  adminResponse: true,
  respondedBy: true,
  respondedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserFeedback = z.infer<typeof insertUserFeedbackSchema>;
export type UserFeedback = typeof userFeedback.$inferSelect;

// Google Sheets Credentials - Per-user OAuth tokens for Google Sheets integration
export const googleCalendarCredentials = pgTable("google_calendar_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry").notNull(),
  connectedEmail: text("connected_email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertGoogleCalendarCredentialSchema = createInsertSchema(googleCalendarCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGoogleCalendarCredential = z.infer<typeof insertGoogleCalendarCredentialSchema>;
export type GoogleCalendarCredential = typeof googleCalendarCredentials.$inferSelect;

export const googleSheetsCredentials = pgTable("google_sheets_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry").notNull(),
  connectedEmail: text("connected_email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertGoogleSheetsCredentialSchema = createInsertSchema(googleSheetsCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGoogleSheetsCredential = z.infer<typeof insertGoogleSheetsCredentialSchema>;
export type GoogleSheetsCredential = typeof googleSheetsCredentials.$inferSelect;

// Phone Release Retry Queue - Durable retry queue for Twilio/Plivo phone number releases
// When a provider release call fails transiently (timeout, 5xx, rate-limit), we enqueue the
// release so a background worker can retry with backoff instead of silently dropping it.
export const phoneReleaseRetryQueue = pgTable("phone_release_retry_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumberId: varchar("phone_number_id").notNull(),
  provider: text("provider").notNull(), // 'twilio' | 'plivo'
  providerSid: text("provider_sid").notNull(), // twilioSid or plivoPhoneNumberId
  userId: varchar("user_id"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  phoneReleaseRetryQueueNextRetryAtIdx: index("phone_release_retry_queue_next_retry_at_idx").on(table.nextRetryAt),
  phoneReleaseRetryQueuePhoneNumberIdIdx: index("phone_release_retry_queue_phone_number_id_idx").on(table.phoneNumberId),
}));

export const insertPhoneReleaseRetryQueueSchema = createInsertSchema(phoneReleaseRetryQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPhoneReleaseRetryQueue = z.infer<typeof insertPhoneReleaseRetryQueueSchema>;
export type PhoneReleaseRetryQueue = typeof phoneReleaseRetryQueue.$inferSelect;
export type PhoneReleaseRetryQueueEntry = typeof phoneReleaseRetryQueue.$inferSelect;
