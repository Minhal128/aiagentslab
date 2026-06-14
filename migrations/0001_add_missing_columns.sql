-- ============================================================
-- Migration 0001: Add missing columns to agents and calls tables
--
-- These columns were added to shared/schema.ts after the initial
-- 0000_damp_spectrum.sql migration was generated.
--
-- SAFE TO RUN ON EXISTING DATABASES: uses ADD COLUMN IF NOT EXISTS
-- IDEMPOTENT: running this migration multiple times will not error
-- ============================================================

-- agents table: messaging / expressive / turn_timeout columns
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_email_enabled" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_whatsapp_enabled" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_email_template" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_whatsapp_template" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_whatsapp_variables" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "expressive_mode" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "turn_timeout" double precision DEFAULT 1.5;

-- calls table: agent_id, engine_type, credits_used columns
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "agent_id" varchar;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "engine_type" text;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "credits_used" integer DEFAULT 0;

-- sip_calls table: fix agent_id FK to use ON DELETE SET NULL
-- Without this, deleting an agent that has SIP call records raises a FK violation.
-- Drop the old constraint (if it exists in any form) then re-add it with the
-- correct ON DELETE SET NULL behaviour.  Idempotent: safe to run multiple times.
ALTER TABLE "sip_calls" DROP CONSTRAINT IF EXISTS "sip_calls_agent_id_agents_id_fk";
ALTER TABLE "sip_calls" ADD CONSTRAINT "sip_calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL;
