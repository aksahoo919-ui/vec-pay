import { LANGUAGES } from '../../shared/config.js';

// A school's languages column (JSON text) → array in a fixed order.
// Falls back to all languages if the value is missing or unreadable.
export function parseLanguages(raw) {
  let list = LANGUAGES;
  try { if (raw) list = JSON.parse(raw); } catch { /* fall back to all */ }
  const valid = LANGUAGES.filter(l => Array.isArray(list) && list.includes(l));
  return valid.length ? valid : LANGUAGES;
}

// Languages chosen in an admin request → JSON text, or an error message.
export function languagesFromRequest(value) {
  const chosen = LANGUAGES.filter(l => Array.isArray(value) && value.includes(l));
  return chosen.length ? JSON.stringify(chosen) : null;
}
