import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type ActiveWhatsAppContact = {
  profileId: string;
  name?: string;
  phone?: string;
  externalUserId?: string;
  location?: string;
  updatedAt?: number | null;
  whatsappContact: string;
};

type SendResult = {
  profileId: string;
  recipient: string;
  status: 'sent' | 'failed';
  error?: string;
};

type OutboxEntry = {
  id: string;
  message: string;
  profileIds: string[];
  requestedBy?: string | null;
  activeWithinHours?: number | null;
  sentCount: number;
  failedCount: number;
  createdAt?: number | null;
  results: SendResult[];
};

type WhatsAppTemplatePreset = {
  id: string;
  templateName: string;
  languageCode: string;
  comments?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

type TemplateSendResult = {
  recipient: string;
  status: 'sent' | 'failed';
  providerMessageId?: string;
  error?: string;
};

type SpecialMessagesTab = 'compose' | 'templates' | 'outbox';

const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid #cbd5e1',
  padding: '10px 12px',
  boxSizing: 'border-box',
  font: 'inherit',
};

const primaryButtonStyle: CSSProperties = {
  borderRadius: 10,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  padding: '10px 14px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
};

function formatWhen(timestamp?: number | null) {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '—';
  }
}

function displayContact(contact: ActiveWhatsAppContact) {
  return contact.name?.trim() || contact.phone?.trim() || contact.externalUserId?.trim() || contact.whatsappContact;
}

function OutboxSummary({ entry }: { entry: OutboxEntry }) {
  const recipients = entry.results.map((result) => result.recipient.replace(/^whatsapp:/i, ''));
  const uniqueRecipients = Array.from(new Set(recipients));

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: '#475569', fontSize: 14 }}>
        <span>Sent: {entry.sentCount}</span>
        <span>Failed: {entry.failedCount}</span>
        <span>Recipients: {uniqueRecipients.length}</span>
        <span>Window: {entry.activeWithinHours ?? 22} hrs</span>
        <span>Created: {formatWhen(entry.createdAt)}</span>
      </div>
      <div style={{ color: '#0f172a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.message}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        <strong style={{ color: '#0f172a' }}>Recipient numbers</strong>
        {uniqueRecipients.length === 0 ? (
          <span style={{ color: '#64748b' }}>No recipients were recorded for this message.</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {uniqueRecipients.map((recipient) => (
              <span
                key={recipient}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#1d4ed8',
                  fontSize: 13,
                }}
              >
                {recipient}
              </span>
            ))}
          </div>
        )}
      </div>
      {entry.results.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <strong style={{ color: '#0f172a' }}>Delivery results</strong>
          {entry.results.map((result) => (
            <div
              key={`${entry.id}-${result.profileId}-${result.recipient}`}
              style={{
                borderRadius: 12,
                border: `1px solid ${result.status === 'sent' ? '#bbf7d0' : '#fecaca'}`,
                background: result.status === 'sent' ? '#f0fdf4' : '#fef2f2',
                padding: 12,
                color: '#0f172a',
              }}
            >
              <strong>{result.status === 'sent' ? 'Sent' : 'Failed'}</strong> — {result.recipient.replace(/^whatsapp:/i, '')}
              {result.error ? <div style={{ marginTop: 4, color: '#991b1b' }}>{result.error}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SpecialMessagesPage() {
  const { tenantId } = useTenant();
  const [activeTab, setActiveTab] = useState<SpecialMessagesTab>('compose');
  const [contacts, setContacts] = useState<ActiveWhatsAppContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [selectAllActive, setSelectAllActive] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastResults, setLastResults] = useState<SendResult[]>([]);
  const [templatePresets, setTemplatePresets] = useState<WhatsAppTemplatePreset[]>([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [templateLanguageInput, setTemplateLanguageInput] = useState('en_US');
  const [templateCommentsInput, setTemplateCommentsInput] = useState('');
  const [templateSelectAllActive, setTemplateSelectAllActive] = useState(true);
  const [templateSelectedIds, setTemplateSelectedIds] = useState<string[]>([]);
  const [templateSending, setTemplateSending] = useState(false);
  const [lastTemplateResults, setLastTemplateResults] = useState<TemplateSendResult[]>([]);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [outboxEntries, setOutboxEntries] = useState<OutboxEntry[]>([]);
  const [outboxLoading, setOutboxLoading] = useState(true);
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [deletingOutboxId, setDeletingOutboxId] = useState<string | null>(null);
  const activeWithinHours = 22;

  const loadContacts = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api<{ profiles: ActiveWhatsAppContact[] }>(
        `/tenants/${tenantId}/xperson-profile/whatsapp-active?activeWithinHours=${activeWithinHours}&limit=500`,
      );
      setContacts(response.profiles ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load active WhatsApp contacts.');
    } finally {
      setLoading(false);
    }
  };

  const loadOutbox = async () => {
    if (!tenantId) return;
    setOutboxLoading(true);
    setOutboxError(null);
    try {
      const response = await api<{ notifications: OutboxEntry[] }>(`/tenants/${tenantId}/xperson-profile/whatsapp-notifications?limit=100`);
      setOutboxEntries(response.notifications ?? []);
    } catch (loadError) {
      setOutboxError(loadError instanceof Error ? loadError.message : 'Failed to load outbox messages.');
    } finally {
      setOutboxLoading(false);
    }
  };

  const loadTemplatePresets = async () => {
    if (!tenantId) return;
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const response = await api<{ presets: WhatsAppTemplatePreset[] }>(
        `/tenants/${tenantId}/xperson-profile/whatsapp-template-presets?limit=200`,
      );
      const presets = response.presets ?? [];
      setTemplatePresets(presets);
      setSelectedPresetId((current) => {
        if (current && presets.some((preset) => preset.id === current)) return current;
        return presets[0]?.id ?? '';
      });
    } catch (loadError) {
      setTemplateError(loadError instanceof Error ? loadError.message : 'Failed to load saved templates.');
    } finally {
      setTemplateLoading(false);
    }
  };

  useEffect(() => {
    void loadContacts();
    void loadOutbox();
    void loadTemplatePresets();
  }, [tenantId]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) =>
      [
        contact.profileId,
        contact.name,
        contact.phone,
        contact.externalUserId,
        contact.location,
        contact.whatsappContact,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [contacts, search]);

  const selectedCount = selectAllActive ? contacts.length : selectedIds.length;

  const toggleSelection = (profileId: string) => {
    setSelectedIds((current) => (current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId]));
  };

  const visibleSelectedCount = filteredContacts.filter((contact) => selectedIds.includes(contact.profileId)).length;
  const templateVisibleSelectedCount = filteredContacts.filter((contact) => templateSelectedIds.includes(contact.profileId)).length;
  const templateSelectedCount = templateSelectAllActive ? contacts.length : templateSelectedIds.length;

  const submit = async () => {
    if (!tenantId) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    setLastResults([]);
    try {
      const response = await api<{
        sentCount: number;
        failedCount: number;
        matchedProfiles: number;
        results: SendResult[];
      }>(`/tenants/${tenantId}/xperson-profile/whatsapp-notifications`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          selectAllActive,
          activeWithinHours,
          profileIds: selectAllActive ? [] : selectedIds,
        }),
      });
      setSuccess(`Notification queued to ${response.sentCount} contact${response.sentCount === 1 ? '' : 's'}${response.failedCount ? `, with ${response.failedCount} failure${response.failedCount === 1 ? '' : 's'}` : ''}.`);
      setLastResults(response.results ?? []);
      setMessage('');
      if (!selectAllActive) setSelectedIds([]);
      void loadContacts();
      void loadOutbox();
      setActiveTab('outbox');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send special WhatsApp message.');
    } finally {
      setSending(false);
    }
  };

  const saveTemplatePreset = async () => {
    if (!tenantId) return;
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      const response = await api<{ preset: WhatsAppTemplatePreset }>(
        `/tenants/${tenantId}/xperson-profile/whatsapp-template-presets`,
        {
          method: 'POST',
          body: JSON.stringify({
            templateName: templateNameInput,
            languageCode: templateLanguageInput,
            comments: templateCommentsInput,
          }),
        },
      );
      setTemplateSuccess(`Saved template "${response.preset.templateName}".`);
      setTemplateNameInput('');
      setTemplateCommentsInput('');
      await loadTemplatePresets();
      setSelectedPresetId(response.preset.id);
    } catch (saveError) {
      setTemplateError(saveError instanceof Error ? saveError.message : 'Failed to save template preset.');
    }
  };

  const deleteTemplatePreset = async (presetId: string) => {
    if (!tenantId) return;
    setDeletingTemplateId(presetId);
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      await api(`/tenants/${tenantId}/xperson-profile/whatsapp-template-presets/${presetId}`, { method: 'DELETE' });
      setTemplateSuccess('Template preset deleted.');
      await loadTemplatePresets();
    } catch (deleteError) {
      setTemplateError(deleteError instanceof Error ? deleteError.message : 'Failed to delete template preset.');
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const sendSavedTemplate = async () => {
    if (!tenantId) return;
    const preset = templatePresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      setTemplateError('Select a saved template first.');
      setTemplateSuccess(null);
      return;
    }

    const targetContacts = templateSelectAllActive
      ? contacts
      : contacts.filter((contact) => templateSelectedIds.includes(contact.profileId));

    const recipients = Array.from(
      new Set(
        targetContacts
          .map((contact) => contact.whatsappContact.replace(/^whatsapp:/i, '').trim())
          .filter(Boolean),
      ),
    );

    if (recipients.length === 0) {
      setTemplateError('Choose at least one active contact, or use send-to-all.');
      setTemplateSuccess(null);
      return;
    }

    setTemplateSending(true);
    setTemplateError(null);
    setTemplateSuccess(null);
    setLastTemplateResults([]);
    try {
      const response = await api<{
        sentCount: number;
        failedCount: number;
        results: TemplateSendResult[];
      }>(`/tenants/${tenantId}/integrations/whatsapp/meta/send-template`, {
        method: 'POST',
        body: JSON.stringify({
          recipients,
          template: {
            name: preset.templateName,
            language: { code: preset.languageCode },
          },
        }),
      });

      setTemplateSuccess(
        `Template "${preset.templateName}" sent to ${response.sentCount} contact${response.sentCount === 1 ? '' : 's'}${response.failedCount ? `, with ${response.failedCount} failure${response.failedCount === 1 ? '' : 's'}` : ''}.`,
      );
      setLastTemplateResults(response.results ?? []);
      if (!templateSelectAllActive) setTemplateSelectedIds([]);
    } catch (sendError) {
      setTemplateError(sendError instanceof Error ? sendError.message : 'Failed to send saved template.');
    } finally {
      setTemplateSending(false);
    }
  };

  const deleteOutboxEntry = async (notificationId: string) => {
    if (!tenantId) return;
    setDeletingOutboxId(notificationId);
    setOutboxError(null);
    try {
      await api(`/tenants/${tenantId}/xperson-profile/whatsapp-notifications/${notificationId}`, {
        method: 'DELETE',
      });
      setOutboxEntries((current) => current.filter((entry) => entry.id !== notificationId));
    } catch (deleteError) {
      setOutboxError(deleteError instanceof Error ? deleteError.message : 'Failed to delete outbox message.');
    } finally {
      setDeletingOutboxId(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={cardStyle}>
        <div style={{ display: 'grid', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>Special WhatsApp Notifications</h1>
          <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>
            Send one-off announcements, updates, or important information to WhatsApp contacts who have been active in the last {activeWithinHours} hours.
          </p>
        </div>
      </section>

      <section style={{ ...cardStyle, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {([
            { key: 'compose', label: 'Compose' },
            { key: 'templates', label: `Template Sends (${templatePresets.length})` },
            { key: 'outbox', label: `Outbox (${outboxEntries.length})` },
          ] as Array<{ key: SpecialMessagesTab; label: string }>).map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  ...secondaryButtonStyle,
                  borderColor: active ? '#2563eb' : '#cbd5e1',
                  background: active ? '#eff6ff' : '#fff',
                  color: active ? '#1d4ed8' : '#0f172a',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'compose' ? (
          <>
            <div style={{ display: 'grid', gap: 8 }}>
              <label htmlFor="special-message" style={{ fontWeight: 600, color: '#0f172a' }}>Notification message</label>
              <textarea
                id="special-message"
                rows={6}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type the special WhatsApp message you want to send."
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <span style={{ color: '#64748b', fontSize: 13 }}>
                The message will be sent exactly as entered to the selected active WhatsApp contacts.
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#0f172a', fontWeight: 600 }}>
                <input
                  type="radio"
                  checked={selectAllActive}
                  onChange={() => setSelectAllActive(true)}
                />
                Send to all {contacts.length} active contacts
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#0f172a', fontWeight: 600 }}>
                <input
                  type="radio"
                  checked={!selectAllActive}
                  onChange={() => setSelectAllActive(false)}
                />
                Choose specific contacts
              </label>
            </div>

            {error ? <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12 }}>{error}</div> : null}
            {success ? <div style={{ color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 12 }}>{success}</div> : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <button
                type="button"
                style={{ ...primaryButtonStyle, opacity: sending ? 0.6 : 1 }}
                onClick={() => void submit()}
                disabled={sending || loading || !message.trim() || selectedCount === 0}
              >
                {sending ? 'Sending…' : `Send to ${selectedCount} contact${selectedCount === 1 ? '' : 's'}`}
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={() => void loadContacts()} disabled={loading || sending}>
                Refresh active contacts
              </button>
            </div>
          </>
        ) : activeTab === 'templates' ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <section style={{ border: '1px solid #dbeafe', borderRadius: 14, padding: 16, background: '#eff6ff', display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#1e3a8a' }}>Save Meta template for reuse</h2>
              <label style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155' }}>
                Template name
                <input value={templateNameInput} onChange={(event) => setTemplateNameInput(event.target.value)} placeholder="e.g. caremax_appointment_reminder" style={inputStyle} />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155' }}>
                Language code
                <input value={templateLanguageInput} onChange={(event) => setTemplateLanguageInput(event.target.value)} placeholder="en_US" style={inputStyle} />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 14, color: '#334155' }}>
                Comments (for identification)
                <textarea
                  value={templateCommentsInput}
                  onChange={(event) => setTemplateCommentsInput(event.target.value)}
                  rows={3}
                  placeholder="What this template is for (internal note only)."
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => void saveTemplatePreset()}
                  disabled={!templateNameInput.trim() || !templateLanguageInput.trim()}
                >
                  Save template
                </button>
                <button type="button" style={secondaryButtonStyle} onClick={() => void loadTemplatePresets()} disabled={templateLoading}>
                  Refresh templates
                </button>
              </div>
            </section>

            <section style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Send using saved templates</h2>
              {templateLoading ? <div style={{ color: '#64748b' }}>Loading saved templates…</div> : null}
              {!templateLoading && templatePresets.length === 0 ? <div style={{ color: '#64748b' }}>No saved templates yet. Save one above to start sending quickly.</div> : null}

              {!templateLoading && templatePresets.length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {templatePresets.map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    return (
                      <label
                        key={preset.id}
                        style={{
                          borderRadius: 12,
                          border: `1px solid ${isSelected ? '#93c5fd' : '#e2e8f0'}`,
                          background: isSelected ? '#f8fbff' : '#fff',
                          padding: 12,
                          display: 'grid',
                          gap: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <input type="radio" checked={isSelected} onChange={() => setSelectedPresetId(preset.id)} />
                            <strong>{preset.templateName}</strong>
                            <span style={{ color: '#1d4ed8', fontSize: 12, border: '1px solid #bfdbfe', borderRadius: 999, padding: '2px 8px', background: '#eff6ff' }}>{preset.languageCode}</span>
                          </div>
                          <button
                            type="button"
                            style={{ ...secondaryButtonStyle, padding: '6px 10px', borderColor: '#fecaca', color: '#b91c1c', background: '#fff1f2' }}
                            onClick={(event) => {
                              event.preventDefault();
                              void deleteTemplatePreset(preset.id);
                            }}
                            disabled={deletingTemplateId !== null}
                          >
                            {deletingTemplateId === preset.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                        {preset.comments ? <div style={{ color: '#475569', fontSize: 13 }}>{preset.comments}</div> : null}
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#0f172a', fontWeight: 600 }}>
                  <input type="radio" checked={templateSelectAllActive} onChange={() => setTemplateSelectAllActive(true)} />
                  Send template to all {contacts.length} active contacts
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#0f172a', fontWeight: 600 }}>
                  <input type="radio" checked={!templateSelectAllActive} onChange={() => setTemplateSelectAllActive(false)} />
                  Choose specific contacts
                </label>
              </div>

              {!templateSelectAllActive ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => setTemplateSelectedIds(filteredContacts.map((contact) => contact.profileId))}
                    disabled={filteredContacts.length === 0}
                  >
                    Select visible ({filteredContacts.length})
                  </button>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setTemplateSelectedIds([])} disabled={templateSelectedIds.length === 0}>
                    Clear selection
                  </button>
                  <span style={{ color: '#64748b', alignSelf: 'center' }}>{templateVisibleSelectedCount} visible selected</span>
                </div>
              ) : null}

              <button
                type="button"
                style={{ ...primaryButtonStyle, opacity: templateSending ? 0.6 : 1, width: 'fit-content' }}
                onClick={() => void sendSavedTemplate()}
                disabled={templateSending || templateSelectedCount === 0 || !selectedPresetId}
              >
                {templateSending ? 'Sending template…' : `Send template to ${templateSelectedCount} contact${templateSelectedCount === 1 ? '' : 's'}`}
              </button>
              {templateError ? <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12 }}>{templateError}</div> : null}
              {templateSuccess ? <div style={{ color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 12 }}>{templateSuccess}</div> : null}
            </section>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Outbox</h2>
                <p style={{ margin: '6px 0 0', color: '#64748b' }}>
                  Review every special message sent, which phone numbers received it, and remove any outbox item as an admin.
                </p>
              </div>
              <button type="button" style={secondaryButtonStyle} onClick={() => void loadOutbox()} disabled={outboxLoading || deletingOutboxId !== null}>
                Refresh outbox
              </button>
            </div>

            {outboxError ? <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12 }}>{outboxError}</div> : null}
            {outboxLoading ? <div style={{ color: '#64748b' }}>Loading outbox messages…</div> : null}
            {!outboxLoading && outboxEntries.length === 0 ? <div style={{ color: '#64748b' }}>No sent special messages are in the outbox yet.</div> : null}

            {!outboxLoading && outboxEntries.length > 0 ? (
              <div style={{ display: 'grid', gap: 14 }}>
                {outboxEntries.map((entry) => (
                  <section
                    key={entry.id}
                    style={{
                      borderRadius: 16,
                      border: '1px solid #e2e8f0',
                      padding: 16,
                      display: 'grid',
                      gap: 14,
                      background: '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div>
                        <h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Outbox message</h3>
                        <p style={{ margin: '6px 0 0', color: '#64748b' }}>Requested by: {entry.requestedBy || 'Unknown admin'}</p>
                      </div>
                      <button
                        type="button"
                        style={{
                          ...secondaryButtonStyle,
                          borderColor: '#fecaca',
                          color: '#b91c1c',
                          background: '#fff1f2',
                          opacity: deletingOutboxId === entry.id ? 0.6 : 1,
                        }}
                        onClick={() => void deleteOutboxEntry(entry.id)}
                        disabled={deletingOutboxId !== null}
                      >
                        {deletingOutboxId === entry.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                    <OutboxSummary entry={entry} />
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section style={{ ...cardStyle, display: activeTab !== 'outbox' ? 'grid' : 'none', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Active WhatsApp contacts</h2>
            <p style={{ margin: '6px 0 0', color: '#64748b' }}>
              Showing contacts active since the last {activeWithinHours} hours. {activeTab === 'compose'
                ? (selectAllActive ? 'All active contacts will receive the message.' : `${selectedIds.length} selected.`)
                : (templateSelectAllActive ? 'All active contacts will receive the saved template.' : `${templateSelectedIds.length} selected for template send.`)}
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, location…"
            style={{ ...inputStyle, maxWidth: 320 }}
          />
        </div>

        {activeTab === 'compose' && !selectAllActive ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => setSelectedIds(filteredContacts.map((contact) => contact.profileId))}
              disabled={filteredContacts.length === 0}
            >
              Select visible ({filteredContacts.length})
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
            >
              Clear selection
            </button>
            <span style={{ color: '#64748b', alignSelf: 'center' }}>{visibleSelectedCount} visible selected</span>
          </div>
        ) : null}

        {loading ? <div style={{ color: '#64748b' }}>Loading active contacts…</div> : null}
        {!loading && filteredContacts.length === 0 ? <div style={{ color: '#64748b' }}>No WhatsApp contacts have been active in the last 22 hours.</div> : null}

        {!loading && filteredContacts.length > 0 ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {filteredContacts.map((contact) => {
              const checked = activeTab === 'compose'
                ? (selectAllActive || selectedIds.includes(contact.profileId))
                : (templateSelectAllActive || templateSelectedIds.includes(contact.profileId));
              const isReadOnlyAllMode = activeTab === 'compose' ? selectAllActive : templateSelectAllActive;
              return (
                <label
                  key={contact.profileId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isReadOnlyAllMode ? '1fr' : 'auto 1fr',
                    gap: 12,
                    padding: 14,
                    borderRadius: 14,
                    border: checked ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                    background: checked ? '#f8fbff' : '#fff',
                    cursor: isReadOnlyAllMode ? 'default' : 'pointer',
                  }}
                >
                  {activeTab === 'compose' && !selectAllActive ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelection(contact.profileId)}
                      style={{ marginTop: 4 }}
                    />
                  ) : null}
                  {activeTab === 'templates' && !templateSelectAllActive ? (
                    <input
                      type="checkbox"
                      checked={templateSelectedIds.includes(contact.profileId)}
                      onChange={() => setTemplateSelectedIds((current) => (
                        current.includes(contact.profileId)
                          ? current.filter((id) => id !== contact.profileId)
                          : [...current, contact.profileId]
                      ))}
                      style={{ marginTop: 4 }}
                    />
                  ) : null}
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
                      <strong style={{ color: '#0f172a' }}>{displayContact(contact)}</strong>
                      <span style={{ color: '#64748b', fontSize: 13 }}>Last active: {formatWhen(contact.updatedAt)}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: '#475569', fontSize: 14 }}>
                      <span>WhatsApp: {contact.whatsappContact.replace(/^whatsapp:/i, '')}</span>
                      {contact.location ? <span>Location: {contact.location}</span> : null}
                      <span>Profile ID: {contact.profileId}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        ) : null}
      </section>

      {lastResults.length > 0 ? (
        <section style={{ ...cardStyle, display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Latest send results</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {lastResults.map((result) => (
              <div
                key={`${result.profileId}-${result.recipient}`}
                style={{
                  borderRadius: 12,
                  border: `1px solid ${result.status === 'sent' ? '#bbf7d0' : '#fecaca'}`,
                  background: result.status === 'sent' ? '#f0fdf4' : '#fef2f2',
                  padding: 12,
                  color: '#0f172a',
                }}
              >
                <strong>{result.status === 'sent' ? 'Sent' : 'Failed'}</strong> — {result.recipient}
                {result.error ? <div style={{ marginTop: 4, color: '#991b1b' }}>{result.error}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {lastTemplateResults.length > 0 ? (
        <section style={{ ...cardStyle, display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Latest template send results</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {lastTemplateResults.map((result) => (
              <div
                key={`${result.recipient}-${result.providerMessageId ?? 'result'}`}
                style={{
                  borderRadius: 12,
                  border: `1px solid ${result.status === 'sent' ? '#bbf7d0' : '#fecaca'}`,
                  background: result.status === 'sent' ? '#f0fdf4' : '#fef2f2',
                  padding: 12,
                  color: '#0f172a',
                }}
              >
                <strong>{result.status === 'sent' ? 'Sent' : 'Failed'}</strong> — {result.recipient}
                {result.providerMessageId ? <div style={{ marginTop: 4, color: '#166534' }}>Provider message ID: {result.providerMessageId}</div> : null}
                {result.error ? <div style={{ marginTop: 4, color: '#991b1b' }}>{result.error}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
