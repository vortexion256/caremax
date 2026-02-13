import { google } from 'googleapis';
import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

const TOKENS_COLLECTION = 'tenant_google_tokens';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

function getOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set');
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri ?? process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

/** Generate Google OAuth URL; state should be tenantId. */
export function getGoogleAuthUrl(tenantId: string): string {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!redirectUri) throw new Error('GOOGLE_OAUTH_REDIRECT_URI must be set');
  const oauth2 = getOAuth2Client(redirectUri);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: tenantId,
    redirect_uri: redirectUri,
  });
}

/** Exchange code for tokens and store for tenant. */
export async function exchangeCodeForTokens(tenantId: string, code: string): Promise<void> {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!redirectUri) throw new Error('GOOGLE_OAUTH_REDIRECT_URI must be set');
  const oauth2 = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2.getToken({ code, redirect_uri: redirectUri });
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token; try revoking app access and connecting again.');
  }
  const ref = db.collection(TOKENS_COLLECTION).doc(tenantId);
  await ref.set({
    tenantId,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    expiresAt: tokens.expiry_date ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Get stored tokens for tenant; refresh access token if expired. */
async function getValidTokens(tenantId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const doc = await db.collection(TOKENS_COLLECTION).doc(tenantId).get();
  if (!doc.exists) {
    throw new Error('Google account not connected for this tenant');
  }
  const data = doc.data()!;
  const refreshToken = data.refreshToken as string;
  const accessToken = data.accessToken as string | null;
  const expiresAt = data.expiresAt as number | null;
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // refresh 5 min before expiry
  if (accessToken && expiresAt && expiresAt > now + bufferMs) {
    return { accessToken, refreshToken };
  }
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const oauth2 = getOAuth2Client(redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  const newAccess = credentials.access_token!;
  const newExpiry = credentials.expiry_date ?? null;
  await db.collection(TOKENS_COLLECTION).doc(tenantId).update({
    accessToken: newAccess,
    expiresAt: newExpiry,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { accessToken: newAccess, refreshToken };
}

/** Check if tenant has Google connected. */
export async function isGoogleConnected(tenantId: string): Promise<boolean> {
  const doc = await db.collection(TOKENS_COLLECTION).doc(tenantId).get();
  return doc.exists && !!(doc.data()?.refreshToken);
}

/** Disconnect Google for tenant. */
export async function disconnectGoogle(tenantId: string): Promise<void> {
  await db.collection(TOKENS_COLLECTION).doc(tenantId).delete();
}

/**
 * Fetch sheet data for tenant. Uses tenant's configured spreadsheet if spreadsheetId not provided.
 * Returns a markdown table string for the agent.
 */
export async function fetchSheetData(
  tenantId: string,
  spreadsheetId: string,
  range?: string
): Promise<string> {
  const { accessToken } = await getValidTokens(tenantId);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: 'v4', auth });
  let rangeToUse = range && range.trim() ? range.trim() : 'Sheet1';
  // Sheets API requires A1 notation (e.g. "Sheet1!A:Z"). 
  // If the range already contains a colon (like "A6:F20"), it's already a valid A1 range - use as-is.
  // If it contains '!', it's already in "SheetName!Range" format - use as-is.
  // Otherwise, treat it as a sheet name and append "!A:Z"
  const hasColon = rangeToUse.includes(':');
  const hasExclamation = rangeToUse.includes('!');
  if (!hasExclamation && !hasColon) {
    // It's just a sheet name, append the default range
    rangeToUse = `${rangeToUse}!A:Z`;
  } else if (hasColon && !hasExclamation) {
    // It's a range like "A6:F20" but no sheet name - assume Sheet1
    rangeToUse = `Sheet1!${rangeToUse}`;
  }
  // If it already has '!', it's in correct format, use as-is
  // Add timeout to prevent hanging (10 seconds)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Google Sheets API timeout after 10 seconds')), 10000);
  });
  
  const res = await Promise.race([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeToUse,
    }),
    timeoutPromise,
  ]);
  const rows = (res.data.values ?? []) as string[][];
  if (rows.length === 0) return 'No data in the specified range.';
  // Build markdown table: first row as header, rest as body
  const header = rows[0];
  const body = rows.slice(1);
  const escape = (cell: string) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const headerLine = '| ' + header.map(escape).join(' | ') + ' |';
  const sep = '| ' + header.map(() => '---').join(' | ') + ' |';
  const bodyLines = body.map((row) => {
    const padded = [...row];
    while (padded.length < header.length) padded.push('');
    return '| ' + padded.slice(0, header.length).map(escape).join(' | ') + ' |';
  });
  return [headerLine, sep, ...bodyLines].join('\n');
}
