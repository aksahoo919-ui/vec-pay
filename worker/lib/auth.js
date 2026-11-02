// Admin login with Google (OAuth "authorization code" redirect flow) and
// cookie sessions stored in D1.
//
//   /api/auth/google/start     → redirects to Google's account chooser
//   /api/auth/google/callback  → Google sends the admin back here; if the
//                                email is in the admins table, a session
//                                cookie is set
import { HttpError, json, redirect, parseCookies, cookie } from './http.js';
import { NOW_SQL } from './db.js';

const SESSION_COOKIE = 'vec_session';
const STATE_COOKIE = 'vec_oauth_state';
const SESSION_HOURS = 12;

// A separate Google client for login is optional; by default the same
// client used for Google Sheets is reused.
function loginClient(env) {
  return {
    id: env.GOOGLE_LOGIN_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID,
    secret: env.GOOGLE_LOGIN_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET
  };
}

const callbackUrl = (request) => `${new URL(request.url).origin}/api/auth/google/callback`;

function base64url(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function decodeJwtPayload(jwt) {
  const part = (jwt.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(part + '='.repeat((4 - (part.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}

const clearState = () => cookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/auth' });

export function startLogin(request, env) {
  const { id } = loginClient(env);
  if (!id) throw new HttpError(500, 'Google login is not configured');

  const state = randomToken();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: callbackUrl(request),
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account'
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [
    cookie(STATE_COOKIE, state, { maxAge: 600, path: '/api/auth' })
  ]);
}

export async function finishLogin(request, env) {
  const url = new URL(request.url);
  const fail = (reason) => redirect(`/?login_error=${reason}`, [clearState()]);

  // `state` must match the cookie set in startLogin (protects against forged logins)
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = parseCookies(request)[STATE_COOKIE];
  if (url.searchParams.get('error')) return fail('cancelled');
  if (!code || !state || !expected || state !== expected) return fail('expired');

  const { id, secret } = loginClient(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: callbackUrl(request),
      grant_type: 'authorization_code'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) {
    console.error('Google token exchange failed:', JSON.stringify(data));
    return fail('google');
  }

  // The ID token came directly from Google's token endpoint over HTTPS, so
  // its claims can be used without checking the signature
  // (OpenID Connect Core 1.0, section 3.1.3.7). The claims are still checked.
  let claims;
  try { claims = decodeJwtPayload(data.id_token); } catch { return fail('google'); }
  const validIssuer = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  if (claims.aud !== id || !validIssuer || !claims.email || claims.email_verified !== true || claims.exp * 1000 < Date.now()) {
    return fail('google');
  }

  const email = String(claims.email).toLowerCase();
  const admin = await env.DB.prepare('SELECT id FROM admins WHERE email = ?').bind(email).first();
  if (!admin) return fail('not_admin');

  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ${NOW_SQL}`),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, email, expires_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${SESSION_HOURS} hours'))`
    ).bind(await sha256Hex(token), email)
  ]);

  return redirect('/', [clearState(), cookie(SESSION_COOKIE, token, { maxAge: SESSION_HOURS * 3600 })]);
}

// Email of the signed-in admin, or null. Removing someone from the admins
// table ends their access immediately.
export async function currentAdmin(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.email FROM sessions s JOIN admins a ON a.email = s.email
     WHERE s.token_hash = ? AND s.expires_at > ${NOW_SQL}`
  ).bind(await sha256Hex(token)).first();
  return row?.email || null;
}

export async function requireAdmin(request, env) {
  // Changes must come from our own pages (extra protection on top of SameSite cookies)
  if (request.method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'Forbidden');
  }
  const email = await currentAdmin(request, env);
  if (!email) throw new HttpError(401, 'Your session has ended. Please sign in again.');
  return email;
}

export async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, [cookie(SESSION_COOKIE, '', { maxAge: 0 })]);
}
