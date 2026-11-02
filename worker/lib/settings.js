import { LANGUAGES } from '../../shared/config.js';

// Languages currently offered on the form (admin setting), in a fixed order.
export async function enabledLanguages(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'languages'").first();
  let list = LANGUAGES;
  try { if (row) list = JSON.parse(row.value); } catch { /* fall back to all */ }
  const enabled = LANGUAGES.filter(l => list.includes(l));
  return enabled.length ? enabled : LANGUAGES;
}
