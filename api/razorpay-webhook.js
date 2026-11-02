import crypto from 'crypto';
import { getServiceClient } from './_google-auth.js';

export const config = { api: { bodyParser: false } };

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function lastTenDigits(contact) {
  if (!contact) return '';
  return String(contact).replace(/\D/g, '').slice(-10);
}

function signatureIsValid(raw, signature, secret) {
  if (typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Finds the registration this payment belongs to.
// New registrations are matched by Razorpay order ID. Registrations made
// before order IDs were stored are matched by mobile number as a fallback.
async function findRegistration(supabase, payment, status) {
  if (payment.order_id) {
    const { data, error } = await supabase
      .from('payments')
      .select('id, status, amount')
      .eq('order_id', payment.order_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const mobile = lastTenDigits(payment.contact);
  if (!mobile) return null;

  const { data: rows, error } = await supabase
    .from('payments')
    .select('id, status, amount, mobile')
    .is('order_id', null)
    // a success may follow an earlier failed attempt, so look at failed rows too
    .in('status', status === 'captured' ? ['pending', 'failed'] : ['pending'])
    .order('timestamp', { ascending: false })
    .limit(500);
  if (error) throw error;

  return rows?.find(r => lastTenDigits(r.mobile) === mobile) || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Refuse everything rather than accept unverified "payment captured" messages.
    console.error('Webhook misconfigured: RAZORPAY_WEBHOOK_SECRET, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const raw = await rawBody(req);

  if (!signatureIsValid(raw, req.headers['x-razorpay-signature'], secret)) {
    console.error('Signature mismatch');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = event.event;
  const payment = event.payload?.payment?.entity;

  console.log('Webhook received:', eventType, '| payment_id:', payment?.id, '| order_id:', payment?.order_id, '| amount:', payment?.amount);

  if (!payment) return res.status(200).json({ ok: true });

  const status = ['payment.captured', 'order.paid', 'payment_link.paid'].includes(eventType)
    ? 'captured'
    : eventType === 'payment.failed'
    ? 'failed'
    : null;

  if (!status) return res.status(200).json({ ok: true });

  const supabase = getServiceClient();

  try {
    const registration = await findRegistration(supabase, payment, status);
    if (!registration) {
      console.error('No registration found for payment', payment.id, 'order', payment.order_id);
      return res.status(200).json({ ok: true, matched: false });
    }

    if (payment.amount !== registration.amount * 100) {
      console.error('Amount mismatch for registration', registration.id, ':', payment.amount, 'paise, expected', registration.amount * 100);
      return res.status(200).json({ skipped: true, reason: 'amount_mismatch' });
    }

    let query = supabase.from('payments').update({ payment_id: payment.id, status }).eq('id', registration.id);

    // A failed attempt must never overwrite a successful one. A successful
    // payment always wins, even if an earlier attempt was marked failed
    // (Razorpay lets people retry in the same window after a failure).
    if (status === 'failed') query = query.neq('status', 'captured');

    const { error: updateError } = await query;
    if (updateError) throw updateError;

    console.log('Updated payment', registration.id, '→', status, payment.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Non-2xx makes Razorpay retry the webhook later.
    console.error('Webhook database error:', err.message || err);
    return res.status(500).json({ error: 'Database error' });
  }
}
