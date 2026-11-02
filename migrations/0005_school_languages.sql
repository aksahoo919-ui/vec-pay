-- Languages are now chosen per school (English, Telugu or both) instead of
-- one setting for the whole form. Existing schools start with both.

ALTER TABLE schools ADD COLUMN languages TEXT NOT NULL DEFAULT '["English","Telugu"]';

DELETE FROM settings WHERE key = 'languages';
