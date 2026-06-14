-- ============================================================
-- Migration 0005: Add missing messaging columns to agents table
--
-- This migration ensures that the messaging and expressive mode 
-- columns exist in the agents table. These are required for 
-- ElevenLabs conversational AI tool integrations.
--
-- SAFE TO RUN ON EXISTING DATABASES: uses ADD COLUMN IF NOT EXISTS
-- IDEMPOTENT: running this migration multiple times will not error
-- ============================================================

-- agents table: messaging and expressive columns
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_email_enabled" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_whatsapp_enabled" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_email_template" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_whatsapp_template" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "messaging_whatsapp_variables" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "expressive_mode" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "appointment_booking_enabled" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "detect_language_enabled" boolean DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "end_conversation_enabled" boolean DEFAULT false;

-- ensure turn_timeout exists (added in 0001 but repeated here for safety)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "turn_timeout" double precision DEFAULT 1.5;

-- calls table: agent_id, engine_type, credits_used columns (added in 0001 but repeated here for safety)
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "agent_id" varchar;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "engine_type" text;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "credits_used" integer DEFAULT 0;
