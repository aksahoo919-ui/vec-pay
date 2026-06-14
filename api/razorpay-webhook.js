import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const raw = await rawBody(req);

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

  console.log('Webhook received:', eventType, '| payment_id:', payment?.id, '| amount:', payment?.amount);

  if (!payment) return res.status(200).json({ ok: true });

  if (payment.amount !== 3000) {
    console.error('Amount mismatch:', payment.amount);
    return res.status(200).json({ skipped: true, reason: 'amount_mismatch' });
  }

  const mobile = normalizeMobile(payment.contact);
  const status = (eventType === 'payment.captured' || eventType === 'payment_link.paid')
    ? 'captured'
    : eventType === 'payment.failed'
    ? 'failed'
    : null;

  if (!status) return res.status(200).json({ ok: true });

  // Find the most recent pending row for this mobile and update it
  const { data: rows, error: fetchError } = await supabase
    .from('payments')
    .select('id, mobile')
    .eq('status', 'pending')
    .order('timestamp', { ascending: false })
    .limit(50);

  if (fetchError) {
    console.error('Supabase fetch error:', fetchError.message);
    return res.status(200).json({ ok: true });
  }

  const match = rows?.find(r => normalizeMobile(r.mobile) === mobile);

  if (!match) {
    console.log('No pending payment found for mobile:', mobile);
    return res.status(200).json({ ok: true });
  }

  const { error: updateError } = await supabase
    .from('payments')
    .update({ payment_id: payment.id, status })
    .eq('id', match.id);

  if (updateError) console.error('Supabase update error:', updateError.message);
  else console.log('Updated payment', match.id, '→', status, payment.id);

  return res.status(200).json({ ok: true });
}
