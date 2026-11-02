import { getGoogleAccessToken, googleFetch, getServiceClient, verifyAdmin } from './_google-auth.js';
import { CONTEST_NAME } from '../shared/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const { schoolId, type } = req.body || {};
  const isOthers = type === 'others';

  if (!isOthers && !schoolId) {
    return res.status(400).json({ error: 'schoolId required' });
  }

  const supabase = getServiceClient();

  try {
    let schoolName = '';
    if (!isOthers) {
      const { data: school, error } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
      if (error) throw error;
      if (!school) return res.status(404).json({ error: 'School not found' });
      schoolName = school.name;
    }

    const token = await getGoogleAccessToken();
    const title = isOthers ? `${CONTEST_NAME} - Others` : `${CONTEST_NAME} - ${schoolName}`;

    // 1. Create the spreadsheet
    const sheet = await googleFetch('https://sheets.googleapis.com/v4/spreadsheets', token, {
      method: 'POST',
      body: { properties: { title } }
    });
    if (!sheet?.spreadsheetId) throw new Error('Google did not return a spreadsheet ID');
    const sheetId = sheet.spreadsheetId;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

    // 2. Save the sheet ID first, so a later failure never leaves an orphan
    //    sheet that the portal doesn't know about (and a duplicate on retry).
    const { error: saveError } = isOthers
      ? await supabase.from('settings').upsert({ key: 'others_sheet_id', value: sheetId })
      : await supabase.from('schools').update({ sheet_id: sheetId }).eq('id', schoolId);
    if (saveError) {
      return res.status(500).json({
        error: `The sheet was created in Google Drive but could not be saved in the portal (${saveError.message}). ` +
               `Please delete it from Drive before trying again: ${sheetUrl}`
      });
    }

    // 3. Header row and sharing. The sheet exists and is saved either way,
    //    so failures here are reported as warnings instead of a hard error.
    const warnings = [];
    const headers = isOthers
      ? [['Name', 'Type', 'City', 'Institution', 'Class/Branch', 'Mobile', 'Language', 'Referred By', 'Payment ID', 'Date', 'Book Given']]
      : [['Name', 'Mobile', 'Class', 'Language', 'Referred By', 'Payment ID', 'Date', 'Book Given']];

    try {
      await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=RAW`, token, {
        method: 'POST',
        body: { values: headers }
      });
    } catch (err) {
      warnings.push(`Header row could not be written: ${err.message}`);
    }

    try {
      await googleFetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, token, {
        method: 'POST',
        body: { type: 'anyone', role: 'reader' }
      });
    } catch (err) {
      warnings.push(`Sheet could not be made public: ${err.message}`);
    }

    return res.status(200).json({ sheetId, sheetUrl, warnings });
  } catch (err) {
    console.error('sheets-create error:', err);
    return res.status(500).json({ error: err.message });
  }
}
