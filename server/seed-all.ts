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
import { llmModels, plans, creditPackages, promptTemplates, flows, emailTemplates, globalSettings, supportedLanguages, type FlowNode, type FlowEdge } from "@shared/schema";
import { sql } from "drizzle-orm";

import { MODELS_SEED_DATA } from "./seed-llm-models-data";
import { PLANS_SEED_DATA } from "./seed-plans";
import { CREDIT_PACKAGES_SEED_DATA } from "./seed-credit-packages";
import { PROMPT_TEMPLATES_SEED_DATA } from "./seed-prompt-templates";
import { EMAIL_TEMPLATES_SEED_DATA } from "./seed-email-templates";
import { AGENT_TEMPLATES_SEED_DATA } from "./seed-agent-templates";
import { GLOBAL_SETTINGS_SEED_DATA } from "./seed-global-settings";
import { SEO_SETTINGS_SEED_DATA } from "./seed-seo-settings";
import { TWILIO_COUNTRIES_SEED_DATA, seedTwilioCountries } from "./seed-twilio-countries";
import { LANGUAGES_SEED_DATA } from "./seed-languages";
import { flowTemplates } from "./services/flow-templates";

const SYSTEM_USER_ID = "system";

async function seedLlmModels() {
  console.log("\n📊 Seeding LLM Models...");
  const existing = await db.select().from(llmModels);
  if (existing.length > 0) {
    console.log(`   ⚠️  Found ${existing.length} existing models. Skipping.`);
    return;
  }
  await db.insert(llmModels).values(MODELS_SEED_DATA);
  console.log(`   ✅ Inserted ${MODELS_SEED_DATA.length} LLM models`);
  console.log(`      - Free tier: ${MODELS_SEED_DATA.filter((m: { tier: string }) => m.tier === 'free').length}`);
  console.log(`      - Pro tier: ${MODELS_SEED_DATA.filter((m: { tier: string }) => m.tier === 'pro').length}`);
}

async function seedPlans() {
  console.log("\n💳 Seeding Subscription Plans...");
  const existing = await db.select().from(plans);
  if (existing.length > 0) {
    console.log(`   ⚠️  Found ${existing.length} existing plans. Skipping.`);
    return;
  }
  await db.insert(plans).values(PLANS_SEED_DATA);
  console.log(`   ✅ Inserted ${PLANS_SEED_DATA.length} subscription plans`);
  PLANS_SEED_DATA.forEach(p => {
    console.log(`      - ${p.displayName}: $${p.monthlyPrice}/month, ${p.includedCredits} credits`);
  });
}

async function seedCreditPackages() {
  console.log("\n🪙 Seeding Credit Packages...");
  const existing = await db.select().from(creditPackages);
  if (existing.length > 0) {
    console.log(`   ⚠️  Found ${existing.length} existing packages. Skipping.`);
    return;
  }
  await db.insert(creditPackages).values(CREDIT_PACKAGES_SEED_DATA);
  console.log(`   ✅ Inserted ${CREDIT_PACKAGES_SEED_DATA.length} credit packages`);
  CREDIT_PACKAGES_SEED_DATA.forEach(pkg => {
    console.log(`      - ${pkg.name}: ${pkg.credits} credits @ $${pkg.price}`);
  });
}

async function seedPromptTemplates() {
  console.log("\n📝 Seeding Prompt Templates...");
  const existing = await db.select().from(promptTemplates);
  const systemTemplates = existing.filter(t => t.isSystemTemplate);
  if (systemTemplates.length > 0) {
    console.log(`   ⚠️  Found ${systemTemplates.length} existing system templates. Skipping.`);
    return;
  }
  await db.insert(promptTemplates).values(PROMPT_TEMPLATES_SEED_DATA);
  console.log(`   ✅ Inserted ${PROMPT_TEMPLATES_SEED_DATA.length} prompt templates`);
  const categories = ['sales', 'support', 'appointment', 'survey', 'general'];
  categories.forEach(cat => {
    const count = PROMPT_TEMPLATES_SEED_DATA.filter(t => t.category === cat).length;
    console.log(`      - ${cat}: ${count} templates`);
  });
}

async function seedFlowTemplates() {
  console.log("\n🔄 Seeding Flow Templates...");
  const existing = await db.select().from(flows);
  const existingTemplates = existing.filter(f => f.isTemplate);
  if (existingTemplates.length > 0) {
    console.log(`   ⚠️  Found ${existingTemplates.length} existing flow templates. Skipping.`);
    return;
  }

  const flowsToInsert = flowTemplates.map(template => ({
    id: template.id,
    userId: SYSTEM_USER_ID,
    name: template.name,
    description: template.description,
    nodes: template.nodes as FlowNode[],
    edges: template.edges as FlowEdge[],
    isTemplate: true,
    isActive: true,
  }));

  await db.insert(flows).values(flowsToInsert);
  console.log(`   ✅ Inserted ${flowTemplates.length} flow templates`);
  flowTemplates.forEach(t => {
    console.log(`      - ${t.name}: ${t.nodes.length} nodes`);
  });
}

async function seedEmailTemplates() {
  console.log("\n📧 Seeding Email Templates...");
  const existing = await db.select().from(emailTemplates);
  const existingTypes = existing.map(t => t.templateType);

  const templatesToInsert = EMAIL_TEMPLATES_SEED_DATA.filter(
    template => !existingTypes.includes(template.templateType)
  );

  if (templatesToInsert.length === 0) {
    console.log(`   ⚠️  All ${EMAIL_TEMPLATES_SEED_DATA.length} email templates already exist. Skipping.`);
    return;
  }

  await db.insert(emailTemplates).values(templatesToInsert);
  console.log(`   ✅ Inserted ${templatesToInsert.length} email templates`);
  templatesToInsert.forEach(template => {
    console.log(`      - ${template.name} (${template.templateType}): ${template.variables.length} variables`);
  });
}

async function seedAgentTemplates() {
  console.log("\n🤖 Seeding Agent Templates...");
  const existing = await db.select().from(promptTemplates);
  const agentPresets = existing.filter(t => t.category === "agent_preset" && t.isSystemTemplate);

  if (agentPresets.length > 0) {
    console.log(`   ⚠️  Found ${agentPresets.length} existing agent preset templates. Skipping.`);
    return;
  }

  await db.insert(promptTemplates).values(AGENT_TEMPLATES_SEED_DATA);
  console.log(`   ✅ Inserted ${AGENT_TEMPLATES_SEED_DATA.length} agent preset templates`);
  AGENT_TEMPLATES_SEED_DATA.forEach(template => {
    console.log(`      - ${template.name}`);
  });
}

async function seedGlobalSettings() {
  console.log("\n⚙️  Seeding Global Settings...");
  const existing = await db.select().from(globalSettings);
  const existingKeys = existing.map(s => s.key);

  const settingsToInsert = GLOBAL_SETTINGS_SEED_DATA.filter(
    setting => !existingKeys.includes(setting.key)
  );

  if (settingsToInsert.length === 0) {
    console.log(`   ⚠️  All ${GLOBAL_SETTINGS_SEED_DATA.length} global settings already exist. Skipping.`);
    return;
  }

  for (const setting of settingsToInsert) {
    await db.execute(sql`
      INSERT INTO global_settings (id, key, value, description, updated_at)
      VALUES (gen_random_uuid(), ${setting.key}, ${JSON.stringify(setting.value)}::jsonb, ${setting.description}, NOW())
      ON CONFLICT (key) DO NOTHING
    `);
  }
  console.log(`   ✅ Inserted ${settingsToInsert.length} global settings`);

  const categories = {
    "Branding": settingsToInsert.filter(s => s.key.startsWith("company_")).length,
    "Features": settingsToInsert.filter(s => s.key.startsWith("feature_")).length,
    "Credits": settingsToInsert.filter(s => s.key.includes("credit") || s.key.includes("currency")).length,
    "Campaigns": settingsToInsert.filter(s => s.key.startsWith("campaign_")).length,
    "Security": settingsToInsert.filter(s => s.key.includes("password") || s.key.includes("login") || s.key.includes("session")).length,
  };

  Object.entries(categories).forEach(([category, count]) => {
    if (count > 0) {
      console.log(`      - ${category}: ${count} settings`);
    }
  });
}

async function seedSeoSettings() {
  console.log("\n🔍 Seeding SEO Settings...");
  const existing = await db.select().from(globalSettings);
  const existingKeys = existing.map(s => s.key);

  const settingsToInsert = SEO_SETTINGS_SEED_DATA.filter(
    setting => !existingKeys.includes(setting.key)
  );

  if (settingsToInsert.length === 0) {
    console.log(`   ⚠️  All ${SEO_SETTINGS_SEED_DATA.length} SEO settings already exist. Skipping.`);
    return;
  }

  for (const setting of settingsToInsert) {
    await db.execute(sql`
      INSERT INTO global_settings (id, key, value, description, updated_at)
      VALUES (gen_random_uuid(), ${setting.key}, ${JSON.stringify(setting.value)}::jsonb, ${setting.description}, NOW())
      ON CONFLICT (key) DO NOTHING
    `);
  }
  console.log(`   ✅ Inserted ${settingsToInsert.length} SEO settings`);

  const categories = {
    "Meta Tags": settingsToInsert.filter(s => s.key.includes("_title") || s.key.includes("_description")).length,
    "Open Graph": settingsToInsert.filter(s => s.key.includes("_og_")).length,
    "Twitter": settingsToInsert.filter(s => s.key.includes("_twitter_")).length,
    "Robots & Sitemap": settingsToInsert.filter(s => s.key.includes("_robots") || s.key.includes("_sitemap")).length,
    "Analytics": settingsToInsert.filter(s => s.key.includes("_google_") || s.key.includes("_facebook_")).length,
  };

  Object.entries(categories).forEach(([category, count]) => {
    if (count > 0) {
      console.log(`      - ${category}: ${count} settings`);
    }
  });
}

async function seedLanguages() {
  console.log("\n🌍 Seeding Supported Languages...");
  const existing = await db.select().from(supportedLanguages);
  if (existing.length > 0) {
    console.log(`   ⚠️  Found ${existing.length} existing languages. Skipping.`);
    return;
  }
  await db.insert(supportedLanguages).values(LANGUAGES_SEED_DATA);
  console.log(`   ✅ Inserted ${LANGUAGES_SEED_DATA.length} supported languages`);
  const bothCount = LANGUAGES_SEED_DATA.filter((l: { providers: string }) => l.providers === 'both').length;
  const openaiOnlyCount = LANGUAGES_SEED_DATA.filter((l: { providers: string }) => l.providers === 'openai').length;
  const elevenLabsOnlyCount = LANGUAGES_SEED_DATA.filter((l: { providers: string }) => l.providers === 'elevenlabs').length;
  console.log(`      - Both providers: ${bothCount} languages`);
  console.log(`      - OpenAI only: ${openaiOnlyCount} languages`);
  console.log(`      - ElevenLabs only: ${elevenLabsOnlyCount} languages`);
}

const SEED_VERSION = "5.4.1";

const ADMIN_PERMISSION_SECTIONS = [
  {
    id: 'users',
    subsections: [
      { id: 'view_users' },
      { id: 'edit_users' },
      { id: 'suspend_users' },
      { id: 'delete_users' },
      { id: 'manage_credits' },
      { id: 'manage_plans' },
    ],
  },
  {
    id: 'contacts',
    subsections: [
      { id: 'view_contacts' },
      { id: 'edit_contacts' },
      { id: 'delete_contacts' },
      { id: 'export_contacts' },
    ],
  },
  {
    id: 'billing',
    subsections: [
      { id: 'plans' },
      { id: 'credits' },
      { id: 'transactions' },
      { id: 'payments' },
    ],
  },
  {
    id: 'phones',
    subsections: [
      { id: 'phone_numbers' },
    ],
  },
  {
    id: 'batch_jobs',
    subsections: [
      { id: 'view_batch_jobs' },
      { id: 'manage_batch_jobs' },
      { id: 'cancel_batch_jobs' },
    ],
  },
  {
    id: 'call_monitoring',
    subsections: [
      { id: 'all_calls' },
      { id: 'banned_words' },
    ],
  },
  {
    id: 'communications',
    subsections: [
      { id: 'email_settings' },
      { id: 'notifications' },
    ],
  },
  {
    id: 'voice_ai',
    subsections: [
      { id: 'twilio_openai_engine' },
      { id: 'plivo_openai_engine' },
      { id: 'openai_pool' },
      { id: 'plivo_settings' },
    ],
  },
  {
    id: 'settings',
    subsections: [
      { id: 'master_settings' },
      { id: 'elevenlabs_settings' },
      { id: 'seo_settings' },
      { id: 'analytics_settings' },
      { id: 'languages_settings' },
      { id: 'system_settings' },
    ],
  },
];

const ADMIN_DEFAULT_ROLES = [
  { name: 'super_admin', displayName: 'Super Admin', description: 'Full access to all admin features', isDefault: false, permissionLevel: 'full' },
  { name: 'admin', displayName: 'Admin', description: 'Manage users and billing', isDefault: true, permissionLevel: 'manage' },
  { name: 'support', displayName: 'Support', description: 'View users and handle support', isDefault: false, permissionLevel: 'read' },
  { name: 'viewer', displayName: 'Viewer', description: 'Read-only access', isDefault: false, permissionLevel: 'read' },
];

function getPermissionsForLevel(level: string): { canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean } {
  switch (level) {
    case 'full': return { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    case 'manage': return { canCreate: true, canRead: true, canUpdate: true, canDelete: false };
    case 'read': return { canCreate: false, canRead: true, canUpdate: false, canDelete: false };
    default: return { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
  }
}

async function seedPluginTables() {
  console.log("\n🔌 Seeding Plugin Tables...");

  // Ensure calls table has REST API columns (added post-launch, may be missing on older databases)
  try {
    await db.execute(sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS agent_id VARCHAR`);
    await db.execute(sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS engine_type TEXT`);
    await db.execute(sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0`);
  } catch (e: any) { /* Columns may already exist */ }

  try {
    // REST API Plugin tables
    console.log("   📡 Creating REST API plugin tables...");
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS api_keys (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          key_prefix TEXT NOT NULL,
          hashed_secret TEXT NOT NULL,
          scopes TEXT[] NOT NULL DEFAULT ARRAY['calls:read', 'calls:write', 'campaigns:read', 'contacts:read']::text[],
          rate_limit INTEGER NOT NULL DEFAULT 100,
          rate_limit_window INTEGER NOT NULL DEFAULT 60,
          ip_whitelist TEXT[] DEFAULT ARRAY[]::text[],
          expires_at TIMESTAMP,
          is_active BOOLEAN NOT NULL DEFAULT true,
          last_used_at TIMESTAMP,
          last_used_ip TEXT,
          total_requests INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          metadata JSONB,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS api_audit_logs (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          api_key_id VARCHAR REFERENCES api_keys(id) ON DELETE SET NULL,
          method TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          path TEXT NOT NULL,
          request_body JSONB,
          query_params JSONB,
          status_code INTEGER NOT NULL,
          response_time INTEGER,
          error_message TEXT,
          ip_address TEXT,
          user_agent TEXT,
          request_id TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    // Add request_id column if missing (for existing tables)
    try {
      await db.execute(sql`ALTER TABLE api_audit_logs ADD COLUMN IF NOT EXISTS request_id TEXT`);
    } catch (e: any) { /* Column may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS api_rate_limits (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          api_key_id VARCHAR NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          window_start TIMESTAMP NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_audit_logs_user_id ON api_audit_logs(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_audit_logs_api_key_id ON api_audit_logs(api_key_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_audit_logs_created_at ON api_audit_logs(created_at)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_audit_logs_request_id ON api_audit_logs(request_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_rate_limits_api_key_id ON api_rate_limits(api_key_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start ON api_rate_limits(window_start)`);
    } catch (e: any) { /* Indexes may already exist */ }
    console.log("   ✅ REST API plugin tables created");

    // SIP Engine Plugin tables
    console.log("   📞 Creating SIP Engine plugin tables...");
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sip_trunks (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          engine VARCHAR(50) NOT NULL DEFAULT 'elevenlabs-sip',
          provider VARCHAR(50) NOT NULL DEFAULT 'generic',
          sip_host VARCHAR(255) NOT NULL,
          sip_port INTEGER DEFAULT 5060,
          transport VARCHAR(10) DEFAULT 'tls',
          inbound_transport VARCHAR(10) DEFAULT 'udp',
          inbound_port INTEGER DEFAULT 5060,
          media_encryption VARCHAR(20) DEFAULT 'require',
          username VARCHAR(255),
          password TEXT,
          elevenlabs_trunk_id VARCHAR(255),
          openai_project_id VARCHAR(255),
          inbound_uri VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          health_status VARCHAR(50) DEFAULT 'unknown',
          last_health_check TIMESTAMP,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sip_phone_numbers (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sip_trunk_id VARCHAR NOT NULL REFERENCES sip_trunks(id) ON DELETE CASCADE,
          trunk_id VARCHAR REFERENCES sip_trunks(id) ON DELETE CASCADE,
          phone_number VARCHAR(50) NOT NULL,
          label VARCHAR(255),
          engine VARCHAR(50) NOT NULL,
          elevenlabs_phone_number_id VARCHAR(255),
          external_elevenlabs_phone_id VARCHAR(255),
          agent_id VARCHAR REFERENCES agents(id) ON DELETE SET NULL,
          inbound_enabled BOOLEAN DEFAULT true,
          outbound_enabled BOOLEAN DEFAULT true,
          is_active BOOLEAN DEFAULT true,
          custom_headers JSONB,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, phone_number)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sip_calls (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          agent_id VARCHAR REFERENCES agents(id) ON DELETE SET NULL,
          campaign_id VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
          contact_id VARCHAR REFERENCES contacts(id) ON DELETE SET NULL,
          sip_trunk_id VARCHAR REFERENCES sip_trunks(id) ON DELETE SET NULL,
          sip_phone_number_id VARCHAR REFERENCES sip_phone_numbers(id) ON DELETE SET NULL,
          engine VARCHAR(50) NOT NULL,
          external_call_id VARCHAR(255),
          openai_call_id VARCHAR(255),
          elevenlabs_conversation_id VARCHAR(255),
          from_number VARCHAR(50),
          to_number VARCHAR(50),
          direction VARCHAR(20) NOT NULL,
          status VARCHAR(50) DEFAULT 'initiated',
          duration_seconds INTEGER DEFAULT 0,
          credits_used DECIMAL(10,2) DEFAULT 0,
          recording_url TEXT,
          transcript JSONB,
          ai_summary TEXT,
          sip_headers JSONB,
          metadata JSONB,
          started_at TIMESTAMP,
          answered_at TIMESTAMP,
          ended_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`ALTER TABLE sip_trunks ADD COLUMN IF NOT EXISTS inbound_transport VARCHAR(10) DEFAULT 'udp'`);
      await db.execute(sql`ALTER TABLE sip_trunks ADD COLUMN IF NOT EXISTS inbound_port INTEGER DEFAULT 5060`);
    } catch (e: any) { /* Columns may already exist */ }

    try {
      await db.execute(sql`ALTER TABLE sip_phone_numbers ADD COLUMN IF NOT EXISTS trunk_id VARCHAR REFERENCES sip_trunks(id) ON DELETE CASCADE`);
      await db.execute(sql`ALTER TABLE sip_phone_numbers ADD COLUMN IF NOT EXISTS external_elevenlabs_phone_id VARCHAR(255)`);
    } catch (e: any) { /* Columns may already exist */ }

    try {
      await db.execute(sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS sip_enabled BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_concurrent_sip_calls INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS sip_engines_allowed TEXT[] DEFAULT ARRAY['elevenlabs-sip']`);
    } catch (e: any) { /* Column may already exist */ }

    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_trunks_user_id ON sip_trunks(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_trunks_engine ON sip_trunks(engine)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_trunks_provider ON sip_trunks(provider)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_phone_numbers_user_id ON sip_phone_numbers(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_phone_numbers_trunk_id ON sip_phone_numbers(sip_trunk_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_phone_numbers_agent_id ON sip_phone_numbers(agent_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_calls_user_id ON sip_calls(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_calls_campaign_id ON sip_calls(campaign_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_calls_status ON sip_calls(status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_calls_engine ON sip_calls(engine)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sip_calls_created_at ON sip_calls(created_at)`);
    } catch (e: any) { /* Indexes may already exist */ }

    try {
      await db.execute(sql`
        INSERT INTO global_settings (setting_key, setting_value, category, description)
        VALUES ('openai_sip_project_id', '', 'sip', 'OpenAI Project ID for SIP integration')
        ON CONFLICT (setting_key) DO NOTHING
      `);
    } catch (e: any) { /* Setting may already exist */ }
    console.log("   ✅ SIP Engine plugin tables created");

    // Team Management Plugin tables
    console.log("   👥 Creating Team Management plugin tables...");

    // User teams
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS teams (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL DEFAULT 'My Team',
          description TEXT,
          settings JSONB NOT NULL DEFAULT '{"maxMembers": 10, "allowCustomRoles": true, "requireEmailVerification": false, "sessionExpiryHours": 24}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_user_team UNIQUE (user_id)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS team_roles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          description TEXT,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_team_role_name UNIQUE (team_id, name)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS team_members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          role_id UUID NOT NULL REFERENCES team_roles(id) ON DELETE RESTRICT,
          status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'deactivated')),
          last_login_at TIMESTAMP WITH TIME ZONE,
          invited_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
          invited_at TIMESTAMP WITH TIME ZONE,
          email_verified_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_team_member_email UNIQUE (team_id, email)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS team_permissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          role_id UUID NOT NULL REFERENCES team_roles(id) ON DELETE CASCADE,
          section VARCHAR(100) NOT NULL,
          subsection VARCHAR(100) NOT NULL,
          can_create BOOLEAN NOT NULL DEFAULT FALSE,
          can_read BOOLEAN NOT NULL DEFAULT FALSE,
          can_update BOOLEAN NOT NULL DEFAULT FALSE,
          can_delete BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_role_permission UNIQUE (role_id, section, subsection)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS team_member_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          token VARCHAR(512) NOT NULL UNIQUE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          user_agent TEXT,
          ip_address VARCHAR(45),
          CONSTRAINT unique_member_token UNIQUE (member_id, token)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS team_activity_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          member_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL,
          target_type VARCHAR(100),
          target_id UUID,
          metadata JSONB,
          ip_address VARCHAR(45),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    // Admin teams (platform sub-admins)
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS admin_teams (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL DEFAULT 'Admin Team',
          description TEXT,
          settings JSONB NOT NULL DEFAULT '{"maxMembers": 50, "allowCustomRoles": true, "requireEmailVerification": false, "sessionExpiryHours": 24}'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS admin_team_roles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          description TEXT,
          is_system BOOLEAN NOT NULL DEFAULT FALSE,
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_admin_team_role_name UNIQUE (admin_team_id, name)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS admin_team_members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          role_id UUID NOT NULL REFERENCES admin_team_roles(id) ON DELETE RESTRICT,
          status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'deactivated')),
          last_login_at TIMESTAMP WITH TIME ZONE,
          invited_by UUID REFERENCES admin_team_members(id) ON DELETE SET NULL,
          invited_at TIMESTAMP WITH TIME ZONE,
          email_verified_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_admin_team_member_email UNIQUE (admin_team_id, email)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS admin_team_permissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          role_id UUID NOT NULL REFERENCES admin_team_roles(id) ON DELETE CASCADE,
          section VARCHAR(100) NOT NULL,
          subsection VARCHAR(100) NOT NULL,
          can_create BOOLEAN NOT NULL DEFAULT FALSE,
          can_read BOOLEAN NOT NULL DEFAULT FALSE,
          can_update BOOLEAN NOT NULL DEFAULT FALSE,
          can_delete BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_admin_role_permission UNIQUE (role_id, section, subsection)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS admin_team_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          member_id UUID NOT NULL REFERENCES admin_team_members(id) ON DELETE CASCADE,
          admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
          token VARCHAR(512) NOT NULL UNIQUE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          user_agent TEXT,
          ip_address VARCHAR(45),
          CONSTRAINT unique_admin_member_token UNIQUE (member_id, token)
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS admin_team_activity_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
          member_id UUID REFERENCES admin_team_members(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL,
          target_type VARCHAR(100),
          target_id UUID,
          metadata JSONB,
          ip_address VARCHAR(45),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
    } catch (e: any) { /* Table may already exist */ }

    // Team indexes
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_teams_user_id ON teams(user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_roles_team_id ON team_roles(team_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_permissions_role_id ON team_permissions(role_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_member_sessions_member_id ON team_member_sessions(member_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_member_sessions_token ON team_member_sessions(token)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_member_sessions_expires_at ON team_member_sessions(expires_at)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_activity_logs_team_id ON team_activity_logs(team_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_team_activity_logs_created_at ON team_activity_logs(created_at)`);
      // Admin team indexes
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_roles_admin_team_id ON admin_team_roles(admin_team_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_members_admin_team_id ON admin_team_members(admin_team_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_members_email ON admin_team_members(email)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_members_status ON admin_team_members(status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_permissions_role_id ON admin_team_permissions(role_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_sessions_member_id ON admin_team_sessions(member_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_sessions_token ON admin_team_sessions(token)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_sessions_expires_at ON admin_team_sessions(expires_at)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_activity_logs_admin_team_id ON admin_team_activity_logs(admin_team_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_team_activity_logs_created_at ON admin_team_activity_logs(created_at)`);
    } catch (e: any) { /* Indexes may already exist */ }

    // Triggers for updated_at
    try {
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION update_team_tables_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);

      await db.execute(sql`DROP TRIGGER IF EXISTS update_teams_updated_at ON teams`);
      await db.execute(sql`CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_team_roles_updated_at ON team_roles`);
      await db.execute(sql`CREATE TRIGGER update_team_roles_updated_at BEFORE UPDATE ON team_roles FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members`);
      await db.execute(sql`CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_team_permissions_updated_at ON team_permissions`);
      await db.execute(sql`CREATE TRIGGER update_team_permissions_updated_at BEFORE UPDATE ON team_permissions FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_admin_teams_updated_at ON admin_teams`);
      await db.execute(sql`CREATE TRIGGER update_admin_teams_updated_at BEFORE UPDATE ON admin_teams FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_admin_team_roles_updated_at ON admin_team_roles`);
      await db.execute(sql`CREATE TRIGGER update_admin_team_roles_updated_at BEFORE UPDATE ON admin_team_roles FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_admin_team_members_updated_at ON admin_team_members`);
      await db.execute(sql`CREATE TRIGGER update_admin_team_members_updated_at BEFORE UPDATE ON admin_team_members FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
      await db.execute(sql`DROP TRIGGER IF EXISTS update_admin_team_permissions_updated_at ON admin_team_permissions`);
      await db.execute(sql`CREATE TRIGGER update_admin_team_permissions_updated_at BEFORE UPDATE ON admin_team_permissions FOR EACH ROW EXECUTE FUNCTION update_team_tables_updated_at()`);
    } catch (e: any) { /* Triggers may already exist */ }

    console.log("   ✅ Team Management plugin tables created");

    // Google Sheets OAuth credentials — schema must match shared/schema.ts exactly
    try {
      // Create table if it doesn't exist yet
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS google_sheets_credentials (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL UNIQUE,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          token_expiry TIMESTAMP NOT NULL,
          connected_email TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      // Non-destructive column migrations for environments with old schema (expires_at / email)
      // Rename old columns to match current schema without dropping any data
      const hasOldExpiry = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'google_sheets_credentials' AND column_name = 'expires_at'
      `);
      if (hasOldExpiry.rows.length > 0) {
        await db.execute(sql`ALTER TABLE google_sheets_credentials RENAME COLUMN expires_at TO token_expiry`);
      }
      const hasOldEmail = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'google_sheets_credentials' AND column_name = 'email'
      `);
      if (hasOldEmail.rows.length > 0) {
        await db.execute(sql`ALTER TABLE google_sheets_credentials RENAME COLUMN email TO connected_email`);
      }
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_google_sheets_credentials_user_id ON google_sheets_credentials(user_id)`);
      console.log("   ✅ Google Sheets credentials table created/verified");
    } catch (e: any) {
      console.error("   ⚠️  Google Sheets credentials table error:", (e as Error).message?.slice(0, 100));
    }

    console.log("   ✅ All plugin tables seeded successfully");
  } catch (error: any) {
    console.error("   ❌ Error creating plugin tables:", error.message?.slice(0, 100));
    throw error;
  }
}

async function seedAdminTeamAndRoles() {
  console.log("\n👥 Seeding Admin Team and Roles...");

  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'admin_teams'
      ) as exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      console.log("   ⚠️  Admin teams table not found (team-management plugin not installed). Skipping.");
      return;
    }

    const existingTeam = await db.execute(sql`SELECT * FROM admin_teams LIMIT 1`);
    let adminTeamId: string;

    if (existingTeam.rows.length > 0) {
      adminTeamId = (existingTeam.rows[0] as any).id;
      console.log("   ✓ Admin team already exists");
    } else {
      const teamResult = await db.execute(sql`
        INSERT INTO admin_teams (name, description)
        VALUES ('Admin Team', 'Platform administration team for sub-admins')
        RETURNING id
      `);
      adminTeamId = (teamResult.rows[0] as any).id;
      console.log("   ✅ Created admin team");
    }

    const existingRoles = await db.execute(sql`
      SELECT name FROM admin_team_roles WHERE admin_team_id = ${adminTeamId}
    `);
    const existingRoleNames = existingRoles.rows.map((r: any) => r.name);

    let rolesCreated = 0;
    let permissionsCreated = 0;

    for (const role of ADMIN_DEFAULT_ROLES) {
      if (existingRoleNames.includes(role.name)) {
        continue;
      }

      const roleResult = await db.execute(sql`
        INSERT INTO admin_team_roles (admin_team_id, name, display_name, description, is_system, is_default)
        VALUES (${adminTeamId}, ${role.name}, ${role.displayName}, ${role.description}, true, ${role.isDefault})
        RETURNING id
      `);

      const roleId = (roleResult.rows[0] as any).id;
      rolesCreated++;

      const perms = getPermissionsForLevel(role.permissionLevel);

      for (const section of ADMIN_PERMISSION_SECTIONS) {
        for (const subsection of section.subsections) {
          await db.execute(sql`
            INSERT INTO admin_team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
            VALUES (${roleId}, ${section.id}, ${subsection.id}, ${perms.canCreate}, ${perms.canRead}, ${perms.canUpdate}, ${perms.canDelete})
            ON CONFLICT (role_id, section, subsection) DO NOTHING
          `);
          permissionsCreated++;
        }
      }

      console.log(`   ✅ Created role: ${role.displayName} with ${ADMIN_PERMISSION_SECTIONS.reduce((acc, s) => acc + s.subsections.length, 0)} permissions`);
    }

    if (rolesCreated === 0) {
      console.log("   ⚠️  All admin roles already exist. Skipping.");
    } else {
      console.log(`   ✅ Created ${rolesCreated} admin roles with ${permissionsCreated} permissions total`);
    }

  } catch (error: any) {
    console.log(`   ⚠️  Admin team seeding skipped: ${error.message?.slice(0, 50)}`);
  }
}

async function updateSeedVersion() {
  console.log("\n📌 Updating seed version tracking...");
  await db.execute(sql`
    UPDATE global_settings 
    SET value = ${JSON.stringify(SEED_VERSION)}::jsonb, updated_at = NOW()
    WHERE key = 'seed_version'
  `);
  await db.execute(sql`
    UPDATE global_settings 
    SET value = ${JSON.stringify(new Date().toISOString())}::jsonb, updated_at = NOW()
    WHERE key = 'seed_applied_at'
  `);
  console.log(`   ✅ Seed version: ${SEED_VERSION}`);
}

export async function runAllSeedsForInstaller(): Promise<{
  success: boolean;
  summary: Record<string, number>;
  error?: string;
}> {
  console.log("🌱 [Installer] Running database seeds...");

  const summary: Record<string, number> = {};

  try {
    await seedLlmModels();
    summary.llmModels = MODELS_SEED_DATA.length;

    await seedPlans();
    summary.plans = PLANS_SEED_DATA.length;

    await seedCreditPackages();
    summary.creditPackages = CREDIT_PACKAGES_SEED_DATA.length;

    await seedPromptTemplates();
    summary.promptTemplates = PROMPT_TEMPLATES_SEED_DATA.length;

    await seedAgentTemplates();
    summary.agentTemplates = AGENT_TEMPLATES_SEED_DATA.length;

    await seedFlowTemplates();
    summary.flowTemplates = flowTemplates.length;

    await seedEmailTemplates();
    summary.emailTemplates = EMAIL_TEMPLATES_SEED_DATA.length;

    await seedGlobalSettings();
    summary.globalSettings = GLOBAL_SETTINGS_SEED_DATA.length;

    await seedSeoSettings();
    summary.seoSettings = SEO_SETTINGS_SEED_DATA.length;

    await seedLanguages();
    summary.languages = LANGUAGES_SEED_DATA.length;

    await seedTwilioCountries();
    summary.twilioCountries = TWILIO_COUNTRIES_SEED_DATA.length;

    await seedPluginTables();
    summary.pluginTables = 15; // REST API: 3, SIP: 3, Team: 6, Admin Team: 6

    await seedAdminTeamAndRoles();
    summary.adminRoles = ADMIN_DEFAULT_ROLES.length;

    await updateSeedVersion();

    console.log("✅ [Installer] All seeds completed successfully");
    console.log(`   Summary: ${JSON.stringify(summary)}`);

    return { success: true, summary };
  } catch (error: any) {
    console.error("❌ [Installer] Seeding failed:", error);
    return { success: false, summary, error: error.message };
  }
}

export async function runAllSeeds() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           🌱 Platform Database Seeder                      ║");
  console.log("║           © 2025 Diploy - Bisht Technologies               ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  try {
    await seedLlmModels();
    await seedPlans();
    await seedCreditPackages();
    await seedPromptTemplates();
    await seedAgentTemplates();
    await seedFlowTemplates();
    await seedEmailTemplates();
    await seedGlobalSettings();
    await seedSeoSettings();

    // Languages seeding may fail due to schema differences - non-fatal
    try {
      await seedLanguages();
    } catch (langError: any) {
      console.log(`   ⚠️  Languages seeding skipped (schema mismatch): ${langError.message?.slice(0, 50)}`);
    }

    await seedTwilioCountries();

    // Plugin tables - creates all 3 plugin tables (REST API, SIP Engine, Team Management)
    try {
      await seedPluginTables();
    } catch (pluginError: any) {
      console.log(`   ⚠️  Plugin tables seeding skipped: ${pluginError.message?.slice(0, 50)}`);
    }

    // Admin team and roles seeding - depends on plugin tables being created
    try {
      await seedAdminTeamAndRoles();
    } catch (adminError: any) {
      console.log(`   ⚠️  Admin team seeding skipped: ${adminError.message?.slice(0, 50)}`);
    }

    await updateSeedVersion();

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║           🎉 All Seeds Completed Successfully!            ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("\n📋 Seed Summary:");
    console.log("   - LLM Models: Up to 14 models (Free + Pro tiers)");
    console.log("   - Subscription Plans: Free & Pro plans");
    console.log("   - Credit Packages: 6 packages ($9.99 - $699.99)");
    console.log("   - Prompt Templates: 15 professional templates");
    console.log("   - Agent Templates: 8 agent presets");
    console.log("   - Flow Templates: 8 automation flows");
    console.log("   - Email Templates: 8 transactional emails");
    console.log("   - Global Settings: Platform configuration");
    console.log("   - SEO Settings: Meta tags & analytics");
    console.log(`   - Supported Languages: ${LANGUAGES_SEED_DATA.length} languages with provider support`);
    console.log(`   - Twilio Countries: ${TWILIO_COUNTRIES_SEED_DATA.length} countries for phone number purchasing`);
    console.log("   - Plugin Tables: REST API (3), SIP Engine (3), Team Management (12)");
    console.log("   - Admin Team: 4 default roles (Super Admin, Admin, Support, Viewer)");
    console.log(`   - Seed Version: ${SEED_VERSION}\n`);

  } catch (error) {
    console.error("\n❌ Seeding failed:", error);
    throw error;
  }
}

import { fileURLToPath } from 'url';

// Only run standalone when this file is executed directly, NOT when bundled
const isDirectExecution = process.argv[1]?.includes('seed-all') &&
  !process.argv[1]?.includes('dist/index.js');

if (isDirectExecution) {
  runAllSeeds()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Fatal error:", error);
      process.exit(1);
    });
}
