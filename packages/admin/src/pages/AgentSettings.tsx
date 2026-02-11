import { useState, useEffect } from 'react';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function AgentSettings() {
  const { tenantId } = useTenant();
  const { isMobile, isVerySmall } = useIsMobile();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const updated = await api<AgentConfig>(`/tenants/${tenantId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({
          agentName: config.agentName,
          chatTitle: config.chatTitle ?? '',
          systemPrompt: config.systemPrompt,
          thinkingInstructions: config.thinkingInstructions,
          model: config.model,
          temperature: config.temperature,
          ragEnabled: config.ragEnabled,
        }),
      });
      setConfig(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (config === null && !error) return <p>Loading...</p>;

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <h1 style={{ margin: '0 0 16px 0', fontSize: isMobile ? 20 : 24 }}>Agent settings</h1>
      {error && <p style={{ color: '#c62828', marginBottom: 16, fontSize: isMobile ? 14 : 16 }}>{error}</p>}
      <form onSubmit={handleSave} style={{ maxWidth: isMobile ? '100%' : 600, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ fontSize: isMobile ? 14 : 16 }}>
          Agent name
          <input
            value={config?.agentName ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, agentName: e.target.value } : c))}
            style={{
              display: 'block',
              width: '100%',
              padding: isMobile ? 12 : 8,
              marginTop: 4,
              fontSize: isMobile ? 16 : 14,
              border: '1px solid #ddd',
              borderRadius: 4,
              boxSizing: 'border-box',
            }}
          />
        </label>
        <label>
          Chat bot title (shown in widget header)
          <input
            value={config?.chatTitle ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, chatTitle: e.target.value } : c))}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            placeholder="e.g. ABC Health Chat"
          />
          <span style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'block' }}>
            Displayed as “Title — powered by CareMAX” in the chat widget. Leave empty to show “CareMax”.
          </span>
        </label>
        <label style={{ fontSize: isMobile ? 14 : 16 }}>
          System prompt
          <textarea
            value={config?.systemPrompt ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, systemPrompt: e.target.value } : c))}
            rows={isMobile ? 5 : 6}
            style={{
              display: 'block',
              width: '100%',
              padding: isMobile ? 12 : 8,
              marginTop: 4,
              fontSize: isMobile ? 16 : 14,
              border: '1px solid #ddd',
              borderRadius: 4,
              boxSizing: 'border-box',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
            placeholder="e.g. You are ABC, a friendly triage assistant. Keep greetings short. Only explain your role when asked."
          />
          <span style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'block' }}>
            Define your agent’s role and style here. To avoid generic replies, add things like: “Keep greetings to one short sentence” or “Don’t repeat your full introduction every time.”
          </span>
        </label>
        <label style={{ fontSize: isMobile ? 14 : 16 }}>
          How the agent thinks (instructions)
          <textarea
            value={config?.thinkingInstructions ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, thinkingInstructions: e.target.value } : c))}
            rows={isMobile ? 3 : 3}
            style={{
              display: 'block',
              width: '100%',
              padding: isMobile ? 12 : 8,
              marginTop: 4,
              fontSize: isMobile ? 16 : 14,
              border: '1px solid #ddd',
              borderRadius: 4,
              boxSizing: 'border-box',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </label>
        <label style={{ fontSize: isMobile ? 14 : 16 }}>
          Model
          <select
            value={config?.model ?? 'gemini-3-flash-preview'}
            onChange={(e) => setConfig((c) => (c ? { ...c, model: e.target.value } : c))}
            style={{
              display: 'block',
              width: '100%',
              padding: isMobile ? 12 : 8,
              marginTop: 4,
              fontSize: isMobile ? 16 : 14,
              border: '1px solid #ddd',
              borderRadius: 4,
              boxSizing: 'border-box',
              backgroundColor: 'white',
            }}
          >
            <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
          </select>
        </label>
        <label style={{ fontSize: isMobile ? 14 : 16 }}>
          Temperature (0–2)
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={config?.temperature ?? 0.7}
            onChange={(e) => setConfig((c) => (c ? { ...c, temperature: Number(e.target.value) } : c))}
            style={{
              display: 'block',
              width: '100%',
              padding: isMobile ? 12 : 8,
              marginTop: 4,
              fontSize: isMobile ? 16 : 14,
              border: '1px solid #ddd',
              borderRadius: 4,
              boxSizing: 'border-box',
            }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: isMobile ? 14 : 16 }}>
          <input
            type="checkbox"
            checked={config?.ragEnabled ?? false}
            onChange={(e) => setConfig((c) => (c ? { ...c, ragEnabled: e.target.checked } : c))}
            style={{
              width: isMobile ? 20 : 18,
              height: isMobile ? 20 : 18,
              cursor: 'pointer',
            }}
          />
          Use RAG for diagnosis (knowledge base)
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: isMobile ? '12px 24px' : '10px 20px',
            alignSelf: 'flex-start',
            fontSize: isMobile ? 15 : 14,
            backgroundColor: saving ? '#ccc' : '#0d47a1',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: saving ? 'not-allowed' : 'pointer',
            minHeight: 44,
            touchAction: 'manipulation',
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
}
