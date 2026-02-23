// app/lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBumb2-CShf570Q7N1TeIh7ScuxmmPcM4E",
  authDomain: "peddometer.firebaseapp.com",
  projectId: "peddometer",
  storageBucket: "peddometer.firebasestorage.app",
  messagingSenderId: "88188963251",
  appId: "1:88188963251:web:f4800b829d395ddd4863c6",
  measurementId: "G-TK32NW8TPP", // 있어도 상관없음
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
