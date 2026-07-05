import { createClient } from '@supabase/supabase-js';
import { getGoogleAccessToken, verifyAdmin } from './_google-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const { sheetId, type } = req.body;
  const isOthers = type === 'others';
  if (!sheetId) return res.status(400).json({ error: 'sheetId required' });

  // Column indices (0-based) in the sheet rows
  // School sheet:  Payment ID = col 5 (F), Book Given = col 7 (H)
  // Others sheet:  Payment ID = col 8 (I), Book Given = col 10 (K)
  const pidIdx = isOthers ? 8 : 5;
  const bgIdx = isOthers ? 10 : 7;
  const range = isOthers ? 'A2:K' : 'A2:H';

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const token = await getGoogleAccessToken();

    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const sheetData = await sheetRes.json();
    const rows = sheetData.values || [];

    // Group payment IDs by intended book_given value for batch updates
    const toTrue = [];
    const toFalse = [];

    for (const row of rows) {
      const paymentId = row[pidIdx]?.trim();
      if (!paymentId) continue;
      const bookGiven = (row[bgIdx] || '').trim().toLowerCase() === 'yes';
      if (bookGiven) toTrue.push(paymentId);
      else toFalse.push(paymentId);
    }

    let updated = 0;

    if (toTrue.length > 0) {
      const { error } = await supabase
        .from('payments')
        .update({ book_given: true })
        .in('payment_id', toTrue)
        .eq('status', 'captured');
      if (!error) updated += toTrue.length;
    }

    if (toFalse.length > 0) {
      const { error } = await supabase
        .from('payments')
        .update({ book_given: false })
        .in('payment_id', toFalse)
        .eq('status', 'captured');
      if (!error) updated += toFalse.length;
    }

    return res.status(200).json({ updated });
  } catch (err) {
    console.error('sheets-sync-pull error:', err);
    return res.status(500).json({ error: err.message });
  }
}
