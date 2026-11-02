-- One-time cleanup: unlink every Google Sheet created so far.
-- Schools and the "Others" sheet go back to showing "Create Google Sheet".
-- The sheet files themselves stay in Google Drive; only the portal's link
-- to them is removed.

UPDATE schools SET sheet_id = NULL;
DELETE FROM settings WHERE key = 'others_sheet_id';
