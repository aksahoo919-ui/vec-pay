import { createClient } from '@supabase/supabase-js';

export function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Uses OAuth with the owner's own Google account (refresh-token flow).
// Files created this way are owned by and stored in the owner's Drive,
// which avoids the service-account file-creation limits on personal Gmail.
export async function getGoogleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN
    })
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Google auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

// Calls a Google API and throws a readable error when Google says no,
// so a failure is never reported to the admin as a success.
export async function googleFetch(url, token, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let data = null;
  try { data = await res.json(); } catch { /* some Google responses have no body */ }

  if (!res.ok) {
    const reason = data?.error?.message || data?.error_description || res.statusText || 'Unknown error';
    throw new Error(`Google API error (HTTP ${res.status}): ${reason}`);
  }
  return data;
}

export async function verifyAdmin(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);

  const supabase = getServiceClient();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return false;

  const { data: adminRecord } = await supabase
    .from('admins')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  return !!adminRecord;
}
