function normalize(value?: string): string {
  return (value ?? '').trim();
}

export type MarzCollectionInput = {
type MarzCollectionInput = {
  phoneNumber: string;
  country: string;
  description?: string;
  callbackUrl?: string;
};

type MarzPayInitializePayload = {
  txRef: string;
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
    checkoutUrl?: string;
    checkout_url?: string;
    paymentLink?: string;
    payment_link?: string;
    url?: string;
    transactionId?: number;
    transaction_id?: number;
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
  checkoutUrl?: string;
  checkout_url?: string;
  paymentLink?: string;
  payment_link?: string;
  url?: string;
  transactionId?: number;
  transaction_id?: number;
  transaction?: {
    uuid?: string;
    reference?: string;
    status?: string;
    provider_reference?: string | null;
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

function extractPaymentLink(body: MarzCollectionsCreateResponse): string {
  return (
    body.data?.checkoutUrl ??
    body.data?.checkout_url ??
    body.data?.paymentLink ??
    body.data?.payment_link ??
    body.data?.url ??
    body.checkoutUrl ??
    body.checkout_url ??
    body.paymentLink ??
    body.payment_link ??
    body.url ??
    ''
  );
}

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

    hasCollectionsUrl: Boolean(getCollectionsUrl()),
    hasPaymentLink: Boolean(normalize(process.env.MARZPAY_PAYMENT_LINK)),
    hasCheckoutUrl: Boolean(normalize(process.env.MARZPAY_CHECKOUT_URL)),
    hasSecretKey: Boolean(getMarzSecretKey()),
    hasApiKey: Boolean(getMarzApiKey()),
    hasApiSecret: Boolean(getMarzApiSecret()),
    hasApiCredentials: Boolean(normalize(process.env.MARZPAY_API_CREDENTIALS)),
    hasVerifyUrl: Boolean(normalize(process.env.MARZPAY_VERIFY_URL)),
  };
}

export async function initializeMarzPayPayment(
  payload: MarzPayInitializePayload,
  collectionInput?: MarzCollectionInput,
): Promise<{ paymentLink: string; transactionId?: number; collectionUuid?: string }> {
  const configuredFallbackUrl = getConfiguredPaymentUrl();
  const collectionsUrl = getCollectionsUrl();

  if (!collectionsUrl || (!collectionInput && configuredFallbackUrl && !getMarzSecretKey())) {
    return { paymentLink: fallbackPaymentLink(payload) };
  }

  const basicAuth = getMarzBasicAuthorization();
  const bearerAuth = getMarzSecretKey();
  const authorization = basicAuth || (bearerAuth ? `Bearer ${bearerAuth}` : '');

  const requestBody = collectionInput
    ? {
        amount: payload.amount,
        phone_number: collectionInput.phoneNumber,
        country: collectionInput.country,
        reference: payload.txRef,
        description: collectionInput.description,
        callback_url: collectionInput.callbackUrl,
      }
    : {
        tx_ref: payload.txRef,
        amount: payload.amount,
        currency: payload.currency,
        email: payload.customerEmail,
        name: payload.customerName,
        redirect_url: payload.redirectUrl,
        meta: {
          tenantId: payload.tenantId,
          billingPlanId: payload.billingPlanId,
        },
      };

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
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(requestBody),
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
  const paymentLink = extractPaymentLink(body);
  if (!paymentLink && !body.data?.transaction?.uuid) {
    throw new Error('Marz Pay collections response did not include a checkout URL');
  }

  return {
    paymentLink: paymentLink || '',
    transactionId: body.data?.transactionId ?? body.data?.transaction_id ?? body.transactionId ?? body.transaction_id,
    collectionUuid: body.data?.transaction?.uuid,
  };
}

export async function verifyMarzPayTransaction(input: MarzPayVerificationInput): Promise<MarzPayVerificationResult> {
  const verifyUrl = normalize(process.env.MARZPAY_VERIFY_URL);
  const status = normalize(input.status).toLowerCase();

  if (verifyUrl) {
    const basicAuth = getMarzBasicAuthorization();
    const secret = getMarzSecretKey();
    const url = new URL(verifyUrl);
    url.searchParams.set('tx_ref', input.txRef);
    if (input.reference) url.searchParams.set('reference', input.reference);
    if (input.transactionId) url.searchParams.set('transaction_id', String(input.transactionId));

    const response = await fetch(url.toString(), {
      headers: {
        ...(basicAuth ? { Authorization: basicAuth } : {}),
        ...(!basicAuth && secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
    });

    const body = await response.json().catch(() => ({})) as { status?: string; paid_at?: string; transaction_id?: number; message?: string };
    if (!response.ok) {
      throw new Error(body.message || 'Marz Pay verification failed');
    }

    return {
      status: body.status ?? 'unknown',
      transactionId: body.transaction_id,
      paidAt: body.paid_at,
    };
  }

  const body = (await response.json().catch(() => ({}))) as MarzApiResponse;
  if (!response.ok) {
    throw new Error(body.message || 'Failed to fetch Marz collection details');
  }

  return {
    status: (body.data?.transaction?.status ?? 'unknown').toLowerCase(),
    providerReference: body.data?.transaction?.provider_reference ?? null,
  };
}
