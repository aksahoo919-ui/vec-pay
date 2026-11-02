-- WhatsApp groups are now per school: one Junior link (up to 7th class)
-- and one Senior link (8th class and above). Replaces the rule-based
-- whatsapp_groups table from 0003.

ALTER TABLE schools ADD COLUMN junior_link TEXT NOT NULL DEFAULT '';
ALTER TABLE schools ADD COLUMN senior_link TEXT NOT NULL DEFAULT '';

DROP TABLE IF EXISTS whatsapp_groups;
