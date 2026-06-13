-- Run this in Supabase SQL Editor (one-time setup for dynamic admin management)

-- 1. Create admins table
CREATE TABLE admins (
  id    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);

-- 2. Seed the initial admins
INSERT INTO admins (email) VALUES
  ('aksahoo.919@gmail.com'),
  ('abhaynitaidas.bavs@gmail.com');

-- 3. Enable RLS
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Each user can see their own row; admins can see all rows
CREATE POLICY "Read own or all if admin"
  ON admins FOR SELECT TO authenticated
  USING (email = (auth.jwt() ->> 'email') OR is_admin());

-- Only existing admins can add or remove admins
CREATE POLICY "Admins can insert admins"
  ON admins FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete admins"
  ON admins FOR DELETE TO authenticated
  USING (is_admin());

-- 4. Update is_admin() to use the table instead of hardcoded emails
--    SECURITY DEFINER means it runs as postgres and bypasses RLS (no circular dependency)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins WHERE email = (auth.jwt() ->> 'email')
  );
$$;
