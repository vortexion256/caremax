import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type MarzPayCredentialStatus = {
  provider: 'marzpay';
  credentials: {
    hasCollectionsUrl: boolean;
    hasPaymentLink: boolean;
    hasCheckoutUrl: boolean;
    hasSecretKey: boolean;
    hasVerifyUrl: boolean;
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
  const [providerStatus, setProviderStatus] = useState<MarzPayCredentialStatus | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('all');
  const [tenantFilter, setTenantFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ payments: Payment[] }>('/platform/billing/payments'),
      api<MarzPayCredentialStatus>('/platform/billing/providers/marzpay/status'),
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

  const tenantOptions = useMemo(() => {
    return Array.from(new Set(payments.map((p) => p.tenantId).filter((t): t is string => Boolean(t)))).sort();
  }, [payments]);

  const filteredPayments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return payments.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (tenantFilter && p.tenantId !== tenantFilter) return false;
      if (!query) return true;
      return [p.txRef, p.customerEmail ?? '', p.billingPlanId ?? '', p.tenantId ?? '', p.status]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [payments, searchTerm, statusFilter, tenantFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedPayments = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredPayments.slice(start, start + pageSize);
  }, [filteredPayments, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, tenantFilter, searchTerm, pageSize]);

  async function deletePayment(paymentId: string) {
    const confirmed = window.confirm('Delete this transaction? This action cannot be undone.');
    if (!confirmed) return;

    try {
      setDeletingPaymentId(paymentId);
      await api(`/platform/billing/payments/${paymentId}`, { method: 'DELETE' });
      setPayments((prev) => prev.filter((p) => p.paymentId !== paymentId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete payment');
    } finally {
      setDeletingPaymentId(null);
    }
  }

  if (loading) return <p>Loading payments...</p>;
  if (error) return <p style={{ color: '#dc2626' }}>Could not load payments: {error}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Payment Transactions</h1>
      <p style={{ color: '#64748b' }}>Monitor Marz Pay payment attempts and completed subscription purchases.</p>

      {providerStatus && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc' }}>
          <strong>Marz Pay config:</strong>{' '}
          collectionsUrl={String(providerStatus.credentials.hasCollectionsUrl)}, paymentLink={String(providerStatus.credentials.hasPaymentLink)}, checkoutUrl={String(providerStatus.credentials.hasCheckoutUrl)}, secret={String(providerStatus.credentials.hasSecretKey)}, verifyUrl={String(providerStatus.credentials.hasVerifyUrl)}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 16,
        alignItems: 'end',
      }}>
        <label>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Search</div>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="tx ref, email, plan..."
            style={{ width: '100%', padding: '8px 10px' }}
          />
        </label>

        <label>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Status</div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={{ width: '100%', padding: '8px 10px' }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </label>

        <label>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Tenant</div>
          <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} style={{ width: '100%', padding: '8px 10px' }}>
            <option value="">All tenants</option>
            {tenantOptions.map((tenantId) => (
              <option key={tenantId} value={tenantId}>{tenantId}</option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Rows per page</div>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: '100%', padding: '8px 10px' }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>

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
              <th align="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedPayments.map((p) => (
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
                <td align="right">
                  <button
                    onClick={() => void deletePayment(p.paymentId)}
                    disabled={deletingPaymentId === p.paymentId}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #fecaca',
                      color: '#b91c1c',
                      background: '#fff5f5',
                      cursor: 'pointer',
                    }}
                  >
                    {deletingPaymentId === p.paymentId ? 'Deleting...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {paginatedPayments.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '16px 8px', color: '#64748b', textAlign: 'center' }}>
                  No payment transactions match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontSize: 13 }}>
          Showing {filteredPayments.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filteredPayments.length)} of {filteredPayments.length}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setPage((curr) => Math.max(1, curr - 1))} disabled={safePage <= 1}>Previous</button>
          <span style={{ fontSize: 13 }}>Page {safePage} / {totalPages}</span>
          <button onClick={() => setPage((curr) => Math.min(totalPages, curr + 1))} disabled={safePage >= totalPages}>Next</button>
        </div>
      </div>
    </div>
  );
}
