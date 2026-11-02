import { getGoogleAccessToken, googleFetch, getServiceClient, verifyAdmin } from './_google-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const supabase = getServiceClient();

  try {
    // Collect all sheet IDs
    const { data: schools, error: schoolsError } = await supabase
      .from('schools').select('name, sheet_id').not('sheet_id', 'is', null);
    if (schoolsError) throw schoolsError;

    const { data: settings, error: settingsError } = await supabase
      .from('settings').select('value').eq('key', 'others_sheet_id').maybeSingle();
    if (settingsError) throw settingsError;

    const targets = [
      ...(schools || []).filter(s => s.sheet_id).map(s => ({ id: s.sheet_id, label: s.name })),
      ...(settings?.value ? [{ id: settings.value, label: 'Others' }] : [])
    ];

    const token = await getGoogleAccessToken();

    const results = await Promise.allSettled(
      targets.map(t =>
        googleFetch(`https://www.googleapis.com/drive/v3/files/${t.id}/permissions`, token, {
          method: 'POST',
          body: { type: 'anyone', role: 'reader' }
        })
      )
    );

    // Only count sheets Google actually accepted
    const failures = results
      .map((r, i) => (r.status === 'rejected' ? `${targets[i].label}: ${r.reason?.message || r.reason}` : null))
      .filter(Boolean);
    failures.forEach(f => console.error('sheets-make-public failed for', f));

    return res.status(200).json({
      total: targets.length,
      succeeded: targets.length - failures.length,
      failed: failures.length,
      failures
    });
  } catch (err) {
    console.error('sheets-make-public error:', err);
    return res.status(500).json({ error: err.message });
  }
}
