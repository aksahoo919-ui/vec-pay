-- Migration V5 — PART B  (run AFTER the new code is live on Vercel
-- and you have made one successful test payment)
-- Run this whole file in the Supabase SQL Editor. Safe to run more than once.
--
-- What it does:
--   1. Stops the browser from writing payment rows directly. From now on
--      only the server (api/register.js and api/razorpay-webhook.js, which
--      use the service-role key) can create or mark payments. This blocks
--      fake "captured" rows and junk inserts.
--   2. Re-runs the ID backfill from Part A for any registrations that came
--      in between Part A and the deploy.
--
-- WARNING: if you run this while the OLD code is still deployed, student
-- registrations will fail until the new code is live.

-- 1. Lock down inserts --------------------------------------------------

DROP POLICY IF EXISTS "Anyone can insert payments" ON payments;

-- 2. Backfill again -----------------------------------------------------

UPDATE payments p SET school_id = s.id
FROM schools s
WHERE p.school_id IS NULL
  AND p.school <> ''
  AND p.school = s.name
  AND (SELECT count(*) FROM schools s2 WHERE s2.name = s.name) = 1;

UPDATE payments p SET college_id = c.id
FROM colleges c
WHERE p.college_id IS NULL
  AND p.college <> ''
  AND p.college = c.name
  AND (SELECT count(*) FROM colleges c2 WHERE c2.name = c.name) = 1;

UPDATE payments p SET child_school_id = s.id
FROM schools s
WHERE p.child_school_id IS NULL
  AND p.has_children = true
  AND p.child_school <> ''
  AND p.child_school = s.name
  AND (SELECT count(*) FROM schools s2 WHERE s2.name = s.name) = 1;
