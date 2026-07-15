import React, { useState, useEffect, useMemo } from 'react';
import { User, LogOut, Plus, Edit2, Trash2, Save, X, Download, ExternalLink, FileSpreadsheet, RefreshCw, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from './config/supabase';

const PAYMENT_AMOUNT = 30;

const loadCheckoutScript = () => new Promise((resolve) => {
  if (window.Razorpay) { resolve(); return; }
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = resolve;
  document.head.appendChild(s);
});

function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    name: '',
    currentStatus: '',   // 'school' | 'college' | 'working'
    school: '',
    class: '',
    college: '',
    branch: '',
    companyName: '',
    mobile: '',
    language: ''
  });
  const [otherSchoolName, setOtherSchoolName] = useState('');
  const [otherCollegeName, setOtherCollegeName] = useState('');

  const [childParticipates, setChildParticipates] = useState('');
  const [childName, setChildName] = useState('');
  const [childSchool, setChildSchool] = useState('');
  const [childOtherSchoolName, setChildOtherSchoolName] = useState('');
  const [childSection, setChildSection] = useState('');

  // cities is {id, name}[]
  const [cities, setCities] = useState([]);
  const [schools, setSchools] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [classes] = useState(['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']);
  const [payments, setPayments] = useState([]);

  const [editingSchool, setEditingSchool] = useState(null);
  const [showAddSchool, setShowAddSchool] = useState(false);
  const [newSchool, setNewSchool] = useState({ name: '', city: '', devotee: '' });

  const [editingCollege, setEditingCollege] = useState(null);
  const [showAddCollege, setShowAddCollege] = useState(false);
  const [newCollege, setNewCollege] = useState({ name: '', city: '', devotee: '' });

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

  // Admin management
  const [admins, setAdmins] = useState([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');

  // Payment state
  const [registrationSaved, setRegistrationSaved] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const [payError, setPayError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormComplete = useMemo(() => {
    if (!formData.name || !formData.currentStatus || !formData.mobile || !formData.language) return false;
    if (formData.currentStatus === 'school') {
      if (!formData.school) return false;
      if (formData.school === 'Other' && !otherSchoolName.trim()) return false;
      if (!formData.class) return false;
    } else if (formData.currentStatus === 'college') {
      if (!formData.college) return false;
      if (formData.college === 'Other' && !otherCollegeName.trim()) return false;
      if (!formData.branch.trim()) return false;
    } else if (formData.currentStatus === 'working') {
      if (!formData.companyName.trim()) return false;
    }
    if (['working', 'other'].includes(formData.currentStatus) && childParticipates === 'yes') {
      if (!childName.trim()) return false;
      if (!childSchool) return false;
      if (childSchool === 'Other' && !childOtherSchoolName.trim()) return false;
      if (!childSection.trim()) return false;
    }
    return true;
  }, [formData, otherSchoolName, otherCollegeName, childParticipates, childName, childSchool, childOtherSchoolName, childSection]);

  // Clear error automatically once the form becomes complete
  useEffect(() => {
    if (payError && isFormComplete) setPayError('');
  }, [isFormComplete, payError]);

  useEffect(() => {
    loadCities();
    loadSchools();
    loadColleges();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user;
      if (user) {
        const { data: adminRecord } = await supabase
          .from('admins')
          .select('email')
          .eq('email', user.email)
          .maybeSingle();

        if (adminRecord) {
          setIsAdmin(true);
          setAdminEmail(user.email);
          loadPayments();
          loadAdmins();
          loadSettings();
        } else {
          setIsAdmin(false);
          setAdminEmail('');
          supabase.auth.signOut();
        }
      } else {
        setIsAdmin(false);
        setAdminEmail('');
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Live updates: refresh payments whenever the table changes (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel('payments-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        loadPayments();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin]);

  // ── Data Loading ──────────────────────────────────────────────

  const loadCities = async () => {
    try {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      setCities(data || []);
    } catch (error) {
      console.error('Error loading cities:', error);
    }
  };

  const loadSchools = async () => {
    try {
      const { data, error } = await supabase.from('schools').select('*');
      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error loading schools:', error);
      setSchools([{
        id: '1',
        name: 'Damanwada Government School, Daman',
        city: 'Daman',
        devotee: 'Suddha Citta Das',
        languages: ['English', 'Hindi', 'Gujarati']
      }]);
    } finally {
      setLoading(false);
    }
  };

  const loadColleges = async () => {
    try {
      const { data, error } = await supabase.from('colleges').select('*').order('name');
      if (error) throw error;
      setColleges(data || []);
    } catch (error) {
      console.error('Error loading colleges:', error);
    }
  };

  const loadPayments = async () => {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('timestamp', { ascending: false });
      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error('Error loading payments:', error);
    }
  };

  // ── Admin CRUD ────────────────────────────────────────────────

  const loadAdmins = async () => {
    try {
      const { data, error } = await supabase.from('admins').select('*').order('email');
      if (error) throw error;
      setAdmins(data || []);
    } catch (error) {
      console.error('Error loading admins:', error);
    }
  };

  const addAdmin = async () => {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) { alert('Please enter an email address'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Please enter a valid email address'); return; }
    if (admins.some(a => a.email === email)) { alert('This email is already an admin'); return; }

    try {
      const { data, error } = await supabase.from('admins').insert({ email }).select().single();
      if (error) throw error;
      setAdmins([...admins, data].sort((a, b) => a.email.localeCompare(b.email)));
      setNewAdminEmail('');
    } catch (error) {
      console.error('Error adding admin:', error);
      alert(`Error adding admin: ${error.message}`);
    }
  };

  const removeAdmin = async (adminRecord) => {
    if (adminRecord.email === adminEmail) { alert("You can't remove yourself."); return; }
    if (admins.length <= 1) { alert('Cannot remove the last admin.'); return; }
    if (!confirm(`Remove ${adminRecord.email} as admin?`)) return;

    try {
      const { error } = await supabase.from('admins').delete().eq('id', adminRecord.id);
      if (error) throw error;
      setAdmins(admins.filter(a => a.id !== adminRecord.id));
    } catch (error) {
      console.error('Error removing admin:', error);
      alert(`Error removing admin: ${error.message}`);
    }
  };

  // ── School CRUD ───────────────────────────────────────────────

  const addSchoolToDb = async () => {
    if (!newSchool.name || !newSchool.city || !newSchool.devotee) {
      alert('Please fill all fields');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('schools')
        .insert({
          name: newSchool.name.trim(),
          city: newSchool.city.trim(),
          devotee: newSchool.devotee.trim(),
          languages: ['English']
        })
        .select()
        .single();

      if (error) throw error;

      setSchools([...schools, data]);
      setNewSchool({ name: '', city: '', devotee: '' });
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
      const { error } = await supabase
        .from('schools')
        .update({
          name: editingSchool.name,
          city: editingSchool.city,
          devotee: editingSchool.devotee
        })
        .eq('id', id);

      if (error) throw error;

      setSchools(schools.map(s => s.id === id ? editingSchool : s));
      setEditingSchool(null);
      alert('School updated successfully!');
    } catch (error) {
      console.error('Error updating school:', error);
      alert('Error updating school. Please try again.');
    }
  };

  const deleteSchoolFromDb = async (id) => {
    if (!confirm('Are you sure you want to delete this school?')) return;

    try {
      const { error } = await supabase.from('schools').delete().eq('id', id);
      if (error) throw error;
      setSchools(schools.filter(s => s.id !== id));
      alert('School deleted successfully!');
    } catch (error) {
      console.error('Error deleting school:', error);
      alert(`Error deleting school: ${error.message}`);
    }
  };

  // ── Google Sheets ─────────────────────────────────────────────

  const getSessionToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  };

  const loadSettings = async () => {
    try {
      const { data } = await supabase.from('settings').select('*');
      const othersId = data?.find(s => s.key === 'others_sheet_id')?.value || '';
      setOthersSheetId(othersId);
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const createSchoolSheet = async (school) => {
    setSheetLoading(prev => ({ ...prev, [school.id]: 'create' }));
    try {
      const token = await getSessionToken();
      const res = await fetch('/api/sheets-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ schoolId: school.id, schoolName: school.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSchools(prev => prev.map(s => s.id === school.id ? { ...s, sheet_id: data.sheetId } : s));
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
      const token = await getSessionToken();
      const res = await fetch('/api/sheets-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'others' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setOthersSheetId(data.sheetId);
      alert('Others Sheet created and shared with your Gmail!');
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
      const token = await getSessionToken();
      const res = await fetch('/api/sheets-sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sheetId: school.sheet_id, schoolName: school.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
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
      const token = await getSessionToken();
      const res = await fetch('/api/sheets-sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sheetId: othersSheetId, type: 'others' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
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
      const token = await getSessionToken();
      const res = await fetch('/api/sheets-sync-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sheetId: school.sheet_id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      alert(`Synced Book Given for ${data.updated} record(s) from Google Sheet.`);
      loadPayments();
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
      const token = await getSessionToken();
      const res = await fetch('/api/sheets-sync-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sheetId: othersSheetId, type: 'others' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      alert(`Synced Book Given for ${data.updated} record(s) from Others Sheet.`);
      loadPayments();
    } catch (err) {
      console.error('Sync pull others failed:', err);
      alert(`Sync failed: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, others: null }));
    }
  };

  const bulkExportSheets = async () => {
    const schoolsWithSheet = schools.filter(s => s.sheet_id);
    const targets = schoolsWithSheet.length + (othersSheetId ? 1 : 0);
    if (targets === 0) { alert('No sheets found. Create school sheets (and the Others sheet) first.'); return; }
    if (!confirm(`Export captured payments to all ${targets} sheet(s)? New records are appended to each.`)) return;

    setSheetLoading(prev => ({ ...prev, bulk: 'push' }));
    try {
      const token = await getSessionToken();
      let totalAdded = 0;
      const failures = [];

      const pushOne = async (body, label) => {
        try {
          const res = await fetch('/api/sheets-sync-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          totalAdded += data.added || 0;
        } catch (err) {
          console.error(`Bulk export failed for ${label}:`, err);
          failures.push(label);
        }
      };

      for (const school of schoolsWithSheet) {
        await pushOne({ sheetId: school.sheet_id, schoolName: school.name }, school.name);
      }
      if (othersSheetId) await pushOne({ sheetId: othersSheetId, type: 'others' }, 'Others');

      let msg = `Bulk export complete. Added ${totalAdded} new record(s) across ${targets} sheet(s).`;
      if (failures.length) msg += `\n\nFailed for: ${failures.join(', ')}`;
      alert(msg);
    } finally {
      setSheetLoading(prev => ({ ...prev, bulk: null }));
    }
  };

  const bulkPullSheets = async () => {
    const schoolsWithSheet = schools.filter(s => s.sheet_id);
    const targets = schoolsWithSheet.length + (othersSheetId ? 1 : 0);
    if (targets === 0) { alert('No sheets found. Create school sheets (and the Others sheet) first.'); return; }
    if (!confirm(`Sync Book Given from all ${targets} sheet(s) into the portal? Portal values are overwritten with sheet values.`)) return;

    setSheetLoading(prev => ({ ...prev, bulk: 'pull' }));
    try {
      const token = await getSessionToken();
      let totalUpdated = 0;
      const failures = [];

      const pullOne = async (body, label) => {
        try {
          const res = await fetch('/api/sheets-sync-pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          totalUpdated += data.updated || 0;
        } catch (err) {
          console.error(`Bulk sync failed for ${label}:`, err);
          failures.push(label);
        }
      };

      for (const school of schoolsWithSheet) {
        await pullOne({ sheetId: school.sheet_id }, school.name);
      }
      if (othersSheetId) await pullOne({ sheetId: othersSheetId, type: 'others' }, 'Others');

      loadPayments();
      let msg = `Bulk sync complete. Updated Book Given for ${totalUpdated} record(s) across ${targets} sheet(s).`;
      if (failures.length) msg += `\n\nFailed for: ${failures.join(', ')}`;
      alert(msg);
    } finally {
      setSheetLoading(prev => ({ ...prev, bulk: null }));
    }
  };

  const makeAllSheetsPublic = async () => {
    if (!confirm('Make all existing Google Sheets publicly viewable (anyone with the link)? This cannot be undone.')) return;
    setSheetLoading(prev => ({ ...prev, makePublic: true }));
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch('/api/sheets-make-public', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert(`Done! ${data.succeeded} of ${data.total} sheet(s) are now public.${data.failed ? `\n${data.failed} failed.` : ''}`);
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSheetLoading(prev => ({ ...prev, makePublic: false }));
    }
  };

  // ── College CRUD ──────────────────────────────────────────────

  const addCollegeToDb = async () => {
    if (!newCollege.name || !newCollege.city || !newCollege.devotee) {
      alert('Please fill all fields');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('colleges')
        .insert({
          name: newCollege.name.trim(),
          city: newCollege.city.trim(),
          devotee: newCollege.devotee.trim()
        })
        .select()
        .single();

      if (error) throw error;

      setColleges([...colleges, data]);
      setNewCollege({ name: '', city: '', devotee: '' });
      setShowAddCollege(false);
      alert('College added successfully!');
    } catch (error) {
      console.error('Error adding college:', error);
      alert(`Error adding college: ${error.message}`);
    }
  };

  const updateCollegeInDb = async (id) => {
    try {
      const { error } = await supabase
        .from('colleges')
        .update({
          name: editingCollege.name,
          city: editingCollege.city,
          devotee: editingCollege.devotee
        })
        .eq('id', id);

      if (error) throw error;

      setColleges(colleges.map(c => c.id === id ? editingCollege : c));
      setEditingCollege(null);
      alert('College updated successfully!');
    } catch (error) {
      console.error('Error updating college:', error);
      alert('Error updating college. Please try again.');
    }
  };

  const deleteCollegeFromDb = async (id) => {
    if (!confirm('Are you sure you want to delete this college?')) return;

    try {
      const { error } = await supabase.from('colleges').delete().eq('id', id);
      if (error) throw error;
      setColleges(colleges.filter(c => c.id !== id));
      alert('College deleted successfully!');
    } catch (error) {
      console.error('Error deleting college:', error);
      alert(`Error deleting college: ${error.message}`);
    }
  };

  const updateBookGiven = async (payment, value) => {
    try {
      const { error } = await supabase.from('payments').update({ book_given: value }).eq('id', payment.id);
      if (error) throw error;
      setPayments(payments.map(p => p.id === payment.id ? { ...p, book_given: value } : p));
    } catch (error) {
      console.error('Error updating book status:', error);
      alert(`Error updating book status: ${error.message}`);
    }
  };

  // ── Payment ───────────────────────────────────────────────────

  const savePaymentToDb = async (paymentData) => {
    try {
      const { error } = await supabase.from('payments').insert({
        name: paymentData.name,
        current_status: paymentData.currentStatus,
        city: paymentData.city,
        school: paymentData.school,
        class: paymentData.class,
        college: paymentData.college,
        branch: paymentData.branch,
        company_name: paymentData.companyName,
        mobile: paymentData.mobile,
        language: paymentData.language,
        referred_by: paymentData.referredBy,
        amount: paymentData.amount,
        payment_id: paymentData.paymentId,
        status: paymentData.status,
        book_given: false,
        has_children: paymentData.hasChildren || false,
        child_name: paymentData.childName || '',
        child_school: paymentData.childSchool || '',
        child_section: paymentData.childSection || '',
        timestamp: new Date().toISOString()
      });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error saving payment:', error);
      return false;
    }
  };

  // ── City CRUD ─────────────────────────────────────────────────

  const addCityToDb = async () => {
    if (!newCity.trim()) { alert('Please enter a city name'); return; }

    const cityName = newCity.trim();
    if (cities.some(c => c.name === cityName)) { alert('City already exists'); return; }

    try {
      const { data, error } = await supabase.from('cities').insert({ name: cityName }).select().single();
      if (error) throw error;
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
      const { error: cityError } = await supabase.from('cities').update({ name: trimmedNewName }).eq('id', cityId);
      if (cityError) throw cityError;

      const { error: schoolError } = await supabase.from('schools').update({ city: trimmedNewName }).eq('city', oldCityName);
      if (schoolError) throw schoolError;

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
    const schoolsUsingCity = schools.filter(s => s.city === city.name);
    if (schoolsUsingCity.length > 0) {
      alert(`Cannot delete city. ${schoolsUsingCity.length} school(s) are using this city.`);
      return;
    }
    if (!confirm(`Are you sure you want to delete "${city.name}"?`)) return;

    try {
      const { error } = await supabase.from('cities').delete().eq('id', city.id);
      if (error) throw error;
      setCities(cities.filter(c => c.id !== city.id));
      alert('City deleted successfully!');
    } catch (error) {
      console.error('Error deleting city:', error);
      alert(`Error deleting city: ${error.message}`);
    }
  };

  // ── Registration + Payment ────────────────────────────────────

  const handleSubmit = async () => {
    if (!formData.name || !formData.currentStatus || !formData.mobile || !formData.language) return false;

    let school = '', cls = '', college = '', branch = '', companyName = '', city = '';

    if (formData.currentStatus === 'school') {
      if (!formData.school) return false;
      if (formData.school === 'Other' && !otherSchoolName.trim()) return false;
      if (!formData.class) return false;
      school = formData.school === 'Other' ? otherSchoolName.trim() : formData.school;
      cls = formData.class;
      city = formData.school === 'Other' ? '' : (schools.find(s => s.name === formData.school)?.city || '');
    } else if (formData.currentStatus === 'college') {
      if (!formData.college) return false;
      if (formData.college === 'Other' && !otherCollegeName.trim()) return false;
      if (!formData.branch.trim()) return false;
      college = formData.college === 'Other' ? otherCollegeName.trim() : formData.college;
      branch = formData.branch.trim();
      city = formData.college === 'Other' ? '' : (colleges.find(c => c.name === formData.college)?.city || '');
    } else if (formData.currentStatus === 'working') {
      if (!formData.companyName.trim()) return false;
      companyName = formData.companyName.trim();
    }

    if (['working', 'other'].includes(formData.currentStatus) && childParticipates === 'yes') {
      if (!childName.trim()) return false;
      if (!childSchool) return false;
      if (childSchool === 'Other' && !childOtherSchoolName.trim()) return false;
      if (!childSection.trim()) return false;
    }

    const hasChildren = ['working', 'other'].includes(formData.currentStatus) && childParticipates === 'yes';
    const saved = await savePaymentToDb({
      name: formData.name,
      currentStatus: formData.currentStatus,
      city,
      school,
      class: cls,
      college,
      branch,
      companyName,
      mobile: formData.mobile,
      language: formData.language,
      referredBy: getReferredBy(),
      amount: PAYMENT_AMOUNT,
      paymentId: 'pending',
      status: 'pending',
      hasChildren,
      childName: hasChildren ? childName.trim() : '',
      childSchool: hasChildren ? (childSchool === 'Other' ? childOtherSchoolName.trim() : childSchool) : '',
      childSection: hasChildren ? childSection.trim() : ''
    });

    return saved;
  };

  const handlePayClick = async () => {
    if (!isFormComplete) {
      setPayError('Please fill in all the details before proceeding.');
      return;
    }
    setPayError('');
    setIsSubmitting(true);

    // Save to DB on first attempt; skip if already saved (e.g. user re-opened modal)
    if (!registrationSaved) {
      const saved = await handleSubmit();
      if (!saved) {
        setPayError('Failed to save registration. Please try again.');
        setIsSubmitting(false);
        return;
      }
      setRegistrationSaved(true);
    }

    // Create a Razorpay order server-side
    let orderId;
    try {
      const res = await fetch('/api/razorpay-create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: PAYMENT_AMOUNT * 100 })
      });
      const data = await res.json();
      if (!data.orderId) throw new Error(data.error || 'Order creation failed');
      orderId = data.orderId;
    } catch (err) {
      setPayError('Could not start payment. Please try again.');
      setIsSubmitting(false);
      return;
    }

    // Load Razorpay checkout script and open the modal
    await loadCheckoutScript();
    setIsSubmitting(false);

    const rzp = new window.Razorpay({
      key: import.meta.env.VITE_RAZORPAY_KEY_ID,
      order_id: orderId,
      amount: PAYMENT_AMOUNT * 100,
      currency: 'INR',
      name: 'ŚREṢṬHA Contest',
      description: `Student Registration · ₹${PAYMENT_AMOUNT}`,
      prefill: { name: formData.name, contact: formData.mobile },
      theme: { color: '#ea580c' },
      handler: () => setPaymentDone(true),
      modal: { ondismiss: () => {} }
    });
    rzp.open();
  };

  // ── Auth ──────────────────────────────────────────────────────

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
      setShowLoginModal(false);
    } catch (error) {
      console.error('Error signing in:', error);
      alert('Error signing in. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setIsAdmin(false);
      setAdminEmail('');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === 'currentStatus') {
      setOtherSchoolName('');
      setOtherCollegeName('');
      setChildParticipates('');
      setChildName('');
      setChildSchool('');
      setChildOtherSchoolName('');
      setChildSection('');
      setFormData(prev => ({
        ...prev,
        currentStatus: value,
        school: '', class: '', college: '', branch: '', companyName: '',
        language: value === 'school' ? 'English' : ''
      }));
      return;
    }
    if (name === 'school') setOtherSchoolName('');
    if (name === 'college') setOtherCollegeName('');

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const getAvailableLanguages = () => {
    if (formData.currentStatus === 'school') return ['English'];
    if (['college', 'working', 'other'].includes(formData.currentStatus)) return ['English', 'Telugu'];
    return [];
  };

  const getReferredBy = () => {
    if (formData.currentStatus === 'school' && formData.school && formData.school !== 'Other') {
      return schools.find(s => s.name === formData.school)?.devotee || '';
    }
    if (formData.currentStatus === 'college' && formData.college && formData.college !== 'Other') {
      return colleges.find(c => c.name === formData.college)?.devotee || '';
    }
    return '';
  };

  const getFilteredPayments = () => {
    let filtered = [...payments];
    if (selectedCityFilter) filtered = filtered.filter(p => p.city === selectedCityFilter);
    if (selectedSchoolFilter) filtered = filtered.filter(p => p.school === selectedSchoolFilter || p.college === selectedSchoolFilter);
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

  const institutionOf = (p) =>
    p.current_status === 'college' ? p.college
    : p.current_status === 'working' ? p.company_name
    : p.current_status === 'other' ? '—'
    : p.school;

  const detailOf = (p) =>
    p.current_status === 'college' ? p.branch
    : (p.current_status === 'working' || p.current_status === 'other') ? '—'
    : p.class;

  const statusLabelOf = (p) =>
    p.current_status === 'college' ? 'College'
    : p.current_status === 'working' ? 'Working'
    : p.current_status === 'school' ? 'School'
    : p.current_status === 'other' ? 'Other' : '—';

  const getUniqueCitiesFromPayments = () =>
    [...new Set(payments.map(p => p.city).filter(Boolean))].sort();

  const getUniqueSchoolsFromPayments = () => {
    const base = selectedCityFilter ? payments.filter(p => p.city === selectedCityFilter) : payments;
    return [...new Set([...base.map(p => p.school), ...base.map(p => p.college)].filter(Boolean))].sort();
  };

  const exportToCSV = () => {
    const filteredPayments = getFilteredPayments();
    if (filteredPayments.length === 0) { alert('No payments to export with the current filters.'); return; }

    const headers = ['Name', 'Current Status', 'City', 'School', 'Class', 'College', 'Branch', 'Company', 'Mobile', 'Language', 'Referred By', 'Amount', 'Payment ID', 'Date', 'Status', 'Book Given', 'Child Name', 'Child School', 'Child Section'];
    const rows = filteredPayments.map(p => [
      p.name, p.current_status || '', p.city, p.school, p.class,
      p.college || '', p.branch || '', p.company_name || '',
      p.mobile, p.language, p.referred_by || '', p.amount, p.payment_id,
      new Date(p.timestamp).toLocaleString(), p.status, p.book_given ? 'Yes' : 'No',
      p.child_name || '', p.child_school || '', p.child_section || ''
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');

    let filename = `vec_payments_${new Date().toISOString().split('T')[0]}`;
    if (selectedCityFilter) filename += `_${selectedCityFilter.replace(/\s+/g, '_')}`;
    if (selectedSchoolFilter) filename += `_${selectedSchoolFilter.replace(/\s+/g, '_').substring(0, 20)}`;
    filename += '.csv';

    const blob = new Blob([csvContent], { type: 'text/csv' });
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
            <img src="/iskcon_logo.png" alt="ISKCON Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex gap-2 justify-center mb-4">
            {[0, 150, 300].map(delay => (
              <div key={delay} className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
                style={{ animationDelay: `${delay}ms` }} />
            ))}
          </div>
          <p className="text-orange-200 text-sm font-medium">Loading ŚREṢṬHA Contest…</p>
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
                <img src="/iskcon_logo.png" alt="ISKCON Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg leading-none">ŚREṢṬHA Admin</h1>
                <p className="text-orange-200 text-xs mt-0.5">{adminEmail}</p>
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
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Filter by School / College</label>
                  <select value={selectedSchoolFilter} onChange={(e) => setSelectedSchoolFilter(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:border-orange-400 outline-none">
                    <option value="">All Schools / Colleges</option>
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
                    <th className="px-6 py-3 text-left font-semibold">Status</th>
                    <th className="px-6 py-3 text-left font-semibold">Institution</th>
                    <th className="px-6 py-3 text-left font-semibold">Class / Branch</th>
                    <th className="px-6 py-3 text-left font-semibold">Child</th>
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
                        <td className="px-6 py-3 text-gray-600">{statusLabelOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{institutionOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{detailOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600 text-xs">
                          {payment.has_children
                            ? <span className="space-y-0.5"><span className="block font-semibold text-gray-800">{payment.child_name}</span><span className="block text-gray-500">{payment.child_school} · Sec {payment.child_section}</span></span>
                            : <span className="text-gray-300">—</span>}
                        </td>
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
                    <th className="px-6 py-3 text-left font-semibold">Status</th>
                    <th className="px-6 py-3 text-left font-semibold">Institution</th>
                    <th className="px-6 py-3 text-left font-semibold">Class / Branch</th>
                    <th className="px-6 py-3 text-left font-semibold">Child</th>
                    <th className="px-6 py-3 text-left font-semibold">Mobile</th>
                    <th className="px-6 py-3 text-left font-semibold">Payment</th>
                    <th className="px-6 py-3 text-left font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {getNonCapturedPayments().length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-6 py-10 text-center text-gray-400">No pending or failed payments</td>
                    </tr>
                  ) : (
                    getNonCapturedPayments().map(payment => (
                      <tr key={payment.id} className="hover:bg-orange-50/40 transition-colors">
                        <td className="px-6 py-3 font-medium text-gray-900">{payment.name}</td>
                        <td className="px-6 py-3 text-gray-600">{statusLabelOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{institutionOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600">{detailOf(payment)}</td>
                        <td className="px-6 py-3 text-gray-600 text-xs">
                          {payment.has_children
                            ? <span className="space-y-0.5"><span className="block font-semibold text-gray-800">{payment.child_name}</span><span className="block text-gray-500">{payment.child_school} · Sec {payment.child_section}</span></span>
                            : <span className="text-gray-300">—</span>}
                        </td>
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
                <div className="flex gap-2 mt-4">
                  <button onClick={addSchoolToDb}
                    className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <Save size={15} /> Save School
                  </button>
                  <button onClick={() => { setShowAddSchool(false); setNewSchool({ name: '', city: '', devotee: '' }); }}
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
                <p className="text-sm text-gray-400 mt-0.5">Google Sheet for college, working, other — and school registrants not in the list above</p>
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

          {/* Colleges Management */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Colleges Management</h2>
                <p className="text-sm text-gray-400 mt-0.5">{colleges.length} colleges</p>
              </div>
              <button onClick={() => setShowAddCollege(!showAddCollege)}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                <Plus size={16} />
                Add College
              </button>
            </div>

            {showAddCollege && (
              <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Add New College</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input type="text" placeholder="College Name" value={newCollege.name}
                    onChange={(e) => setNewCollege(prev => ({ ...prev, name: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white" />
                  <select value={newCollege.city} onChange={(e) => setNewCollege(prev => ({ ...prev, city: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white">
                    <option value="">Select City</option>
                    {cities.map(city => <option key={city.id} value={city.name}>{city.name}</option>)}
                  </select>
                  <input type="text" placeholder="Devotee Name" value={newCollege.devotee}
                    onChange={(e) => setNewCollege(prev => ({ ...prev, devotee: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none bg-white" />
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={addCollegeToDb}
                    className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <Save size={15} /> Save College
                  </button>
                  <button onClick={() => { setShowAddCollege(false); setNewCollege({ name: '', city: '', devotee: '' }); }}
                    className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                    <X size={15} /> Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-gray-50">
              {colleges.map(college => (
                <div key={college.id} className="px-6 py-4">
                  {editingCollege?.id === college.id ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <input type="text" value={editingCollege.name}
                        onChange={(e) => setEditingCollege(prev => ({ ...prev, name: e.target.value }))}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none" />
                      <select value={editingCollege.city}
                        onChange={(e) => setEditingCollege(prev => ({ ...prev, city: e.target.value }))}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none">
                        {cities.map(city => <option key={city.id} value={city.name}>{city.name}</option>)}
                      </select>
                      <input type="text" value={editingCollege.devotee}
                        onChange={(e) => setEditingCollege(prev => ({ ...prev, devotee: e.target.value }))}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none" />
                      <div className="flex gap-2 md:col-span-3">
                        <button onClick={() => updateCollegeInDb(college.id)}
                          className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                          <Save size={15} /> Save
                        </button>
                        <button onClick={() => setEditingCollege(null)}
                          className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all">
                          <X size={15} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{college.name}</h3>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                          <span className="text-xs text-gray-400">{college.city}</span>
                          <span className="text-xs text-gray-400">by {college.devotee}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => setEditingCollege(college)}
                          className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl transition-colors">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => deleteCollegeFromDb(college.id)}
                          className="p-2 bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
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
              <div className="flex gap-2 mb-5">
                <input
                  type="email"
                  placeholder="Enter Google email address"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addAdmin()}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-orange-400 outline-none"
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
                        <span className="text-orange-600 text-xs font-bold uppercase">{admin.email[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{admin.email}</p>
                        {admin.email === adminEmail && (
                          <p className="text-xs text-orange-500 font-medium">You</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeAdmin(admin)}
                      disabled={admin.email === adminEmail || admins.length <= 1}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={admin.email === adminEmail ? "Can't remove yourself" : "Remove admin"}>
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
        <img src="/iskcon_logo.png" alt="" style={{ width: '55vw', maxWidth: '500px', opacity: 0.06, filter: 'invert(1)' }} />
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
            <button onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 border-2 border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-gray-700 px-4 py-3.5 rounded-2xl transition-all font-semibold mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>
            <button onClick={() => setShowLoginModal(false)}
              className="w-full text-gray-400 hover:text-gray-600 py-2 text-sm transition-colors">
              Cancel
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
                <img src="/iskcon_logo.png" alt="ISKCON Logo" className="w-full h-full object-contain" />
              </div>
              <span className="inline-block bg-white/25 text-white/95 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-widest mb-3">
                ISKCON ABIDS, Hyderabad
              </span>
              <h1 className="text-white text-2xl font-bold mb-1">ŚREṢṬHA Contest</h1>
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
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Current Status</label>
              <select name="currentStatus" value={formData.currentStatus} onChange={handleInputChange}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                <option value="">Select your current status</option>
                <option value="school">Studying in a school</option>
                <option value="college">Studying in a college</option>
                <option value="working">Working</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* School path */}
            {formData.currentStatus === 'school' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">School</label>
                  <select name="school" value={formData.school} onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                    <option value="">Select your school</option>
                    {schools.map(school => (
                      <option key={school.id} value={school.name}>{school.name}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </div>

                {formData.school === 'Other' && (
                  <>
                    <input type="text" placeholder="Enter your school name" value={otherSchoolName}
                      onChange={(e) => setOtherSchoolName(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                    <div className="flex items-start gap-3 bg-red-50 border-2 border-red-200 rounded-xl p-4">
                      <span className="text-xl shrink-0 mt-0.5">⚠️</span>
                      <p className="text-red-700 font-bold text-sm leading-snug">
                        Please collect your booklet from ISKCON ABIDS temple only
                      </p>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Class</label>
                  <select name="class" value={formData.class} onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                    <option value="">Select your class</option>
                    {classes.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* College path */}
            {formData.currentStatus === 'college' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">College</label>
                  <select name="college" value={formData.college} onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                    <option value="">Select your college</option>
                    {colleges.map(college => (
                      <option key={college.id} value={college.name}>{college.name}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </div>

                {formData.college === 'Other' && (
                  <input type="text" placeholder="Enter your college name" value={otherCollegeName}
                    onChange={(e) => setOtherCollegeName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Branch</label>
                  <input type="text" name="branch" placeholder="Enter your branch / stream" value={formData.branch} onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                </div>

                <div className="flex items-start gap-3 bg-red-50 border-2 border-red-200 rounded-xl p-4">
                  <span className="text-xl shrink-0 mt-0.5">⚠️</span>
                  <p className="text-red-700 font-bold text-sm leading-snug">
                    Please collect your booklet from ISKCON ABIDS temple only
                  </p>
                </div>
              </>
            )}

            {/* Working path */}
            {formData.currentStatus === 'working' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Company Name</label>
                  <input type="text" name="companyName" placeholder="Enter your company name" value={formData.companyName} onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                </div>
              </>
            )}

            {/* Other path */}
            {formData.currentStatus === 'other' && (
              <></>
            )}

            {/* Children participation — shown for Working and Other */}
            {(formData.currentStatus === 'working' || formData.currentStatus === 'other') && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Are your children also participating in this contest?
                </label>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setChildParticipates('yes')}
                    className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all border-2 ${
                      childParticipates === 'yes'
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:border-orange-300'
                    }`}>
                    Yes
                  </button>
                  <button type="button" onClick={() => { setChildParticipates('no'); setChildName(''); setChildSchool(''); setChildOtherSchoolName(''); setChildSection(''); }}
                    className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all border-2 ${
                      childParticipates === 'no'
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:border-orange-300'
                    }`}>
                    No
                  </button>
                </div>
              </div>
            )}

            {/* Child details */}
            {(formData.currentStatus === 'working' || formData.currentStatus === 'other') && childParticipates === 'yes' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Child's Name</label>
                  <input type="text" placeholder="Enter your child's name" value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Child's School</label>
                  <select value={childSchool} onChange={(e) => { setChildSchool(e.target.value); setChildOtherSchoolName(''); }}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer">
                    <option value="">Select school</option>
                    {schools.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    <option value="Other">Other</option>
                  </select>
                </div>

                {childSchool === 'Other' && (
                  <>
                    <input type="text" placeholder="Enter school name" value={childOtherSchoolName}
                      onChange={(e) => setChildOtherSchoolName(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                    <div className="flex items-start gap-3 bg-red-50 border-2 border-red-200 rounded-xl p-4">
                      <span className="text-xl shrink-0 mt-0.5">⚠️</span>
                      <p className="text-red-700 font-bold text-sm leading-snug">
                        Please collect your booklet from ISKCON ABIDS temple only
                      </p>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Class and Section</label>
                  <input type="text" placeholder="Enter class and section (e.g. 5-A, 6-B)" value={childSection}
                    onChange={(e) => setChildSection(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400" />
                </div>
              </>
            )}

            {/* Temple notice when children are not participating */}
            {(formData.currentStatus === 'working' || formData.currentStatus === 'other') && childParticipates === 'no' && (
              <div className="flex items-start gap-3 bg-red-50 border-2 border-red-200 rounded-xl p-4">
                <span className="text-xl shrink-0 mt-0.5">⚠️</span>
                <p className="text-red-700 font-bold text-sm leading-snug">
                  Please collect your booklet from ISKCON ABIDS temple only
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Mobile</label>
              <input type="tel" name="mobile" placeholder="Mobile number" value={formData.mobile} onChange={handleInputChange}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 placeholder-gray-400 font-medium" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Preferred Language</label>
              <select name="language" value={formData.language} onChange={handleInputChange}
                disabled={!formData.currentStatus || formData.currentStatus === 'school'}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-orange-400 focus:bg-white outline-none transition-all text-gray-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <option value="">Select language</option>
                {getAvailableLanguages().map(lang => <option key={lang} value={lang}>{lang}</option>)}
              </select>
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
                    : registrationSaved ? 'Complete Payment' : 'Submit Details'
                  }
                </button>
                {payError && (
                  <p className="text-red-500 text-sm text-center font-medium">{payError}</p>
                )}
              </div>
            )}

            <p className="text-center text-xs text-gray-400 pb-1">🔒 Secured by Razorpay · All payments are final</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
