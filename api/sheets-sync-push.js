import { getGoogleAccessToken, googleFetch, getServiceClient, verifyAdmin } from './_google-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifyAdmin(req))) return res.status(403).json({ error: 'Forbidden' });

  const { schoolId, type } = req.body || {};
  const isOthers = type === 'others';

  if (!isOthers && !schoolId) return res.status(400).json({ error: 'schoolId required' });

  const supabase = getServiceClient();

  try {
    // Current names, so renamed schools/colleges show their new name
    const [{ data: schools, error: schoolsError }, { data: colleges, error: collegesError }] = await Promise.all([
      supabase.from('schools').select('id, name, city, sheet_id'),
      supabase.from('colleges').select('id, name, city')
    ]);
    if (schoolsError) throw schoolsError;
    if (collegesError) throw collegesError;
    const schoolById = new Map((schools || []).map(s => [s.id, s]));
    const collegeById = new Map((colleges || []).map(c => [c.id, c]));

    let sheetId;
    let payments;

    if (isOthers) {
      const { data: setting, error: settingError } = await supabase
        .from('settings').select('value').eq('key', 'others_sheet_id').maybeSingle();
      if (settingError) throw settingError;
      sheetId = setting?.value;
      if (!sheetId) return res.status(400).json({ error: 'The Others sheet has not been created yet' });

      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .order('timestamp', { ascending: true });
      if (error) throw error;

      // Others = everyone NOT linked to an admin-added school
      payments = (data || []).filter(p => !(p.current_status === 'school' && p.school_id));
    } else {
      const school = schoolById.get(schoolId);
      if (!school) return res.status(404).json({ error: 'School not found' });
      sheetId = school.sheet_id;
      if (!sheetId) return res.status(400).json({ error: 'This school has no sheet yet' });

      // Students registered directly for this school
      const { data: students, error: studentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .eq('current_status', 'school')
        .eq('school_id', schoolId)
        .order('timestamp', { ascending: true });
      if (studentsError) throw studentsError;

      // Parents whose child is in this school
      const { data: parents, error: parentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'captured')
        .eq('has_children', true)
        .eq('child_school_id', schoolId)
        .order('timestamp', { ascending: true });
      if (parentsError) throw parentsError;

      payments = [...(students || []), ...(parents || [])]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    const token = await getGoogleAccessToken();

    // Read existing rows so we only append payments not already in the sheet.
    // If this read fails we stop: appending blindly would duplicate every row.
    // Payment ID column: index 5 (F) for school sheets, index 8 (I) for Others.
    const pidIdx = isOthers ? 8 : 5;
    const readRange = isOthers ? 'A2:K' : 'A2:H';
    const existingData = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(readRange)}`,
      token
    );
    const existingIds = new Set(
      (existingData?.values || [])
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
          const schoolName = schoolById.get(p.school_id)?.name || p.school;
          const collegeName = collegeById.get(p.college_id)?.name || p.college;
          const institution = p.current_status === 'college' ? collegeName
            : p.current_status === 'working' ? p.company_name
            : p.current_status === 'school' ? schoolName : '';
          const classBranch = p.current_status === 'school' ? (p.class || '')
            : p.current_status === 'college' ? (p.branch || '') : '';
          return [
            p.name,
            typeLabels[p.current_status] || p.current_status,
            schoolById.get(p.school_id)?.city || collegeById.get(p.college_id)?.city || p.city || '',
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

      await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:append?valueInputOption=RAW`, token, {
        method: 'POST',
        body: { values: rows }
      });
    }

    return res.status(200).json({ added: newPayments.length, total: payments.length });
  } catch (err) {
    console.error('sheets-sync-push error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
