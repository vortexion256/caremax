import { Router } from 'express';
import { db } from '../config/firebase.js';
import { activateTenantSubscription } from '../services/billing.js';
import { verifyFlutterwaveTransactionById } from '../services/flutterwave.js';

export const flutterwaveRouter: Router = Router();

type FlutterwaveWebhookBody = {
  event?: string;
  data?: {
    id?: number;
    status?: string;
    tx_ref?: string;
    amount?: number;
    currency?: string;
  };
};

function hasValidWebhookHash(hashHeader: string | undefined): boolean {
  const configuredHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  if (!configuredHash) return false;
  if (!hashHeader) return false;
  return configuredHash.trim() === hashHeader.trim();
}

// Flutterwave docs: webhook requests include a `verif-hash` header that should match
// your dashboard-configured webhook secret hash.
flutterwaveRouter.post('/webhook', async (req, res) => {
  const hashHeader = req.header('verif-hash') ?? req.header('Verif-Hash') ?? undefined;
  if (!hasValidWebhookHash(hashHeader)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const body = (req.body ?? {}) as FlutterwaveWebhookBody;
  const txRef = body.data?.tx_ref;
  const transactionId = body.data?.id;

  if (!txRef || typeof transactionId !== 'number') {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }

  try {
    const paymentRef = db.collection('payments').doc(txRef);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const payment = paymentDoc.data() ?? {};
    const tenantId = typeof payment.tenantId === 'string' ? payment.tenantId : null;
    const billingPlanId = typeof payment.billingPlanId === 'string' ? payment.billingPlanId : null;
    const expectedAmount = typeof payment.amount === 'number' ? payment.amount : 0;

    if (!tenantId || !billingPlanId) {
      await paymentRef.set({
        status: 'failed',
        failureReason: 'Missing tenantId or billingPlanId on payment record',
        updatedAt: new Date(),
      }, { merge: true });
      res.status(400).json({ error: 'Invalid payment record' });
      return;
    }

    const verified = await verifyFlutterwaveTransactionById(transactionId);
    if (!verified) {
      await paymentRef.set({
        status: 'failed',
        failureReason: 'Verification response was empty',
        updatedAt: new Date(),
      }, { merge: true });
      res.status(400).json({ error: 'Webhook verification failed' });
      return;
    }
    const verifiedAmount = typeof verified.amount === 'number' ? verified.amount : 0;

    const isValid =
      verified.tx_ref === txRef
      && verified.status === 'successful'
      && verifiedAmount >= expectedAmount;

    if (!isValid) {
      await paymentRef.set({
        status: 'failed',
        providerTransactionId: verified.id,
        providerStatus: verified.status ?? 'unknown',
        failureReason: 'Webhook verification mismatch or incomplete payment',
        updatedAt: new Date(),
      }, { merge: true });
      res.status(400).json({ error: 'Webhook verification failed' });
      return;
    }

    await activateTenantSubscription(tenantId, billingPlanId);

    await paymentRef.set({
      status: 'completed',
      providerTransactionId: verified.id,
      providerStatus: verified.status ?? 'unknown',
      paidAt: verified.created_at ? new Date(verified.created_at) : new Date(),
      webhookEvent: body.event ?? null,
      updatedAt: new Date(),
    }, { merge: true });

    res.status(200).json({ success: true });
  } catch (e) {
    console.error('Failed to process Flutterwave webhook:', e);
    res.status(500).json({ error: 'Failed to process Flutterwave webhook' });
  }
});
