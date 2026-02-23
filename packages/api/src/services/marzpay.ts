function normalize(value?: string): string {
  return (value ?? '').trim();
}

type MarzCollectionInput = {
  phoneNumber: string;
  country: string;
  description?: string;
  callbackUrl?: string;
};

type MarzPayInitializePayload = {
  txRef: string;
  amount: number;
  currency: string;
  redirectUrl: string;
  customerEmail: string;
  customerName?: string;
  billingPlanId: string;
  tenantId: string;
};

type MarzPayVerificationInput = {
  txRef: string;
  status?: string;
  transactionId?: number;
  reference?: string;
};

type MarzPayVerificationResult = {
  status: string;
  transactionId?: number;
  paidAt?: string;
};

type MarzCollectionsCreateResponse = {
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
  return normalize(process.env.MARZPAY_COLLECTIONS_URL);
}

function getConfiguredPaymentUrl(): string {
  return normalize(process.env.MARZPAY_PAYMENT_LINK) || normalize(process.env.MARZPAY_CHECKOUT_URL);
}

function getMarzSecretKey(): string {
  const raw = normalize(process.env.MARZPAY_SECRET_KEY);
  return raw.replace(/^Bearer\s+/i, '');
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

function fallbackPaymentLink(payload: MarzPayInitializePayload): string {
  const checkoutUrl = getConfiguredPaymentUrl();
  if (!checkoutUrl) {
    throw new Error('Marz Pay is not configured: set MARZPAY_COLLECTIONS_URL (recommended), MARZPAY_PAYMENT_LINK, or MARZPAY_CHECKOUT_URL');
  }

  const params = new URLSearchParams({
    tx_ref: payload.txRef,
    amount: String(payload.amount),
    currency: payload.currency,
    email: payload.customerEmail,
    redirect_url: payload.redirectUrl,
    tenant_id: payload.tenantId,
    plan_id: payload.billingPlanId,
  });

  if (payload.customerName) {
    params.set('name', payload.customerName);
  }

  return `${checkoutUrl}?${params.toString()}`;
}

export function getMarzPayCredentialInfo() {
  return {
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
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  const body = (await response.json().catch(() => ({}))) as MarzCollectionsCreateResponse;

  if (!response.ok) {
    if (configuredFallbackUrl) {
      return { paymentLink: fallbackPaymentLink(payload) };
    }
    throw new Error(body.message || 'Marz Pay collections initialization failed');
  }

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

  if (!['successful', 'success', 'completed', 'paid'].includes(status)) {
    throw new Error('Payment verification failed');
  }

  return {
    status: 'successful',
    transactionId: input.transactionId,
    paidAt: new Date().toISOString(),
  };
}
