-- WhatsApp links per school are now per language as well:
--   one language offered → Junior + Senior link for that language (2 links)
--   both languages       → Junior + Senior for English and for Telugu (4 links)
-- Stored as JSON: {"English": {"junior": "...", "senior": "..."}, "Telugu": {...}}

ALTER TABLE schools ADD COLUMN whatsapp_links TEXT NOT NULL DEFAULT '{}';

-- Keep the links already entered: copy them to each language the school offers.
UPDATE schools SET whatsapp_links = json_object(
  'English', json(CASE WHEN instr(languages, '"English"') > 0
                       THEN json_object('junior', junior_link, 'senior', senior_link) ELSE '{}' END),
  'Telugu',  json(CASE WHEN instr(languages, '"Telugu"') > 0
                       THEN json_object('junior', junior_link, 'senior', senior_link) ELSE '{}' END)
)
WHERE junior_link <> '' OR senior_link <> '';

ALTER TABLE schools DROP COLUMN junior_link;
ALTER TABLE schools DROP COLUMN senior_link;
