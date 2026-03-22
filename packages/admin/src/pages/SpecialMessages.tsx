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

type SpecialMessagesTab = 'compose' | 'outbox';

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

  useEffect(() => {
    void loadContacts();
    void loadOutbox();
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

      <section style={{ ...cardStyle, display: activeTab === 'compose' ? 'grid' : 'none', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Active WhatsApp contacts</h2>
            <p style={{ margin: '6px 0 0', color: '#64748b' }}>
              Showing contacts active since the last {activeWithinHours} hours. {selectAllActive ? 'All active contacts will receive the message.' : `${selectedIds.length} selected.`}
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, location…"
            style={{ ...inputStyle, maxWidth: 320 }}
          />
        </div>

        {!selectAllActive ? (
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
              const checked = selectAllActive || selectedIds.includes(contact.profileId);
              return (
                <label
                  key={contact.profileId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: selectAllActive ? '1fr' : 'auto 1fr',
                    gap: 12,
                    padding: 14,
                    borderRadius: 14,
                    border: checked ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                    background: checked ? '#f8fbff' : '#fff',
                    cursor: selectAllActive ? 'default' : 'pointer',
                  }}
                >
                  {!selectAllActive ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelection(contact.profileId)}
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
    </div>
  );
}
