// Google Sheets export / import for the admin panel.
import { HttpError, json, readJson } from '../lib/http.js';
import { NOW_SQL } from '../lib/db.js';
import { getGoogleAccessToken, googleFetch } from '../lib/google.js';
import { CONTEST_NAME } from '../../shared/config.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

const SCHOOL_HEADER = ['Name', 'Mobile', 'Class', 'Language', 'Referred By', 'Payment ID', 'Date', 'Book Given'];
const OTHERS_HEADER = ['Name', 'Type', 'City', 'Institution', 'Class/Branch', 'Mobile', 'Language', 'Referred By', 'Payment ID', 'Date', 'Book Given'];

// Column positions (0-based): school sheet Payment ID = F, Book Given = H;
// Others sheet Payment ID = I, Book Given = K.
const layout = (isOthers) => isOthers
  ? { pidIdx: 8, bgIdx: 10, range: 'A2:K' }
  : { pidIdx: 5, bgIdx: 7, range: 'A2:H' };

const classWithSection = (p) => (p.section ? `${p.class} - ${p.section}` : p.class);

async function othersSheetId(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'others_sheet_id'").first();
  return row?.value || '';
}

const makePublic = (sheetId, token) =>
  googleFetch(`${DRIVE}/${sheetId}/permissions`, token, { method: 'POST', body: { type: 'anyone', role: 'reader' } });

// POST /api/admin/sheets/create  { schoolId } or { type: 'others' }
export async function createSheet(request, env) {
  const { schoolId, type } = await readJson(request);
  const isOthers = type === 'others';

  let school = null;
  if (!isOthers) {
    school = await env.DB.prepare('SELECT id, name FROM schools WHERE id = ?').bind(schoolId || '').first();
    if (!school) throw new HttpError(404, 'School not found');
  }

  const token = await getGoogleAccessToken(env);
  const title = isOthers ? `${CONTEST_NAME} - Others` : `${CONTEST_NAME} - ${school.name}`;

  const sheet = await googleFetch(SHEETS, token, { method: 'POST', body: { properties: { title } } });
  if (!sheet?.spreadsheetId) throw new Error('Google did not return a spreadsheet ID');
  const sheetId = sheet.spreadsheetId;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  // Save the sheet ID first, so a later failure never leaves an orphan sheet
  // the portal doesn't know about (and a duplicate on retry).
  try {
    if (isOthers) {
      await env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('others_sheet_id', ?1, ${NOW_SQL})
         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ${NOW_SQL}`
      ).bind(sheetId).run();
    } else {
      await env.DB.prepare('UPDATE schools SET sheet_id = ? WHERE id = ?').bind(sheetId, school.id).run();
    }
  } catch (err) {
    throw new HttpError(500,
      `The sheet was created in Google Drive but could not be saved in the portal (${err.message}). ` +
      `Please delete it from Drive before trying again: ${sheetUrl}`);
  }

  // The sheet exists and is saved either way, so these are warnings, not errors.
  const warnings = [];
  try {
    await googleFetch(`${SHEETS}/${sheetId}/values/A1:append?valueInputOption=RAW`, token, {
      method: 'POST', body: { values: [isOthers ? OTHERS_HEADER : SCHOOL_HEADER] }
    });
  } catch (err) {
    warnings.push(`Header row could not be written: ${err.message}`);
  }
  try {
    await makePublic(sheetId, token);
  } catch (err) {
    warnings.push(`Sheet could not be made public: ${err.message}`);
  }

  return json({ sheetId, sheetUrl, warnings });
}

// POST /api/admin/sheets/push  { schoolId } or { type: 'others' }
// Appends captured payments that aren't in the sheet yet.
export async function pushSheet(request, env) {
  const { schoolId, type } = await readJson(request);
  const isOthers = type === 'others';

  const [schoolsRes, collegesRes] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, city, sheet_id FROM schools'),
    env.DB.prepare('SELECT id, name, city FROM colleges')
  ]);
  const schoolById = new Map(schoolsRes.results.map(s => [s.id, s]));
  const collegeById = new Map(collegesRes.results.map(c => [c.id, c]));

  let sheetId;
  let payments;
  if (isOthers) {
    sheetId = await othersSheetId(env);
    if (!sheetId) throw new HttpError(400, 'The Others sheet has not been created yet');
    // Others = everyone not linked to an admin-added school
    const { results } = await env.DB.prepare(
      `SELECT * FROM payments WHERE status = 'captured' AND NOT (current_status = 'school' AND school_id IS NOT NULL)
       ORDER BY timestamp`
    ).all();
    payments = results;
  } else {
    const school = schoolById.get(schoolId);
    if (!school) throw new HttpError(404, 'School not found');
    sheetId = school.sheet_id;
    if (!sheetId) throw new HttpError(400, 'This school has no sheet yet');
    // Students of this school, plus parents whose child is in this school
    const { results } = await env.DB.prepare(
      `SELECT * FROM payments WHERE status = 'captured'
         AND ((current_status = 'school' AND school_id = ?1) OR (has_children = 1 AND child_school_id = ?1))
       ORDER BY timestamp`
    ).bind(schoolId).all();
    payments = results;
  }

  const token = await getGoogleAccessToken(env);
  const { pidIdx, range } = layout(isOthers);

  // If this read fails we stop: appending blindly would duplicate every row.
  const existing = await googleFetch(`${SHEETS}/${sheetId}/values/${encodeURIComponent(range)}`, token);
  const existingIds = new Set((existing?.values || []).map(r => r[pidIdx]?.trim()).filter(Boolean));
  const newPayments = payments.filter(p => !existingIds.has(p.payment_id));

  if (newPayments.length > 0) {
    const typeLabels = { school: 'School', college: 'College', working: 'Working', other: 'Other' };
    const rows = newPayments.map(p => {
      const date = new Date(p.timestamp).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
      const bookGiven = p.book_given ? 'Yes' : 'No';
      if (isOthers) {
        const schoolName = schoolById.get(p.school_id)?.name || p.school;
        const collegeName = collegeById.get(p.college_id)?.name || p.college;
        const institution = p.current_status === 'college' ? collegeName
          : p.current_status === 'working' ? p.company_name
          : p.current_status === 'school' ? schoolName : '';
        const classBranch = p.current_status === 'school' ? classWithSection(p) : p.current_status === 'college' ? p.branch : '';
        const city = schoolById.get(p.school_id)?.city || collegeById.get(p.college_id)?.city || p.city;
        return [p.name, typeLabels[p.current_status] || p.current_status, city || '', institution || '', classBranch || '',
          p.mobile, p.language || '', p.referred_by || '', p.payment_id, date, bookGiven];
      }
      const isParent = p.current_status !== 'school';
      return [isParent ? `${p.name} (Parent of ${p.child_name})` : p.name, p.mobile,
        (isParent ? p.child_section : classWithSection(p)) || '', p.language || '', p.referred_by || '', p.payment_id, date, bookGiven];
    });

    await googleFetch(`${SHEETS}/${sheetId}/values/A2:append?valueInputOption=RAW`, token, {
      method: 'POST', body: { values: rows }
    });
  }

  return json({ added: newPayments.length, total: payments.length });
}

// POST /api/admin/sheets/pull  { schoolId } or { type: 'others' }
// Copies the Book Given column from the sheet into the portal.
export async function pullSheet(request, env) {
  const { schoolId, type } = await readJson(request);
  const isOthers = type === 'others';

  const sheetId = isOthers
    ? await othersSheetId(env)
    : (await env.DB.prepare('SELECT sheet_id FROM schools WHERE id = ?').bind(schoolId || '').first())?.sheet_id;
  if (!sheetId) throw new HttpError(400, 'No sheet found');

  const token = await getGoogleAccessToken(env);
  const { pidIdx, bgIdx, range } = layout(isOthers);
  const data = await googleFetch(`${SHEETS}/${sheetId}/values/${encodeURIComponent(range)}`, token);

  const toTrue = [];
  const toFalse = [];
  for (const row of data?.values || []) {
    const paymentId = row[pidIdx]?.trim();
    if (!paymentId) continue;
    ((row[bgIdx] || '').trim().toLowerCase() === 'yes' ? toTrue : toFalse).push(paymentId);
  }

  // D1 allows at most 100 bound values per statement, so update in chunks
  // (all chunks run in one transaction). Only rows whose value actually
  // changes are touched, and the count is what really changed.
  const CHUNK = 90;
  const statements = [];
  for (const [ids, value] of [[toTrue, 1], [toFalse, 0]]) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      statements.push(env.DB.prepare(
        `UPDATE payments SET book_given = ?, updated_at = ${NOW_SQL}
         WHERE status = 'captured' AND book_given <> ? AND payment_id IN (${chunk.map(() => '?').join(', ')})`
      ).bind(value, value, ...chunk));
    }
  }
  const results = statements.length ? await env.DB.batch(statements) : [];
  const updated = results.reduce((n, r) => n + (r.meta?.changes || 0), 0);

  return json({ updated });
}

// POST /api/admin/sheets/make-public
export async function makeAllPublic(request, env) {
  const { results: schools } = await env.DB.prepare('SELECT name, sheet_id FROM schools WHERE sheet_id IS NOT NULL').all();
  const others = await othersSheetId(env);
  const targets = [
    ...schools.map(s => ({ id: s.sheet_id, label: s.name })),
    ...(others ? [{ id: others, label: 'Others' }] : [])
  ];

  const token = await getGoogleAccessToken(env);
  const results = await Promise.allSettled(targets.map(t => makePublic(t.id, token)));

  // Only count sheets Google actually accepted
  const failures = results
    .map((r, i) => (r.status === 'rejected' ? `${targets[i].label}: ${r.reason?.message || r.reason}` : null))
    .filter(Boolean);
  failures.forEach(f => console.error('make-public failed for', f));

  return json({ total: targets.length, succeeded: targets.length - failures.length, failed: failures.length, failures });
}
