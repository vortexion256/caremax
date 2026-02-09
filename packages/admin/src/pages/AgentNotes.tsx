import { useEffect, useState } from 'react';
import { useTenant } from '../TenantContext';
import { api } from '../api';

type AgentNote = {
  noteId: string;
  tenantId: string;
  conversationId: string;
  userId: string | null;
  patientName: string | null;
  content: string;
  category: 'common_questions' | 'keywords' | 'analytics' | 'insights' | 'other';
  status: 'pending' | 'reviewed' | 'archived';
  createdAt: number | null;
  updatedAt: number | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
};

export default function AgentNotes() {
  const { tenantId } = useTenant();
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'reviewed' | 'archived'>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | AgentNote['category']>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [consolidating, setConsolidating] = useState(false);
  const [showConsolidationDialog, setShowConsolidationDialog] = useState(false);
  const [consolidationResult, setConsolidationResult] = useState<{ notesConsolidated: number } | null>(null);

  const loadNotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.append('status', filterStatus);
      params.append('limit', '200');
      
      const url = `/tenants/${tenantId}/agent-notes${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await api<{ notes: AgentNote[] }>(url);
      
      // Filter by category and keyword client-side
      let filtered = data.notes;
      if (filterCategory !== 'all') {
        filtered = filtered.filter((n) => n.category === filterCategory);
      }
      if (searchKeyword.trim()) {
        const keyword = searchKeyword.trim().toLowerCase();
        filtered = filtered.filter((n) => 
          n.content.toLowerCase().includes(keyword) ||
          (n.patientName && n.patientName.toLowerCase().includes(keyword))
        );
      }
      
      setNotes(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [tenantId, filterStatus, filterCategory, searchKeyword]);

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

  const runConsolidation = async () => {
    setConsolidating(true);
    setError(null);
    setConsolidationResult(null);
    try {
      const result = await api<{ notesConsolidated: number }>(`/tenants/${tenantId}/agent-notes/consolidate`, { method: 'POST' });
      await loadNotes();
      setConsolidationResult(result);
      // Show success message for a few seconds
      setTimeout(() => {
        setConsolidationResult(null);
      }, 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run consolidation');
    } finally {
      setConsolidating(false);
      setShowConsolidationDialog(false);
    }
  };

  const handleConsolidationClick = () => {
    setShowConsolidationDialog(true);
  };

  const handleConsolidationConfirm = () => {
    runConsolidation();
  };

  const handleConsolidationCancel = () => {
    setShowConsolidationDialog(false);
  };

  const categoryColors: Record<AgentNote['category'], string> = {
    common_questions: '#1976d2',
    keywords: '#d32f2f',
    analytics: '#388e3c',
    insights: '#7b1fa2',
    other: '#666',
  };

  const statusColors: Record<AgentNote['status'], string> = {
    pending: '#ff9800',
    reviewed: '#4caf50',
    archived: '#9e9e9e',
  };

  const pendingCount = notes.filter((n) => n.status === 'pending').length;
  const commonQuestionsCount = notes.filter((n) => n.category === 'common_questions').length;
  const keywordsCount = notes.filter((n) => n.category === 'keywords').length;
  const analyticsCount = notes.filter((n) => n.category === 'analytics').length;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Agent Notes</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Review notes created by the agent during conversations. The agent tracks analytics and insights such as most common questions, frequently asked about items, keywords, trends, and user behavior patterns to help improve the service.
      </p>

      {/* Consolidation Button */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleConsolidationClick}
          disabled={consolidating || notes.length === 0}
          style={{
            padding: '8px 16px',
            fontSize: 14,
            background: consolidating || notes.length === 0 ? '#ccc' : '#0d47a1',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: consolidating || notes.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {consolidating ? 'Checking & consolidating…' : 'Check and consolidate notes'}
        </button>
        <span style={{ fontSize: 13, color: '#666' }}>
          Asks the agent to review all notes and merge duplicates or similar notes to avoid redundancy and repetition.
        </span>
      </div>

      {/* Consolidation Success Message */}
      {consolidationResult && consolidationResult.notesConsolidated > 0 && (
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: '#e8f5e9', 
          border: '1px solid #4caf50', 
          borderRadius: 6, 
          marginBottom: 16, 
          color: '#2e7d32', 
          fontSize: 14 
        }}>
          ✓ Successfully consolidated {consolidationResult.notesConsolidated} note{consolidationResult.notesConsolidated !== 1 ? 's' : ''}. Duplicate and similar notes have been merged.
        </div>
      )}

      {/* Consolidation Confirmation Dialog */}
      {showConsolidationDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: 8,
            padding: 24,
            maxWidth: 500,
            width: '90%',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 20, fontWeight: 600 }}>
              Consolidate Agent Notes
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#333', lineHeight: 1.6 }}>
              The agent will review all {notes.length} note{notes.length !== 1 ? 's' : ''} and identify duplicates or similar notes that cover the same topic.
            </p>
            <div style={{ 
              backgroundColor: '#f5f5f5', 
              padding: 12, 
              borderRadius: 6, 
              marginBottom: 16,
              fontSize: 13,
              color: '#666',
            }}>
              <strong style={{ display: 'block', marginBottom: 8, color: '#333' }}>What will happen:</strong>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                <li>Similar or duplicate notes will be merged into a single consolidated note</li>
                <li>Redundant notes will be deleted</li>
                <li>Important information from all notes will be preserved in the merged note</li>
                <li>This process cannot be undone</li>
              </ul>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={handleConsolidationCancel}
                disabled={consolidating}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  backgroundColor: '#f5f5f5',
                  color: '#333',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  cursor: consolidating ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConsolidationConfirm}
                disabled={consolidating}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  backgroundColor: consolidating ? '#ccc' : '#0d47a1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: consolidating ? 'not-allowed' : 'pointer',
                }}
              >
                {consolidating ? 'Processing...' : 'OK, Proceed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '0 0 180px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Pending Review</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#ff9800' }}>{pendingCount}</div>
        </div>
        <div
          style={{
            flex: '0 0 180px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Common Questions</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#1976d2' }}>{commonQuestionsCount}</div>
        </div>
        <div
          style={{
            flex: '0 0 180px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Keywords</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#d32f2f' }}>{keywordsCount}</div>
        </div>
        <div
          style={{
            flex: '0 0 180px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Analytics</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#388e3c' }}>{analyticsCount}</div>
        </div>
        <div
          style={{
            flex: '0 0 180px',
            padding: 16,
            borderRadius: 8,
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Notes</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{notes.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, border: '1px solid #ddd' }}
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as typeof filterCategory)}
          style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, border: '1px solid #ddd' }}
        >
          <option value="all">All Categories</option>
          <option value="common_questions">Common Questions</option>
          <option value="keywords">Keywords</option>
          <option value="analytics">Analytics</option>
          <option value="insights">Insights</option>
          <option value="other">Other</option>
        </select>
        <input
          type="text"
          placeholder="Search by keyword..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, border: '1px solid #ddd', minWidth: 200 }}
        />
        <button
          onClick={loadNotes}
          style={{
            padding: '6px 16px',
            fontSize: 14,
            backgroundColor: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#ffebee', border: '1px solid #ef5350', borderRadius: 6, marginBottom: 16, color: '#c62828', fontSize: 14 }}>
          {error}
        </div>
      )}

      {loading && <p>Loading notes...</p>}

      {!loading && notes.length === 0 && (
        <p style={{ color: '#666' }}>No notes found matching your filters.</p>
      )}

      {!loading && notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notes.map((note) => (
            <div
              key={note.noteId}
              style={{
                padding: 16,
                borderRadius: 8,
                backgroundColor: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                borderLeft: `4px solid ${categoryColors[note.category]}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        backgroundColor: categoryColors[note.category],
                        color: 'white',
                      }}
                    >
                      {note.category === 'common_questions' ? 'Common Questions' :
                       note.category === 'keywords' ? 'Keywords' :
                       note.category === 'analytics' ? 'Analytics' :
                       note.category === 'insights' ? 'Insights' : 'Other'}
                    </span>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        backgroundColor: statusColors[note.status],
                        color: 'white',
                      }}
                    >
                      {note.status}
                    </span>
                    {note.patientName && (
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>
                        User: {note.patientName}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: '#333', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {note.content}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {note.createdAt && (
                    <>
                      Created: {new Date(note.createdAt).toLocaleString()}
                      {note.reviewedAt && ` · Reviewed: ${new Date(note.reviewedAt).toLocaleString()}`}
                    </>
                  )}
                  {note.conversationId && (
                    <span style={{ marginLeft: 12, fontFamily: 'monospace', fontSize: 11 }}>
                      Conv: {note.conversationId.slice(0, 8)}...
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {note.status === 'pending' && (
                    <button
                      onClick={() => updateNoteStatus(note.noteId, 'reviewed')}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Mark Reviewed
                    </button>
                  )}
                  {note.status === 'reviewed' && (
                    <>
                      <button
                        onClick={() => updateNoteStatus(note.noteId, 'pending')}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          backgroundColor: '#ff9800',
                          color: 'white',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Mark Pending
                      </button>
                      <button
                        onClick={() => updateNoteStatus(note.noteId, 'archived')}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          backgroundColor: '#9e9e9e',
                          color: 'white',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Archive
                      </button>
                    </>
                  )}
                  {note.status === 'archived' && (
                    <button
                      onClick={() => updateNoteStatus(note.noteId, 'reviewed')}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Unarchive
                    </button>
                  )}
                  <button
                    onClick={() => deleteNote(note.noteId)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
