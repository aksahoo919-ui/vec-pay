const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;

export const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export const createRazorpayOrder = (amount, formData, onSuccess, onFailure) => {
  const options = {
    key: RAZORPAY_KEY_ID,
    amount: amount * 100, // Convert to paise
    currency: 'INR',
    name: 'JIVADAYA - Value Education Contest',
    description: 'VEC Kit Payment',
    image: '/logo.png',
    handler: function (response) {
      onSuccess(response);
    },
    prefill: {
      name: formData.name,
      contact: formData.mobile,
    },
    theme: {
      color: '#F97316'
    },
    modal: {
      ondismiss: function() {
        onFailure();
      }
    }
  };

  const paymentObject = new window.Razorpay(options);
  paymentObject.open();
};