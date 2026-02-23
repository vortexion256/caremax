function normalize(value?: string): string {
  return (value ?? '').trim();
}

type MarzCollectionInput = {
  reference: string;
  amount: number;
  phoneNumber: string;
  country: string;
  description?: string;
  callbackUrl?: string;
};

type MarzCollectionTransaction = {
  uuid?: string;
  reference?: string;
  status?: string;
  provider_reference?: string | null;
};

type MarzCollectionResponse = {
  status?: string;
  message?: string;
  data?: {
    transaction?: MarzCollectionTransaction;
    collection?: {
      provider?: string;
      phone_number?: string;
      mode?: string;
      amount?: { raw?: number; currency?: string };
    };
  };
};

export type MarzVerifyResult = {
  status: string;
  transactionId?: string;
  paidAt?: string;
};

function getMarzBaseUrl(): string {
  return normalize(process.env.MARZPAY_BASE_URL) || 'https://wallet.wearemarz.com/api/v1';
}

function getMarzApiKey(): string {
  return normalize(process.env.MARZPAY_API_KEY);
}

function getMarzApiSecret(): string {
  return normalize(process.env.MARZPAY_API_SECRET);
}

function getMarzBasicAuthorization(): string {
  const fromEnv = normalize(process.env.MARZPAY_API_CREDENTIALS);
  if (fromEnv) return `Basic ${fromEnv}`;

  const apiKey = getMarzApiKey();
  const apiSecret = getMarzApiSecret();
  if (!apiKey || !apiSecret) return '';

  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

function authHeaders(): Record<string, string> {
  const authorization = getMarzBasicAuthorization();
  if (!authorization) {
    throw new Error('Marz Pay is not configured. Set MARZPAY_API_CREDENTIALS or MARZPAY_API_KEY + MARZPAY_API_SECRET');
  }

  return {
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
}

export function getMarzPayCredentialInfo() {
  return {
    baseUrl: getMarzBaseUrl(),
    hasApiKey: Boolean(getMarzApiKey()),
    hasApiSecret: Boolean(getMarzApiSecret()),
    hasApiCredentials: Boolean(normalize(process.env.MARZPAY_API_CREDENTIALS)),
  };
}

export async function initializeMarzPayPayment(input: MarzCollectionInput): Promise<{
  collectionUuid: string;
  status: string;
  providerReference?: string | null;
}> {
  const response = await fetch(`${getMarzBaseUrl()}/collect-money`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      amount: input.amount,
      phone_number: input.phoneNumber,
      country: input.country,
      reference: input.reference,
      description: input.description,
      callback_url: input.callbackUrl,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as MarzCollectionResponse;

  if (!response.ok) {
    throw new Error(body.message || 'Failed to initialize Marz Pay collection');
  }

  const uuid = body.data?.transaction?.uuid;
  if (!uuid) {
    throw new Error('Marz Pay response did not include a transaction UUID');
  }

  return {
    collectionUuid: uuid,
    status: body.data?.transaction?.status ?? 'processing',
    providerReference: body.data?.transaction?.provider_reference,
  };
}

export async function verifyMarzPayTransaction(input: { txRef: string; collectionUuid?: string; status?: string }): Promise<MarzVerifyResult> {
  const statusFromCallback = normalize(input.status).toLowerCase();
  const collectionUuid = normalize(input.collectionUuid);

  if (!collectionUuid) {
    if (!['successful', 'success', 'completed', 'paid'].includes(statusFromCallback)) {
      throw new Error('Payment verification failed');
    }

    return {
      status: 'completed',
      paidAt: new Date().toISOString(),
    };
  }

  const response = await fetch(`${getMarzBaseUrl()}/collect-money/${encodeURIComponent(collectionUuid)}`, {
    method: 'GET',
    headers: authHeaders(),
  });

  const body = (await response.json().catch(() => ({}))) as MarzCollectionResponse;
  if (!response.ok) {
    throw new Error(body.message || 'Marz Pay verification failed');
  }

  const finalStatus = normalize(body.data?.transaction?.status).toLowerCase();
  const isPaid = ['successful', 'success', 'completed', 'paid'].includes(finalStatus);

  return {
    status: isPaid ? 'completed' : finalStatus || 'failed',
    transactionId: body.data?.transaction?.uuid,
    paidAt: isPaid ? new Date().toISOString() : undefined,
  };
}
