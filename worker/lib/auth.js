// Admin login with username + password, and cookie sessions stored in D1.
//
// The main admin's username and password are the ADMIN_USERNAME and
// ADMIN_PASSWORD secrets in Cloudflare. Extra admins (added from the admin
// panel) are in the admins table with hashed passwords.
import { HttpError, json, readJson, parseCookies, cookie } from './http.js';
import { NOW_SQL } from './db.js';
import { verifyPassword, equalStrings, dummyVerify } from './passwords.js';

const SESSION_COOKIE = 'vec_session';
const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export const mainAdminUsername = (env) => String(env.ADMIN_USERNAME || '').trim().toLowerCase();

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function checkOrigin(request) {
  // Changes must come from our own pages (extra protection on top of SameSite cookies)
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'Forbidden');
}

async function passwordIsCorrect(env, username, password) {
  const main = mainAdminUsername(env);
  if (main && env.ADMIN_PASSWORD && username === main) {
    return equalStrings(password, env.ADMIN_PASSWORD);
  }
  const row = await env.DB.prepare('SELECT password_hash FROM admins WHERE username = ?').bind(username).first();
  return row ? verifyPassword(password, row.password_hash) : dummyVerify(password);
}

// POST /api/auth/login  { username, password }
export async function login(request, env) {
  checkOrigin(request);
  const body = await readJson(request);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password || username.length > 50 || password.length > 200) {
    throw new HttpError(400, 'Please enter your username and password');
  }

  const attempts = await env.DB.prepare(
    `SELECT failures, locked_until > ${NOW_SQL} AS locked FROM login_attempts WHERE username = ?`
  ).bind(username).first();
  if (attempts?.locked) {
    throw new HttpError(429, `Too many wrong attempts. Please wait ${LOCK_MINUTES} minutes and try again.`);
  }

  if (!(await passwordIsCorrect(env, username, password))) {
    const failures = (attempts?.failures || 0) + 1;
    const lock = failures >= MAX_FAILURES;
    await env.DB.prepare(
      `INSERT INTO login_attempts (username, failures, locked_until)
       VALUES (?1, ?2, CASE WHEN ?3 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${LOCK_MINUTES} minutes') END)
       ON CONFLICT(username) DO UPDATE SET failures = ?2,
         locked_until = CASE WHEN ?3 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${LOCK_MINUTES} minutes') END`
    ).bind(username, lock ? 0 : failures, lock ? 1 : 0).run();
    throw new HttpError(401, lock
      ? `Too many wrong attempts. Please wait ${LOCK_MINUTES} minutes and try again.`
      : 'Incorrect username or password');
  }

  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ${NOW_SQL}`),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, username, expires_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${SESSION_HOURS} hours'))`
    ).bind(await sha256Hex(token), username)
  ]);

  return json({ username }, 200, [cookie(SESSION_COOKIE, token, { maxAge: SESSION_HOURS * 3600 })]);
}

// Username of the signed-in admin, or null. Removing an admin (or changing
// ADMIN_USERNAME) ends their access immediately.
export async function currentAdmin(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.username, EXISTS (SELECT 1 FROM admins a WHERE a.username = s.username) AS in_table
     FROM sessions s WHERE s.token_hash = ? AND s.expires_at > ${NOW_SQL}`
  ).bind(await sha256Hex(token)).first();
  if (!row) return null;
  const isMain = mainAdminUsername(env) && row.username === mainAdminUsername(env);
  return isMain || row.in_table ? row.username : null;
}

export async function requireAdmin(request, env) {
  if (request.method !== 'GET') checkOrigin(request);
  const username = await currentAdmin(request, env);
  if (!username) throw new HttpError(401, 'Your session has ended. Please sign in again.');
  return username;
}

export async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, [cookie(SESSION_COOKIE, '', { maxAge: 0 })]);
}
