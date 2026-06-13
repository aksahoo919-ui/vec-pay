import { supabase } from '../config/supabase';

// Schools
export const getSchools = async () => {
  const { data, error } = await supabase.from('schools').select('*');
  if (error) throw error;
  return data;
};

export const addSchool = async (schoolData) => {
  const { data, error } = await supabase.from('schools').insert(schoolData).select().single();
  if (error) throw error;
  return data.id;
};

export const updateSchool = async (id, schoolData) => {
  const { error } = await supabase.from('schools').update(schoolData).eq('id', id);
  if (error) throw error;
};

export const deleteSchool = async (id) => {
  const { error } = await supabase.from('schools').delete().eq('id', id);
  if (error) throw error;
};

// Payments
export const getPayments = async () => {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('timestamp', { ascending: false });
  if (error) throw error;
  return data;
};

export const addPayment = async (paymentData) => {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      ...paymentData,
      timestamp: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data.id;
};
