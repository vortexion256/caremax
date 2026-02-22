function normalize(value?: string): string {
  return (value ?? '').trim();
}

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

const DEFAULT_CHECKOUT_URL = 'https://wallet.wearemarz.com/checkout';

export function getMarzPayCredentialInfo() {
  return {
    hasCheckoutUrl: Boolean(normalize(process.env.MARZPAY_CHECKOUT_URL)),
    hasSecretKey: Boolean(normalize(process.env.MARZPAY_SECRET_KEY)),
    hasVerifyUrl: Boolean(normalize(process.env.MARZPAY_VERIFY_URL)),
  };
}

export async function initializeMarzPayPayment(payload: MarzPayInitializePayload): Promise<{ paymentLink: string }> {
  const checkoutUrl = normalize(process.env.MARZPAY_CHECKOUT_URL) || DEFAULT_CHECKOUT_URL;
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

  return { paymentLink: `${checkoutUrl}?${params.toString()}` };
}

export async function verifyMarzPayTransaction(input: MarzPayVerificationInput): Promise<MarzPayVerificationResult> {
  const verifyUrl = normalize(process.env.MARZPAY_VERIFY_URL);
  const status = normalize(input.status).toLowerCase();

  if (verifyUrl) {
    const secret = normalize(process.env.MARZPAY_SECRET_KEY);
    const url = new URL(verifyUrl);
    url.searchParams.set('tx_ref', input.txRef);
    if (input.reference) url.searchParams.set('reference', input.reference);
    if (input.transactionId) url.searchParams.set('transaction_id', String(input.transactionId));

    const response = await fetch(url.toString(), {
      headers: {
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
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
