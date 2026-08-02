import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseConfig.apiKey) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    setPersistence(auth, browserLocalPersistence).catch(() => {});
    db = getFirestore(app);
    console.log('Firebase Client SDK initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize Firebase Client SDK:', error);
  }
} else {
  console.log(
    'Firebase client-side API key missing. Operating in single-user Local Database mode.'
  );
}

export function isFirebaseEnabled(): boolean {
  return auth !== null && db !== null;
}

export { auth, db };
