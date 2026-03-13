import { useState, useEffect } from 'react';
import { api, type AgentConfig } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

const GOOGLE_TTS_LANGUAGE_CODE_DEFAULT = 'en-US';
const GOOGLE_TTS_VOICE_NAME_DEFAULT = 'en-US-Neural2-F';

const GOOGLE_TTS_VOICE_OPTIONS = [
  { value: 'en-US-Neural2-F', label: 'en-US-Neural2-F (Female)' },
  { value: 'en-US-Neural2-J', label: 'en-US-Neural2-J (Male)' },
  { value: 'en-US-Neural2-A', label: 'en-US-Neural2-A' },
  { value: 'en-US-Neural2-C', label: 'en-US-Neural2-C' },
  { value: 'en-US-Neural2-D', label: 'en-US-Neural2-D' },
  { value: 'en-US-Neural2-E', label: 'en-US-Neural2-E' },
  { value: 'en-US-Wavenet-F', label: 'en-US-Wavenet-F (Female)' },
  { value: 'en-US-Wavenet-D', label: 'en-US-Wavenet-D (Male)' },
];

export default function AgentSettings() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api<AgentConfig>(`/tenants/${tenantId}/agent-config`)
      .then((incoming) => {
        const legacyFields = (incoming as { xPersonProfileCustomFields?: unknown }).xPersonProfileCustomFields;
        const normalizedFields = Array.isArray(legacyFields)
          ? legacyFields
              .map((field) => {
                if (typeof field === 'string') {
                  const trimmed = field.trim();
                  return trimmed ? { field: trimmed } : null;
                }
                if (!field || typeof field !== 'object') return null;
                const fieldName = (field as { field?: unknown }).field;
                if (typeof fieldName !== 'string' || fieldName.trim().length === 0) return null;
                const description = (field as { description?: unknown }).description;
                return {
                  field: fieldName.trim(),
                  ...(typeof description === 'string' && description.trim().length > 0
                    ? { description: description.trim() }
                    : {}),
                };
              })
              .filter((field): field is { field: string; description?: string } => field !== null)
          : [];
        setConfig({ ...incoming, xPersonProfileCustomFields: normalizedFields });
      })
      .catch((e) => setError(e.message));
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const allowedModels = Array.isArray(config.availableModels)
        ? config.availableModels.filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
        : [];
      const safeModel = typeof config.model === 'string' && allowedModels.includes(config.model)
        ? config.model
        : allowedModels[0];
      const normalizedTemperature =
        typeof config.temperature === 'number' || typeof config.temperature === 'string'
          ? Number(config.temperature)
          : Number.NaN;
      const safeTemperature = Number.isFinite(normalizedTemperature)
        ? Math.min(2, Math.max(0, normalizedTemperature))
        : 0.7;
      const normalizedVoiceThreshold =
        typeof config.whatsappVoiceNoteCharThreshold === 'number' || typeof config.whatsappVoiceNoteCharThreshold === 'string'
          ? Number(config.whatsappVoiceNoteCharThreshold)
          : Number.NaN;
      const safeVoiceThreshold = Number.isFinite(normalizedVoiceThreshold)
        ? Math.max(0, Math.trunc(normalizedVoiceThreshold))
        : 0;
      const normalizedSunbirdTemperature =
        typeof config.whatsappSunbirdTemperature === 'number' || typeof config.whatsappSunbirdTemperature === 'string'
          ? Number(config.whatsappSunbirdTemperature)
          : Number.NaN;
      const safeSunbirdTemperature = Number.isFinite(normalizedSunbirdTemperature)
        ? Math.min(2, Math.max(0, normalizedSunbirdTemperature))
        : 0.7;
      const safeProvider =
        config.whatsappTtsProvider === 'google-cloud-tts' ||
        config.whatsappTtsProvider === 'gemini-2.5-flash-preview-tts' ||
        config.whatsappTtsProvider === 'elevenlabs' ||
        config.whatsappTtsProvider === 'sunbird'
          ? config.whatsappTtsProvider
          : 'sunbird';
      const safeGoogleLanguageCode = typeof config.whatsappGoogleTtsLanguageCode === 'string' && config.whatsappGoogleTtsLanguageCode.trim().length > 0
        ? config.whatsappGoogleTtsLanguageCode.trim()
        : GOOGLE_TTS_LANGUAGE_CODE_DEFAULT;
      const safeGoogleVoiceName = typeof config.whatsappGoogleTtsVoiceName === 'string' && config.whatsappGoogleTtsVoiceName.trim().length > 0
        ? config.whatsappGoogleTtsVoiceName.trim()
        : GOOGLE_TTS_VOICE_NAME_DEFAULT;

      const updated = await api<AgentConfig>(`/tenants/${tenantId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({
          agentName: typeof config.agentName === 'string' ? config.agentName : '',
          chatTitle: typeof config.chatTitle === 'string' ? config.chatTitle : '',
          welcomeText: typeof config.welcomeText === 'string' ? config.welcomeText : '',
          suggestedQuestions: Array.isArray(config.suggestedQuestions)
            ? config.suggestedQuestions.filter((q): q is string => typeof q === 'string')
            : [],
          widgetColor: typeof config.widgetColor === 'string' ? config.widgetColor : '#2563eb',
          systemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : '',
          thinkingInstructions: typeof config.thinkingInstructions === 'string' ? config.thinkingInstructions : '',
          model: safeModel,
          temperature: safeTemperature,
          ragEnabled: Boolean(config.ragEnabled),
          whatsappVoiceNoteCharThreshold: safeVoiceThreshold,
          whatsappForceVoiceReplies: Boolean(config.whatsappForceVoiceReplies),
          whatsappTtsProvider: safeProvider,
          whatsappSunbirdTemperature: safeSunbirdTemperature,
          whatsappGoogleTtsLanguageCode: safeGoogleLanguageCode,
          whatsappGoogleTtsVoiceName: safeGoogleVoiceName,
          xPersonProfileEnabled: Boolean(config.xPersonProfileEnabled),
          xPersonProfileCustomFields: Array.isArray(config.xPersonProfileCustomFields)
            ? config.xPersonProfileCustomFields
                .filter((field) => field && typeof field.field === 'string' && field.field.trim().length > 0)
                .map((field) => ({
                  field: field.field.trim(),
                  ...(typeof field.description === 'string' && field.description.trim().length > 0
                    ? { description: field.description.trim() }
                    : {}),
                }))
            : [],
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
              value={config?.model ?? (config?.availableModels?.[0] ?? 'gemini-2.0-flash')}
              onChange={(e) => setConfig((c) => (c ? { ...c, model: e.target.value } : c))}
              style={inputStyle}
            >
              {(config?.availableModels ?? ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']).map((modelId) => (
                <option key={modelId} value={modelId}>{modelId}</option>
              ))}
              {config?.model && !(config?.availableModels ?? []).includes(config.model) && (
                <option value={config.model}>{config.model}</option>
              )}
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

        <div style={{ marginTop: 24 }}>
          <label style={labelStyle}>WhatsApp Voice Note Threshold (characters)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={config?.whatsappVoiceNoteCharThreshold ?? 0}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              const threshold = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
              setConfig((c) => (c ? { ...c, whatsappVoiceNoteCharThreshold: threshold } : c));
            }}
            style={{ ...inputStyle, maxWidth: 260 }}
          />
          <span style={helperStyle}>
            Set to 0 to disable threshold-based voice replies. If above 0, the agent sends a voice note when a WhatsApp reply length reaches this value.
          </span>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>WhatsApp TTS Provider</label>
          <select
            value={config?.whatsappTtsProvider ?? 'sunbird'}
            onChange={(e) => setConfig((c) => (c ? { ...c, whatsappTtsProvider: e.target.value as AgentConfig['whatsappTtsProvider'] } : c))}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            <option value="sunbird">Sunbird</option>
            <option value="google-cloud-tts">Google Cloud TTS</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="gemini-2.5-flash-preview-tts">Gemini 2.5 Flash Preview TTS</option>
          </select>
          <span style={helperStyle}>
            Choose which text-to-speech engine is used when WhatsApp voice notes are generated (Google, ElevenLabs, Gemini, or Sunbird).
          </span>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Google TTS Language Code</label>
          <input
            value={config?.whatsappGoogleTtsLanguageCode ?? GOOGLE_TTS_LANGUAGE_CODE_DEFAULT}
            onChange={(e) => setConfig((c) => (c ? { ...c, whatsappGoogleTtsLanguageCode: e.target.value } : c))}
            style={{ ...inputStyle, maxWidth: 260 }}
            placeholder={GOOGLE_TTS_LANGUAGE_CODE_DEFAULT}
          />
          <span style={helperStyle}>
            Used by Google Cloud TTS / Gemini preview voice generation (example: en-US). ElevenLabs uses its own voice/model configuration via API environment variables.
          </span>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Google TTS Voice</label>
          <select
            value={config?.whatsappGoogleTtsVoiceName ?? GOOGLE_TTS_VOICE_NAME_DEFAULT}
            onChange={(e) => setConfig((c) => (c ? { ...c, whatsappGoogleTtsVoiceName: e.target.value } : c))}
            style={{ ...inputStyle, maxWidth: 360 }}
          >
            {GOOGLE_TTS_VOICE_OPTIONS.map((voice) => (
              <option key={voice.value} value={voice.value}>{voice.label}</option>
            ))}
          </select>
          <span style={helperStyle}>
            Select the Google voice used for WhatsApp voice notes when Google Cloud TTS is active. (Ignored for ElevenLabs.)
          </span>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Sunbird TTS Temperature</label>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={config?.whatsappSunbirdTemperature ?? 0.7}
            onChange={(e) => {
              const parsed = Number.parseFloat(e.target.value);
              const nextTemperature = Number.isFinite(parsed) ? parsed : 0.7;
              setConfig((c) => (c ? { ...c, whatsappSunbirdTemperature: Math.min(2, Math.max(0, nextTemperature)) } : c));
            }}
            style={{ ...inputStyle, maxWidth: 260 }}
          />
          <span style={helperStyle}>
            Used only when Sunbird is selected as the WhatsApp TTS provider.
          </span>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config?.whatsappForceVoiceReplies ?? false}
              onChange={(e) => setConfig((c) => (c ? { ...c, whatsappForceVoiceReplies: e.target.checked } : c))}
              style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            Force WhatsApp voice note replies for all text responses
          </label>
          <span style={helperStyle}>
            When enabled, every WhatsApp text reply will also attempt a voice note (TTS), even below the character threshold.
          </span>
        </div>


        </div>

        <div style={{ padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 20px 0', fontSize: 18, color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>Tools</h3>
          <div style={{ marginTop: 4 }}>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config?.xPersonProfileEnabled ?? false}
                onChange={(e) => setConfig((c) => (c ? { ...c, xPersonProfileEnabled: e.target.checked } : c))}
                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563eb' }}
              />
              Enable Persons (Pipo) / XPersonProfile tool
            </label>
            <span style={helperStyle}>
              Off by default. When enabled, the agent can autonomously profile users from widget and WhatsApp conversations using identity details such as phone, external ID, and device/user ID.
            </span>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>XPersonProfile custom fields</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(config?.xPersonProfileCustomFields ?? []).map((field, i) => (
                <div key={`${field.field}-${i}`} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr auto', gap: 8 }}>
                  <input
                    value={field.field}
                    onChange={(e) => {
                      const updatedFields = [...(config?.xPersonProfileCustomFields ?? [])];
                      updatedFields[i] = { ...updatedFields[i], field: e.target.value };
                      setConfig((c) => (c ? { ...c, xPersonProfileCustomFields: updatedFields } : c));
                    }}
                    style={inputStyle}
                    placeholder="Field name (e.g. insurance_provider)"
                  />
                  <input
                    value={field.description ?? ''}
                    onChange={(e) => {
                      const updatedFields = [...(config?.xPersonProfileCustomFields ?? [])];
                      updatedFields[i] = { ...updatedFields[i], description: e.target.value };
                      setConfig((c) => (c ? { ...c, xPersonProfileCustomFields: updatedFields } : c));
                    }}
                    style={inputStyle}
                    placeholder="Description for agent guidance"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const updatedFields = (config?.xPersonProfileCustomFields ?? []).filter((_, idx) => idx !== i);
                      setConfig((c) => (c ? { ...c, xPersonProfileCustomFields: updatedFields } : c));
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
                  const updatedFields = [...(config?.xPersonProfileCustomFields ?? []), { field: '', description: '' }];
                  setConfig((c) => (c ? { ...c, xPersonProfileCustomFields: updatedFields } : c));
                }}
                style={{
                  width: 'fit-content',
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                + Add custom field
              </button>
            </div>
            <span style={helperStyle}>
              Default fields are always captured: name, phone, location, and conversation_duration_last_conversation (total time spent in the user&apos;s most recent conversation across widget or WhatsApp).
              Add tenant-specific fields with descriptions to guide the agent during profile updates.
            </span>
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
