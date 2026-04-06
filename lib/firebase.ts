// lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAItiJnR_obuvzIPFl1ynuwCS5idhmtw5M',
  authDomain: 'pedo-c66e6.firebaseapp.com',
  projectId: 'pedo-c66e6',
  storageBucket: 'pedo-c66e6.firebasestorage.app',
  messagingSenderId: '455472798685',
  appId: '1:455472798685:web:39e07d3355393d8def3434',
};

const isNew = !getApps().length;
const app = isNew ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = isNew
  ? initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  : getAuth(app);

export const db = getFirestore(app);
