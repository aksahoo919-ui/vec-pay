// Password hashing with PBKDF2-SHA256 (built into Workers).
//
// 20,000 rounds takes about 4 ms, which fits the Workers free plan's 10 ms
// CPU limit per request. The login lockout (5 tries per 15 minutes) and the
// 10-character minimum make up for the lower round count.

const ITERATIONS = 20000;
const enc = new TextEncoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// Constant-time comparison of two byte arrays
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromB64(salt), parseInt(iterations, 10));
  return equalBytes(actual, fromB64(hash));
}

// Compares two plain strings (e.g. the ADMIN_PASSWORD secret) in constant time.
export async function equalStrings(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b)))
  ]);
  return equalBytes(new Uint8Array(x), new Uint8Array(y));
}

// Spends the same time as a real check, so unknown usernames can't be
// told apart from wrong passwords by timing.
export async function dummyVerify(password) {
  await pbkdf2(password, new Uint8Array(16), ITERATIONS);
  return false;
}

export const PASSWORD_MIN_LENGTH = 10;
