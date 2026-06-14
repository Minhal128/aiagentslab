-- ============================================================
-- AgentLabs Pre-Upgrade Cleanup Script
-- 
-- Run this BEFORE running "drizzle-kit push" when upgrading
-- from older versions of AgentLabs.
--
-- This script safely removes deprecated schema elements using
-- IF EXISTS so it is safe to run even if they don't exist.
--
-- Usage:
--   psql $DATABASE_URL -f scripts/pre-upgrade-cleanup.sql
-- ============================================================

-- ----------------------------------------------------------------
-- Remove Fonoster integration remnants (deprecated in v4.x)
-- Fonoster was replaced by a generic SIP trunk system.
-- ----------------------------------------------------------------

-- Drop FK constraint from sip_trunks (may not exist on all installs)
ALTER TABLE sip_trunks
  DROP CONSTRAINT IF EXISTS "sip_trunks_fonoster_credential_id_fonoster_credentials_id_fk";

-- Drop fonoster columns from sip_trunks
ALTER TABLE sip_trunks
  DROP COLUMN IF EXISTS fonoster_credential_id;

ALTER TABLE sip_trunks
  DROP COLUMN IF EXISTS external_fonoster_trunk_id;

-- Drop fonoster column from sip_phone_numbers
ALTER TABLE sip_phone_numbers
  DROP COLUMN IF EXISTS external_fonoster_phone_id;

-- Drop fonoster_credentials table
DROP TABLE IF EXISTS fonoster_credentials;

-- ----------------------------------------------------------------
-- Add missing columns that may not exist on older databases
-- These use IF NOT EXISTS so they are safe to run repeatedly.
-- ----------------------------------------------------------------

ALTER TABLE calls ADD COLUMN IF NOT EXISTS sentiment text;
ALTER TABLE twilio_openai_calls ADD COLUMN IF NOT EXISTS sentiment text;
ALTER TABLE plivo_calls ADD COLUMN IF NOT EXISTS sentiment text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sentiment text;
ALTER TABLE widget_call_sessions ADD COLUMN IF NOT EXISTS sentiment text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sip_calls') THEN
    ALTER TABLE sip_calls ADD COLUMN IF NOT EXISTS sentiment varchar(50);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- Done. You can now safely run: drizzle-kit push
-- ----------------------------------------------------------------

SELECT 'Pre-upgrade cleanup complete. Safe to run drizzle-kit push.' AS status;
