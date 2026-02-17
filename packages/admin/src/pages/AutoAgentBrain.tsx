import { useState, useEffect } from 'react';
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

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ records: AgentRecord[] }>(`/tenants/${tenantId}/agent-records`),
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

  const formatDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString() : '—';

  if (loading) return <div style={{ color: '#64748b' }}>Loading memory...</div>;

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Auto Agent Brain</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 800 }}>
        The agent's dynamic memory. It automatically learns from interactions and care team feedback.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: '#f8fafc', 
        padding: 20, 
        borderRadius: 12, 
        border: '1px solid #e2e8f0',
        marginBottom: 32,
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div style={{ flex: '1 1 300px' }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: 16, color: '#0f172a' }}>Memory Optimization</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Analyze memory records to merge duplicates and remove outdated info.
          </p>
        </div>
        <button
          type="button"
          onClick={runConsolidation}
          disabled={consolidating || records.length === 0}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            background: consolidating || records.length === 0 ? '#94a3b8' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: consolidating || records.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {consolidating ? 'Optimizing...' : 'Optimize Memory'}
        </button>
      </div>

      {modRequests.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 16px 0', color: '#0f172a' }}>Modification Requests</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {modRequests.map((req) => (
              <div
                key={req.requestId}
                style={{
                  padding: 20,
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  backgroundColor: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ 
                        fontSize: 11, 
                        fontWeight: 700, 
                        textTransform: 'uppercase', 
                        padding: '2px 8px', 
                        borderRadius: 4, 
                        background: req.type === 'edit' ? '#eff6ff' : '#fef2f2', 
                        color: req.type === 'edit' ? '#2563eb' : '#ef4444' 
                      }}>
                        {req.type}
                      </span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(req.createdAt)}</span>
                    </div>
                    {req.type === 'edit' && (req.title != null || req.content != null) && (
                      <div style={{ fontSize: 14, color: '#1e293b', marginBottom: 8 }}>
                        {req.title != null && <div style={{ fontWeight: 600 }}>{req.title}</div>}
                        {req.content != null && <div style={{ marginTop: 4, color: '#475569' }}><ReactMarkdown>{req.content}</ReactMarkdown></div>}
                      </div>
                    )}
                    {req.reason && <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>Reason: {req.reason}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => approveRequest(req.requestId)}
                      disabled={actioningRequestId === req.requestId}
                      style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectRequest(req.requestId)}
                      disabled={actioningRequestId === req.requestId}
                      style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #e2e8f0', color: '#ef4444', borderRadius: 8, cursor: 'pointer' }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 18, margin: '0 0 16px 0', color: '#0f172a' }}>Learned Records</h2>
        {records.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
            No memory records yet. The agent learns automatically during conversations.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            {records.map((r) => (
              <div
                key={r.recordId}
                style={{
                  padding: 20,
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  backgroundColor: '#fff',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 15, color: '#0f172a', fontWeight: 600 }}>{r.title}</h4>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(r.createdAt)}</span>
                </div>
                <div style={{ margin: '0 0 20px 0', color: '#475569', fontSize: 14, lineHeight: 1.5, flex: 1 }}>
                  <ReactMarkdown>{r.content.length > 150 ? `${r.content.slice(0, 150)}...` : r.content}</ReactMarkdown>
                </div>
                <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                  <button type="button" onClick={() => setEditingId(r.recordId)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', color: '#475569' }}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.recordId)}
                    disabled={deletingId === r.recordId}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.3)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setEditingId(null)}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 16, maxWidth: 640, width: '90%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 24px 0', fontSize: 20, color: '#0f172a' }}>Edit Memory Record</h2>
            {editLoading ? (
              <div style={{ color: '#64748b' }}>Loading...</div>
            ) : (
              <form onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Title</label>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Content</label>
                  <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={8} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="button" onClick={() => setEditingId(null)} style={{ padding: '10px 20px', fontSize: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={editSaving} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                    {editSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
