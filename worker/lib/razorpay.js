// Razorpay helpers.

// RAZORPAY_API_BASE is only for local testing against a fake server.
const apiBase = (env) => env.RAZORPAY_API_BASE || 'https://api.razorpay.com';

export async function createOrder(env, { amountPaise, notes }) {
  const res = await fetch(`${apiBase(env)}/v1/orders`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: `rcpt_${Date.now()}`, notes })
  });
  const order = await res.json().catch(() => ({}));
  if (!order.id) throw new Error(order.error?.description || `Order creation failed (HTTP ${res.status})`);
  return order;
}

// Checks the X-Razorpay-Signature header (HMAC-SHA256 of the raw body).
export async function webhookSignatureIsValid(rawBody, signature, secret) {
  if (typeof signature !== 'string' || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  // Constant-time comparison
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
