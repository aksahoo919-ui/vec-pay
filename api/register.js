import { getServiceClient } from './_google-auth.js';
import { normalizeIndianMobile } from '../shared/mobile.js';
import { REGISTRATION_FEE_RUPEES, REGISTRATION_FEE_PAISE, CLASSES, STATUSES, languagesFor } from '../shared/config.js';

// Creates a student registration and its Razorpay order in one step.
//
// The browser can no longer write to the payments table directly: it sends
// the form here, the server checks it, creates the Razorpay order for the
// fixed fee, and saves the registration as "pending" together with the
// Razorpay order ID. The webhook later marks that exact row as paid.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= max ? s : null;
};

class BadRequest extends Error {}

const need = (value, message) => {
  if (!value) throw new BadRequest(message);
  return value;
};

// Resolves a school/college choice: either an ID from the list, or "Other"
// with a typed name. Returns { id, name, city, devotee }.
async function resolveInstitution(supabase, table, choice, otherName, label) {
  if (choice === 'Other') {
    return { id: null, name: need(text(otherName, 150), `Please enter the ${label} name`), city: '', devotee: '' };
  }
  if (typeof choice !== 'string' || !UUID_RE.test(choice)) throw new BadRequest(`Please select a ${label}`);

  const { data, error } = await supabase.from(table).select('id, name, city, devotee').eq('id', choice).maybeSingle();
  if (error) throw error;
  if (!data) throw new BadRequest(`The selected ${label} no longer exists. Please refresh the page and choose again.`);
  return data;
}

async function buildRow(supabase, body) {
  const name = need(text(body.name, 100), 'Please enter your full name');
  const currentStatus = STATUSES.includes(body.currentStatus) ? body.currentStatus : null;
  need(currentStatus, 'Please select your current status');

  const mobile = need(normalizeIndianMobile(body.mobile), 'Please enter a valid 10-digit mobile number');

  const language = languagesFor(currentStatus).includes(body.language) ? body.language : null;
  need(language, 'Please select a language');

  const row = {
    name,
    current_status: currentStatus,
    city: '',
    school: '', school_id: null, class: '',
    college: '', college_id: null, branch: '',
    company_name: '',
    mobile,
    language,
    referred_by: '',
    has_children: false, child_name: '', child_school: '', child_school_id: null, child_section: ''
  };

  if (currentStatus === 'school') {
    const school = await resolveInstitution(supabase, 'schools', body.schoolId, body.otherSchoolName, 'school');
    row.school = school.name;
    row.school_id = school.id;
    row.city = school.city || '';
    row.referred_by = school.devotee || '';
    row.class = need(CLASSES.includes(body.class) ? body.class : null, 'Please select your class');
  } else if (currentStatus === 'college') {
    const college = await resolveInstitution(supabase, 'colleges', body.collegeId, body.otherCollegeName, 'college');
    row.college = college.name;
    row.college_id = college.id;
    row.city = college.city || '';
    row.referred_by = college.devotee || '';
    row.branch = need(text(body.branch, 100), 'Please enter your branch');
  } else if (currentStatus === 'working') {
    row.company_name = need(text(body.companyName, 150), 'Please enter your company name');
  }

  if (['working', 'other'].includes(currentStatus) && body.hasChildren === true) {
    const childSchool = await resolveInstitution(supabase, 'schools', body.childSchoolId, body.childOtherSchoolName, "child's school");
    row.has_children = true;
    row.child_name = need(text(body.childName, 100), "Please enter your child's name");
    row.child_school = childSchool.name;
    row.child_school_id = childSchool.id;
    row.child_section = need(text(body.childSection, 30), "Please enter your child's class and section");
  }

  return row;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('register: missing Razorpay or Supabase environment variables');
    return res.status(500).json({ error: 'Server is not configured. Please contact the organisers.' });
  }

  const supabase = getServiceClient();

  let row;
  try {
    row = await buildRow(supabase, req.body || {});
  } catch (err) {
    if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
    console.error('register: validation lookup failed:', err);
    return res.status(500).json({ error: 'Could not save registration. Please try again.' });
  }

  try {
    // 1. Razorpay order for the fixed fee (never an amount from the browser)
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: REGISTRATION_FEE_PAISE,
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`,
        notes: { mobile: row.mobile, name: row.name.slice(0, 200) }
      })
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error(order.error?.description || 'Order creation failed');

    // 2. Registration linked to that order
    const { error } = await supabase.from('payments').insert({
      ...row,
      amount: REGISTRATION_FEE_RUPEES,
      payment_id: 'pending',
      status: 'pending',
      order_id: order.id,
      book_given: false,
      timestamp: new Date().toISOString()
    });
    if (error) throw error;

    return res.status(200).json({ orderId: order.id, mobile: row.mobile });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
}
