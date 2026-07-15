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
      // Students registered directly for this school
      const { data: students, error: studentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .eq('current_status', 'school')
        .eq('school', schoolName)
        .order('timestamp', { ascending: true });
      if (studentsError) throw studentsError;

      // Parents whose child is in this school
      const { data: parents, error: parentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .eq('has_children', true)
        .eq('child_school', schoolName)
        .order('timestamp', { ascending: true });
      if (parentsError) throw parentsError;

      payments = [...(students || []), ...(parents || [])]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    // Read existing rows so we only append payments not already in the sheet.
    // Payment ID column: index 5 (F) for school sheets, index 8 (I) for Others.
    const pidIdx = isOthers ? 8 : 5;
    const readRange = isOthers ? 'A2:K' : 'A2:H';
    const existingRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(readRange)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const existingData = await existingRes.json();
    const existingIds = new Set(
      (existingData.values || [])
        .map(r => r[pidIdx]?.trim())
        .filter(Boolean)
    );

    // Only keep captured payments whose payment_id isn't already in the sheet
    const newPayments = payments.filter(p => !existingIds.has(p.payment_id));

    if (newPayments.length > 0) {
      const typeLabels = { school: 'School', college: 'College', working: 'Working', other: 'Other' };

      const rows = newPayments.map(p => {
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
          const isParent = p.current_status !== 'school';
          return [
            isParent ? `${p.name} (Parent of ${p.child_name})` : p.name,
            p.mobile,
            isParent ? (p.child_section || '') : (p.class || ''),
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

    return res.status(200).json({ added: newPayments.length, total: payments.length });
  } catch (err) {
    console.error('sheets-sync-push error:', err);
    return res.status(500).json({ error: err.message });
  }
}
