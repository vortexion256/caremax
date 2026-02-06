import { useState, useEffect } from 'react';
import { api, type RagDoc } from '../api';
import { useTenant } from '../TenantContext';

export default function RAG() {
  const { tenantId } = useTenant();
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => {
    api<{ documents: RagDoc[] }>(`/tenants/${tenantId}/rag/documents`)
      .then((r) => setDocs(r.documents))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [tenantId]);

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

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>RAG documents</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Add text documents for the agent to use when RAG is enabled in Agent settings.
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
            <li key={d.documentId} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              {d.name} — {d.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
