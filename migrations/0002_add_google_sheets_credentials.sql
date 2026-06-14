-- ============================================================
-- Migration 0002: Add google_sheets_credentials table
--
-- Stores per-user Google OAuth tokens for the Google Sheets integration.
-- Appointment and Form nodes can be configured to push rows to a Google
-- Sheet automatically after each booking/submission.
--
-- SAFE TO RUN ON EXISTING DATABASES: CREATE TABLE IF NOT EXISTS
-- IDEMPOTENT: running this migration multiple times will not error
-- ============================================================

CREATE TABLE IF NOT EXISTS "google_sheets_credentials" (
  "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" VARCHAR NOT NULL UNIQUE,
  "access_token" TEXT NOT NULL,
  "refresh_token" TEXT NOT NULL,
  "token_expiry" TIMESTAMP NOT NULL,
  "connected_email" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_credentials_user_id ON "google_sheets_credentials"("user_id");
