// WhatsApp group for a registration: the link the school set for the
// student's language and group (Junior up to 7th, Senior 8th and above).
import { whatsappGroupFor } from '../../shared/config.js';
import { parseLanguages, parseWhatsappLinks } from './settings.js';

export async function findWhatsappLink(env, registration) {
  const group = whatsappGroupFor(registration.class);
  const language = registration.language;
  const school = registration.school_id
    ? await env.DB.prepare('SELECT languages, whatsapp_links FROM schools WHERE id = ?').bind(registration.school_id).first()
    : null;
  const links = school ? parseWhatsappLinks(school.whatsapp_links, parseLanguages(school.languages)) : {};
  return { group, language, link: links[language]?.[group] || null };
}
