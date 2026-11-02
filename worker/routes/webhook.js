// POST /api/razorpay-webhook — Razorpay tells us a payment succeeded or failed.
import { json } from '../lib/http.js';
import { NOW_SQL } from '../lib/db.js';
import { webhookSignatureIsValid } from '../lib/razorpay.js';

export async function razorpayWebhook(request, env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    // Refuse everything rather than accept unverified "payment captured" messages.
    console.error('Webhook misconfigured: RAZORPAY_WEBHOOK_SECRET is not set');
    return json({ error: 'Server misconfigured' }, 500);
  }

  const raw = await request.text();
  if (!(await webhookSignatureIsValid(raw, request.headers.get('X-Razorpay-Signature'), env.RAZORPAY_WEBHOOK_SECRET))) {
    console.error('Webhook signature mismatch');
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
