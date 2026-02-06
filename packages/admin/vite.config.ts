import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load repo root .env so VITE_* and NEXT_PUBLIC_* are available when running from root
config({ path: resolve(__dirname, '../../.env') });

const firebaseApiKey =
  process.env.VITE_FIREBASE_API_KEY ?? process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '';
const firebaseAuthDomain =
  process.env.VITE_FIREBASE_AUTH_DOMAIN ?? process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '';
const firebaseProjectId =
  process.env.VITE_FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
const firebaseStorageBucket =
  process.env.VITE_FIREBASE_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
const firebaseMessagingSenderId =
  process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '';
const firebaseAppId =
  process.env.VITE_FIREBASE_APP_ID ?? process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '';

export default defineConfig({
  plugins: [react()],
  server: { port: 3002 },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'),
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(firebaseApiKey),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(firebaseAuthDomain),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(firebaseProjectId),
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(firebaseStorageBucket),
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(firebaseMessagingSenderId),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(firebaseAppId),
  },
});
