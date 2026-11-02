// Indian mobile number handling, shared by the form and the server.
//
// Accepts common ways people type a number: "98765 43210", "+91 98765-43210",
// "919876543210", "09876543210". Returns the plain 10 digits, or null when
// the input is not a valid Indian mobile number (10 digits starting 6-9).
export function normalizeIndianMobile(input) {
  let s = String(input ?? '').trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+91')) s = s.slice(3);
  else if (/^91\d{10}$/.test(s)) s = s.slice(2);
  else if (/^0\d{10}$/.test(s)) s = s.slice(1);
  return /^[6-9]\d{9}$/.test(s) ? s : null;
}
