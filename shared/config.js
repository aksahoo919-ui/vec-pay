// Settings shared by the website (src/) and the Vercel server functions (api/).
// Change a value here and both sides pick it up.

export const CONTEST_NAME = 'Value Education Contest 2027';

// Registration fee in rupees. Razorpay works in paise (1 rupee = 100 paise).
export const REGISTRATION_FEE_RUPEES = 200;
export const REGISTRATION_FEE_PAISE = REGISTRATION_FEE_RUPEES * 100;

export const CLASSES = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export const STATUSES = ['school', 'college', 'working', 'other'];

// Languages offered for each current status.
export const languagesFor = (status) => {
  if (status === 'school') return ['English'];
  if (['college', 'working', 'other'].includes(status)) return ['English', 'Telugu'];
  return [];
};
