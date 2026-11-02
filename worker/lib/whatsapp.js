// WhatsApp group for a registration: the school's Junior link for classes
// up to 7th, its Senior link for 8th and above.
import { whatsappGroupFor } from '../../shared/config.js';

export async function findWhatsappLink(env, registration) {
  const group = whatsappGroupFor(registration.class);
  const school = registration.school_id
    ? await env.DB.prepare('SELECT junior_link, senior_link FROM schools WHERE id = ?').bind(registration.school_id).first()
    : null;
  const link = school ? (group === 'junior' ? school.junior_link : school.senior_link) : '';
  return { group, link: link || null };
}
