import { useState, useEffect } from 'react';
import { api, type AgentRecord, type AgentBrainModificationRequest } from '../api';
import { useTenant } from '../TenantContext';

export default function AutoAgentBrain() {
  const { tenantId } = useTenant();
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
      const result = await api<{ modificationRequestsCreated: number }>(`/tenants/${tenantId}/agent-records/consolidate`, { method: 'POST' });
      load();
      if (result.modificationRequestsCreated > 0) {
        // Optional: could show a brief success message
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run consolidation');
    } finally {
      setConsolidating(false);
    }
  };

  const formatDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString() : '—';

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Auto Agent Brain</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Records the agent automatically saves when it learns new information (e.g. after the care team or user provides details the agent didn’t know). These are indexed and used in RAG so the agent can answer next time. You can view, edit, or delete entries here. The agent can request edits or deletions; those appear under Modification requests and require your approval before they are applied.
      </p>
      {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}

      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={runConsolidation}
          disabled={consolidating || records.length === 0}
          style={{
            padding: '8px 16px',
            fontSize: 14,
            background: consolidating || records.length === 0 ? '#ccc' : '#0d47a1',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: consolidating || records.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {consolidating ? 'Checking & consolidating…' : 'Check and consolidate memory'}
        </button>
        <span style={{ fontSize: 13, color: '#666' }}>
          Asks the agent to review all records and propose merging or removing duplicate/scattered related entries. Proposals appear under Modification requests for you to approve.
        </span>
      </div>

      {modRequests.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Modification requests</h2>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 12 }}>
            The agent has requested the following changes. Approve to apply them to its memory, or reject to discard. This prevents users from manipulating the agent into deleting or changing important information.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: 24 }}>
            {modRequests.map((req) => (
              <li
                key={req.requestId}
                style={{
                  padding: 12,
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  marginBottom: 8,
                  backgroundColor: '#fafafa',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{req.type === 'edit' ? 'Edit' : 'Delete'} record</strong> — record ID: <code style={{ fontSize: 12 }}>{req.recordId}</code>
                    {req.type === 'edit' && (req.title != null || req.content != null) && (
                      <div style={{ marginTop: 8, fontSize: 14, color: '#555' }}>
                        {req.title != null && <div><strong>New title:</strong> {req.title}</div>}
                        {req.content != null && <div><strong>New content:</strong> {req.content.length > 200 ? `${req.content.slice(0, 200)}…` : req.content}</div>}
                      </div>
                    )}
                    {req.reason && <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#666' }}>Reason: {req.reason}</p>}
                    <p style={{ margin: 4, fontSize: 12, color: '#888' }}>{formatDate(req.createdAt)}</p>
                  </div>
                  <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => approveRequest(req.requestId)}
                      disabled={actioningRequestId === req.requestId}
                      style={{ padding: '6px 12px', fontSize: 13, background: '#1b5e20', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    >
                      {actioningRequestId === req.requestId ? '…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectRequest(req.requestId)}
                      disabled={actioningRequestId === req.requestId}
                      style={{ padding: '6px 12px', fontSize: 13, background: '#fff', border: '1px solid #c62828', color: '#c62828', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Reject
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Learned records</h2>
      {records.length === 0 ? (
        <p>No records yet. When the agent learns something new (e.g. after a handoff), it will save it here if RAG is enabled in Agent settings.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {records.map((r) => (
            <li
              key={r.recordId}
              style={{
                padding: '12px 0',
                borderBottom: '1px solid #eee',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.title}</strong>
                <p style={{ margin: '4px 0 0 0', color: '#555', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                  {r.content.length > 200 ? `${r.content.slice(0, 200)}…` : r.content}
                </p>
                <p style={{ margin: 4, fontSize: 12, color: '#888' }}>{formatDate(r.createdAt)}</p>
              </div>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => setEditingId(r.recordId)} style={{ padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.recordId)}
                  disabled={deletingId === r.recordId}
                  style={{ padding: '4px 10px', fontSize: 13, cursor: 'pointer', color: '#c62828' }}
                >
                  {deletingId === r.recordId ? 'Deleting...' : 'Delete'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editingId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setEditingId(null)}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              maxWidth: 600,
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px 0', fontSize: 18 }}>Edit record</h2>
            {editLoading ? (
              <p>Loading...</p>
            ) : (
              <form onSubmit={saveEdit}>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Title
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Content
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={8}
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button type="submit" disabled={editSaving}>
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Cancel
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
