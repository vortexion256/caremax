function normalize(value?: string): string {
  return (value ?? '').trim();
}

export type MarzCollectionInput = {
  amount: number;
  phoneNumber: string;
  country: string;
  reference: string;
  description?: string;
  callbackUrl?: string;
};

type MarzApiResponse = {
  status?: string;
  message?: string;
  data?: {
    transaction?: {
      uuid?: string;
      reference?: string;
      status?: string;
      provider_reference?: string | null;
    };
    collection?: {
      provider?: string;
      phone_number?: string;
      amount?: {
        raw?: number;
        currency?: string;
      };
      mode?: string;
    };
  };
};

function getCollectionsUrl(): string {
  return normalize(process.env.MARZPAY_COLLECTIONS_URL) || 'https://wallet.wearemarz.com/api/v1/collect-money';
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
  if (!apiKey || !apiSecret) {
    return '';
  }

  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

function requireCollectionConfig(): { collectionsUrl: string; authHeader: string } {
  const collectionsUrl = getCollectionsUrl();
  const authHeader = getMarzBasicAuthorization();

  if (!authHeader) {
    throw new Error('Marz Pay Basic Auth is required. Set MARZPAY_API_KEY + MARZPAY_API_SECRET (or MARZPAY_API_CREDENTIALS).');
  }

  return { collectionsUrl, authHeader };
}

export function getMarzPayCredentialInfo() {
  return {
    hasCollectionsUrl: Boolean(normalize(process.env.MARZPAY_COLLECTIONS_URL)),
    hasApiKey: Boolean(getMarzApiKey()),
    hasApiSecret: Boolean(getMarzApiSecret()),
    hasApiCredentials: Boolean(normalize(process.env.MARZPAY_API_CREDENTIALS)),
    hasPaymentLink: false,
    hasCheckoutUrl: false,
    hasSecretKey: false,
    hasVerifyUrl: false,
  };
}

export async function createMarzCollection(input: MarzCollectionInput): Promise<{
  transactionUuid: string;
  transactionStatus: string;
  providerReference: string | null;
}> {
  const { collectionsUrl, authHeader } = requireCollectionConfig();

  const response = await fetch(collectionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({
      amount: input.amount,
      phone_number: input.phoneNumber,
      country: input.country,
      reference: input.reference,
      description: input.description,
      callback_url: input.callbackUrl,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as MarzApiResponse;
  if (!response.ok) {
    throw new Error(body.message || 'Marz Pay collection initialization failed');
  }

  const transactionUuid = body.data?.transaction?.uuid;
  const transactionStatus = body.data?.transaction?.status ?? 'processing';
  if (!transactionUuid) {
    throw new Error('Marz Pay collection response missing transaction uuid');
  }

  return {
    transactionUuid,
    transactionStatus,
    providerReference: body.data?.transaction?.provider_reference ?? null,
  };
}

export async function getMarzCollectionDetails(collectionUuid: string): Promise<{ status: string; providerReference: string | null }> {
  const { collectionsUrl, authHeader } = requireCollectionConfig();
  const response = await fetch(`${collectionsUrl.replace(/\/$/, '')}/${encodeURIComponent(collectionUuid)}`, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });

  const body = (await response.json().catch(() => ({}))) as MarzApiResponse;
  if (!response.ok) {
    throw new Error(body.message || 'Failed to fetch Marz collection details');
  }

  return {
    status: (body.data?.transaction?.status ?? 'unknown').toLowerCase(),
    providerReference: body.data?.transaction?.provider_reference ?? null,
  };
}
