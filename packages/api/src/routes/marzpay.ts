import { Router } from 'express';
import { db } from '../config/firebase.js';
import { activateTenantSubscription } from '../services/billing.js';

type MarzCollectionWebhookBody = {
  event_type?: string;
  transaction?: {
    reference?: string;
    status?: string;
    updated_at?: string;
  };
  collection?: {
    provider_transaction_id?: string;
  };
};

export const marzpayRouter: Router = Router();

const FINAL_SUCCESS_STATUSES = new Set(['successful', 'success', 'completed', 'paid']);
const FINAL_FAILED_STATUSES = new Set(['failed', 'cancelled', 'canceled']);

function normalizeStatus(raw?: string): string {
  return (raw ?? '').trim().toLowerCase();
}

function isValidWebhookToken(token?: string): boolean {
  const configured = process.env.MARZPAY_WEBHOOK_TOKEN?.trim();
  if (!configured) return true;
  return configured === (token ?? '').trim();
}

marzpayRouter.post('/collections', async (req, res) => {
  const token = req.query.token;
  if (!isValidWebhookToken(typeof token === 'string' ? token : undefined)) {
    res.status(401).json({ error: 'Invalid webhook token' });
    return;
  }

  const body = (req.body ?? {}) as MarzCollectionWebhookBody;
  const txRef = body.transaction?.reference;
  const providerStatus = normalizeStatus(body.transaction?.status);

  if (!txRef || !providerStatus) {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }

  try {
    const paymentRef = db.collection('payments').doc(txRef);
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) {
      res.status(200).json({ success: true, ignored: true });
      return;
    }

    const payment = paymentDoc.data() ?? {};
    if (payment.provider !== 'marzpay') {
      res.status(200).json({ success: true, ignored: true });
      return;
    }

    const tenantId = typeof payment.tenantId === 'string' ? payment.tenantId : null;
    const billingPlanId = typeof payment.billingPlanId === 'string' ? payment.billingPlanId : null;
    const currentStatus = normalizeStatus(typeof payment.status === 'string' ? payment.status : undefined);

    if (!tenantId || !billingPlanId) {
      await paymentRef.set({
        status: 'failed',
        failureReason: 'Missing tenantId or billingPlanId on payment record',
        providerStatus,
        updatedAt: new Date(),
      }, { merge: true });
      res.status(200).json({ success: true });
      return;
    }

    if (currentStatus === 'completed') {
      res.status(200).json({ success: true, alreadyProcessed: true });
      return;
    }

    if (FINAL_SUCCESS_STATUSES.has(providerStatus)) {
      await activateTenantSubscription(tenantId, billingPlanId);

      await paymentRef.set({
        status: 'completed',
        providerStatus,
        providerTransactionId: body.collection?.provider_transaction_id ?? null,
        paidAt: body.transaction?.updated_at ? new Date(body.transaction.updated_at) : new Date(),
        webhookEventType: body.event_type ?? null,
        updatedAt: new Date(),
      }, { merge: true });

      res.status(200).json({ success: true });
      return;
    }

    if (FINAL_FAILED_STATUSES.has(providerStatus)) {
      await paymentRef.set({
        status: 'failed',
        providerStatus,
        providerTransactionId: body.collection?.provider_transaction_id ?? null,
        webhookEventType: body.event_type ?? null,
        updatedAt: new Date(),
      }, { merge: true });

      res.status(200).json({ success: true });
      return;
    }

    await paymentRef.set({
      status: providerStatus,
      providerStatus,
      providerTransactionId: body.collection?.provider_transaction_id ?? null,
      webhookEventType: body.event_type ?? null,
      updatedAt: new Date(),
    }, { merge: true });

    res.status(200).json({ success: true });
  } catch (e) {
    console.error('Failed to process Marz Pay webhook:', e);
    res.status(500).json({ error: 'Failed to process Marz Pay webhook' });
  }
});
