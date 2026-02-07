import { useState, useEffect } from 'react';
import { api, type RagDoc, type RagDocDetail } from '../api';
import { useTenant } from '../TenantContext';

export default function RAG() {
  const { tenantId } = useTenant();
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    api<{ documents: RagDoc[] }>(`/tenants/${tenantId}/rag/documents`)
      .then((r) => setDocs(r.documents))
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
    api<RagDocDetail>(`/tenants/${tenantId}/rag/documents/${editingId}`)
      .then((d) => {
        setEditName(d.name ?? '');
        setEditContent(d.content ?? '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setEditLoading(false));
  }, [tenantId, editingId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/rag/documents`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), content: content.trim() }),
      });
      setName('');
      setContent('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (documentId: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    setDeletingId(documentId);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/rag/documents/${documentId}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/rag/documents/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim(), content: editContent.trim() }),
      });
      setEditingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>RAG documents</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Add or edit text documents for the agent to use when RAG is enabled in Agent settings.
      </p>
      {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}
      <form onSubmit={add} style={{ maxWidth: 600, marginBottom: 24 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Document name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            placeholder="e.g. First aid guidelines"
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Content (plain text)
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            placeholder="Paste or type content..."
          />
        </label>
        <button type="submit" disabled={adding}>
          {adding ? 'Adding...' : 'Add document'}
        </button>
      </form>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Indexed documents</h2>
      {docs.length === 0 ? (
        <p>No documents yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {docs.map((d) => (
            <li key={d.documentId} style={{ padding: '8px 0', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{d.name} — {d.status}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setEditingId(d.documentId)}
                  style={{ padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(d.documentId)}
                  disabled={deletingId === d.documentId}
                  style={{ padding: '4px 10px', fontSize: 13, cursor: 'pointer', color: '#c62828' }}
                >
                  {deletingId === d.documentId ? 'Deleting...' : 'Delete'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setEditingId(null)}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, maxWidth: 600, width: '90%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 18 }}>Edit document</h2>
            {editLoading ? (
              <p>Loading...</p>
            ) : (
              <form onSubmit={saveEdit}>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Document name
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Content (plain text)
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={10}
                    style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
                    placeholder="Paste or type content... (saving re-indexes the document)"
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
