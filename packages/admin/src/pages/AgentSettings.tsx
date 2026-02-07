import { useState, useEffect } from 'react';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';

export default function AgentSettings() {
  const { tenantId } = useTenant();
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
    <div>
      <h1 style={{ margin: '0 0 16px 0' }}>Agent settings</h1>
      {error && <p style={{ color: '#c62828', marginBottom: 16 }}>{error}</p>}
      <form onSubmit={handleSave} style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label>
          Agent name
          <input
            value={config?.agentName ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, agentName: e.target.value } : c))}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
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
        <label>
          System prompt
          <textarea
            value={config?.systemPrompt ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, systemPrompt: e.target.value } : c))}
            rows={6}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            placeholder="e.g. You are ABC, a friendly triage assistant. Keep greetings short. Only explain your role when asked."
          />
          <span style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'block' }}>
            Define your agent’s role and style here. To avoid generic replies, add things like: “Keep greetings to one short sentence” or “Don’t repeat your full introduction every time.”
          </span>
        </label>
        <label>
          How the agent thinks (instructions)
          <textarea
            value={config?.thinkingInstructions ?? ''}
            onChange={(e) => setConfig((c) => (c ? { ...c, thinkingInstructions: e.target.value } : c))}
            rows={3}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Model
          <select
            value={config?.model ?? 'gemini-3-flash-preview'}
            onChange={(e) => setConfig((c) => (c ? { ...c, model: e.target.value } : c))}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          >
            <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
          </select>
        </label>
        <label>
          Temperature (0–2)
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={config?.temperature ?? 0.7}
            onChange={(e) => setConfig((c) => (c ? { ...c, temperature: Number(e.target.value) } : c))}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={config?.ragEnabled ?? false}
            onChange={(e) => setConfig((c) => (c ? { ...c, ragEnabled: e.target.checked } : c))}
          />
          Use RAG for diagnosis (knowledge base)
        </label>
        <button type="submit" disabled={saving} style={{ padding: '10px 20px', alignSelf: 'flex-start' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
}
