-- Initial D1 schema for the Value Education Contest site.
-- Applied automatically on deploy by `npm run deploy`
-- (wrangler d1 migrations apply DB --remote).
-- D1 enforces foreign keys by default.


CREATE TABLE cities (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE schools (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  city     TEXT NOT NULL DEFAULT '',
  devotee  TEXT NOT NULL DEFAULT '',
  sheet_id TEXT
);

CREATE TABLE colleges (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  city    TEXT NOT NULL DEFAULT '',
  devotee TEXT NOT NULL DEFAULT ''
);

-- One row per registration. Created only by the server (POST /api/register)
-- and marked paid / failed only by the Razorpay webhook.
CREATE TABLE payments (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  current_status  TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  school          TEXT NOT NULL DEFAULT '',          -- name at registration time (kept for "Other" / deleted schools)
  school_id       TEXT REFERENCES schools(id)  ON DELETE SET NULL,
  class           TEXT NOT NULL DEFAULT '',
  college         TEXT NOT NULL DEFAULT '',
  college_id      TEXT REFERENCES colleges(id) ON DELETE SET NULL,
  branch          TEXT NOT NULL DEFAULT '',
  company_name    TEXT NOT NULL DEFAULT '',
  mobile          TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT '',
  referred_by     TEXT NOT NULL DEFAULT '',
  amount          INTEGER NOT NULL,                  -- rupees
  payment_id      TEXT NOT NULL DEFAULT 'pending',   -- Razorpay payment ID once known
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | captured | failed
  order_id        TEXT UNIQUE,                       -- Razorpay order ID
  book_given      INTEGER NOT NULL DEFAULT 0,
  has_children    INTEGER NOT NULL DEFAULT 0,
  child_name      TEXT NOT NULL DEFAULT '',
  child_school    TEXT NOT NULL DEFAULT '',
  child_school_id TEXT REFERENCES schools(id)  ON DELETE SET NULL,
  child_section   TEXT NOT NULL DEFAULT '',
  timestamp       TEXT NOT NULL,                     -- ISO time of registration
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX payments_updated_idx      ON payments(updated_at, id);   -- admin dashboard refresh
CREATE INDEX payments_status_idx       ON payments(status);
CREATE INDEX payments_school_idx       ON payments(school_id);
CREATE INDEX payments_child_school_idx ON payments(child_school_id);
CREATE INDEX payments_payment_id_idx   ON payments(payment_id);

CREATE TABLE admins (
  id    TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE                         -- always stored lowercase
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Admin login sessions. Only a SHA-256 hash of the cookie value is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- First admins (same as before). More can be added from the admin panel.
INSERT INTO admins (id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'aksahoo.919@gmail.com'),
  ('00000000-0000-4000-8000-000000000002', 'abhaynitaidas.bavs@gmail.com');
