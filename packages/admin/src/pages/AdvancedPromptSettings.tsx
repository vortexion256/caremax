import { useState, useEffect } from 'react';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';

export default function AdvancedPromptSettings() {
  const { tenantId } = useTenant();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Partial<AgentConfig> | null>(null);

  useEffect(() => {
    api<AgentConfig>(`/tenants/${tenantId}/agent-config`)
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    
    // Show confirmation dialog
    setPendingChanges({
      learningOnlyPrompt: config.learningOnlyPrompt,
      learningOnlyPromptEnabled: config.learningOnlyPromptEnabled,
      consolidationPrompt: config.consolidationPrompt,
      consolidationPromptEnabled: config.consolidationPromptEnabled,
    });
    setShowConfirmDialog(true);
  };

  const confirmSave = async () => {
    if (!config || !pendingChanges) return;
    
    setShowConfirmDialog(false);
    setSaving(true);
    setError(null);
    
    try {
      const updated = await api<AgentConfig>(`/tenants/${tenantId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({
          learningOnlyPrompt: config.learningOnlyPrompt?.trim() || undefined,
          learningOnlyPromptEnabled: config.learningOnlyPromptEnabled === true,
          consolidationPrompt: config.consolidationPrompt?.trim() || undefined,
          consolidationPromptEnabled: config.consolidationPromptEnabled === true,
        }),
      });
      setConfig(updated);
      setPendingChanges(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const cancelSave = () => {
    setShowConfirmDialog(false);
    setPendingChanges(null);
  };

  if (config === null && !error) return <p>Loading...</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Advanced Prompt Settings</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        ⚠️ <strong>Warning:</strong> These prompts control critical agent behavior. Only modify if you understand the impact.
        Changes affect how the agent learns from conversations and consolidates knowledge.
      </p>
      
      {error && <p style={{ color: '#c62828', marginBottom: 16, padding: 12, background: '#ffebee', borderRadius: 4 }}>{error}</p>}
      
      <form onSubmit={handleSave} style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 20, background: '#fafafa' }}>
          <h2 style={{ margin: '0 0 12px 0', fontSize: 18 }}>Learning-Only Prompt</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            Used when reviewing conversations after a human care team member finishes helping. 
            The agent extracts information to add/edit/delete Auto Agent Brain records.
          </p>
          <p style={{ fontSize: 12, color: config?.learningOnlyPromptEnabled ? '#166534' : '#7f1d1d', marginBottom: 12, fontWeight: 600 }}>
            Current status: {config?.learningOnlyPromptEnabled ? 'Active custom prompt (editable)' : 'Default system prompt active'}
          </p>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12, fontStyle: 'italic' }}>
            Use <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 3 }}>{'{existingRecords}'}</code> as a placeholder 
            to insert the current Auto Agent Brain records list. If omitted, records will be appended automatically.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, fontWeight: 600, color: '#333' }}>
            <input
              type="checkbox"
              checked={config?.learningOnlyPromptEnabled === true}
              onChange={(e) => setConfig((c) => (c ? { ...c, learningOnlyPromptEnabled: e.target.checked } : c))}
            />
            Make current learning prompt active
          </label>
          <label>
            <textarea
              value={config?.learningOnlyPrompt ?? ''}
              onChange={(e) => setConfig((c) => (c ? { ...c, learningOnlyPrompt: e.target.value } : c))}
              rows={12}
              style={{ 
                display: 'block', 
                width: '100%', 
                padding: 12, 
                marginTop: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                border: '1px solid #ccc',
                borderRadius: 4,
              }}
              placeholder={`You are reviewing a conversation after a human care team member has finished helping the user. Your only job is to identify information from this conversation (by the user or care team in messages labeled "[Care team said to the user]: ...") that should be reflected in the Auto Agent Brain—e.g. contact details, phone numbers, policy info, or corrections.

--- Current Auto Agent Brain records (check these first) ---
{existingRecords}
--- End of existing records ---

You MUST decide for each piece of information:
1) If it UPDATES or CORRECTS an existing record (e.g. new phone number for same branch, changed hours)—use request_edit_record with that record's recordId; do NOT add a new record.
2) If a record is obsolete or wrong and should be removed—use request_delete_record with that recordId.
3) Only use record_learned_knowledge for genuinely NEW information that does not overlap any existing record (no similar title/topic).
If there is nothing new or nothing to update/remove, do not call any tool.`}
            />
          </label>
        </div>

        <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 20, background: '#fafafa' }}>
          <h2 style={{ margin: '0 0 12px 0', fontSize: 18 }}>Consolidation Prompt</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            Used when consolidating Auto Agent Brain records to merge duplicates and scattered information.
            The agent reviews all records and proposes edits/deletes to merge related data.
          </p>
          <p style={{ fontSize: 12, color: config?.consolidationPromptEnabled ? '#166534' : '#7f1d1d', marginBottom: 12, fontWeight: 600 }}>
            Current status: {config?.consolidationPromptEnabled ? 'Active custom prompt (editable)' : 'Default system prompt active'}
          </p>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 12, fontStyle: 'italic' }}>
            Use <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 3 }}>{'{recordsBlock}'}</code> as a placeholder 
            to insert the formatted records list. If omitted, records will be appended automatically.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, fontWeight: 600, color: '#333' }}>
            <input
              type="checkbox"
              checked={config?.consolidationPromptEnabled === true}
              onChange={(e) => setConfig((c) => (c ? { ...c, consolidationPromptEnabled: e.target.checked } : c))}
            />
            Make current consolidation prompt active
          </label>
          <label>
            <textarea
              value={config?.consolidationPrompt ?? ''}
              onChange={(e) => setConfig((c) => (c ? { ...c, consolidationPrompt: e.target.value } : c))}
              rows={12}
              style={{ 
                display: 'block', 
                width: '100%', 
                padding: 12, 
                marginTop: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                border: '1px solid #ccc',
                borderRadius: 4,
              }}
              placeholder={`You are consolidating the Auto Agent Brain: a knowledge base of records. Your task is to find records that are about the SAME topic or are duplicates/scattered (e.g. multiple "Ntinda Branch" or "Kampala Kololo" entries with overlapping or updated info).

Below are the current records (recordId, title, content).

Instructions:
1) Identify groups of records that cover the same topic or are clearly related (e.g. same branch, same location, same policy).
2) For each group: choose ONE record to keep as the single source of truth. Use request_edit_record to update that record's title and content with consolidated, merged information (combine the facts, remove redundancy, keep the most up-to-date details). Use request_delete_record on the OTHER records in the group so they are removed (redundant).
3) Do not add new records. Only use request_edit_record and request_delete_record.
4) If a record has no duplicates or related records, leave it unchanged (do not call any tool for it).
5) Be conservative: only consolidate when records are clearly about the same thing. When in doubt, leave as is.

--- Current records ---
{recordsBlock}
--- End of records ---

Review the list above and submit edit/delete requests to consolidate scattered or duplicate data.`}
            />
          </label>
        </div>

        <button 
          type="submit" 
          disabled={saving} 
          style={{ 
            padding: '12px 24px', 
            alignSelf: 'flex-start',
            background: '#0d47a1',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 14,
            fontWeight: 500,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={cancelSave}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: 24,
              maxWidth: 500,
              width: '90%',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px 0', fontSize: 20, color: '#c62828' }}>
              ⚠️ Confirm Changes
            </h2>
            <p style={{ margin: '0 0 20px 0', lineHeight: 1.6, color: '#333' }}>
              You are about to modify advanced prompt settings. These changes will affect how the agent:
            </p>
            <ul style={{ margin: '0 0 20px 0', paddingLeft: 20, lineHeight: 1.8, color: '#555' }}>
              <li>Learns from conversations after human handoffs</li>
              <li>Consolidates and merges knowledge base records</li>
            </ul>
            <p style={{ margin: '0 0 20px 0', lineHeight: 1.6, color: '#c62828', fontWeight: 500 }}>
              <strong>Are you sure you want to proceed?</strong>
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={cancelSave}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSave}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: 4,
                  background: '#c62828',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Yes, Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
