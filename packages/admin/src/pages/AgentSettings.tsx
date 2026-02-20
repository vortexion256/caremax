import { useState, useEffect } from 'react';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function AgentSettings() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api<AgentConfig>(`/tenants/${tenantId}/agent-config`)
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await api<AgentConfig>(`/tenants/${tenantId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({
          agentName: config.agentName,
          chatTitle: config.chatTitle ?? '',
          welcomeText: config.welcomeText ?? '',
          suggestedQuestions: config.suggestedQuestions ?? [],
          widgetColor: config.widgetColor ?? '#2563eb',
          systemPrompt: config.systemPrompt,
          thinkingInstructions: config.thinkingInstructions,
          model: config.model,
          temperature: config.temperature,
          ragEnabled: config.ragEnabled,
        }),
      });
      setConfig(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (config === null && !error) return <div style={{ color: '#64748b', padding: 20 }}>Loading settings...</div>;

  const labelStyle = { 
    display: 'block', 
    fontSize: 14, 
    fontWeight: 600, 
    color: '#334155', 
    marginBottom: 8 
  };
  
  const helperStyle = { 
    fontSize: 12, 
    color: '#64748b', 
    marginTop: 6, 
    display: 'block',
    lineHeight: 1.5
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 16, // Better for mobile
    backgroundColor: '#fff',
    transition: 'all 0.2s',
    outline: 'none'
  };

  return (
    <div style={{ paddingBottom: 40, padding: isMobile ? '16px 0' : 0 }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Agent Settings</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Configure your AI agent's personality and behavior.</p>
      
      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 12, background: '#f0fdf4', color: '#166534', borderRadius: 8, marginBottom: 20, fontSize: 14 }}>
          Settings saved successfully.
        </div>
      )}

      <form onSubmit={handleSave} style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 20px 0', fontSize: 18, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>General Identity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>
          <div>
            <label style={labelStyle}>Agent Name</label>
            <input
              value={config?.agentName ?? ''}
              onChange={(e) => setConfig((c) => (c ? { ...c, agentName: e.target.value } : c))}
              style={inputStyle}
              placeholder="e.g. CareMax Assistant"
            />
          </div>

          <div>
            <label style={labelStyle}>Chat Widget Title</label>
            <input
              value={config?.chatTitle ?? ''}
              onChange={(e) => setConfig((c) => (c ? { ...c, chatTitle: e.target.value } : c))}
              style={inputStyle}
              placeholder="e.g. ABC Health Support"
            />
            <span style={helperStyle}>Shown in the widget header.</span>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <label style={labelStyle}>Welcome Text (Chat Bubble)</label>
          <input
            value={config?.welcomeText ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, welcomeText: e.target.value } : c))}
            style={inputStyle}
            placeholder="e.g. Hello, how can I be of service?"
          />
          <span style={helperStyle}>The first message the user sees when opening the widget.</span>
        </div>
        </div>

        <div style={{ padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 20px 0', fontSize: 18, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>Interaction Design</h3>
        <div>
          <label style={labelStyle}>Suggested Questions</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(config?.suggestedQuestions ?? []).map((q, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <input
                  value={q}
                  onChange={(e) => {
                    const newQs = [...(config?.suggestedQuestions ?? [])];
                    newQs[i] = e.target.value;
                    setConfig((c) => (c ? { ...c, suggestedQuestions: newQs } : c));
                  }}
                  style={inputStyle}
                  placeholder="Enter a question..."
                />
                <button
                  type="button"
                  onClick={() => {
                    const newQs = (config?.suggestedQuestions ?? []).filter((_, idx) => idx !== i);
                    setConfig((c) => (c ? { ...c, suggestedQuestions: newQs } : c));
                  }}
                  style={{
                    padding: '0 12px',
                    backgroundColor: '#fee2e2',
                    color: '#ef4444',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const newQs = [...(config?.suggestedQuestions ?? []), ''];
                setConfig((c) => (c ? { ...c, suggestedQuestions: newQs } : c));
              }}
              style={{
                padding: '10px',
                backgroundColor: '#f1f5f9',
                color: '#475569',
                border: '1px dashed #cbd5e1',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              + Add Question
            </button>
          </div>
          <span style={helperStyle}>Quick questions users can click to start a conversation.</span>
        </div>

        <div style={{ marginTop: 24 }}>
          <label style={labelStyle}>Widget Theme Color (Hex)</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              type="color"
              value={config?.widgetColor ?? '#2563eb'}
              onChange={(e) => setConfig((c) => (c ? { ...c, widgetColor: e.target.value } : c))}
              style={{ width: 44, height: 44, padding: 0, border: 'none', borderRadius: 8, cursor: 'pointer', backgroundColor: 'transparent' }}
            />
            <input
              value={config?.widgetColor ?? '#2563eb'}
              onChange={(e) => setConfig((c) => (c ? { ...c, widgetColor: e.target.value } : c))}
              style={{ ...inputStyle, width: 140 }}
              placeholder="#2563eb"
            />
          </div>
          <span style={helperStyle}>Changes the color of user messages, buttons, and icons.</span>
        </div>
        </div>

        <div style={{ padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 20px 0', fontSize: 18, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>AI Intelligence & Behavior</h3>
        <div>
          <label style={labelStyle}>System Prompt</label>
          <textarea
            value={config?.systemPrompt ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, systemPrompt: e.target.value } : c))}
            rows={8}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            placeholder="Define your agent's role and style..."
          />
          <span style={helperStyle}>The core instructions that guide how the agent behaves and speaks.</span>
        </div>

        <div>
          <label style={labelStyle}>Thinking Instructions</label>
          <textarea
            value={config?.thinkingInstructions ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, thinkingInstructions: e.target.value } : c))}
            rows={4}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            placeholder="Internal reasoning instructions..."
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>
          <div>
            <label style={labelStyle}>AI Model</label>
            <select
              value={config?.model ?? 'gemini-2.0-flash'}
              onChange={(e) => setConfig((c) => (c ? { ...c, model: e.target.value } : c))}
              style={inputStyle}
            >
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Creativity (Temperature)</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={config?.temperature ?? 0.7}
              onChange={(e) => setConfig((c) => (c ? { ...c, temperature: Number(e.target.value) } : c))}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 16, 
          padding: '20px', 
          background: '#f8fafc', 
          borderRadius: 12,
          border: '1px solid #e2e8f0'
        }}>
          <input
            type="checkbox"
            checked={config?.ragEnabled ?? false}
            onChange={(e) => setConfig((c) => (c ? { ...c, ragEnabled: e.target.checked } : c))}
            style={{ width: 22, height: 22, cursor: 'pointer', accentColor: '#2563eb' }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>Enable Knowledge Base (RAG)</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Allow the agent to use uploaded documents for answering.</div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '14px 32px',
            alignSelf: isMobile ? 'stretch' : 'flex-start',
            fontSize: 15,
            fontWeight: 600,
            backgroundColor: saving ? '#94a3b8' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            cursor: saving ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
            transition: 'all 0.2s'
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
