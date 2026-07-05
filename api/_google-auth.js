import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export async function getGoogleAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  // Env vars sometimes store \n as literal backslash-n — fix it
  const privateKey = sa.private_key.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');

  const sigInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(privateKey, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${sigInput}.${signature}`
    })
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth failed: ' + JSON.stringify(data));
  // Note: the JWT-bearer grant response does not echo a `scope` field,
  // even though the issued token carries the scopes from the JWT payload.
  return data.access_token;
}

export async function verifyAdmin(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return false;

  const { data: adminRecord } = await supabase
    .from('admins')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  return !!adminRecord;
}
