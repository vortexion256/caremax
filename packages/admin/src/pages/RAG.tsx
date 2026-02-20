import { useState, useEffect } from 'react';
import { api, type RagDoc, type RagDocDetail } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function RAG() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
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

  if (loading) return <div style={{ color: '#64748b', padding: isMobile ? 16 : 0 }}>Loading knowledge base...</div>;

  const getCappedTitle = (title: string) => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length <= 50) return trimmedTitle;
    return `${trimmedTitle.slice(0, 47)}...`;
  };

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Knowledge Base</h1>
      <p style={{ color: '#64748b', marginBottom: isMobile ? 24 : 32, maxWidth: 600, fontSize: isMobile ? 14 : 16 }}>
        Upload text documents to provide your agent with specific knowledge.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 32 : 40, alignItems: 'start' }}>
        <section style={{ width: '100%', flex: 1 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 16px 0', color: '#0f172a' }}>Add New Document</h2>
          <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Document Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '10px 12px', 
                  border: '1px solid #e2e8f0', 
                  borderRadius: 8,
                  fontSize: 16 // Prevent iOS zoom
                }}
                placeholder="e.g. Company Policy, FAQ"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Content (Plain Text)
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={isMobile ? 6 : 8}
                style={{ 
                  width: '100%', 
                  padding: '10px 12px', 
                  border: '1px solid #e2e8f0', 
                  borderRadius: 8,
                  fontSize: 16,
                  fontFamily: 'inherit'
                }}
                placeholder="Paste the document content here..."
              />
            </div>
            <button 
              type="submit" 
              disabled={adding}
              style={{
                padding: '12px 24px',
                width: isMobile ? '100%' : 'auto',
                fontSize: 14,
                fontWeight: 600,
                backgroundColor: adding ? '#94a3b8' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: adding ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              {adding ? 'Processing...' : 'Add Document'}
            </button>
          </form>
        </section>

        <section style={{ width: '100%', flex: 1 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 16px 0', color: '#0f172a' }}>Indexed Documents</h2>
          {docs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
              No documents added yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {docs.map((d) => (
                <div 
                  key={d.documentId} 
                  style={{ 
                    padding: '16px', 
                    background: '#fff',
                    border: '1px solid #e2e8f0', 
                    borderRadius: 12,
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    gap: 12 
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ 
                      fontWeight: 600, 
                      color: '#1e293b', 
                      fontSize: 14, 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis' 
                    }}>{getCappedTitle(d.name)}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, textTransform: 'capitalize' }}>Status: {d.status}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => setEditingId(d.documentId)}
                      style={{ 
                        padding: '6px 12px', 
                        fontSize: 13, 
                        background: '#fff', 
                        border: '1px solid #e2e8f0', 
                        borderRadius: 6, 
                        cursor: 'pointer', 
                        fontWeight: 500 
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(d.documentId)}
                      disabled={deletingId === d.documentId}
                      style={{ 
                        padding: '6px 12px', 
                        fontSize: 13, 
                        color: '#ef4444', 
                        background: 'transparent', 
                        border: 'none', 
                        cursor: 'pointer', 
                        fontWeight: 500 
                      }}
                    >
                      {deletingId === d.documentId ? '...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editingId && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(15, 23, 42, 0.4)', 
            backdropFilter: 'blur(4px)',
            display: 'flex', 
            alignItems: isMobile ? 'flex-end' : 'center', 
            justifyContent: 'center', 
            zIndex: 2000 
          }} 
          onClick={() => setEditingId(null)}
        >
          <div 
            style={{ 
              background: '#fff', 
              padding: isMobile ? '24px 20px 40px' : 32, 
              borderRadius: isMobile ? '20px 20px 0 0' : 16, 
              maxWidth: 640, 
              width: '100%', 
              maxHeight: isMobile ? '90vh' : '90vh', 
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }} 
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 24px 0', fontSize: 20, color: '#0f172a' }}>Edit Document</h2>
            {editLoading ? (
              <div style={{ color: '#64748b' }}>Loading content...</div>
            ) : (
              <form onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Document Name
                  </label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ 
                      width: '100%', 
                      padding: '10px 12px', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: 8,
                      fontSize: 16
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Content
                  </label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={isMobile ? 10 : 12}
                    style={{ 
                      width: '100%', 
                      padding: '10px 12px', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: 8,
                      fontSize: 16,
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button 
                    type="button" 
                    onClick={() => setEditingId(null)}
                    style={{ 
                      flex: isMobile ? 1 : 'none',
                      padding: '10px 20px', 
                      fontSize: 14, 
                      background: '#fff', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: 8, 
                      cursor: 'pointer', 
                      fontWeight: 500 
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={editSaving}
                    style={{ 
                      flex: isMobile ? 1 : 'none',
                      padding: '10px 24px', 
                      fontSize: 14, 
                      fontWeight: 600, 
                      background: '#2563eb', 
                      color: '#fff', 
                      border: 'none', 
                      borderRadius: 8, 
                      cursor: 'pointer' 
                    }}
                  >
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
