import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTenant } from '../TenantContext';
import { api } from '../api';
import { useIsMobile } from '../hooks/useIsMobile';

type AgentNote = {
  noteId: string;
  tenantId: string;
  conversationId: string;
  userId: string | null;
  externalUserId: string | null;
  patientName: string | null;
  content: string;
  category: 'common_questions' | 'keywords' | 'analytics' | 'insights' | 'other';
  status: 'unread' | 'read' | 'archived';
  createdAt: number | null;
  updatedAt: number | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
};

function inferChannel(note: AgentNote): 'whatsapp' | 'widget' | 'unknown' {
  if (note.userId?.startsWith('whatsapp:') || note.externalUserId?.startsWith('whatsapp:')) return 'whatsapp';
  if (note.userId?.startsWith('widget:') || note.externalUserId?.startsWith('widget-device:')) return 'widget';
  return 'unknown';
}

function identityKey(note: AgentNote): string {
  const channel = inferChannel(note);
  const external = note.externalUserId?.trim();
  const scoped = note.userId?.trim();
  if (channel === 'whatsapp') return `whatsapp:${external ?? scoped ?? 'unknown'}`;
  if (channel === 'widget') return `widget:${external ?? scoped ?? 'unknown'}`;
  return `other:${external ?? scoped ?? 'unknown'}`;
}

export default function AgentNotebook() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [allNotes, setAllNotes] = useState<AgentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'read' | 'archived'>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | AgentNote['category']>('all');
  const [selectedIdentity, setSelectedIdentity] = useState<'all' | string>('all');
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadNotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.append('status', filterStatus);
      params.append('limit', '300');

      const url = `/tenants/${tenantId}/agent-notes${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await api<{ notes: AgentNote[] }>(url);
      setAllNotes(data.notes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [tenantId, filterStatus]);

  const identityOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const note of allNotes) {
      uniq.add(identityKey(note));
    }
    return Array.from(uniq).sort();
  }, [allNotes]);

  const notes = useMemo(() => {
    let filtered = allNotes;

    if (filterCategory !== 'all') {
      filtered = filtered.filter((n) => n.category === filterCategory);
    }

    if (selectedIdentity !== 'all') {
      filtered = filtered.filter((n) => identityKey(n) === selectedIdentity);
    }

    if (searchKeyword.trim()) {
      const keyword = searchKeyword.trim().toLowerCase();
      filtered = filtered.filter((n) =>
        n.content.toLowerCase().includes(keyword) ||
        (n.patientName && n.patientName.toLowerCase().includes(keyword)) ||
        (n.userId && n.userId.toLowerCase().includes(keyword)) ||
        (n.externalUserId && n.externalUserId.toLowerCase().includes(keyword))
      );
    }

    return filtered;
  }, [allNotes, filterCategory, selectedIdentity, searchKeyword]);

  const notesByIdentity = useMemo(() => {
    const grouped: Record<string, AgentNote[]> = {};
    for (const note of notes) {
      const key = identityKey(note);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(note);
    }
    return grouped;
  }, [notes]);

  const updateNoteStatus = async (noteId: string, status: AgentNote['status']) => {
    try {
      await api(`/tenants/${tenantId}/agent-notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadNotes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update note');
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    try {
      await api(`/tenants/${tenantId}/agent-notes/${noteId}`, { method: 'DELETE' });
      await loadNotes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    }
  };

  const categoryLabels: Record<AgentNote['category'], string> = {
    common_questions: 'Common Questions',
    keywords: 'Keywords',
    analytics: 'Analytics',
    insights: 'Insights',
    other: 'Other',
  };

  const categoryColors: Record<AgentNote['category'], string> = {
    common_questions: '#3b82f6',
    keywords: '#ef4444',
    analytics: '#10b981',
    insights: '#8b5cf6',
    other: '#64748b',
  };

  const statusColors: Record<AgentNote['status'], string> = {
    unread: '#f59e0b',
    read: '#10b981',
    archived: '#94a3b8',
  };

  const unreadCount = notes.filter((n) => n.status === 'unread').length;

  return (
    <div style={{ padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Agent Notebook</h1>
      <p style={{ color: '#64748b', marginBottom: 32, maxWidth: 800 }}>
        Review automated insights and analytics generated by the agent during user conversations.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            placeholder="Search notes..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <select value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)} style={{ minWidth: 140 }}>
          <option value="all">All Status</option>
          <option value="unread">Unread ({unreadCount})</option>
          <option value="read">Read</option>
          <option value="archived">Archived</option>
        </select>
        <select value={filterCategory} onChange={(e: any) => setFilterCategory(e.target.value)} style={{ minWidth: 160 }}>
          <option value="all">All Categories</option>
          <option value="common_questions">Common Questions</option>
          <option value="keywords">Keywords</option>
          <option value="analytics">Analytics</option>
          <option value="insights">Insights</option>
        </select>
        <select value={selectedIdentity} onChange={(e: any) => setSelectedIdentity(e.target.value)} style={{ minWidth: 220 }}>
          <option value="all">All Users / Devices</option>
          {identityOptions.map((identity) => (
            <option key={identity} value={identity}>{identity}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading notes...</div>
      ) : notes.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', color: '#94a3b8' }}>
          No notes found matching your criteria.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(notesByIdentity).sort(([a], [b]) => a.localeCompare(b)).map(([identity, identityNotes]) => (
            <section key={identity} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#334155' }}>{identity}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {identityNotes.map((note) => (
                  <div
                    key={note.noteId}
                    style={{
                      padding: 20,
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: `${categoryColors[note.category]}15`,
                          color: categoryColors[note.category]
                        }}>
                          {categoryLabels[note.category]}
                        </span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: `${statusColors[note.status]}15`,
                          color: statusColors[note.status]
                        }}>
                          {note.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                      </div>
                    </div>

                    <div style={{ fontSize: 15, color: '#1e293b', lineHeight: 1.6, marginBottom: 16 }}>
                      <ReactMarkdown>{note.content}</ReactMarkdown>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                      <div style={{ fontSize: 12, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {note.patientName && <span>Patient: <strong>{note.patientName}</strong></span>}
                        {note.userId && <span>User Scope ID: <strong>{note.userId}</strong></span>}
                        {note.externalUserId && <span>External User ID: <strong>{note.externalUserId}</strong></span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {note.status === 'unread' && (
                          <button
                            onClick={() => updateNoteStatus(note.noteId, 'read')}
                            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: '#f0fdf4', color: '#166534', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                          >
                            Mark Read
                          </button>
                        )}
                        <button
                          onClick={() => deleteNote(note.noteId)}
                          style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'transparent', color: '#ef4444', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
