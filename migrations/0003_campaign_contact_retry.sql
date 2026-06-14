-- ============================================================
-- Migration 0003: Campaign contact retry system
--
-- Adds retry configuration columns to campaigns table and
-- attempt-tracking columns to contacts table.
--
-- SAFE TO RUN ON EXISTING DATABASES: uses ADD COLUMN IF NOT EXISTS
-- IDEMPOTENT: running this migration multiple times will not error
-- ============================================================

-- campaigns table: retry configuration columns
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "retry_max_attempts" integer DEFAULT 3;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "retry_interval_minutes" integer DEFAULT 60;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "retry_on_no_answer" boolean DEFAULT true;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "retry_on_busy" boolean DEFAULT false;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "retry_on_failed" boolean DEFAULT false;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "batch_job_history" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "current_retry_pass" integer DEFAULT 0;

-- contacts table: attempt tracking columns
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 1;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;
