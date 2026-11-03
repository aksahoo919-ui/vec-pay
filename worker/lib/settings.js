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

// A school's whatsapp_links column (JSON text) → { English: { junior, senior }, … }
// with an entry (possibly empty strings) for each language the school offers.
export function parseWhatsappLinks(raw, languages) {
  let stored = {};
  try { stored = JSON.parse(raw || '{}') || {}; } catch { /* treat as empty */ }
  const out = {};
  for (const lang of languages) {
    const entry = stored[lang] || {};
    out[lang] = {
      junior: typeof entry.junior === 'string' ? entry.junior : '',
      senior: typeof entry.senior === 'string' ? entry.senior : ''
    };
  }
  return out;
}
