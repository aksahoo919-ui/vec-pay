-- Child-only registration form + WhatsApp groups.

-- Optional class section (e.g. "B")
ALTER TABLE payments ADD COLUMN section TEXT NOT NULL DEFAULT '';

-- WhatsApp group links shown after a successful payment.
-- A registration gets the most specific matching group:
-- a specific city beats "all cities", a specific language beats "any language".
CREATE TABLE whatsapp_groups (
  id         TEXT PRIMARY KEY,
  city_id    TEXT REFERENCES cities(id) ON DELETE CASCADE,   -- NULL = all cities/areas
  classes    TEXT NOT NULL,                                  -- JSON array, e.g. ["1st","2nd"]
  language   TEXT NOT NULL DEFAULT '',                       -- '' = any language
  link       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Languages offered on the form (admin can switch either one off)
INSERT OR IGNORE INTO settings (key, value) VALUES ('languages', '["English","Telugu"]');
