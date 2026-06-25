-- ============================================================
-- Migration 0006: Add appointment_doctor_name column to agents table
--
-- Adds an optional doctor name field to agents, used when sending
-- automatic WhatsApp appointment confirmation messages.
-- If not set, the agent's own name is used as the doctor name.
--
-- SAFE TO RUN ON EXISTING DATABASES: uses ADD COLUMN IF NOT EXISTS
-- IDEMPOTENT: running this migration multiple times will not error
-- ============================================================

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "appointment_doctor_name" text;
