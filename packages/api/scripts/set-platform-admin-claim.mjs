/**
 * Set Firebase custom claims so a user becomes a platform admin (SaaS owner).
 * Run from repo root:
 *   node packages/api/scripts/set-platform-admin-claim.mjs YOUR_FIREBASE_UID
 *
 * Get your UID: Firebase Console → Authentication → Users → copy the "User UID" of your Google user.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
config({ path: resolve(repoRoot, '.env') });

// Resolve relative GOOGLE_APPLICATION_CREDENTIALS from repo root
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && !credPath.startsWith('/') && !/^[A-Za-z]:/.test(credPath)) {
  const fromRoot = resolve(repoRoot, credPath.replace(/^\.\//, ''));
  if (existsSync(fromRoot)) process.env.GOOGLE_APPLICATION_CREDENTIALS = fromRoot;
}

const uid = process.argv[2];

if (!uid) {
  console.error('Usage: node set-platform-admin-claim.mjs <FIREBASE_USER_UID>');
  console.error('Example: node set-platform-admin-claim.mjs abc123xyz');
  console.error('\nGet your UID: Firebase Console → Authentication → Users → copy \"User UID\"');
  process.exit(1);
}

if (!admin.apps.length) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      console.error('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env');
      process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
}

const auth = admin.auth();
auth
  .setCustomUserClaims(uid, { isPlatformAdmin: true })
  .then(() => {
    console.log('Done. Claims set: { isPlatformAdmin: true }');
    console.log('User must sign out and sign in again in the admin app for the new token to apply.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

