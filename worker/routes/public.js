// Routes the public registration page uses (no login).
import { HttpError, json, readJson, text, need } from '../lib/http.js';
import { insert, newId } from '../lib/db.js';
import { createOrder } from '../lib/razorpay.js';
import { normalizeIndianMobile } from '../../shared/mobile.js';
import { REGISTRATION_FEE_RUPEES, REGISTRATION_FEE_PAISE, CLASSES, STATUSES, languagesFor } from '../../shared/config.js';

// GET /api/public/bootstrap — everything the form needs in one request
export async function bootstrap(request, env) {
  const [cities, schools, colleges] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM cities ORDER BY name'),
    env.DB.prepare('SELECT id, name, city, devotee FROM schools ORDER BY name'),
    env.DB.prepare('SELECT id, name, city, devotee FROM colleges ORDER BY name')
  ]);
  return json({
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    cities: cities.results,
    schools: schools.results,
    colleges: colleges.results
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A school/college choice is either an ID from the list, or "Other" with a typed name.
async function resolveInstitution(env, table, choice, otherName, label) {
  if (choice === 'Other') {
    return { id: null, name: need(text(otherName, 150), `Please enter the ${label} name`), city: '', devotee: '' };
  }
  if (typeof choice !== 'string' || !UUID_RE.test(choice)) throw new HttpError(400, `Please select a ${label}`);

  const row = await env.DB.prepare(`SELECT id, name, city, devotee FROM ${table} WHERE id = ?`).bind(choice).first();
  if (!row) throw new HttpError(400, `The selected ${label} no longer exists. Please refresh the page and choose again.`);
  return row;
}

async function buildRegistration(env, body) {
  const name = need(text(body.name, 100), 'Please enter your full name');
  const currentStatus = need(STATUSES.includes(body.currentStatus) ? body.currentStatus : null, 'Please select your current status');
  const mobile = need(normalizeIndianMobile(body.mobile), 'Please enter a valid 10-digit mobile number');
  const language = need(languagesFor(currentStatus).includes(body.language) ? body.language : null, 'Please select a language');

  const row = {
    name, current_status: currentStatus, city: '',
    school: '', school_id: null, class: '',
    college: '', college_id: null, branch: '',
    company_name: '', mobile, language, referred_by: '',
    has_children: 0, child_name: '', child_school: '', child_school_id: null, child_section: ''
  };

  if (currentStatus === 'school') {
    const school = await resolveInstitution(env, 'schools', body.schoolId, body.otherSchoolName, 'school');
    Object.assign(row, { school: school.name, school_id: school.id, city: school.city || '', referred_by: school.devotee || '' });
    row.class = need(CLASSES.includes(body.class) ? body.class : null, 'Please select your class');
  } else if (currentStatus === 'college') {
    const college = await resolveInstitution(env, 'colleges', body.collegeId, body.otherCollegeName, 'college');
    Object.assign(row, { college: college.name, college_id: college.id, city: college.city || '', referred_by: college.devotee || '' });
    row.branch = need(text(body.branch, 100), 'Please enter your branch');
  } else if (currentStatus === 'working') {
    row.company_name = need(text(body.companyName, 150), 'Please enter your company name');
  }

  if (['working', 'other'].includes(currentStatus) && body.hasChildren === true) {
    const childSchool = await resolveInstitution(env, 'schools', body.childSchoolId, body.childOtherSchoolName, "child's school");
    Object.assign(row, {
      has_children: 1,
      child_name: need(text(body.childName, 100), "Please enter your child's name"),
      child_school: childSchool.name,
      child_school_id: childSchool.id,
      child_section: need(text(body.childSection, 30), "Please enter your child's class and section")
    });
  }
  return row;
}

// POST /api/register — saves the registration and creates its Razorpay order.
// The fee is fixed here on the server; the browser never chooses the amount.
export async function register(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    console.error('register: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
    throw new HttpError(500, 'Server is not configured. Please contact the organisers.');
  }

  const row = await buildRegistration(env, await readJson(request));

  let order;
  try {
    order = await createOrder(env, { amountPaise: REGISTRATION_FEE_PAISE, notes: { mobile: row.mobile, name: row.name.slice(0, 200) } });
  } catch (err) {
    console.error('register: Razorpay order failed:', err.message);
    throw new HttpError(502, 'Could not start payment. Please try again.');
  }

  await insert(env.DB, 'payments', {
    id: newId(),
    ...row,
    amount: REGISTRATION_FEE_RUPEES,
    payment_id: 'pending',
    status: 'pending',
    order_id: order.id,
    book_given: 0,
    timestamp: new Date().toISOString()
  }).run();

  return json({ orderId: order.id, mobile: row.mobile });
}
