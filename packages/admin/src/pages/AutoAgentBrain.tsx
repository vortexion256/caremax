import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { api, type AgentRecord, type AgentBrainModificationRequest } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function AutoAgentBrain() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [records, setRecords] = useState<AgentRecord[]>([]);
  const [modRequests, setModRequests] = useState<AgentBrainModificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actioningRequestId, setActioningRequestId] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [selectedIdentity, setSelectedIdentity] = useState<'all' | 'shared' | string>('all');

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ records: AgentRecord[] }>(`/tenants/${tenantId}/agent-records?includeAllUserScoped=true`),
      api<{ requests: AgentBrainModificationRequest[] }>(`/tenants/${tenantId}/agent-records/modification-requests`),
    ])
      .then(([r, m]) => {
        setRecords(r.records);
        setModRequests(m.requests ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [tenantId]);

  useEffect(() => {
    if (!editingId) return;
    setEditLoading(true);
    setError(null);
    api<AgentRecord>(`/tenants/${tenantId}/agent-records/${editingId}`)
      .then((d) => {
        setEditTitle(d.title ?? '');
        setEditContent(d.content ?? '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setEditLoading(false));
  }, [tenantId, editingId]);

  const identityOptions = useMemo(() => {
    const ids = new Set<string>();
    records.forEach((r) => {
      if (r.scope === 'user' && r.userId) ids.add(r.userId);
    });
    return Array.from(ids).sort();
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (selectedIdentity === 'all') return records;
    if (selectedIdentity === 'shared') return records.filter((r) => r.scope === 'shared');
    return records.filter((r) => r.scope === 'user' && r.userId === selectedIdentity);
  }, [records, selectedIdentity]);

  const groupedRecords = useMemo(() => {
    const grouped: Record<string, AgentRecord[]> = {};
    filteredRecords.forEach((r) => {
      const key = r.scope === 'user' ? (r.userId ?? 'unknown-user') : 'shared';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    });
    return grouped;
  }, [filteredRecords]);

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/agent-records/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editTitle.trim(), content: editContent.trim() }),
      });
      setEditingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async (recordId: string) => {
    if (!confirm('Delete this record? It will be removed from the agent\'s knowledge base.')) return;
    setDeletingId(recordId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/agent-records/${recordId}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const approveRequest = async (requestId: string) => {
    setActioningRequestId(requestId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/agent-records/modification-requests/${requestId}/approve`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setActioningRequestId(null);
    }
  };

  const rejectRequest = async (requestId: string) => {
    setActioningRequestId(requestId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/agent-records/modification-requests/${requestId}/reject`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject');
    } finally {
      setActioningRequestId(null);
    }
  };

  const runConsolidation = async () => {
    setConsolidating(true);
    setError(null);
    try {
      await api<{ modificationRequestsCreated: number }>(`/tenants/${tenantId}/agent-records/consolidate`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run consolidation');
    } finally {
      setConsolidating(false);
    }
  };

  const formatDate = (ms: number | null) => ms ? new Date(ms).toLocaleDateString() : '—';

  if (loading) return <div style={{ color: '#64748b' }}>Loading memory...</div>;

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Auto Agent Brain</h1>
      {error && <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: '1 1 300px' }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: 16, color: '#0f172a' }}>Memory Optimization</h3>
        </div>
        <button type="button" onClick={runConsolidation} disabled={consolidating || records.length === 0} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, background: consolidating || records.length === 0 ? '#94a3b8' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8 }}>
          {consolidating ? 'Optimizing...' : 'Optimize Memory'}
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <select value={selectedIdentity} onChange={(e: any) => setSelectedIdentity(e.target.value)} style={{ minWidth: 280 }}>
          <option value="all">All Users / Devices</option>
          <option value="shared">Shared Memory</option>
          {identityOptions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>

      {modRequests.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 16px 0', color: '#0f172a' }}>Modification Requests</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {modRequests.map((req) => (
              <div key={req.requestId} style={{ padding: 20, border: '1px solid #e2e8f0', borderRadius: 12, backgroundColor: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{req.type}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(req.createdAt)}</span>
                    </div>
                    {req.type === 'edit' && (req.title != null || req.content != null) && (
                      <div style={{ fontSize: 14, color: '#1e293b', marginBottom: 8 }}>
                        {req.title != null && <div style={{ fontWeight: 600 }}>{req.title}</div>}
                        {req.content != null && <div style={{ marginTop: 4, color: '#475569' }}><ReactMarkdown>{req.content}</ReactMarkdown></div>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => approveRequest(req.requestId)} disabled={actioningRequestId === req.requestId}>Approve</button>
                    <button type="button" onClick={() => rejectRequest(req.requestId)} disabled={actioningRequestId === req.requestId}>Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 18, margin: '0 0 16px 0', color: '#0f172a' }}>Learned Records</h2>
        {filteredRecords.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
            No memory records found for this selected user/device.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(groupedRecords).sort(([a], [b]) => a.localeCompare(b)).map(([ownerId, ownerRecords]) => (
              <section key={ownerId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#334155' }}>{ownerId}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                  {ownerRecords.map((r) => (
                    <div key={r.recordId} style={{ padding: 20, border: '1px solid #e2e8f0', borderRadius: 12, backgroundColor: '#fff', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <h4 style={{ margin: 0, fontSize: 15, color: '#0f172a', fontWeight: 600 }}>{r.title}</h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: r.scope === 'shared' ? '#dbeafe' : '#f5d0fe', color: r.scope === 'shared' ? '#1d4ed8' : '#a21caf' }}>
                              {r.scope === 'shared' ? 'Shared Memory' : 'User Memory'}
                            </span>
                            {r.scope === 'user' && r.userId && <span style={{ fontSize: 11, color: '#64748b' }}>User ID: {r.userId}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatDate(r.createdAt)}</span>
                      </div>
                      <div style={{ margin: '0 0 20px 0', color: '#475569', fontSize: 14, lineHeight: 1.5, flex: 1 }}>
                        <ReactMarkdown>{r.content.length > 150 ? `${r.content.slice(0, 150)}...` : r.content}</ReactMarkdown>
                      </div>
                      <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                        <button type="button" onClick={() => setEditingId(r.recordId)}>Edit</button>
                        <button type="button" onClick={() => remove(r.recordId)} disabled={deletingId === r.recordId}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setEditingId(null)}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 16, maxWidth: 640, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 24px 0', fontSize: 20, color: '#0f172a' }}>Edit Memory Record</h2>
            {editLoading ? <div style={{ color: '#64748b' }}>Loading...</div> : (
              <form onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={8} />
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                  <button type="submit" disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
