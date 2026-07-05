-- Migration V4: Google Sheets integration
-- Run this in the Supabase SQL editor

-- 1. Add sheet_id column to schools table
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sheet_id TEXT;

-- 2. Create settings table (stores misc config like the Others sheet ID)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Only authenticated admins can read/write settings
CREATE POLICY "Admins can manage settings"
ON settings
FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());
