-- Run this in the Supabase SQL Editor to add support for:
--   - Current Status (school / college / working / other)
--   - Admin-managed colleges
--   - Book given/not given tracking
--   - Admin ability to update payment rows
--
-- This script is safe to run multiple times (idempotent).

-- ============================================================
-- 1. COLLEGES TABLE (admin-managed, mirrors schools)
-- ============================================================

CREATE TABLE IF NOT EXISTS colleges (
  id      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name    TEXT NOT NULL,
  city    TEXT NOT NULL DEFAULT '',
  devotee TEXT NOT NULL DEFAULT ''
);

ALTER TABLE colleges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read colleges"   ON colleges;
DROP POLICY IF EXISTS "Admins can insert colleges" ON colleges;
DROP POLICY IF EXISTS "Admins can update colleges" ON colleges;
DROP POLICY IF EXISTS "Admins can delete colleges" ON colleges;

CREATE POLICY "Anyone can read colleges"   ON colleges FOR SELECT USING (true);
CREATE POLICY "Admins can insert colleges" ON colleges FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "Admins can update colleges" ON colleges FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "Admins can delete colleges" ON colleges FOR DELETE TO authenticated USING (is_admin());

-- ============================================================
-- 2. NEW COLUMNS ON payments
-- ============================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS current_status TEXT    DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS college        TEXT    DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS branch         TEXT    DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_name   TEXT    DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS book_given     BOOLEAN DEFAULT false;

-- school and class are NOT NULL from the original schema; college/working
-- rows store empty strings there, which satisfies NOT NULL.

-- ============================================================
-- 3. ALLOW ADMINS TO UPDATE PAYMENTS (for the book given/not given toggle)
-- ============================================================

DROP POLICY IF EXISTS "Admins can update payments" ON payments;
CREATE POLICY "Admins can update payments" ON payments FOR UPDATE TO authenticated USING (is_admin());
