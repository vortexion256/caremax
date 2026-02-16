import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup as firebaseSignInWithPopup,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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
  const msg = 'Firebase Error: VITE_FIREBASE_API_KEY is missing or empty. Please check your .env file in the repository root.';
  console.error(msg);
  // Optional: throw error to stop initialization if API key is critical
  // throw new Error(msg);
}

export const app = initializeApp(config);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

export async function signUpWithEmail(email: string, password: string): Promise<string> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  const token = await user.getIdToken();
  if (!token) throw new Error('No token');
  return token;
}

export async function signInWithEmail(email: string, password: string): Promise<string> {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  const token = await user.getIdToken();
  if (!token) throw new Error('No token');
  return token;
}

export async function signInWithGoogle(): Promise<string> {
  const provider = new GoogleAuthProvider();
  
  // Debug: Log current URL and Firebase config
  console.log('Firebase Auth Debug:', {
    currentUrl: typeof window !== 'undefined' ? window.location.href : 'N/A',
    origin: typeof window !== 'undefined' ? window.location.origin : 'N/A',
    authDomain: config.authDomain,
    projectId: config.projectId,
  });
  
  try {
    const { user } = await firebaseSignInWithPopup(auth, provider);
    const token = await user?.getIdToken();
    if (!token) throw new Error('No token');
    return token;
  } catch (error: any) {
    // Enhanced error logging
    console.error('Google Sign-In Error:', {
      code: error?.code,
      message: error?.message,
      email: error?.email,
      credential: error?.credential,
      currentUrl: typeof window !== 'undefined' ? window.location.href : 'N/A',
    });
    throw error;
  }
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
