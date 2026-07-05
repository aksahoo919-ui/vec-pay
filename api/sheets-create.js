import { createClient } from '@supabase/supabase-js';
import { getGoogleAccessToken, verifyAdmin } from './_google-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const { schoolId, schoolName, type } = req.body;
  const isOthers = type === 'others';

  if (!isOthers && (!schoolId || !schoolName)) {
    return res.status(400).json({ error: 'schoolId and schoolName required' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const token = await getGoogleAccessToken();
    const title = isOthers ? 'ŚREṢṬHA - Others' : `ŚREṢṬHA - ${schoolName}`;

    // Create the spreadsheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title } })
    });
    const sheet = await createRes.json();
    if (!sheet.spreadsheetId) {
      throw new Error(`Sheet creation failed (HTTP ${createRes.status}): ${JSON.stringify(sheet)}`);
    }
    const sheetId = sheet.spreadsheetId;

    // Write header row
    const headers = isOthers
      ? [['Name', 'Type', 'City', 'Institution', 'Class/Branch', 'Mobile', 'Language', 'Referred By', 'Payment ID', 'Date', 'Book Given']]
      : [['Name', 'Mobile', 'Class', 'Language', 'Referred By', 'Payment ID', 'Date', 'Book Given']];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=RAW`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: headers })
    });

    // The sheet is owned by the OAuth account's own Drive — no extra sharing needed.

    // Store the sheet ID in Supabase
    if (isOthers) {
      await supabase.from('settings').upsert({ key: 'others_sheet_id', value: sheetId });
    } else {
      await supabase.from('schools').update({ sheet_id: sheetId }).eq('id', schoolId);
    }

    return res.status(200).json({
      sheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
    });
  } catch (err) {
    console.error('sheets-create error:', err);
    return res.status(500).json({ error: err.message });
  }
}
