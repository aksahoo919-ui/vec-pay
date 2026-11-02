// Routes the public registration page uses (no login).
import { HttpError, json, readJson, text, need } from '../lib/http.js';
import { insert, newId } from '../lib/db.js';
import { createOrder, checkoutSignatureIsValid } from '../lib/razorpay.js';
import { parseLanguages } from '../lib/settings.js';
import { findWhatsappLink } from '../lib/whatsapp.js';
import { normalizeIndianMobile } from '../../shared/mobile.js';
import { REGISTRATION_FEE_RUPEES, REGISTRATION_FEE_PAISE, CLASSES } from '../../shared/config.js';

// GET /api/public/bootstrap — everything the form needs in one request
export async function bootstrap(request, env) {
  const [cities, schools] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM cities ORDER BY name'),
    env.DB.prepare('SELECT id, name, city, devotee, languages FROM schools ORDER BY name')
  ]);
  return json({
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    cities: cities.results,
    schools: schools.results.map(s => ({ ...s, languages: parseLanguages(s.languages) }))
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buildRegistration(env, body) {
  const name = need(text(body.name, 100), 'Please enter the full name');

  if (typeof body.schoolId !== 'string' || !UUID_RE.test(body.schoolId)) throw new HttpError(400, 'Please select a school');
  const school = await env.DB.prepare('SELECT id, name, city, devotee, languages FROM schools WHERE id = ?').bind(body.schoolId).first();
  if (!school) throw new HttpError(400, 'The selected school no longer exists. Please refresh the page and choose again.');

  const cls = need(CLASSES.includes(body.class) ? body.class : null, 'Please select the class');

  const rawSection = typeof body.section === 'string' ? body.section.trim() : '';
  if (rawSection.length > 20) throw new HttpError(400, 'Section is too long');

  // Only the languages this school offers
  const language = need(parseLanguages(school.languages).includes(body.language) ? body.language : null, 'Please select a language');

  const mobile = need(normalizeIndianMobile(body.mobile), 'Please enter a valid 10-digit mobile number');

  return {
    name,
    current_status: 'school',
    city: school.city || '',
    school: school.name,
    school_id: school.id,
    class: cls,
    section: rawSection,
    language,
    mobile,
    referred_by: school.devotee || ''
  };
}

// POST /api/register — saves the registration and creates its Razorpay order.
// The fee is fixed here on the server; the browser never chooses the amount.
export async function register(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    console.error('register: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
    throw new HttpError(500, 'Server is not configured. Please contact the organisers.');
  }

  const row = await buildRegistration(env, await readJson(request));

  let order;
  try {
    order = await createOrder(env, { amountPaise: REGISTRATION_FEE_PAISE, notes: { mobile: row.mobile, name: row.name.slice(0, 200) } });
  } catch (err) {
    console.error('register: Razorpay order failed:', err.message);
    throw new HttpError(502, 'Could not start payment. Please try again.');
  }

  await insert(env.DB, 'payments', {
    id: newId(),
    ...row,
    amount: REGISTRATION_FEE_RUPEES,
    payment_id: 'pending',
    status: 'pending',
    order_id: order.id,
    book_given: 0,
    timestamp: new Date().toISOString()
  }).run();

  return json({ orderId: order.id, mobile: row.mobile });
}

// POST /api/registration/whatsapp  { orderId, paymentId, signature }
// Called by the form right after Razorpay reports success. The Razorpay
// signature proves the payment went through, so only people who actually
// paid get the WhatsApp group link.
export async function whatsappLink(request, env) {
  const { orderId, paymentId, signature } = await readJson(request);
  if (!(await checkoutSignatureIsValid(orderId, paymentId, signature, env.RAZORPAY_KEY_SECRET || ''))) {
    throw new HttpError(400, 'Could not verify the payment');
  }
  const registration = await env.DB.prepare(
    'SELECT school_id, class FROM payments WHERE order_id = ?'
  ).bind(orderId).first();
  if (!registration) throw new HttpError(404, 'Registration not found');

  return json(await findWhatsappLink(env, registration));
}
