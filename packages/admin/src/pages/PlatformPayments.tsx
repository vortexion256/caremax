import { useEffect, useState } from 'react';
import { api } from '../api';

type FlutterwaveCredentialStatus = {
  provider: 'flutterwave';
  credentials: {
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasEncryptionKey: boolean;
    hasWebhookSecretHash: boolean;
  };
  readyForCheckout: boolean;
};

type Payment = {
  paymentId: string;
  provider: string;
  tenantId: string | null;
  billingPlanId: string | null;
  txRef: string;
  amount: number;
  currency: string;
  status: string;
  customerEmail: string | null;
  providerStatus: string | null;
  providerTransactionId: number | null;
  createdAt: number | null;
  paidAt: number | null;
};

export default function PlatformPayments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<FlutterwaveCredentialStatus | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ payments: Payment[] }>('/platform/billing/payments'),
      api<FlutterwaveCredentialStatus>('/platform/billing/providers/flutterwave/status'),
    ])
      .then(([paymentsRes, providerRes]) => {
        setPayments(paymentsRes.payments);
        setProviderStatus(providerRes);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load payments');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading payments...</p>;
  if (error) return <p style={{ color: '#dc2626' }}>Could not load payments: {error}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Payment Transactions</h1>
      <p style={{ color: '#64748b' }}>Monitor Flutterwave payment attempts and completed subscription purchases.</p>

      {providerStatus && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc' }}>
          <strong>Flutterwave credentials:</strong>{' '}
          clientId={String(providerStatus.credentials.hasClientId)}, secret={String(providerStatus.credentials.hasClientSecret)}, encryptionKey={String(providerStatus.credentials.hasEncryptionKey)}, webhookHash={String(providerStatus.credentials.hasWebhookSecretHash)}
        </div>
      )}

      <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Time</th>
              <th align="left">Tenant</th>
              <th align="left">Plan</th>
              <th align="left">Customer</th>
              <th align="right">Amount</th>
              <th align="left">Status</th>
              <th align="left">Tx Ref</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.paymentId} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td>{p.createdAt ? new Date(p.createdAt).toLocaleString() : '—'}</td>
                <td>{p.tenantId ?? '—'}</td>
                <td>{p.billingPlanId ?? '—'}</td>
                <td>{p.customerEmail ?? '—'}</td>
                <td align="right">{p.currency} {p.amount.toFixed(2)}</td>
                <td>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontWeight: 600,
                    background: p.status === 'completed' ? '#dcfce7' : p.status === 'failed' ? '#fee2e2' : '#e2e8f0',
                    color: p.status === 'completed' ? '#166534' : p.status === 'failed' ? '#991b1b' : '#334155',
                  }}>
                    {p.status}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace' }}>{p.txRef}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
