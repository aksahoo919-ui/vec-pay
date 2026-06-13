-- Run this entire file in the Supabase SQL Editor (https://app.supabase.com → SQL Editor)

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE cities (
  id   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE schools (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name      TEXT    NOT NULL,
  city      TEXT    NOT NULL,
  devotee   TEXT    NOT NULL,
  languages TEXT[]  NOT NULL DEFAULT '{}'
);

CREATE TABLE payments (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  city        TEXT        NOT NULL,
  school      TEXT        NOT NULL,
  class       TEXT        NOT NULL,
  division    TEXT,
  mobile      TEXT        NOT NULL,
  language    TEXT        NOT NULL,
  referred_by TEXT,
  amount      INTEGER     NOT NULL,
  payment_id  TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'success',
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE cities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Helper: returns true when the logged-in user is an admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (auth.jwt() ->> 'email') IN (
    'aksahoo.919@gmail.com',
    'abhaynitaidas.bavs@gmail.com'
  );
$$;

-- ---- cities ----
-- Public read (students need the list)
CREATE POLICY "Anyone can read cities"   ON cities FOR SELECT USING (true);
CREATE POLICY "Admins can insert cities" ON cities FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "Admins can update cities" ON cities FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "Admins can delete cities" ON cities FOR DELETE TO authenticated USING (is_admin());

-- ---- schools ----
-- Public read (students need the list)
CREATE POLICY "Anyone can read schools"   ON schools FOR SELECT USING (true);
CREATE POLICY "Admins can insert schools" ON schools FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "Admins can update schools" ON schools FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "Admins can delete schools" ON schools FOR DELETE TO authenticated USING (is_admin());

-- ---- payments ----
-- Students can submit without logging in; only admins can view; nobody can edit/delete
CREATE POLICY "Anyone can insert payments" ON payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can read payments"   ON payments FOR SELECT TO authenticated USING (is_admin());

-- ============================================================
-- 3. SUPABASE AUTH SETUP (do these in the Dashboard)
-- ============================================================
-- a) Authentication → Providers → Google: enable and add your OAuth credentials
-- b) Authentication → URL Configuration → Site URL: set to your app URL (e.g. http://localhost:5173)
-- c) Authentication → URL Configuration → Redirect URLs: add your app URL
