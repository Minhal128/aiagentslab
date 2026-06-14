-- ============================================================
-- Migration 0004: Catch-up for tables/columns added since 0003
--
-- Adds tables that were introduced to shared/schema.ts after the
-- 0003 migration was authored. These are required by the live app
-- (flow test queue, Google Calendar OAuth, phone-release retry queue,
-- in-app user feedback). Existing prod databases that have only ever
-- been touched by 0000..0003 will be missing them; fresh installs
-- created via the run-safe-migration.mjs runner will pick them up
-- automatically.
--
-- IMPORTANT: this migration is purely ADDITIVE.
--   * No DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE, or anything that
--     could destroy data.
--   * Every CREATE TABLE / CREATE INDEX uses IF NOT EXISTS.
--   * Safe to run multiple times against any database state.
--
-- See replit.md > "Production database migration rule (task #196)"
-- for why we never run drizzle-kit push --force on production.
-- ============================================================

-- flow_test_queue: durable queue for "Test Flow" calls placed from the
-- flow builder UI. A background worker drains the queue and dispatches
-- the test call.
CREATE TABLE IF NOT EXISTS "flow_test_queue" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL,
  "flow_id" varchar NOT NULL,
  "to_phone" text NOT NULL,
  "status" text NOT NULL DEFAULT 'waiting',
  "call_id" varchar,
  "error_message" text,
  "processed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- FK to flows.id with ON DELETE CASCADE — only added if flows exists
-- and the constraint is missing (so re-running this migration after
-- the FK is in place is a no-op).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'flows')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'flow_test_queue'
         AND constraint_name = 'flow_test_queue_flow_id_flows_id_fk'
     ) THEN
    ALTER TABLE "flow_test_queue"
      ADD CONSTRAINT "flow_test_queue_flow_id_flows_id_fk"
      FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- google_calendar_credentials: per-user Google OAuth tokens for the
-- Calendar integration used by Appointment nodes. Mirrors the existing
-- google_sheets_credentials shape (added in 0002).
CREATE TABLE IF NOT EXISTS "google_calendar_credentials" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL UNIQUE,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expiry" timestamp NOT NULL,
  "connected_email" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_credentials_user_id
  ON "google_calendar_credentials"("user_id");

-- phone_release_retry_queue: durable queue for retrying failed Twilio /
-- Plivo phone-number release calls instead of silently dropping them.
CREATE TABLE IF NOT EXISTS "phone_release_retry_queue" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone_number_id" varchar NOT NULL,
  "provider" text NOT NULL,
  "provider_sid" text NOT NULL,
  "user_id" varchar,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_retry_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_release_retry_queue_next_retry_at_idx
  ON "phone_release_retry_queue"("next_retry_at");
CREATE INDEX IF NOT EXISTS phone_release_retry_queue_phone_number_id_idx
  ON "phone_release_retry_queue"("phone_number_id");

-- user_feedback: in-app feedback / bug-report inbox surfaced to admins.
CREATE TABLE IF NOT EXISTS "user_feedback" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL,
  "type" text NOT NULL,
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "priority" text DEFAULT 'medium',
  "admin_response" text,
  "responded_by" varchar,
  "responded_at" timestamp,
  "page_url" text,
  "user_agent" text,
  "screenshot" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'user_feedback'
         AND constraint_name = 'user_feedback_user_id_users_id_fk'
     ) THEN
    ALTER TABLE "user_feedback"
      ADD CONSTRAINT "user_feedback_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'user_feedback'
         AND constraint_name = 'user_feedback_responded_by_users_id_fk'
     ) THEN
    ALTER TABLE "user_feedback"
      ADD CONSTRAINT "user_feedback_responded_by_users_id_fk"
      FOREIGN KEY ("responded_by") REFERENCES "users"("id");
  END IF;
END $$;
