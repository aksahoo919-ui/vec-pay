-- Switch admin login from Google accounts to username + password.
--
-- The main admin is not stored here: its username and password are the
-- ADMIN_USERNAME / ADMIN_PASSWORD secrets in Cloudflare. This table holds
-- the extra admins added from the admin panel.

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS admins;

CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,          -- always stored lowercase
  password_hash TEXT NOT NULL,                 -- pbkdf2-sha256$iterations$salt$hash
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Login sessions. Only a SHA-256 hash of the cookie value is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Wrong-password counter: 5 failures lock that username for 15 minutes.
CREATE TABLE login_attempts (
  username     TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
