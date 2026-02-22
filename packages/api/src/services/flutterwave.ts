const FLUTTERWAVE_BASE_URL = process.env.FLUTTERWAVE_BASE_URL?.trim() || 'https://api.flutterwave.com/v3';
const FLUTTERWAVE_OAUTH_URL =
  process.env.FLUTTERWAVE_OAUTH_URL?.trim() ||
  'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token';

type FlutterwaveInitializePayload = {
  tx_ref: string;
  amount: number;
  currency: string;
  redirect_url: string;
  customer: {
    email: string;
    name?: string;
  };
  meta?: Record<string, unknown>;
  customizations?: {
    title?: string;
    description?: string;
  };
};

type FlutterwaveInitResponse = {
  status: string;
  message: string;
  data?: {
    link?: string;
  };
};

type FlutterwaveVerifyResponse = {
  status: string;
  message: string;
  data?: {
    id: number;
    tx_ref?: string;
    status?: string;
    amount?: number;
    currency?: string;
    customer?: { email?: string; name?: string };
    meta?: Record<string, unknown>;
    created_at?: string;
  };
};

type FlutterwaveOAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

function normalizeEnvSecret(rawKey?: string): string {
  return (rawKey ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^"(.+)"$/, '$1')
    .replace(/^'(.+)'$/, '$1')
    .replace(/^`(.+)`$/, '$1')
    .replace(/[\r\n]+/g, '');
}

function getRawDirectSecretFromEnv(): string | undefined {
  return (
    process.env.FLUTTERWAVE_SECRET_KEY ??
    process.env.FLW_SECRET_KEY ??
    process.env.FLUTTERWAVE_SECRET ??
    process.env.FLUTTERWAVE_SECRETKEY ??
    process.env.FLW_SECRET ??
    // Legacy/alternate names seen in older deployments.
    process.env.RAVE_SECRET_KEY ??
    process.env.FLWSECK
  );
}

function getStaticApiSecret(): string {
  const key = normalizeEnvSecret(getRawDirectSecretFromEnv());

  if (!key) {
    return '';
  }

  if (/^FLWPUBK/i.test(key)) {
    throw new Error(
      'Flutterwave credential is misconfigured: received a Public Key (FLWPUBK...). Use a server-side secret or OAuth client credentials instead.',
    );
  }
  if (/^FLWENC/i.test(key)) {
    throw new Error(
      'Flutterwave secret is misconfigured: received an Encryption Key (FLWENC...). Use your API Secret Key instead.',
    );
  }

  // Flutterwave key formats can vary by dashboard generation and account mode.
  // Keep strict checks for known-invalid key types above, but allow other non-empty
  // secret values so valid sandbox/live credentials are not rejected locally.
  return key;
}

function getOAuthClientId(): string {
  return normalizeEnvSecret(process.env.FLUTTERWAVE_CLIENT_ID ?? process.env.FLW_CLIENT_ID);
}

function getOAuthClientSecret(): string {
  return normalizeEnvSecret(process.env.FLUTTERWAVE_CLIENT_SECRET ?? process.env.FLW_CLIENT_SECRET);
}

async function getOAuthAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > now + 60_000) {
    return cachedAccessToken.token;
  }

  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Flutterwave OAuth credentials. Set FLUTTERWAVE_CLIENT_ID and FLUTTERWAVE_CLIENT_SECRET, or provide FLUTTERWAVE_SECRET_KEY.',
    );
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetch(FLUTTERWAVE_OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const body = (await response.json().catch(() => ({}))) as FlutterwaveOAuthTokenResponse & { message?: string };

  if (!response.ok || !body.access_token) {
    const message = body?.message || 'Unable to obtain Flutterwave OAuth access token';
    throw new Error(message);
  }

  const expiresInSeconds = Number.isFinite(body.expires_in) ? Number(body.expires_in) : 600;
  cachedAccessToken = {
    token: body.access_token,
    expiresAtMs: now + expiresInSeconds * 1000,
  };

  return body.access_token;
}

async function getAuthorizationToken(): Promise<string> {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();

  // Prefer OAuth whenever both OAuth credentials are present.
  // This avoids accidental use of stale/mis-entered direct secrets in mixed configurations.
  if (clientId && clientSecret) {
    return getOAuthAccessToken();
  }

  const staticSecret = getStaticApiSecret();
  if (staticSecret) {
    return staticSecret;
  }

  if (clientSecret && !clientId) {
    // Backward-compatible fallback for legacy deployments that put the direct secret in CLIENT_SECRET.
    if (/^FLWPUBK/i.test(clientSecret)) {
      throw new Error(
        'Flutterwave credential is misconfigured: FLUTTERWAVE_CLIENT_SECRET appears to be a Public Key (FLWPUBK...).',
      );
    }
    return clientSecret;
  }

  throw new Error(
    'Missing Flutterwave credentials. Configure FLUTTERWAVE_SECRET_KEY for direct auth, or FLUTTERWAVE_CLIENT_ID + FLUTTERWAVE_CLIENT_SECRET for OAuth.',
  );
}

export function getFlutterwaveCredentialInfo(): {
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasEncryptionKey: boolean;
  hasWebhookSecretHash: boolean;
} {
  return {
    hasClientId: Boolean(process.env.FLUTTERWAVE_CLIENT_ID),
    hasClientSecret: Boolean(
      normalizeEnvSecret(
        getRawDirectSecretFromEnv() ??
          process.env.FLUTTERWAVE_CLIENT_SECRET ??
          process.env.FLW_CLIENT_SECRET,
      ),
    ),
    hasEncryptionKey: Boolean(process.env.FLUTTERWAVE_ENCRYPTION_KEY),
    hasWebhookSecretHash: Boolean(process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH),
  };
}

async function flutterwaveRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthorizationToken();
  const response = await fetch(`${FLUTTERWAVE_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : 'Flutterwave request failed';
    if (response.status === 401 || /invalid authorization key|unauthori[sz]ed/i.test(message)) {
      throw new Error(
        'Flutterwave authentication failed. Confirm your direct secret or OAuth credentials are valid, in the correct mode (sandbox/live), and redeploy after updating env vars.',
      );
    }
    throw new Error(message);
  }

  return body as T;
}

export async function initializeFlutterwavePayment(payload: FlutterwaveInitializePayload): Promise<{ paymentLink: string }> {
  const response = await flutterwaveRequest<FlutterwaveInitResponse>('/payments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (response.status !== 'success' || !response.data?.link) {
    throw new Error(response.message || 'Unable to initialize Flutterwave payment');
  }

  return { paymentLink: response.data.link };
}

export async function verifyFlutterwaveTransactionById(transactionId: number): Promise<FlutterwaveVerifyResponse['data']> {
  const response = await flutterwaveRequest<FlutterwaveVerifyResponse>(`/transactions/${transactionId}/verify`);
  if (response.status !== 'success' || !response.data) {
    throw new Error(response.message || 'Unable to verify Flutterwave transaction');
  }
  return response.data;
}
