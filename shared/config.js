// Settings shared by the website (src/) and the Cloudflare Worker (worker/).
// Change a value here and both sides pick it up.

export const CONTEST_NAME = 'Value Education Contest 2027';

// Registration fee in rupees. Razorpay works in paise (1 rupee = 100 paise).
export const REGISTRATION_FEE_RUPEES = 200;
export const REGISTRATION_FEE_PAISE = REGISTRATION_FEE_RUPEES * 100;

export const CLASSES = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

// Languages the contest can be taken in. The admin chooses which of these
// are offered on the form.
export const LANGUAGES = ['English', 'Telugu'];

// WhatsApp groups: classes up to and including JUNIOR_UP_TO get the
// school's Junior group link; higher classes get the Senior group link.
export const JUNIOR_UP_TO = '7th';
export const whatsappGroupFor = (cls) =>
  CLASSES.indexOf(cls) <= CLASSES.indexOf(JUNIOR_UP_TO) ? 'junior' : 'senior';
