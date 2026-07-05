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
      // Ask Google what scopes are actually on this token, to settle whether
      // this is a scope problem or a file-creation-permission problem.
      let tokenScopes = 'unknown';
      try {
        const ti = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
        const tiData = await ti.json();
        tokenScopes = tiData.scope || JSON.stringify(tiData);
      } catch { /* ignore */ }
      throw new Error(`Sheet creation failed (HTTP ${createRes.status}): ${JSON.stringify(sheet)} | token scopes: ${tokenScopes}`);
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

    // Make the sheet accessible to anyone with the link (writer)
    await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'anyone' })
    });

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
