// Admin panel routes. Every handler here runs after requireAdmin().
import { HttpError, json, readJson, text, need } from '../lib/http.js';
import { NOW_SQL, insert, newId, isUniqueViolation, toPayment } from '../lib/db.js';
import { mainAdminUsername } from '../lib/auth.js';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../lib/passwords.js';

// GET /api/admin/bootstrap — everything except payments
export async function adminBootstrap(request, env, { username }) {
  const [cities, schools, colleges, admins, others] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM cities ORDER BY name'),
    env.DB.prepare('SELECT id, name, city, devotee, sheet_id FROM schools ORDER BY name'),
    env.DB.prepare('SELECT id, name, city, devotee FROM colleges ORDER BY name'),
    env.DB.prepare('SELECT id, username FROM admins ORDER BY username'),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'others_sheet_id'")
  ]);
  const main = mainAdminUsername(env);
  return json({
    username,
    cities: cities.results,
    schools: schools.results,
    colleges: colleges.results,
    // The main admin (from the Cloudflare secrets) is listed first and can't be removed here
    admins: [...(main ? [{ id: 'main', username: main, main: true }] : []), ...admins.results],
    othersSheetId: others.results[0]?.value || ''
  });
}

// GET /api/admin/payments?since=&afterId=&limit=
// Payments changed after the (since, afterId) cursor, oldest change first.
// The dashboard calls this page by page on load, then every ~20 seconds for
// changes only, which keeps D1 row reads low.
export async function listPayments(request, env) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || '';
  const afterId = url.searchParams.get('afterId') || '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 500, 1), 1000);

  const { results } = await env.DB.prepare(
    'SELECT * FROM payments WHERE (updated_at, id) > (?1, ?2) ORDER BY updated_at, id LIMIT ?3'
  ).bind(since, afterId, limit).all();

  const last = results[results.length - 1];
  return json({
    payments: results.map(toPayment),
    next: results.length === limit ? { since: last.updated_at, afterId: last.id } : null
  });
}

// PUT /api/admin/payments/:id/book-given  { value: true|false }
export async function setBookGiven(request, env, { params }) {
  const { value } = await readJson(request);
  if (typeof value !== 'boolean') throw new HttpError(400, 'value must be true or false');
  const res = await env.DB.prepare(`UPDATE payments SET book_given = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
    .bind(value ? 1 : 0, params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Payment not found');
  return json({ ok: true });
}

// ── Cities ─────────────────────────────────────────────────────

export async function addCity(request, env) {
  const name = need(text((await readJson(request)).name, 100), 'Please enter a city name');
  const city = { id: newId(), name };
  try {
    await insert(env.DB, 'cities', city).run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'City already exists');
    throw err;
  }
  return json(city);
}

// Renaming a city also renames it on its schools and colleges (one transaction).
export async function renameCity(request, env, { params }) {
  const name = need(text((await readJson(request)).name, 100), 'Please enter a city name');
  const city = await env.DB.prepare('SELECT id, name FROM cities WHERE id = ?').bind(params.id).first();
  if (!city) throw new HttpError(404, 'City not found');
  if (city.name === name) return json(city);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE cities SET name = ? WHERE id = ?').bind(name, city.id),
      env.DB.prepare('UPDATE schools SET city = ? WHERE city = ?').bind(name, city.name),
      env.DB.prepare('UPDATE colleges SET city = ? WHERE city = ?').bind(name, city.name)
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'City already exists');
    throw err;
  }
  return json({ id: city.id, name });
}

export async function deleteCity(request, env, { params }) {
  const city = await env.DB.prepare('SELECT id, name FROM cities WHERE id = ?').bind(params.id).first();
  if (!city) throw new HttpError(404, 'City not found');
  const used = await env.DB.prepare(
    'SELECT (SELECT count(*) FROM schools WHERE city = ?1) + (SELECT count(*) FROM colleges WHERE city = ?1) AS n'
  ).bind(city.name).first();
  if (used.n > 0) throw new HttpError(409, `Cannot delete city. ${used.n} school(s)/college(s) are using it.`);
  await env.DB.prepare('DELETE FROM cities WHERE id = ?').bind(city.id).run();
  return json({ ok: true });
}

// ── Schools & colleges (same shape) ────────────────────────────

function institutionFields(body) {
  return {
    name: need(text(body.name, 150), 'Please enter the name'),
    city: need(text(body.city, 100), 'Please select a city'),
    devotee: need(text(body.devotee, 100), 'Please enter the devotee name')
  };
}

const institutionRoutes = (table, label) => ({
  async add(request, env) {
    const row = { id: newId(), ...institutionFields(await readJson(request)) };
    await insert(env.DB, table, row).run();
    return json(table === 'schools' ? { ...row, sheet_id: null } : row);
  },
  async update(request, env, { params }) {
    const fields = institutionFields(await readJson(request));
    const res = await env.DB.prepare(`UPDATE ${table} SET name = ?, city = ?, devotee = ? WHERE id = ?`)
      .bind(fields.name, fields.city, fields.devotee, params.id).run();
    if (!res.meta.changes) throw new HttpError(404, `${label} not found`);
    return json({ id: params.id, ...fields });
  },
  async remove(request, env, { params }) {
    // Payments keep the name they were registered with (school_id becomes NULL).
    const res = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(params.id).run();
    if (!res.meta.changes) throw new HttpError(404, `${label} not found`);
    return json({ ok: true });
  }
});

export const schools = institutionRoutes('schools', 'School');
export const colleges = institutionRoutes('colleges', 'College');

// ── Admins ─────────────────────────────────────────────────────

// POST /api/admin/admins  { username, password }
export async function addAdmin(request, env) {
  const body = await readJson(request);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    throw new HttpError(400, 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore');
  }
  if (username === mainAdminUsername(env)) throw new HttpError(409, 'This username is already an admin');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 200) {
    throw new HttpError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }

  const admin = { id: newId(), username, password_hash: await hashPassword(password) };
  try {
    await insert(env.DB, 'admins', admin).run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'This username is already an admin');
    throw err;
  }
  return json({ id: admin.id, username });
}

export async function removeAdmin(request, env, { params, username: me }) {
  const target = await env.DB.prepare('SELECT id, username FROM admins WHERE id = ?').bind(params.id).first();
  if (!target) throw new HttpError(404, 'Admin not found');
  if (target.username === me) throw new HttpError(400, "You can't remove yourself.");
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(target.id),
    env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(target.username)   // signs them out everywhere
  ]);
  return json({ ok: true });
}
