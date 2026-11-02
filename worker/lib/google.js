// Google Sheets / Drive access using the owner's own Google account
// (refresh-token flow). Files are owned by and stored in the owner's Drive.

export async function getGoogleAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error('Google auth failed: ' + (data.error_description || data.error || `HTTP ${res.status}`));
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
