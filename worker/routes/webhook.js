// POST /api/razorpay-webhook — Razorpay tells us a payment succeeded or failed.
import { json } from '../lib/http.js';
import { NOW_SQL } from '../lib/db.js';
import { webhookSignatureIsValid } from '../lib/razorpay.js';

export async function razorpayWebhook(request, env) {
  // Ignore spaces / line breaks accidentally copied along with the secret
  const secret = String(env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    // Refuse everything rather than accept unverified "payment captured" messages.
    console.error('Webhook misconfigured: RAZORPAY_WEBHOOK_SECRET is not set');
    return json({ error: 'Server misconfigured' }, 500);
  }

  // Check the signature on the exact bytes Razorpay sent
  const bytes = new Uint8Array(await request.arrayBuffer());
  const raw = new TextDecoder().decode(bytes);
  const signature = request.headers.get('X-Razorpay-Signature');
  if (!(await webhookSignatureIsValid(bytes, signature, secret))) {
    if (signature) {
      // Which webhook sent it helps find a duplicate / test-mode webhook with a different secret
      let info = {};
      try { info = JSON.parse(raw); } catch { /* not JSON */ }
      console.error('Webhook signature mismatch: RAZORPAY_WEBHOOK_SECRET in Cloudflare does not match the secret on the Razorpay webhook',
        '| event:', info.event, '| account:', info.account_id,
        '| event id:', request.headers.get('X-Razorpay-Event-Id'),
        '| payment:', info.payload?.payment?.entity?.id);
    } else {
      console.error('Webhook rejected: no X-Razorpay-Signature header (not sent by Razorpay?)');
    }
    return json({ error: 'Invalid signature' }, 400);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const eventType = event.event;
  const payment = event.payload?.payment?.entity;
  console.log('Webhook received:', eventType, '| payment_id:', payment?.id, '| order_id:', payment?.order_id, '| amount:', payment?.amount);

  const status = ['payment.captured', 'order.paid'].includes(eventType) ? 'captured'
    : eventType === 'payment.failed' ? 'failed'
    : null;
  if (!payment || !status) return json({ ok: true });

  // Each registration has its own Razorpay order, so the order ID identifies it exactly.
  const registration = payment.order_id
    ? await env.DB.prepare('SELECT id, amount FROM payments WHERE order_id = ?').bind(payment.order_id).first()
    : null;
  if (!registration) {
    console.error('No registration found for payment', payment.id, 'order', payment.order_id);
    return json({ ok: true, matched: false });
  }

  if (payment.amount !== registration.amount * 100) {
    console.error('Amount mismatch for registration', registration.id, ':', payment.amount, 'paise, expected', registration.amount * 100);
    return json({ skipped: true, reason: 'amount_mismatch' });
  }

  // A successful payment always wins, even after an earlier failed attempt
  // (Razorpay lets people retry in the same window). A failure never
  // overwrites a success. Database errors throw → 500 → Razorpay retries.
  const sql = status === 'captured'
    ? `UPDATE payments SET status = 'captured', payment_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`
    : `UPDATE payments SET status = 'failed', payment_id = ?, updated_at = ${NOW_SQL} WHERE id = ? AND status <> 'captured'`;
  await env.DB.prepare(sql).bind(payment.id, registration.id).run();

  console.log('Updated payment', registration.id, '→', status, payment.id);
  return json({ ok: true });
}
