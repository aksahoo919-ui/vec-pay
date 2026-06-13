import React, { useState, useEffect } from 'react';
import { User, LogOut, Plus, Edit2, Trash2, Save, X, Download } from 'lucide-react';
import { supabase } from './config/supabase';

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;
const PAYMENT_AMOUNT = 200;
const ALLOWED_ADMINS = [
  'aksahoo.919@gmail.com',
  'abhaynitaidas.bavs@gmail.com'
];

function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    school: '',
    class: '',
    mobile: '',
    language: ''
  });
  const [otherSchoolName, setOtherSchoolName] = useState('');

  // Data state — cities is {id, name}[]
  const [cities, setCities] = useState([]);
  const [schools, setSchools] = useState([]);
  const [classes] = useState(['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']);
  const [payments, setPayments] = useState([]);

  const [editingSchool, setEditingSchool] = useState(null);
  const [showAddSchool, setShowAddSchool] = useState(false);
  const [newSchool, setNewSchool] = useState({ name: '', city: '', devotee: '', languages: [] });

  // City management state — editingCity is {id, name} | null
  const [showAddCity, setShowAddCity] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [editingCity, setEditingCity] = useState(null);
  const [editingCityValue, setEditingCityValue] = useState('');

  // Filter state for CSV export
  const [selectedCityFilter, setSelectedCityFilter] = useState('');
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState('');

  // Load data on mount; listen for auth state changes
  useEffect(() => {
    loadCities();
    loadSchools();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      if (user && ALLOWED_ADMINS.includes(user.email)) {
        setIsAdmin(true);
        setAdminEmail(user.email);
        loadPayments();
      } else {
        setIsAdmin(false);
        setAdminEmail('');
        if (user && !ALLOWED_ADMINS.includes(user.email)) {
          supabase.auth.signOut();
        }
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Data Loading ─────────────────────────────────────────────

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

  // ── School CRUD ───────────────────────────────────────────────

  const addSchoolToDb = async () => {
    if (!newSchool.name || !newSchool.city || !newSchool.devotee || newSchool.languages.length === 0) {
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
          languages: newSchool.languages
        })
        .select()
        .single();

      if (error) throw error;

      setSchools([...schools, data]);
      setNewSchool({ name: '', city: '', devotee: '', languages: [] });
      setShowAddSchool(false);
      alert('School added successfully!');
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
          devotee: editingSchool.devotee,
          languages: editingSchool.languages
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

  // ── Payment ───────────────────────────────────────────────────

  const savePaymentToDb = async (paymentData) => {
    try {
      const { error } = await supabase.from('payments').insert({
        name: paymentData.name,
        city: paymentData.city,
        school: paymentData.school,
        class: paymentData.class,
        mobile: paymentData.mobile,
        language: paymentData.language,
        referred_by: paymentData.referredBy,
        amount: paymentData.amount,
        payment_id: paymentData.paymentId,
        status: paymentData.status,
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
    if (!newCity.trim()) {
      alert('Please enter a city name');
      return;
    }

    const cityName = newCity.trim();

    if (cities.some(c => c.name === cityName)) {
      alert('City already exists');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('cities')
        .insert({ name: cityName })
        .select()
        .single();

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
    if (!newCityName.trim()) {
      alert('Please enter a city name');
      return;
    }

    const trimmedNewName = newCityName.trim();

    if (trimmedNewName === oldCityName) {
      setEditingCity(null);
      return;
    }

    if (cities.some(c => c.name === trimmedNewName)) {
      alert('City already exists');
      return;
    }

    try {
      const { error: cityError } = await supabase
        .from('cities')
        .update({ name: trimmedNewName })
        .eq('id', cityId);
      if (cityError) throw cityError;

      // Cascade rename to all schools in this city
      const { error: schoolError } = await supabase
        .from('schools')
        .update({ city: trimmedNewName })
        .eq('city', oldCityName);
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
      alert(`Cannot delete city. ${schoolsUsingCity.length} school(s) are using this city. Please update or delete those schools first.`);
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

  // ── Razorpay ──────────────────────────────────────────────────

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handlePayment = async () => {
    if (!formData.name || !formData.school || !formData.class || !formData.mobile || !formData.language) {
      alert('Please fill all required fields');
      return;
    }

    const res = await loadRazorpayScript();

    if (!res) {
      alert('Razorpay SDK failed to load. Please check your internet connection.');
      return;
    }

    const options = {
      key: RAZORPAY_KEY_ID,
      amount: PAYMENT_AMOUNT * 100,
      currency: 'INR',
      name: 'JIVADAYA - ŚREṢṬHA Contest',
      description: 'VEC Kit Payment',
      handler: async function (response) {
        const schoolName = formData.school === 'Other'
          ? (otherSchoolName.trim() || 'Other')
          : formData.school;
        const cityFromSchool = formData.school === 'Other'
          ? ''
          : (schools.find(s => s.name === formData.school)?.city || '');

        const paymentData = {
          name: formData.name,
          city: cityFromSchool,
          school: schoolName,
          class: formData.class,
          mobile: formData.mobile,
          language: formData.language,
          referredBy: getReferredBy(),
          amount: PAYMENT_AMOUNT,
          paymentId: response.razorpay_payment_id,
          status: 'success'
        };

        const saved = await savePaymentToDb(paymentData);

        if (saved) {
          alert('Payment Successful! Registration completed.');
          setFormData({ name: '', school: '', class: '', mobile: '', language: '' });
          setOtherSchoolName('');
        }
      },
      prefill: {
        name: formData.name,
        contact: formData.mobile
      },
      theme: { color: '#F97316' },
      modal: {
        ondismiss: function () {
          alert('Payment cancelled');
        }
      }
    };

    const paymentObject = new window.Razorpay(options);
    paymentObject.open();
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
    if (name === 'school') setOtherSchoolName('');
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'school' && { language: '' })
    }));
  };

  const getFilteredSchools = () => schools;

  const getAvailableLanguages = () => {
    if (!formData.school) return [];
    if (formData.school === 'Other') return ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu'];
    const school = schools.find(s => s.name === formData.school);
    return school ? school.languages : [];
  };

  const getReferredBy = () => {
    if (!formData.school || formData.school === 'Other') return '';
    const school = schools.find(s => s.name === formData.school);
    return school ? school.devotee : '';
  };

  const toggleLanguage = (lang, isNew = false) => {
    if (isNew) {
      setNewSchool(prev => ({
        ...prev,
        languages: prev.languages.includes(lang)
          ? prev.languages.filter(l => l !== lang)
          : [...prev.languages, lang]
      }));
    } else if (editingSchool) {
      setEditingSchool(prev => ({
        ...prev,
        languages: prev.languages.includes(lang)
          ? prev.languages.filter(l => l !== lang)
          : [...prev.languages, lang]
      }));
    }
  };

  const getFilteredPayments = () => {
    let filtered = [...payments];
    if (selectedCityFilter) filtered = filtered.filter(p => p.city === selectedCityFilter);
    if (selectedSchoolFilter) filtered = filtered.filter(p => p.school === selectedSchoolFilter);
    return filtered;
  };

  const getUniqueCitiesFromPayments = () =>
    [...new Set(payments.map(p => p.city).filter(Boolean))].sort();

  const getUniqueSchoolsFromPayments = () => {
    const base = selectedCityFilter ? payments.filter(p => p.city === selectedCityFilter) : payments;
    return [...new Set(base.map(p => p.school).filter(Boolean))].sort();
  };

  const exportToCSV = () => {
    const filteredPayments = getFilteredPayments();

    if (filteredPayments.length === 0) {
      alert('No payments to export with the current filters.');
      return;
    }

    const headers = ['Name', 'City', 'School', 'Class', 'Mobile', 'Language', 'Referred By', 'Amount', 'Payment ID', 'Date', 'Status'];
    const rows = filteredPayments.map(p => [
      p.name,
      p.city,
      p.school,
      p.class,
      p.mobile,
      p.language,
      p.referred_by || '',
      p.amount,
      p.payment_id,
      new Date(p.timestamp).toLocaleString(),
      p.status
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    let filename = `vec_payments_${new Date().toISOString().split('T')[0]}`;
    if (selectedCityFilter) filename += `_${selectedCityFilter.replace(/\s+/g, '_')}`;
    if (selectedSchoolFilter) filename += `_${selectedSchoolFilter.replace(/\s+/g, '_').substring(0, 20)}`;
    filename += '.csv';

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // ── Loading State ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Admin Panel ───────────────────────────────────────────────

  if (isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 p-6">
        <div className="max-w-6xl mx-auto">

          {/* Admin Header */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold text-orange-600">VEC Admin Panel</h1>
                <p className="text-gray-600 mt-1">Logged in as: {adminEmail}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600"
              >
                <LogOut size={20} />
                Logout
              </button>
            </div>
          </div>

          {/* Payments Section */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">
                Payment Records ({getFilteredPayments().length} of {payments.length})
              </h2>
              <button
                onClick={exportToCSV}
                disabled={getFilteredPayments().length === 0}
                className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 disabled:bg-gray-300"
              >
                <Download size={20} />
                Export to CSV
              </button>
            </div>

            {/* Filters */}
            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Filter by City</label>
                  <select
                    value={selectedCityFilter}
                    onChange={(e) => {
                      setSelectedCityFilter(e.target.value);
                      setSelectedSchoolFilter('');
                    }}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  >
                    <option value="">All Cities</option>
                    {getUniqueCitiesFromPayments().map(city => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Filter by School</label>
                  <select
                    value={selectedSchoolFilter}
                    onChange={(e) => setSelectedSchoolFilter(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  >
                    <option value="">All Schools</option>
                    {getUniqueSchoolsFromPayments().map(school => (
                      <option key={school} value={school}>{school}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <button
                    onClick={() => { setSelectedCityFilter(''); setSelectedSchoolFilter(''); }}
                    className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                  >
                    Clear Filters
                  </button>
                </div>
              </div>
              {(selectedCityFilter || selectedSchoolFilter) && (
                <div className="mt-2 text-sm text-gray-600">
                  Showing: {selectedCityFilter ? `City: ${selectedCityFilter}` : ''}
                  {selectedCityFilter && selectedSchoolFilter ? ' | ' : ''}
                  {selectedSchoolFilter ? `School: ${selectedSchoolFilter}` : ''}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">School</th>
                    <th className="px-4 py-2 text-left">City</th>
                    <th className="px-4 py-2 text-left">Class</th>
                    <th className="px-4 py-2 text-left">Mobile</th>
                    <th className="px-4 py-2 text-left">Amount</th>
                    <th className="px-4 py-2 text-left">Payment ID</th>
                    <th className="px-4 py-2 text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredPayments().length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-4 py-8 text-center text-gray-500">
                        {payments.length === 0 ? 'No payments yet' : 'No payments match the selected filters'}
                      </td>
                    </tr>
                  ) : (
                    getFilteredPayments().map(payment => (
                      <tr key={payment.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{payment.name}</td>
                        <td className="px-4 py-2">{payment.school}</td>
                        <td className="px-4 py-2">{payment.city}</td>
                        <td className="px-4 py-2">{payment.class}</td>
                        <td className="px-4 py-2">{payment.mobile}</td>
                        <td className="px-4 py-2">₹{payment.amount}</td>
                        <td className="px-4 py-2 font-mono text-xs">{payment.payment_id}</td>
                        <td className="px-4 py-2">{new Date(payment.timestamp).toLocaleDateString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* City Management */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">City Management ({cities.length})</h2>
              <button
                onClick={() => setShowAddCity(!showAddCity)}
                className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
              >
                <Plus size={20} />
                Add New City
              </button>
            </div>

            {showAddCity && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter city name"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addCityToDb()}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2"
                  />
                  <button
                    onClick={addCityToDb}
                    className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
                  >
                    <Save size={20} />
                    Save
                  </button>
                  <button
                    onClick={() => { setShowAddCity(false); setNewCity(''); }}
                    className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
                  >
                    <X size={20} />
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {cities.map(city => (
                <div key={city.id} className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                  {editingCity?.id === city.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingCityValue}
                        onChange={(e) => setEditingCityValue(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') updateCityInDb(editingCity.id, editingCity.name, editingCityValue);
                          else if (e.key === 'Escape') { setEditingCity(null); setEditingCityValue(''); }
                        }}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        autoFocus
                      />
                      <button
                        onClick={() => updateCityInDb(editingCity.id, editingCity.name, editingCityValue)}
                        className="p-1 bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        <Save size={16} />
                      </button>
                      <button
                        onClick={() => { setEditingCity(null); setEditingCityValue(''); }}
                        className="p-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm font-medium">{city.name}</span>
                      <button
                        onClick={() => { setEditingCity(city); setEditingCityValue(city.name); }}
                        className="p-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                        title="Edit city"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => deleteCityFromDb(city)}
                        className="p-1 bg-red-500 text-white rounded hover:bg-red-600"
                        title="Delete city"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Add School Button */}
          <div className="mb-6">
            <button
              onClick={() => setShowAddSchool(!showAddSchool)}
              className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
            >
              <Plus size={20} />
              Add New School
            </button>
          </div>

          {/* Add School Form */}
          {showAddSchool && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
              <h2 className="text-xl font-bold mb-4">Add New School</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="School Name"
                  value={newSchool.name}
                  onChange={(e) => setNewSchool(prev => ({ ...prev, name: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-4 py-2"
                />
                <select
                  value={newSchool.city}
                  onChange={(e) => setNewSchool(prev => ({ ...prev, city: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-4 py-2"
                >
                  <option value="">Select City</option>
                  {cities.map(city => (
                    <option key={city.id} value={city.name}>{city.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Devotee Name"
                  value={newSchool.devotee}
                  onChange={(e) => setNewSchool(prev => ({ ...prev, devotee: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-4 py-2"
                />
                <div className="border border-gray-300 rounded-lg px-4 py-2">
                  <p className="text-sm text-gray-600 mb-2">Languages:</p>
                  <div className="flex flex-wrap gap-2">
                    {['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu'].map(lang => (
                      <label key={lang} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newSchool.languages.includes(lang)}
                          onChange={() => toggleLanguage(lang, true)}
                        />
                        <span className="text-sm">{lang}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={addSchoolToDb}
                  className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
                >
                  <Save size={20} />
                  Save School
                </button>
                <button
                  onClick={() => { setShowAddSchool(false); setNewSchool({ name: '', city: '', devotee: '', languages: [] }); }}
                  className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
                >
                  <X size={20} />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Schools List */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-bold mb-4">Schools Management ({schools.length})</h2>
            <div className="space-y-4">
              {schools.map(school => (
                <div key={school.id} className="border border-gray-200 rounded-lg p-4">
                  {editingSchool?.id === school.id ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <input
                        type="text"
                        value={editingSchool.name}
                        onChange={(e) => setEditingSchool(prev => ({ ...prev, name: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-4 py-2"
                      />
                      <select
                        value={editingSchool.city}
                        onChange={(e) => setEditingSchool(prev => ({ ...prev, city: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-4 py-2"
                      >
                        {cities.map(city => (
                          <option key={city.id} value={city.name}>{city.name}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={editingSchool.devotee}
                        onChange={(e) => setEditingSchool(prev => ({ ...prev, devotee: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-4 py-2"
                      />
                      <div className="border border-gray-300 rounded-lg px-4 py-2">
                        <p className="text-sm text-gray-600 mb-2">Languages:</p>
                        <div className="flex flex-wrap gap-2">
                          {['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu'].map(lang => (
                            <label key={lang} className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editingSchool.languages.includes(lang)}
                                onChange={() => toggleLanguage(lang)}
                              />
                              <span className="text-sm">{lang}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2 md:col-span-2">
                        <button
                          onClick={() => updateSchoolInDb(school.id)}
                          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
                        >
                          <Save size={20} />
                          Save
                        </button>
                        <button
                          onClick={() => setEditingSchool(null)}
                          className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
                        >
                          <X size={20} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg">{school.name}</h3>
                        <p className="text-gray-600">City: {school.city}</p>
                        <p className="text-gray-600">Devotee: {school.devotee}</p>
                        <p className="text-gray-600">Languages: {school.languages.join(', ')}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingSchool(school)}
                          className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                        >
                          <Edit2 size={20} />
                        </button>
                        <button
                          onClick={() => deleteSchoolFromDb(school.id)}
                          className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── Student Registration Form ─────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setShowLoginModal(true)}
          className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600"
        >
          <User size={20} />
          Admin Login
        </button>
      </div>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4">Admin Login</h2>
            <button
              onClick={handleGoogleLogin}
              className="w-full bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 mb-4"
            >
              Sign in with Google
            </button>
            <button
              onClick={() => setShowLoginModal(false)}
              className="w-full bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Student Form */}
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-orange-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-2xl">JD</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-center text-blue-500 mb-6">
            ŚREṢṬHA Contest
          </h1>

          <div className="space-y-4">
            <input
              type="text"
              name="name"
              placeholder="Enter your name"
              value={formData.name}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />

            <select
              name="school"
              value={formData.school}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select School</option>
              {getFilteredSchools().map(school => (
                <option key={school.id} value={school.name}>{school.name}</option>
              ))}
              <option value="Other">Other</option>
            </select>

            {formData.school === 'Other' && (
              <>
                <input
                  type="text"
                  placeholder="Enter your school name (optional)"
                  value={otherSchoolName}
                  onChange={(e) => setOtherSchoolName(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
                <p className="text-red-600 font-bold text-center text-sm">
                  Please collect your booklet from ISKCON ABIDS temple only
                </p>
              </>
            )}

            <select
              name="class"
              value={formData.class}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select Class</option>
              {classes.map(cls => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>

            <input
              type="tel"
              name="mobile"
              placeholder="Mobile Number"
              value={formData.mobile}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />

            <select
              name="language"
              value={formData.language}
              onChange={handleInputChange}
              disabled={!formData.school}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
            >
              <option value="">Select your preferred language</option>
              {getAvailableLanguages().map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>

            {getReferredBy() && (
              <p className="text-center text-blue-600">
                Referred by: {getReferredBy()}
              </p>
            )}

            <button
              onClick={handlePayment}
              className="w-full bg-blue-500 text-white py-3 rounded-lg font-semibold hover:bg-blue-600 transition-colors"
            >
              Register & Pay ₹{PAYMENT_AMOUNT}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
