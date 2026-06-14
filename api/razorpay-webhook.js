import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const BUTTON_ID = 'pl_T1R8ZMGQxzl7p7';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  const raw = await rawBody(req);

  // Verify signature if webhook secret is configured
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (signature !== expected) {
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

  // Only handle events from our specific button
  if (paymentLink?.id !== BUTTON_ID) {
    return res.status(200).json({ skipped: true });
  }

  if (!payment) {
    return res.status(200).json({ ok: true });
  }

  const mobile = normalizeMobile(payment.contact);

  if (eventType === 'payment_link.paid') {
    // Find the most recent 'registered' record for this mobile and update it
    const { data: rows } = await supabase
      .from('payments')
      .select('id, mobile')
      .eq('status', 'registered')
      .order('timestamp', { ascending: false })
      .limit(20);

    const match = rows?.find(r => normalizeMobile(r.mobile) === mobile);

    if (match) {
      await supabase
        .from('payments')
        .update({ payment_id: payment.id, status: 'captured' })
        .eq('id', match.id);
    }
  } else if (eventType === 'payment.failed') {
    const { data: rows } = await supabase
      .from('payments')
      .select('id, mobile')
      .eq('status', 'registered')
      .order('timestamp', { ascending: false })
      .limit(20);

    const match = rows?.find(r => normalizeMobile(r.mobile) === mobile);

    if (match) {
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('id', match.id);
    }
  }

  return res.status(200).json({ ok: true });
}
