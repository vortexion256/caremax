const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3';

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

function getSecretKey(): string {
  const key = process.env.FLUTTERWAVE_SECRET_KEY ?? process.env.FLUTTERWAVE_CLIENT_SECRET;
  if (!key) {
    throw new Error('Missing Flutterwave secret. Set FLUTTERWAVE_SECRET_KEY or FLUTTERWAVE_CLIENT_SECRET.');
  }
  return key;
}

export function getFlutterwaveCredentialInfo(): {
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasEncryptionKey: boolean;
  hasWebhookSecretHash: boolean;
} {
  return {
    hasClientId: Boolean(process.env.FLUTTERWAVE_CLIENT_ID),
    hasClientSecret: Boolean(process.env.FLUTTERWAVE_SECRET_KEY ?? process.env.FLUTTERWAVE_CLIENT_SECRET),
    hasEncryptionKey: Boolean(process.env.FLUTTERWAVE_ENCRYPTION_KEY),
    hasWebhookSecretHash: Boolean(process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH),
  };
}

async function flutterwaveRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${FLUTTERWAVE_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : 'Flutterwave request failed';
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
