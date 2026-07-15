import { createClient } from '@supabase/supabase-js';
import { getGoogleAccessToken, verifyAdmin } from './_google-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const token = await getGoogleAccessToken();

    // Collect all sheet IDs
    const { data: schools } = await supabase.from('schools').select('sheet_id').not('sheet_id', 'is', null);
    const { data: settings } = await supabase.from('settings').select('value').eq('key', 'others_sheet_id').maybeSingle();

    const sheetIds = [
      ...(schools || []).map(s => s.sheet_id).filter(Boolean),
      settings?.value || null
    ].filter(Boolean);

    const results = await Promise.allSettled(
      sheetIds.map(id =>
        fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'anyone', role: 'reader' })
        })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    return res.status(200).json({ total: sheetIds.length, succeeded, failed });
  } catch (err) {
    console.error('sheets-make-public error:', err);
    return res.status(500).json({ error: err.message });
  }
}
