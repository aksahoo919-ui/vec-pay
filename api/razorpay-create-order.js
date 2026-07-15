export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount required' });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay credentials not configured' });
  }

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,          // paise (e.g. 3000 = ₹30)
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`
      })
    });

    const order = await response.json();
    if (!order.id) {
      throw new Error(order.error?.description || 'Order creation failed');
    }

    return res.status(200).json({ orderId: order.id });
  } catch (err) {
    console.error('razorpay-create-order error:', err);
    return res.status(500).json({ error: err.message });
  }
}
