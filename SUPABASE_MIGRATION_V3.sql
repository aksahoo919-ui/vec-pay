-- Run this in the Supabase SQL Editor to add support for:
--   - Children participation tracking for Working / Other registrants
--
-- This script is safe to run multiple times (idempotent).

-- ============================================================
-- 1. NEW COLUMNS ON payments
-- ============================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS has_children  BOOLEAN DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS child_name    TEXT    DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS child_school  TEXT    DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS child_section TEXT    DEFAULT '';
