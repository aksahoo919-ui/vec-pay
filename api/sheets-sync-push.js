import { createClient } from '@supabase/supabase-js';
import { getGoogleAccessToken, verifyAdmin } from './_google-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const { sheetId, schoolName, type } = req.body;
  const isOthers = type === 'others';

  if (!sheetId) return res.status(400).json({ error: 'sheetId required' });
  if (!isOthers && !schoolName) return res.status(400).json({ error: 'schoolName required' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const token = await getGoogleAccessToken();
    let payments;

    if (isOthers) {
      // Get all admin-added school names
      const { data: adminSchools } = await supabase.from('schools').select('name');
      const adminSchoolNames = new Set((adminSchools || []).map(s => s.name));

      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .order('timestamp', { ascending: true });
      if (error) throw error;

      // Others = everyone NOT in an admin-added school
      payments = (data || []).filter(p =>
        p.current_status !== 'school' || !adminSchoolNames.has(p.school)
      );
    } else {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .eq('current_status', 'school')
        .eq('school', schoolName)
        .order('timestamp', { ascending: true });
      if (error) throw error;
      payments = data || [];
    }

    // Clear existing data rows, keep header at row 1
    const clearRange = isOthers ? 'A2:K' : 'A2:H';
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(clearRange)}:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (payments.length > 0) {
      const typeLabels = { school: 'School', college: 'College', working: 'Working', other: 'Other' };

      const rows = payments.map(p => {
        const date = new Date(p.timestamp).toLocaleDateString('en-IN');
        const bookGiven = p.book_given ? 'Yes' : 'No';

        if (isOthers) {
          const institution = p.current_status === 'college' ? p.college
            : p.current_status === 'working' ? p.company_name
            : p.current_status === 'school' ? p.school : '';
          const classBranch = p.current_status === 'school' ? (p.class || '')
            : p.current_status === 'college' ? (p.branch || '') : '';
          return [
            p.name,
            typeLabels[p.current_status] || p.current_status,
            p.city || '',
            institution || '',
            classBranch,
            p.mobile,
            p.language || '',
            p.referred_by || '',
            p.payment_id,
            date,
            bookGiven
          ];
        } else {
          return [
            p.name,
            p.mobile,
            p.class || '',
            p.language || '',
            p.referred_by || '',
            p.payment_id,
            date,
            bookGiven
          ];
        }
      });

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:append?valueInputOption=RAW`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows })
      });
    }

    return res.status(200).json({ synced: payments.length });
  } catch (err) {
    console.error('sheets-sync-push error:', err);
    return res.status(500).json({ error: err.message });
  }
}
