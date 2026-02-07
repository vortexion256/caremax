import { useState, useEffect } from 'react';
import { api, type AgentRecord } from '../api';
import { useTenant } from '../TenantContext';

export default function AutoAgentBrain() {
  const { tenantId } = useTenant();
  const [records, setRecords] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<{ records: AgentRecord[] }>(`/tenants/${tenantId}/agent-records`)
      .then((r) => setRecords(r.records))
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

  const formatDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString() : '—';

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Auto Agent Brain</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Records the agent automatically saves when it learns new information (e.g. after the care team or user provides details the agent didn’t know). These are indexed and used in RAG so the agent can answer next time. You can view, edit, or delete entries here.
      </p>
      {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}

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
