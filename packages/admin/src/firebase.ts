import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup as firebaseSignInWithPopup,
  onAuthStateChanged as firebaseOnAuthStateChanged,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!config.apiKey || config.apiKey === '') {
  console.warn(
    'Firebase: Missing VITE_FIREBASE_API_KEY (or NEXT_PUBLIC_FIREBASE_API_KEY in root .env). Admin sign-in will fail.'
  );
}

export const app = initializeApp(config);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

export async function signInWithGoogle(): Promise<string> {
  const provider = new GoogleAuthProvider();
  const { user } = await firebaseSignInWithPopup(auth, provider);
  const token = await user?.getIdToken();
  if (!token) throw new Error('No token');
  return token;
}

export function onAuthStateChanged(cb: (token: string | null) => void) {
  return firebaseOnAuthStateChanged(auth, async (user) => {
    if (!user) {
      cb(null);
      return;
    }
    try {
      const token = await user.getIdToken();
      cb(token);
    } catch {
      cb(null);
    }
  });
}

/** Call after server has set new custom claims (e.g. after register) so the next API call gets updated claims. */
export async function refreshIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken(true);
  return token;
}
