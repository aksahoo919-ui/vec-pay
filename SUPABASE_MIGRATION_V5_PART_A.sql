-- Migration V5 — PART A  (run BEFORE deploying the new code)
-- Run this whole file in the Supabase SQL Editor. Safe to run more than once.
--
-- What it does:
--   1. Adds order_id so each registration is linked to its Razorpay order.
--   2. Links payments to schools / colleges by ID instead of by name, so
--      renaming a school or college no longer detaches earlier payments.
--   3. Fills in those IDs for existing payments by matching names.
--
-- This part does not change any permissions, so the currently deployed
-- site keeps working after you run it.

-- 1. New columns -------------------------------------------------------

ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id        TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS school_id       UUID REFERENCES schools(id)  ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS college_id      UUID REFERENCES colleges(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS child_school_id UUID REFERENCES schools(id)  ON DELETE SET NULL;

-- One registration per Razorpay order
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_key ON payments(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_school_id_idx       ON payments(school_id);
CREATE INDEX IF NOT EXISTS payments_college_id_idx      ON payments(college_id);
CREATE INDEX IF NOT EXISTS payments_child_school_id_idx ON payments(child_school_id);

-- 2. Backfill IDs for existing payments --------------------------------
-- Only names that match exactly one school / college are linked, so two
-- schools with the same name are never mixed up. Anything left unlinked
-- keeps working as before (it shows under "Others").

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
