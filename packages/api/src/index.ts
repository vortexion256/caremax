/**
 * Load .env before any other module (so Firebase gets GOOGLE_APPLICATION_CREDENTIALS).
 * In ESM, static imports run first, so we load dotenv and then dynamically import the app.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const envPaths = [
  resolve(repoRoot, '.env'),
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '../../.env'),
].filter((p) => existsSync(p));
envPaths.forEach((p, i) => config({ path: p, override: i > 0 }));

const { startApp } = await import('./app.js');
startApp();
