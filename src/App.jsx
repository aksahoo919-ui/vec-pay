import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, LogOut, Plus, Edit2, Trash2, Save, X, Download, ExternalLink, FileSpreadsheet, RefreshCw, Loader2, ChevronDown } from 'lucide-react';
import { api } from './api';
import { CONTEST_NAME, REGISTRATION_FEE_RUPEES, CLASSES, LANGUAGES, JUNIOR_UP_TO } from '../shared/config.js';
import { normalizeIndianMobile } from '../shared/mobile.js';

const PAYMENT_AMOUNT = REGISTRATION_FEE_RUPEES;

const PAYMENTS_REFRESH_MS = 20000;   // admin dashboard checks for new/changed payments this often
const SHEETS_TIMEOUT_MS = 90000;     // Google Sheets actions can take a while


// ISO time `seconds` earlier than `iso`
const secondsBefore = (iso, seconds) => new Date(new Date(iso).getTime() - seconds * 1000).toISOString();

// Makes a value safe for a CSV cell: doubles inner quotes and stops Excel /
// Google Sheets from running user-typed text that starts with = + - @ as a formula.
const csvCell = (value) => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

// Keeps long digit strings (mobile numbers) as text so Excel doesn't turn
// them into scientific notation.
const csvTextCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /^\d+$/.test(s) ? `"=""${s}"""` : csvCell(s);
};

// Single shared promise so mount-preload and click-time never inject twice.
// Resolves true on success, false on failure (so callers can recover instead of hang).
let checkoutScriptPromise = null;
const loadCheckoutScript = () => {
  if (window.Razorpay) return Promise.resolve(true);
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => { checkoutScriptPromise = null; resolve(false); }; // allow retry on next click
    document.head.appendChild(s);
  });
  return checkoutScriptPromise;
};

function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    name: '',
    city: '',       // city/area name
    school: '',     // school ID
    class: '',
    section: '',
    language: '',
    mobile: ''
  });

  // cities is {id, name}[]
  const [cities, setCities] = useState([]);
  const [schools, setSchools] = useState([]);
  const classes = CLASSES;
  const [payments, setPayments] = useState([]);


  // WhatsApp group shown after payment
  const [whatsapp, setWhatsapp] = useState(null);     // null | { status: 'loading' | 'ready', group, link }

  const [editingSchool, setEditingSchool] = useState(null);
  const [showAddSchool, setShowAddSchool] = useState(false);
  const EMPTY_SCHOOL = { name: '', city: '', devotee: '', juniorLink: '', seniorLink: '', languages: [...LANGUAGES] };
  const [newSchool, setNewSchool] = useState(EMPTY_SCHOOL);

  // editingCity is {id, name} | null
  const [showAddCity, setShowAddCity] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [editingCity, setEditingCity] = useState(null);
  const [editingCityValue, setEditingCityValue] = useState('');

  const [selectedCityFilter, setSelectedCityFilter] = useState('');
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState('');
  const [selectedBookFilter, setSelectedBookFilter] = useState('');
  const [capturedSearch, setCapturedSearch] = useState('');
  const [capturedExpanded, setCapturedExpanded] = useState(true);
  const [nonCapturedExpanded, setNonCapturedExpanded] = useState(true);

  const [sheetLoading, setSheetLoading] = useState({});
  const [othersSheetId, setOthersSheetId] = useState('');

  const [razorpayKeyId, setRazorpayKeyId] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Where the last payments refresh got to, and whether one is running
  const paymentsCursor = useRef({ since: '', afterId: '' });
  const paymentsLoading = useRef(false);

  // Admin management
  const [admins, setAdmins] = useState([]);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  // Payment state
  // The registration last saved on the server, so an unchanged form reuses
  // its Razorpay order while an edited form creates a fresh registration.
  const [lastRegistration, setLastRegistration] = useState(null); // { signature, orderId, mobile }
  const [mobileTouched, setMobileTouched] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const paymentShown = useRef(false);   // success popup already shown for this payment
  const paymentWatch = useRef(null);    // timer checking the server for a completed payment
  const [payError, setPayError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormComplete = useMemo(() =>
    !!(formData.name.trim() && formData.city && formData.school && formData.class &&
       formData.language && normalizeIndianMobile(formData.mobile)),
  [formData]);

  // Payments are linked to schools by ID, so look up the current name and
  // city. Falls back to the name saved at registration for deleted schools.
  const schoolById = useMemo(() => new Map(schools.map(s => [s.id, s])), [schools]);
  const schoolNameOf = (p) => schoolById.get(p.school_id)?.name || p.school || '';
  const cityOf = (p) => schoolById.get(p.school_id)?.city || p.city || '';
  const classOf = (p) => (p.section ? `${p.class} - ${p.section}` : p.class);

  // Schools in the chosen city/area
  const schoolsInCity = useMemo(
    () => schools.filter(s => s.city === formData.city).sort((a, b) => a.name.localeCompare(b.name)),
    [schools, formData.city]
  );

  // Languages offered by the chosen school (set per school by the admin)
  const schoolLanguages = useMemo(
    () => schoolById.get(formData.school)?.languages || [],
    [schoolById, formData.school]
  );

  // If the school offers only one language, pick it automatically; drop a
  // language the newly chosen school doesn't offer.
  useEffect(() => {
    setFormData(prev => {
      if (schoolLanguages.length === 1 && prev.language !== schoolLanguages[0]) return { ...prev, language: schoolLanguages[0] };
      if (prev.language && !schoolLanguages.includes(prev.language)) return { ...prev, language: '' };
      return prev;
    });
  }, [schoolLanguages]);

  // Clear error automatically once the form becomes complete
  useEffect(() => {
    if (payError && isFormComplete) setPayError('');
  }, [isFormComplete, payError]);

  // Preload the Razorpay checkout script in the background so the modal opens instantly
  useEffect(() => {
    loadCheckoutScript();
  }, []);

  // ── Startup ───────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const [, me] = await Promise.all([
        loadPublicData(),
        api('/api/auth/me').catch(() => null)   // not signed in → public registration page
      ]);
      if (me?.username) {
        try {
          await enterAdmin(me.username);
        } catch (error) {
          console.error('Error loading admin panel:', error);
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: while the admin panel is open and visible, fetch payments
  // that changed in the last few seconds (cheap on D1 row reads).
  useEffect(() => {
    if (!isAdmin) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadPaymentChanges();
    }, PAYMENTS_REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ── Data Loading ──────────────────────────────────────────────

  const loadPublicData = async () => {
    try {
      const data = await api('/api/public/bootstrap');
      setRazorpayKeyId(data.razorpayKeyId);
      setCities(data.cities);
      setSchools(data.schools);
    } catch (error) {
      console.error('Error loading page data:', error);
      setPayError('Could not load the school list. Please refresh the page.');
    }
  };

  const enterAdmin = async (username) => {
    const data = await api('/api/admin/bootstrap');
    setAdminUser(username);
    setCities(data.cities);
    setSchools(data.schools);
    setAdmins(data.admins);
    setOthersSheetId(data.othersSheetId);
    setIsAdmin(true);
    paymentsCursor.current = { since: '', afterId: '' };
    setPayments([]);
    loadPaymentChanges();
  };

  const leaveAdmin = () => {
    setIsAdmin(false);
    setAdminUser('');
    setPayments([]);
    paymentsCursor.current = { since: '', afterId: '' };
  };

  // Admin request; if the session has ended, go back to the public page.
  const adminApi = async (path, options) => {
    try {
      return await api(path, options);
    } catch (err) {
      if (err.status === 401) {
        leaveAdmin();
        setLoginError('Your session has ended. Please sign in again.');
        setShowLoginModal(true);
      }
      throw err;
    }
  };

  // Loads payments changed since the last check (all of them the first time),
  // page by page, and merges them into the list by ID.
  const loadPaymentChanges = async () => {
    if (paymentsLoading.current) return;
    paymentsLoading.current = true;
    try {
      // Start a few seconds early so nothing written at the same moment is missed
      let since = paymentsCursor.current.since ? secondsBefore(paymentsCursor.current.since, 5) : '';
      let afterId = since ? '' : paymentsCursor.current.afterId;
      const changed = [];
      for (;;) {
        const qs = new URLSearchParams({ since, afterId, limit: '500' });
        const data = await adminApi(`/api/admin/payments?${qs}`);
        changed.push(...data.payments);
        if (!data.next) break;
        ({ since, afterId } = data.next);
      }
      if (changed.length) {
        const newest = changed.reduce((a, p) => (p.updated_at > a.updated_at ? p : a));
        if (newest.updated_at > paymentsCursor.current.since) {
          paymentsCursor.current = { since: newest.updated_at, afterId: newest.id };
        }
        setPayments(prev => {
          const byId = new Map(prev.map(p => [p.id, p]));
          changed.forEach(p => byId.set(p.id, p));
          return [...byId.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
        });
      }
    } catch (error) {
      console.error('Error loading payments:', error);
    } finally {
      paymentsLoading.current = false;
    }
  };

  // ── Admin CRUD ────────────────────────────────────────────────

  const addAdmin = async () => {
    const username = newAdminUsername.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      alert('Username must be 3–30 characters: letters, numbers, dot, dash or underscore');
      return;
    }
    if (admins.some(a => a.username === username)) { alert('This username is already an admin'); return; }
    if (newAdminPassword.length < 10) { alert('Password must be at least 10 characters'); return; }

    try {
      const data = await adminApi('/api/admin/admins', { method: 'POST', body: { username, password: newAdminPassword } });
      setAdmins([...admins, data].sort((a, b) => (a.main ? -1 : b.main ? 1 : a.username.localeCompare(b.username))));
      setNewAdminUsername('');
      setNewAdminPassword('');
      alert(`Admin "${username}" added. Share the password with them privately.`);
    } catch (error) {
      console.error('Error adding admin:', error);
      alert(`Error adding admin: ${error.message}`);
    }
  };

  const removeAdmin = async (adminRecord) => {
    if (adminRecord.main) return;
    if (adminRecord.username === adminUser) { alert("You can't remove yourself."); return; }
    if (!confirm(`Remove ${adminRecord.username} as admin?`)) return;

    try {
      await adminApi(`/api/admin/admins/${adminRecord.id}`, { method: 'DELETE' });
      setAdmins(admins.filter(a => a.id !== adminRecord.id));
    } catch (error) {
      console.error('Error removing admin:', error);
      alert(`Error removing admin: ${error.message}`);
    }
  };

  // ── School CRUD ───────────────────────────────────────────────

  const addSchoolToDb = async () => {
    if (!newSchool.name || !newSchool.city || !newSchool.devotee) {
      alert('Please fill in the school name, city and devotee name');
      return;
    }
    if (!newSchool.languages.length) { alert('Choose at least one language for the school'); return; }

    try {
      const data = await adminApi('/api/admin/schools', {
        method: 'POST',
        body: {
          name: newSchool.name.trim(), city: newSchool.city.trim(), devotee: newSchool.devotee.trim(),
          juniorLink: newSchool.juniorLink.trim(), seniorLink: newSchool.seniorLink.trim(),
          languages: newSchool.languages
        }
      });
      setSchools([...schools, data]);
      setNewSchool(EMPTY_SCHOOL);
      setShowAddSchool(false);
      alert('School added successfully!');
      createSchoolSheet(data);
    } catch (error) {
      console.error('Error adding school:', error);
      alert(`Error adding school: ${error.message}`);
    }
  };

  const updateSchoolInDb = async (id) => {
    try {
      const data = await adminApi(`/api/admin/schools/${id}`, {
        method: 'PUT',
        body: {
          name: editingSchool.name, city: editingSchool.city, devotee: editingSchool.devotee,
          juniorLink: (editingSchool.junior_link || '').trim(), seniorLink: (editingSchool.senior_link || '').trim(),
          languages: editingSchool.languages
        }
      });
      setSchools(schools.map(s => s.id === id ? { ...s, ...data } : s));
      setEditingSchool(null);
      alert('School updated successfully!');
    } catch (error) {
      console.error('Error updating school:', error);
      alert(`Error updating school: ${error.message}`);
    }
  };

  const deleteSchoolFromDb = async (id) => {
    if (!confirm('Are you sure you want to delete this school?')) return;

    try {
      await adminApi(`/api/admin/schools/${id}`, { method: 'DELETE' });
      setSchools(schools.filter(s => s.id !== id));
      alert('School deleted successfully!');
    } catch (error) {
      console.error('Error deleting school:', error);
      alert(`Error deleting school: ${error.message}`);
    }
  };

  // ── Google Sheets ─────────────────────────────────────────────

  const sheetsApi = (action, body) =>
    adminApi(`/api/admin/sheets/${action}`, { method: 'POST', body, timeout: SHEETS_TIMEOUT_MS });

  const createSchoolSheet = async (school) => {
    setSheetLoading(prev => ({ ...prev, [school.id]: 'create' }));
    try {
      const data = await sheetsApi('create', { schoolId: school.id });
      setSchools(prev => prev.map(s => s.id === school.id ? { ...s, sheet_id: data.sheetId } : s));
      if (data.warnings?.length) alert(`Sheet for "${school.name}" was created, but:\n\n${data.warnings.join('\n')}`);
    } catch (err) {
      console.error('Create sheet failed:', err);
      alert(`Could not create Google Sheet for "${school.name}": ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, [school.id]: null }));
    }
  };

  const createOthersSheet = async () => {
    setSheetLoading(prev => ({ ...prev, others: 'create' }));
    try {
      const data = await sheetsApi('create', { type: 'others' });
      setOthersSheetId(data.sheetId);
      alert(data.warnings?.length
        ? `Others Sheet was created, but:\n\n${data.warnings.join('\n')}`
        : 'Others Sheet created and shared with your Gmail!');
    } catch (err) {
      console.error('Create others sheet failed:', err);
      alert(`Could not create Others Sheet: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, others: null }));
    }
  };

  const syncSheetPush = async (school) => {
    setSheetLoading(prev => ({ ...prev, [school.id]: 'push' }));
    try {
      const data = await sheetsApi('push', { schoolId: school.id });
      alert(`Added ${data.added} new payment(s) to Google Sheet (${data.total} captured in total).`);
    } catch (err) {
      console.error('Sync push failed:', err);
      alert(`Export failed: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, [school.id]: null }));
    }
  };

  const syncOthersSheetPush = async () => {
    setSheetLoading(prev => ({ ...prev, others: 'push' }));
    try {
      const data = await sheetsApi('push', { type: 'others' });
      alert(`Added ${data.added} new payment(s) to Others Sheet (${data.total} captured in total).`);
    } catch (err) {
      console.error('Sync push others failed:', err);
      alert(`Export failed: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, others: null }));
    }
  };

  const syncSheetPull = async (school) => {
    if (!confirm('This will overwrite Book Given values in the portal with values from the Google Sheet. Continue?')) return;
    setSheetLoading(prev => ({ ...prev, [school.id]: 'pull' }));
    try {
      const data = await sheetsApi('pull', { schoolId: school.id });
      alert(`Synced Book Given for ${data.updated} record(s) from Google Sheet.`);
      loadPaymentChanges();
    } catch (err) {
      console.error('Sync pull failed:', err);
      alert(`Sync failed: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, [school.id]: null }));
    }
  };

  const syncOthersSheetPull = async () => {
    if (!confirm('This will overwrite Book Given values in the portal with values from the Others Sheet. Continue?')) return;
    setSheetLoading(prev => ({ ...prev, others: 'pull' }));
    try {
      const data = await sheetsApi('pull', { type: 'others' });
      alert(`Synced Book Given for ${data.updated} record(s) from Others Sheet.`);
      loadPaymentChanges();
    } catch (err) {
      console.error('Sync pull others failed:', err);
      alert(`Sync failed: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, others: null }));
    }
  };

  // Runs one sheet action for every school sheet and the Others sheet.
  const runOnAllSheets = async (action, countKey) => {
    const targets = [
      ...schools.filter(s => s.sheet_id).map(s => ({ body: { schoolId: s.id }, label: s.name })),
      ...(othersSheetId ? [{ body: { type: 'others' }, label: 'Others' }] : [])
    ];
    let total = 0;
    const failures = [];
    for (const t of targets) {
      try {
        const data = await sheetsApi(action, t.body);
        total += data[countKey] || 0;
      } catch (err) {
        console.error(`Bulk ${action} failed for ${t.label}:`, err);
        failures.push(`${t.label}: ${err.message}`);
      }
    }
    return { total, failures, count: targets.length };
  };

  const sheetTargetCount = () => schools.filter(s => s.sheet_id).length + (othersSheetId ? 1 : 0);

  const bulkExportSheets = async () => {
    const targets = sheetTargetCount();
    if (targets === 0) { alert('No sheets found. Create school sheets (and the Others sheet) first.'); return; }
    if (!confirm(`Export captured payments to all ${targets} sheet(s)? New records are appended to each.`)) return;

    setSheetLoading(prev => ({ ...prev, bulk: 'push' }));
    try {
      const { total, failures, count } = await runOnAllSheets('push', 'added');
      let msg = `Bulk export complete. Added ${total} new record(s) across ${count} sheet(s).`;
      if (failures.length) msg += `\n\nFailed for:\n${failures.join('\n')}`;
      alert(msg);
    } finally {
      setSheetLoading(prev => ({ ...prev, bulk: null }));
    }
  };

  const bulkPullSheets = async () => {
    const targets = sheetTargetCount();
    if (targets === 0) { alert('No sheets found. Create school sheets (and the Others sheet) first.'); return; }
    if (!confirm(`Sync Book Given from all ${targets} sheet(s) into the portal? Portal values are overwritten with sheet values.`)) return;

    setSheetLoading(prev => ({ ...prev, bulk: 'pull' }));
    try {
      const { total, failures, count } = await runOnAllSheets('pull', 'updated');
      loadPaymentChanges();
      let msg = `Bulk sync complete. Updated Book Given for ${total} record(s) across ${count} sheet(s).`;
      if (failures.length) msg += `\n\nFailed for:\n${failures.join('\n')}`;
      alert(msg);
    } finally {
      setSheetLoading(prev => ({ ...prev, bulk: null }));
    }
  };

  const makeAllSheetsPublic = async () => {
    if (!confirm('Make all existing Google Sheets publicly viewable (anyone with the link)? This cannot be undone.')) return;
    setSheetLoading(prev => ({ ...prev, makePublic: true }));
    try {
      const data = await sheetsApi('make-public');
      let msg = `Done! ${data.succeeded} of ${data.total} sheet(s) are now public.`;
      if (data.failed) msg += `\n\n${data.failed} failed:\n${(data.failures || []).join('\n')}`;
      alert(msg);
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, makePublic: false }));
    }
  };

  const updateBookGiven = async (payment, value) => {
    try {
      await adminApi(`/api/admin/payments/${payment.id}/book-given`, { method: 'PUT', body: { value } });
      setPayments(prev => prev.map(p => p.id === payment.id ? { ...p, book_given: value } : p));
    } catch (error) {
      console.error('Error updating book status:', error);
      alert(`Error updating book status: ${error.message}`);
    }
  };

  // ── City CRUD ─────────────────────────────────────────────────

  const addCityToDb = async () => {
    if (!newCity.trim()) { alert('Please enter a city name'); return; }

    const cityName = newCity.trim();
    if (cities.some(c => c.name === cityName)) { alert('City already exists'); return; }

    try {
      const data = await adminApi('/api/admin/cities', { method: 'POST', body: { name: cityName } });
      setCities([...cities, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCity('');
      setShowAddCity(false);
      alert('City added successfully!');
    } catch (error) {
      console.error('Error adding city:', error);
      alert(`Error adding city: ${error.message}`);
    }
  };

  const updateCityInDb = async (cityId, oldCityName, newCityName) => {
    if (!newCityName.trim()) { alert('Please enter a city name'); return; }

    const trimmedNewName = newCityName.trim();
    if (trimmedNewName === oldCityName) { setEditingCity(null); return; }
    if (cities.some(c => c.name === trimmedNewName)) { alert('City already exists'); return; }

    try {
      // The server also renames the city on its schools
      await adminApi(`/api/admin/cities/${cityId}`, { method: 'PUT', body: { name: trimmedNewName } });
      setCities(cities.map(c => c.id === cityId ? { ...c, name: trimmedNewName } : c).sort((a, b) => a.name.localeCompare(b.name)));
      setSchools(schools.map(s => s.city === oldCityName ? { ...s, city: trimmedNewName } : s));
      setEditingCity(null);
      setEditingCityValue('');
      alert('City updated successfully!');
    } catch (error) {
      console.error('Error updating city:', error);
      alert(`Error updating city: ${error.message}`);
    }
  };

  const deleteCityFromDb = async (city) => {
    const used = schools.filter(s => s.city === city.name).length;
    if (used > 0) {
      alert(`Cannot delete city. ${used} school(s) are using this city.`);
      return;
    }
    if (!confirm(`Are you sure you want to delete "${city.name}"?`)) return;

    try {
      await adminApi(`/api/admin/cities/${city.id}`, { method: 'DELETE' });
      setCities(cities.filter(c => c.id !== city.id));
      alert('City deleted successfully!');
    } catch (error) {
      console.error('Error deleting city:', error);
      alert(`Error deleting city: ${error.message}`);
    }
  };

  // ── Registration + Payment ────────────────────────────────────

  // Everything the server needs to create the registration. The server
  // re-checks all of it and looks up the school by ID itself.
  const buildRegistrationPayload = () => ({
    name: formData.name.trim(),
    schoolId: formData.school,
    class: formData.class,
    section: formData.section.trim(),
    language: formData.language,
    mobile: normalizeIndianMobile(formData.mobile) || formData.mobile.trim()
  });

  // After Razorpay reports success: fetch the WhatsApp group for this child.
  // The server only returns it for a verified payment.
  const showWhatsappGroup = async (response) => {
    if (paymentShown.current) return;   // the Razorpay window and our own check can both report success
    paymentShown.current = true;
    stopPaymentWatch();
    setPaymentDone(true);
    setWhatsapp({ status: 'loading', group: null, link: null });
    try {
      const data = await api('/api/registration/whatsapp', {
        method: 'POST',
        body: {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature
        }
      });
      setWhatsapp({ status: 'ready', group: data.group, link: data.link || null });
    } catch (err) {
      console.error('Could not load WhatsApp group:', err);
      setWhatsapp({ status: 'ready', group: null, link: null });
    }
  };

  const handlePayClick = async () => {
    if (formData.mobile.trim() && !normalizeIndianMobile(formData.mobile)) {
      setMobileTouched(true);
      setPayError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!isFormComplete) {
      setPayError('Please fill in all the details before proceeding.');
      return;
    }
    setPayError('');
    setIsSubmitting(true);

    const payload = buildRegistrationPayload();
    const signature = JSON.stringify(payload);

    // Reuse the saved registration if nothing changed; otherwise save a new
    // one so corrected details are what gets recorded.
    let registration = lastRegistration?.signature === signature ? lastRegistration : null;

    if (!registration) {
      try {
        const data = await api('/api/register', { method: 'POST', body: payload });
        registration = { signature, orderId: data.orderId, mobile: data.mobile };
        setLastRegistration(registration);
      } catch (err) {
        setPayError(err.message || 'Could not start payment. Please check your connection and try again.');
        setIsSubmitting(false);
        return;
      }
    }

    // Script is preloaded on mount; on a slow connection this awaits the same in-flight load
    const scriptLoaded = await loadCheckoutScript();
    if (!scriptLoaded) {
      setPayError('Payment could not load. Please check your connection and try again.');
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);

    const rzp = new window.Razorpay({
      key: razorpayKeyId,
      order_id: registration.orderId,
      amount: PAYMENT_AMOUNT * 100,
      currency: 'INR',
      name: CONTEST_NAME,
      description: `Student Registration · ₹${PAYMENT_AMOUNT}`,
      image: `${window.location.origin}/vec_logo.png`,
      prefill: { name: payload.name, contact: registration.mobile },
      theme: { color: '#ea580c' },
      handler: showWhatsappGroup,
      modal: { ondismiss: () => {} }
    });
    rzp.open();
    watchPayment(rzp, registration.orderId);
  };

  const stopPaymentWatch = () => {
    if (paymentWatch.current) clearInterval(paymentWatch.current);
    paymentWatch.current = null;
  };

  // Backup for when the Razorpay window doesn't notice a payment (e.g. paid by
  // scanning the UPI QR code with another phone): ask our server every few
  // seconds whether the Razorpay webhook has marked this order as paid. If so,
  // close the Razorpay window and show the success / WhatsApp popup. Keeps
  // checking for 15 minutes, even if the window was closed.
  const watchPayment = (rzp, orderId) => {
    stopPaymentWatch();
    const startedAt = Date.now();
    paymentWatch.current = setInterval(async () => {
      if (paymentShown.current || Date.now() - startedAt > 15 * 60 * 1000) { stopPaymentWatch(); return; }
      try {
        const { status } = await api(`/api/registration/status?orderId=${encodeURIComponent(orderId)}`);
        if (status === 'captured') {
          try { rzp.close(); } catch { /* window may already be closed */ }
          showWhatsappGroup({ razorpay_order_id: orderId });
        }
      } catch {
        // network hiccup — try again on the next tick
      }
    }, 4000);
  };

  // ── Auth ──────────────────────────────────────────────────────

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) { setLoginError('Please enter your username and password.'); return; }
    setLoginBusy(true);
    setLoginError('');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { username: loginUsername, password: loginPassword } });
      await enterAdmin(data.username);
      setShowLoginModal(false);
      setLoginUsername('');
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginPassword('');
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Error signing out:', error);
    }
    leaveAdmin();
    loadPublicData();
  };

  // ── Helpers ───────────────────────────────────────────────────

  // English / Telugu checkboxes for a school's languages
  const languageCheckboxes = (selected, onChange) => (
    <div className="flex flex-wrap items-center gap-4">
      <span className="text-xs font-semibold text-gray-500">Languages offered:</span>
      {LANGUAGES.map(lang => (
        <label key={lang} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-orange-600" checked={selected.includes(lang)}
            onChange={(e) => onChange(e.target.checked
              ? LANGUAGES.filter(l => l === lang || selected.includes(l))
              : selected.filter(l => l !== lang))} />
          {lang}
        </label>
      ))}
    </div>
  );

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'city' ? { school: '' } : {})   // new area → choose the school again
    }));
  };

  const getReferredBy = () => schoolById.get(formData.school)?.devotee || '';

  const getFilteredPayments = () => {
    let filtered = [...payments];
    if (selectedCityFilter) filtered = filtered.filter(p => cityOf(p) === selectedCityFilter);
    if (selectedSchoolFilter) filtered = filtered.filter(p => schoolNameOf(p) === selectedSchoolFilter);
    return filtered;
  };

  const getCapturedPayments = () => {
    const term = capturedSearch.trim().toLowerCase();
    let list = getFilteredPayments().filter(p => p.status === 'captured');
    if (term) {
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(term) ||
        (p.mobile || '').toLowerCase().includes(term)
      );
    }
    if (selectedBookFilter === 'given') list = list.filter(p => p.book_given);
    if (selectedBookFilter === 'notgiven') list = list.filter(p => !p.book_given);
    return list;
  };
  const getNonCapturedPayments = () => getFilteredPayments().filter(p => p.status !== 'captured');

  const getUniqueCitiesFromPayments = () =>
    [...new Set(payments.map(cityOf).filter(Boolean))].sort();

  const getUniqueSchoolsFromPayments = () => {
    const base = selectedCityFilter ? payments.filter(p => cityOf(p) === selectedCityFilter) : payments;
    return [...new Set(base.map(schoolNameOf).filter(Boolean))].sort();
  };

  const exportToCSV = () => {
    const filteredPayments = getFilteredPayments();
    if (filteredPayments.length === 0) { alert('No payments to export with the current filters.'); return; }

    const headers = ['Name', 'City/Area', 'School', 'Class', 'Section', 'Language', 'Mobile', 'Referred By', 'Amount', 'Payment ID', 'Date', 'Status', 'Book Given'];
    const rows = filteredPayments.map(p => [
      csvCell(p.name), csvCell(cityOf(p)), csvCell(schoolNameOf(p)), csvCell(p.class), csvCell(p.section),
      csvCell(p.language), csvTextCell(p.mobile), csvCell(p.referred_by), csvCell(p.amount), csvCell(p.payment_id),
      csvCell(new Date(p.timestamp).toLocaleString()), csvCell(p.status), csvCell(p.book_given ? 'Yes' : 'No')
    ]);

    // BOM so Excel reads Telugu names as UTF-8; CRLF line endings for Excel
    const csvContent = '﻿' + [headers.map(csvCell).join(','), ...rows.map(row => row.join(','))].join('\r\n');

    let filename = `vec_payments_${new Date().toISOString().split('T')[0]}`;
    if (selectedCityFilter) filename += `_${selectedCityFilter.replace(/\s+/g, '_')}`;
    if (selectedSchoolFilter) filename += `_${selectedSchoolFilter.replace(/\s+/g, '_').substring(0, 20)}`;
    filename += '.csv';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    window.URL.revokeObjectURL(url);
  };

  // ── Loading ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #1c0a00 0%, #7c2d12 40%, #991b1b 75%, #c2410c 100%)' }}>
        <div className="text-center">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse p-3 shadow-lg">
            <img src="/vec_logo.png" alt="VEC 2027 logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex gap-2 justify-center mb-4">
            {[0, 150, 300].map(delay => (
              <div key={delay} className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
                style={{ animationDelay: `${delay}ms` }} />
            ))}
          </div>
          <p className="text-orange-200 text-sm font-medium">Loading {CONTEST_NAME}…</p>
        </div>
      </div>
    );
  }

  // ── Admin Panel ───────────────────────────────────────────────

  if (isAdmin) {
    return (
      <div className="min-h-screen bg-gray-100">

        {/* Topbar */}
        <div style={{ background: 'linear-gradient(135deg, #ea580c, #dc2626)' }} className="shadow-lg sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1.5 shadow">
                <img src="/vec_logo.png" alt="VEC 2027 logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg leading-none">{CONTEST_NAME} Admin</h1>
                <p className="text-orange-200 text-xs mt-0.5">Signed in as {adminUser}</p>
              </div>
            </div>
            <button onClick={handleLogout}
              className="flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-xl transition-all text-sm font-medium border border-white/20">
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto p-6 space-y-6">

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Total Registrations', value: getCapturedPayments().length, sub: 'All time', color: 'text-gray-900' },
              { label: 'Total Revenue', value: `₹${payments.filter(p => p.status === 'captured').reduce((s, p) => s + (p.amount || 0), 0).toLocaleString()}`, sub: 'Captured payments only', color: 'text-green-600' },
              { label: 'Active Schools', value: schools.length, sub: 'Across all cities', color: 'text-orange-600' },
            ].map(stat => (
              <div key={stat.label} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-sm font-medium">{stat.label}</p>
                <p className={`text-4xl font-bold mt-2 ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* Payments Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Payment Records</h2>
                <p className="text-sm text-gray-400 mt-0.5">{getFilteredPayments().length} of {payments.length} shown</p>
              </div>
              <button onClick={exportToCSV} disabled={getFilteredPayments().length === 0}
                className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                <Download size={16} />
                Export CSV
              </button>
            </div>

            {/* Filters */}
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Filter by City</label>
                  <select value={selectedCityFilter}
                    onChange={(e) => { setSelectedCityFilter(e.target.value); setSelectedSchoolFilter(''); }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-orange-400 outline-none">
                    <option value="">All Cities</option>
                    {getUniqueCitiesFromPayments().map(city => <option key={city} value={city}>{city}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Filter by School</label>
                  <select value={selectedSchoolFilter} onChange={(e) => setSelectedSchoolFilter(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-orange-400 outline-none">
                    <option value="">All Schools</option>
                    {getUniqueSchoolsFromPayments().map(school => <option key={school} value={school}>{school}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Filter by Book (captured)</label>
                  <select value={selectedBookFilter} onChange={(e) => setSelectedBookFilter(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-orange-400 outline-none">
                    <option value="">All</option>
                    <option value="given">Book Given</option>
                    <option value="notgiven">Book Not Given</option>
                  </select>
                </div>
                {(selectedCityFilter || selectedSchoolFilter || selectedBookFilter) && (
                  <button onClick={() => { setSelectedCityFilter(''); setSelectedSchoolFilter(''); setSelectedBookFilter(''); }}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 bg-white border border-gray-200 px-3 py-2 rounded-xl transition-all">
                    <X size={14} /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Captured Payments */}
            <div className="px-6 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => setCapturedExpanded(v => !v)}
                className="flex items-center gap-2 hover:opacity-70 transition-opacity"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <h3 className="text-sm font-bold text-gray-700">Captured Payments</h3>
                <span className="text-xs text-gray-400">({getCapturedPayments().length})</span>
                <ChevronDown size={15} className={`text-gray-400 transition-transform duration-200 ${capturedExpanded ? '' : '-rotate-90'}`} />
              </button>
              {capturedExpanded && (
                <div className="relative min-w-[220px]">
                  <input type="text" placeholder="Search by name or phone…" value={capturedSearch}
                    onChange={(e) => setCapturedSearch(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl pl-3 pr-8 py-2 text-sm bg-white focus:border-orange-400 outline-none" />
                  {capturedSearch && (
                    <button onClick={() => setCapturedSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {capturedExpanded && <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-3 text-left font-semibold">Name</th>
                    <th className="px-6 py-3 text-left font-semibold">Payment ID</th>
                    <th className="px-6 py-3 text-left font-semibold">Date</th>
                    <th className="px-6 py-3 text-left font-semibold">Book</th>
                    <th className="px-6 py-3 text-left font-semibold">School</th>
                    <th className="px-6 py-3 text-left font-semibold">City / Area</th>
                    <th className="px-6 py-3 text-left font-semibold">Class</th>
                    <th className="px-6 py-3 text-left font-semibold">Language</th>
                    <th className="px-6 py-3 text-left font-semibold">Mobile</th>
                    <th className="px-6 py-3 text-left font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {getCapturedPayments().length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-6 py-10 text-center text-gray-400">No captured payments yet</td>
                    </tr>
                  ) : (
                    getCapturedPayments().map(payment => (
                      <tr key={payment.id} className="hover:bg-orange-50/40 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-900">{payment.name}</td>
                        <td className="px-6 py-3 font-mono text-xs text-gray-400">{payment.payment_id}</td>
                        <td className="px-6 py-3 text-gray-500 text-xs">{new Date(payment.timestamp).toLocaleDateString()}</td>
                        <td className="px-6 py-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={!!payment.book_given}
                              onChange={(e) => updateBookGiven(payment, e.target.checked)}
                              className="w-4 h-4 accent-green-600 cursor-pointer" />
                            <span className={`text-xs font-semibold ${payment.book_given ? 'text-green-700' : 'text-gray-400'}`}>
                              {payment.book_given ? 'Given' : 'Not given'}
                            </span>
                          </label>
                        </td>
                        <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{schoolNameOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{cityOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{classOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{payment.language}</td>
                        <td className="px-6 py-3 text-gray-600">{payment.mobile}</td>
                        <td className="px-6 py-3">
                          <span className="bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-lg text-xs">₹{payment.amount}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>}

            {/* Non-Captured Payments */}
            <div
              className="px-6 pt-6 pb-2 flex items-center gap-2 border-t border-gray-100 mt-2 cursor-pointer hover:opacity-70 transition-opacity"
              onClick={() => setNonCapturedExpanded(v => !v)}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <h3 className="text-sm font-bold text-gray-700">Non-Captured Payments</h3>
              <span className="text-xs text-gray-400">({getNonCapturedPayments().length})</span>
              <ChevronDown size={15} className={`text-gray-400 transition-transform duration-200 ${nonCapturedExpanded ? '' : '-rotate-90'}`} />
            </div>
            {nonCapturedExpanded && <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-3 text-left font-semibold">Name</th>
                    <th className="px-6 py-3 text-left font-semibold">School</th>
                    <th className="px-6 py-3 text-left font-semibold">Class</th>
                    <th className="px-6 py-3 text-left font-semibold">Language</th>
                    <th className="px-6 py-3 text-left font-semibold">Mobile</th>
                    <th className="px-6 py-3 text-left font-semibold">Payment</th>
                    <th className="px-6 py-3 text-left font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {getNonCapturedPayments().length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-gray-400">No pending or failed payments</td>
                    </tr>
                  ) : (
                    getNonCapturedPayments().map(payment => (
                      <tr key={payment.id} className="hover:bg-orange-50/40 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-900">{payment.name}</td>
                        <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{schoolNameOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{classOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{payment.language}</td>
                        <td className="px-6 py-3 text-gray-600">{payment.mobile}</td>
                        <td className="px-6 py-3">
                          <span className={`font-semibold px-2 py-0.5 rounded-lg text-xs ${payment.status === 'failed'
                            ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {payment.status === 'failed' ? 'Failed' : 'Pending'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-500 text-xs">{new Date(payment.timestamp).toLocaleDateString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>}
          </div>

          {/* City Management */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">City Management</h2>
                <p className="text-sm text-gray-400 mt-0.5">{cities.length} cities</p>
              </div>
              <button onClick={() => setShowAddCity(!showAddCity)}
                className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                <Plus size={16} />
                Add City
              </button>
            </div>

            <div className="px-6 py-5">
              {showAddCity && (
                <div className="flex gap-2 mb-5 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <input type="text" placeholder="Enter city name" value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addCityToDb()}
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:border-orange-400 outline-none" />
                  <button onClick={addCityToDb}
                    className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <Save size={15} /> Save
                  </button>
                  <button onClick={() => { setShowAddCity(false); setNewCity(''); }}
                    className="flex items-center gap-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <X size={15} /> Cancel
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {cities.map(city => (
                  <div key={city.id} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 rounded-xl px-3 py-2 transition-colors">
                    {editingCity?.id === city.id ? (
                      <div className="flex items-center gap-2">
                        <input type="text" value={editingCityValue} onChange={(e) => setEditingCityValue(e.target.value)}
                          onKeyPress={(e) => { if (e.key === 'Enter') updateCityInDb(editingCity.id, editingCity.name, editingCityValue); }}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-28 focus:border-orange-400 outline-none" autoFocus />
                        <button onClick={() => updateCityInDb(editingCity.id, editingCity.name, editingCityValue)}
                          className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                          <Save size={13} />
                        </button>
                        <button onClick={() => { setEditingCity(null); setEditingCityValue(''); }}
                          className="p-1.5 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-gray-700">{city.name}</span>
                        <button onClick={() => { setEditingCity(city); setEditingCityValue(city.name); }}
                          className="p-1 text-blue-500 hover:text-blue-700 transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => deleteCityFromDb(city)}
                          className="p-1 text-red-400 hover:text-red-600 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Schools Management */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Schools Management</h2>
                <p className="text-sm text-gray-400 mt-0.5">{schools.length} schools</p>
                {schools.some(s => !s.junior_link || !s.senior_link) && (
                  <p className="text-xs text-amber-700 mt-1 font-medium">
                    {schools.filter(s => !s.junior_link || !s.senior_link).length} school(s) are missing a WhatsApp link — those students won't see a group after paying
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={bulkExportSheets} disabled={!!sheetLoading['bulk']}
                  title="Export captured payments to every school sheet and the Others sheet"
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                  {sheetLoading['bulk'] === 'push' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                  Export All to Sheets
                </button>
                <button onClick={bulkPullSheets} disabled={!!sheetLoading['bulk']}
                  title="Sync Book Given from every school sheet and the Others sheet into the portal"
                  className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                  {sheetLoading['bulk'] === 'pull' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Sync All from Sheets
                </button>
                <button onClick={makeAllSheetsPublic} disabled={!!sheetLoading['makePublic']}
                  title="Make all existing Google Sheets publicly viewable by anyone with the link"
                  className="flex items-center gap-2 bg-violet-500 hover:bg-violet-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                  {sheetLoading['makePublic'] ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                  Make All Sheets Public
                </button>
                <button onClick={() => setShowAddSchool(!showAddSchool)}
                  className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                  <Plus size={16} />
                  Add School
                </button>
              </div>
            </div>

            {showAddSchool && (
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Add New School</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input type="text" placeholder="School Name" value={newSchool.name}
                    onChange={(e) => setNewSchool(prev => ({ ...prev, name: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white" />
                  <select value={newSchool.city} onChange={(e) => setNewSchool(prev => ({ ...prev, city: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white">
                    <option value="">Select City</option>
                    {cities.map(city => <option key={city.id} value={city.name}>{city.name}</option>)}
                  </select>
                  <input type="text" placeholder="Devotee Name" value={newSchool.devotee}
                    onChange={(e) => setNewSchool(prev => ({ ...prev, devotee: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <input type="url" placeholder={`Junior WhatsApp link (1st–${JUNIOR_UP_TO})`} value={newSchool.juniorLink}
                    onChange={(e) => setNewSchool(prev => ({ ...prev, juniorLink: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white" />
                  <input type="url" placeholder="Senior WhatsApp link (8th and above)" value={newSchool.seniorLink}
                    onChange={(e) => setNewSchool(prev => ({ ...prev, seniorLink: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white" />
                </div>
                <div className="mt-4">
                  {languageCheckboxes(newSchool.languages, (languages) => setNewSchool(prev => ({ ...prev, languages })))}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={addSchoolToDb}
                    className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <Save size={15} /> Save School
                  </button>
                  <button onClick={() => { setShowAddSchool(false); setNewSchool(EMPTY_SCHOOL); }}
                    className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <X size={15} /> Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-gray-50">
              {schools.map(school => (
                <div key={school.id} className="px-6 py-4">
                  {editingSchool?.id === school.id ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <input type="text" value={editingSchool.name}
                        onChange={(e) => setEditingSchool(prev => ({ ...prev, name: e.target.value }))}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none" />
                      <select value={editingSchool.city}
                        onChange={(e) => setEditingSchool(prev => ({ ...prev, city: e.target.value }))}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none">
                        {cities.map(city => <option key={city.id} value={city.name}>{city.name}</option>)}
                      </select>
                      <input type="text" value={editingSchool.devotee}
                        onChange={(e) => setEditingSchool(prev => ({ ...prev, devotee: e.target.value }))}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none" />
                      <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="text-xs font-semibold text-gray-500">
                          Junior WhatsApp link (1st–{JUNIOR_UP_TO})
                          <input type="url" placeholder="https://chat.whatsapp.com/…" value={editingSchool.junior_link || ''}
                            onChange={(e) => setEditingSchool(prev => ({ ...prev, junior_link: e.target.value }))}
                            className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-normal focus:border-orange-400 outline-none" />
                        </label>
                        <label className="text-xs font-semibold text-gray-500">
                          Senior WhatsApp link (8th and above)
                          <input type="url" placeholder="https://chat.whatsapp.com/…" value={editingSchool.senior_link || ''}
                            onChange={(e) => setEditingSchool(prev => ({ ...prev, senior_link: e.target.value }))}
                            className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-normal focus:border-orange-400 outline-none" />
                        </label>
                      </div>
                      <div className="md:col-span-3">
                        {languageCheckboxes(editingSchool.languages || [], (languages) => setEditingSchool(prev => ({ ...prev, languages })))}
                      </div>
                      <div className="flex gap-2 md:col-span-3">
                        <button onClick={() => updateSchoolInDb(school.id)}
                          className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                          <Save size={15} /> Save
                        </button>
                        <button onClick={() => setEditingSchool(null)}
                          className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                          <X size={15} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-900 truncate">{school.name}</h3>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                            <span className="text-xs text-gray-400">{school.city}</span>
                            <span className="text-xs text-gray-400">by {school.devotee}</span>
                            <span className="text-xs text-gray-400">{(school.languages || []).join(' & ')}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {[['Junior', school.junior_link], ['Senior', school.senior_link]].map(([label, link]) => link ? (
                              <a key={label} href={link} target="_blank" rel="noreferrer"
                                className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-lg hover:bg-green-100">
                                ✓ {label} WhatsApp
                              </a>
                            ) : (
                              <button key={label} onClick={() => setEditingSchool(school)}
                                className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg hover:bg-amber-100">
                                {label} WhatsApp link not set
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => setEditingSchool(school)}
                            className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl transition-colors">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => deleteSchoolFromDb(school.id)}
                            className="p-2 bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {school.sheet_id ? (
                          <>
                            <a href={`https://docs.google.com/spreadsheets/d/${school.sheet_id}/edit`} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg border border-green-200 transition-all font-medium">
                              <ExternalLink size={12} /> Open Sheet
                            </a>
                            <button onClick={() => syncSheetPush(school)} disabled={!!sheetLoading[school.id]}
                              className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-3 py-1.5 rounded-lg font-semibold transition-all">
                              {sheetLoading[school.id] === 'push' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                              Export to GSheet
                            </button>
                            <button onClick={() => syncSheetPull(school)} disabled={!!sheetLoading[school.id]}
                              className="flex items-center gap-1.5 text-xs bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-3 py-1.5 rounded-lg font-semibold transition-all">
                              {sheetLoading[school.id] === 'pull' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              Sync from Sheet
                            </button>
                          </>
                        ) : (
                          <button onClick={() => createSchoolSheet(school)} disabled={sheetLoading[school.id] === 'create'}
                            className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 disabled:text-gray-400 text-gray-600 px-3 py-1.5 rounded-lg font-semibold transition-all">
                            {sheetLoading[school.id] === 'create' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                            Create Google Sheet
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Others Sheet */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Others Sheet</h2>
                <p className="text-sm text-gray-400 mt-0.5">Google Sheet for students whose school was later deleted from the list above</p>
              </div>
              {othersSheetId && (
                <a href={`https://docs.google.com/spreadsheets/d/${othersSheetId}/edit`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-green-700 bg-green-50 hover:bg-green-100 px-3 py-2 rounded-xl border border-green-200 transition-all font-medium">
                  <ExternalLink size={14} /> Open Sheet
                </a>
              )}
            </div>
            <div className="px-6 py-5 flex flex-wrap gap-3">
              {!othersSheetId ? (
                <button onClick={createOthersSheet} disabled={sheetLoading['others'] === 'create'}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                  {sheetLoading['others'] === 'create' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
                  Create Others Sheet
                </button>
              ) : (
                <>
                  <button onClick={syncOthersSheetPush} disabled={!!sheetLoading['others']}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    {sheetLoading['others'] === 'push' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
                    Export to GSheet
                  </button>
                  <button onClick={syncOthersSheetPull} disabled={!!sheetLoading['others']}
                    className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    {sheetLoading['others'] === 'pull' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    Sync from Sheet
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Admin Management */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Admin Management</h2>
                <p className="text-sm text-gray-400 mt-0.5">{admins.length} admin{admins.length !== 1 ? 's' : ''} · changes take effect immediately</p>
              </div>
            </div>

            <div className="px-6 py-5">
              {/* Add new admin */}
              <div className="flex flex-wrap gap-2 mb-5">
                <input
                  type="text"
                  placeholder="New admin username"
                  autoComplete="off"
                  value={newAdminUsername}
                  onChange={(e) => setNewAdminUsername(e.target.value)}
                  className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none"
                />
                <input
                  type="password"
                  placeholder="Password (min 10 characters)"
                  autoComplete="new-password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addAdmin()}
                  className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none"
                />
                <button onClick={addAdmin}
                  className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap">
                  <Plus size={15} /> Add Admin
                </button>
              </div>

              {/* Admin list */}
              <div className="space-y-2">
                {admins.map(admin => (
                  <div key={admin.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                        <span className="text-orange-600 text-xs font-bold uppercase">{admin.username[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{admin.username}</p>
                        <p className="text-xs font-medium">
                          {admin.main && <span className="text-gray-400">Main admin (password set in Cloudflare)</span>}
                          {admin.main && admin.username === adminUser && <span className="text-gray-300"> · </span>}
                          {admin.username === adminUser && <span className="text-orange-500">You</span>}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeAdmin(admin)}
                      disabled={admin.main || admin.username === adminUser}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={admin.main ? 'The main admin is set in Cloudflare' : admin.username === adminUser ? "Can't remove yourself" : 'Remove admin'}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── Student Registration Form ─────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1c0a00 0%, #7c2d12 35%, #991b1b 70%, #c2410c 100%)' }}>

      {/* Logo watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <img src="/vec_logo.png" alt="" style={{ width: '55vw', maxWidth: '500px', opacity: 0.06 }} />
      </div>

      {/* Glow blobs */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full pointer-events-none blur-3xl opacity-25"
        style={{ background: 'radial-gradient(circle, #f97316, transparent)', transform: 'translate(40%, -40%)' }} />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full pointer-events-none blur-3xl opacity-20"
        style={{ background: 'radial-gradient(circle, #ef4444, transparent)', transform: 'translate(-40%, 40%)' }} />

      {/* Admin button */}
      <div className="absolute top-5 right-5 z-20">
        <button onClick={() => setShowLoginModal(true)}
          className="flex items-center gap-2 bg-white/10 backdrop-blur-md text-white/90 border border-white/20 px-4 py-2 rounded-full hover:bg-white/20 transition-all text-sm font-medium">
          <User size={15} />
          Admin
        </button>
      </div>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl card-enter">
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <User size={24} className="text-orange-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Admin Portal</h2>
              <p className="text-gray-400 text-sm mt-1">Sign in to manage the contest</p>
            </div>
            {loginError && (
              <p className="text-red-600 text-sm text-center font-medium bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4">{loginError}</p>
            )}
            <form onSubmit={handleLogin} className="space-y-3 mb-3">
              <input type="text" placeholder="Username" autoComplete="username" autoCapitalize="none" autoFocus
                value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
              <input type="password" placeholder="Password" autoComplete="current-password"
                value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
              <button type="submit" disabled={loginBusy}
                className="w-full flex items-center justify-center gap-2 text-white px-4 py-3.5 rounded-2xl transition-all font-semibold disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #ea580c, #dc2626)' }}>
                {loginBusy && <Loader2 className="animate-spin w-4 h-4" />}
                Sign in
              </button>
            </form>
            <button onClick={() => { setShowLoginModal(false); setLoginError(''); setLoginPassword(''); }}
              className="w-full text-gray-400 hover:text-gray-600 py-2 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* WhatsApp group popup (after successful payment) */}
      {whatsapp && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl card-enter text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✅</div>
            <h2 className="text-2xl font-bold text-gray-900">Payment successful!</h2>
            <p className="text-gray-500 text-sm mt-1 mb-6">Your registration is confirmed.</p>
            {whatsapp.status === 'loading' ? (
              <p className="flex items-center justify-center gap-2 text-gray-500 text-sm py-3">
                <Loader2 className="animate-spin w-4 h-4" /> Finding your WhatsApp group…
              </p>
            ) : whatsapp.link ? (
              <>
                <p className="text-gray-700 text-sm mb-4">
                  Join your school's <strong>{whatsapp.group === 'junior' ? 'Junior' : 'Senior'}</strong> WhatsApp group for contest updates:
                </p>
                <a href={whatsapp.link} target="_blank" rel="noreferrer"
                  className="block w-full text-white font-bold py-3.5 rounded-2xl transition-all mb-3"
                  style={{ background: '#25D366' }}>
                  Join WhatsApp Group
                </a>
              </>
            ) : (
              <p className="text-gray-600 text-sm mb-4">Your WhatsApp group details will be shared with you soon.</p>
            )}
            <button onClick={() => setWhatsapp(null)}
              className="w-full text-gray-400 hover:text-gray-600 py-2 text-sm transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Registration Card */}
      <div className="relative z-10 w-full max-w-md card-enter">
        <div className="bg-white rounded-3xl overflow-hidden"
          style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.5)' }}>

          {/* Card Header */}
          <div className="relative px-8 pt-8 pb-10 text-center overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #ea580c 0%, #dc2626 100%)' }}>
            <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
            <div className="absolute -bottom-8 -left-8 w-36 h-36 rounded-full bg-black/10 pointer-events-none" />

            <div className="relative z-10">
              <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg p-2">
                <img src="/vec_logo.png" alt="VEC 2027 logo" className="w-full h-full object-contain" />
              </div>
              <h1 className="text-white text-2xl font-bold mb-1">{CONTEST_NAME}</h1>
              <p className="text-orange-100 text-sm">Student Registration · ₹{PAYMENT_AMOUNT}</p>
            </div>
          </div>

          {/* Form */}
          <div className="px-8 py-8 space-y-5">

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Full Name</label>
              <input type="text" name="name" placeholder="Enter your full name" value={formData.name} onChange={handleInputChange}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400 font-medium" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">City / Area</label>
              <select name="city" value={formData.city} onChange={handleInputChange}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                <option value="">Select your city / area</option>
                {cities.filter(c => schools.some(s => s.city === c.name)).map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">School</label>
              <select name="school" value={formData.school} onChange={handleInputChange} disabled={!formData.city}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <option value="">{formData.city ? 'Select your school' : 'Select your city / area first'}</option>
                {schoolsInCity.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Class</label>
                <select name="class" value={formData.class} onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                  <option value="">Class</option>
                  {classes.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Section <span className="normal-case font-normal text-gray-400">(optional)</span>
                </label>
                <input type="text" name="section" placeholder="e.g. A" maxLength={20} value={formData.section} onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Language</label>
              <select name="language" value={formData.language} onChange={handleInputChange}
                disabled={schoolLanguages.length <= 1}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70">
                {schoolLanguages.length === 0 && <option value="">Select your school first</option>}
                {schoolLanguages.length > 1 && <option value="">Select language</option>}
                {schoolLanguages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Phone Number</label>
              <input type="tel" name="mobile" inputMode="numeric" autoComplete="tel" maxLength={16}
                placeholder="10-digit mobile number" value={formData.mobile} onChange={handleInputChange}
                onBlur={() => setMobileTouched(true)}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400 font-medium" />
              {mobileTouched && formData.mobile.trim() && !normalizeIndianMobile(formData.mobile) && (
                <p className="text-red-500 text-xs mt-1.5 font-medium">Please enter a valid 10-digit mobile number.</p>
              )}
            </div>

            {getReferredBy() && (
              <div className="flex items-center gap-3 bg-orange-50 border-2 border-orange-100 rounded-xl px-4 py-3">
                <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-orange-500 text-sm font-bold">✦</span>
                </div>
                <div>
                  <p className="text-orange-400 text-xs font-semibold uppercase tracking-wider">Referred by</p>
                  <p className="text-orange-800 font-bold text-sm">{getReferredBy()}</p>
                </div>
              </div>
            )}

            {paymentDone ? (
              <div className="mt-2 bg-green-50 border border-green-200 rounded-2xl p-5 text-center space-y-1">
                <p className="text-green-700 font-bold text-base">Payment successful!</p>
                <p className="text-green-600 text-sm">Your registration is confirmed. See you at the contest!</p>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <button
                  onClick={handlePayClick}
                  disabled={isSubmitting}
                  className={`w-full py-4 rounded-2xl font-bold text-white text-lg transition-all ${
                    isFormComplete && !isSubmitting ? 'active:scale-[0.98] cursor-pointer' : 'cursor-not-allowed opacity-60'
                  }`}
                  style={isFormComplete && !isSubmitting
                    ? { background: 'linear-gradient(135deg, #ea580c, #dc2626)', boxShadow: '0 8px 24px rgba(234,88,12,0.4)' }
                    : { background: 'linear-gradient(135deg, #9ca3af, #6b7280)' }
                  }
                >
                  {isSubmitting
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="animate-spin w-5 h-5" />Please wait...</span>
                    : lastRegistration && lastRegistration.signature === JSON.stringify(buildRegistrationPayload()) ? 'Complete Payment' : 'Submit Details'
                  }
                </button>
                {payError && (
                  <p className="text-red-500 text-sm text-center font-medium">{payError}</p>
                )}
              </div>
            )}

            <p className="text-center text-xs text-gray-400 pb-1">🔒 Secured by Razorpay · All payments are final</p>
            <p className="text-center text-xs text-gray-400 pb-1">
              <a href="/privacy" className="underline hover:text-gray-600">Privacy Policy</a>
              {' · '}
              <a href="/terms" className="underline hover:text-gray-600">Terms of Service</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
