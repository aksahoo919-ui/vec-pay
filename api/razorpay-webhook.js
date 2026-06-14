import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const BUTTON_ID = 'pl_T1R8ZMGQxzl7p7';

export const config = { api: { bodyParser: false } };

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeMobile(contact) {
  if (!contact) return '';
  return contact.replace(/\D/g, '').slice(-10);
}

async function updatePayment(supabase, mobile, paymentId, status) {
  const { data: rows, error: fetchError } = await supabase
    .from('payments')
    .select('id, mobile')
    .eq('status', 'registered')
    .order('timestamp', { ascending: false })
    .limit(50);

  if (fetchError) {
    console.error('Supabase fetch error:', fetchError.message);
    return false;
  }

  const match = rows?.find(r => normalizeMobile(r.mobile) === mobile);
  if (!match) {
    console.log('No registered payment found for mobile:', mobile);
    return false;
  }

  const updates = status === 'captured'
    ? { payment_id: paymentId, status: 'captured' }
    : { status };

  const { error: updateError } = await supabase
    .from('payments')
    .update(updates)
    .eq('id', match.id);

  if (updateError) {
    console.error('Supabase update error:', updateError.message);
    return false;
  }

  console.log(`Updated payment ${match.id} → status=${status}, payment_id=${paymentId}`);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check env vars are present
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const raw = await rawBody(req);

  // Verify signature if webhook secret is configured
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (signature !== expected) {
      console.error('Signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = event.event;
  const payment = event.payload?.payment?.entity;
  const paymentLink = event.payload?.payment_link?.entity;

  console.log('Webhook received:', eventType, '| payment_id:', payment?.id);

  if (!payment) {
    return res.status(200).json({ ok: true });
  }

  const mobile = normalizeMobile(payment.contact);
  console.log('Normalized mobile:', mobile);

  if (eventType === 'payment.captured') {
    await updatePayment(supabase, mobile, payment.id, 'captured');
  } else if (eventType === 'payment.authorized') {
    await updatePayment(supabase, mobile, payment.id, 'authorized');
  } else if (eventType === 'payment.failed') {
    await updatePayment(supabase, mobile, null, 'failed');
  }

  return res.status(200).json({ ok: true });
}
