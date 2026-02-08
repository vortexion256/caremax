import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import { resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../');

function initFirebase(): admin.app.App {
  if (admin.apps.length > 0) return admin.app() as admin.app.App;

  let credential: admin.credential.Credential | undefined;
  let projectId: string | undefined;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credPath) {
    const name = credPath.replace(/^\.\//, '');
    const candidates = [
      credPath.startsWith('/') || /^[A-Za-z]:/.test(credPath) ? credPath : null,
      resolve(process.cwd(), credPath),
      resolve(repoRoot, name),
      resolve(process.cwd(), '..', name),
      resolve(process.cwd(), '..', '..', name),
    ].filter(Boolean) as string[];
    const jsonPath = candidates.find((p) => existsSync(p));
    if (jsonPath) {
      credential = admin.credential.cert(jsonPath);
      try {
        const key = JSON.parse(readFileSync(jsonPath, 'utf8')) as { project_id?: string };
        projectId = key.project_id;
      } catch {
        // ignore
      }
    }
  }

  if (!credential) {
    projectId =
      process.env.FIREBASE_PROJECT_ID ??
      process.env.GOOGLE_PROJECT_ID ??
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Firebase: Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in env (required on Vercel/serverless when the credentials file is not available).'
      );
    }
    credential = admin.credential.cert({ projectId, clientEmail, privateKey });
  }

  if (!credential) {
    throw new Error(
      'Firebase: Set GOOGLE_APPLICATION_CREDENTIALS (path to JSON file) or, for serverless (e.g. Vercel), set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in env.'
    );
  }

  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    (projectId ? `${projectId}.appspot.com` : undefined);

  return admin.initializeApp({
    credential,
    storageBucket,
  });
}

export const app = initFirebase();
export const auth: Auth = admin.auth();
export const db = admin.firestore();
export const bucket: ReturnType<admin.storage.Storage['bucket']> | null = app.options.storageBucket
  ? admin.storage().bucket(app.options.storageBucket)
  : null;
