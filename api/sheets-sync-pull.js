import { getGoogleAccessToken, googleFetch, getServiceClient, verifyAdmin } from './_google-auth.js';

// PostgREST puts .in() filters in the URL, so very long ID lists fail.
// Update in batches to stay well under URL length limits.
const BATCH_SIZE = 100;

async function updateInBatches(supabase, paymentIds, bookGiven) {
  let updated = 0;
  for (let i = 0; i < paymentIds.length; i += BATCH_SIZE) {
    const batch = paymentIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('payments')
      .update({ book_given: bookGiven })
      .in('payment_id', batch)
      .eq('status', 'captured')
      .select('id');
    if (error) throw error;
    updated += data?.length || 0;
  }
  return updated;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const { sheetId, type } = req.body || {};
  const isOthers = type === 'others';
  if (!sheetId) return res.status(400).json({ error: 'sheetId required' });

  // Column indices (0-based) in the sheet rows
  // School sheet:  Payment ID = col 5 (F), Book Given = col 7 (H)
  // Others sheet:  Payment ID = col 8 (I), Book Given = col 10 (K)
  const pidIdx = isOthers ? 8 : 5;
  const bgIdx = isOthers ? 10 : 7;
  const range = isOthers ? 'A2:K' : 'A2:H';

  const supabase = getServiceClient();

  try {
    const token = await getGoogleAccessToken();

    const sheetData = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
      token
    );
    const rows = sheetData?.values || [];

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

    // Count rows the database actually changed, not rows in the sheet
    const updated =
      (await updateInBatches(supabase, toTrue, true)) +
      (await updateInBatches(supabase, toFalse, false));

    return res.status(200).json({ updated });
  } catch (err) {
    console.error('sheets-sync-pull error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
