import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  query, 
  orderBy 
} from 'firebase/firestore';
import { db } from '../config/firebase';

// Schools
export const getSchools = async () => {
  const schoolsCol = collection(db, 'schools');
  const schoolSnapshot = await getDocs(schoolsCol);
  return schoolSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addSchool = async (schoolData) => {
  const docRef = await addDoc(collection(db, 'schools'), schoolData);
  return docRef.id;
};

export const updateSchool = async (id, schoolData) => {
  const schoolRef = doc(db, 'schools', id);
  await updateDoc(schoolRef, schoolData);
};

export const deleteSchool = async (id) => {
  await deleteDoc(doc(db, 'schools', id));
};

// Payments
export const getPayments = async () => {
  const paymentsCol = collection(db, 'payments');
  const q = query(paymentsCol, orderBy('timestamp', 'desc'));
  const paymentSnapshot = await getDocs(q);
  return paymentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addPayment = async (paymentData) => {
  const docRef = await addDoc(collection(db, 'payments'), {
    ...paymentData,
    timestamp: new Date().toISOString()
  });
  return docRef.id;
};