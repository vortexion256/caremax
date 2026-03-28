import { useEffect, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type TenantUserActivity = {
  userKey: string;
  reminderCount: number;
  dueSoonCount: number;
  reminders: Array<{
    reminderId: string;
    message: string;
    dueAt: number | null;
    dueAtIso: string | null;
    channel: string | null;
    targetType: string | null;
    source: string | null;
    conversationId: string | null;
  }>;
  logCount: number;
  logs: Array<{
    logId: string;
    source: string;
    step: string;
    status: string;
    durationMs: number | null;
    conversationId: string | null;
    error: string | null;
    createdAt: number | null;
  }>;
};

export default function WhatsAppPatientActivityPage() {
  const { tenantId } = useTenant();
  const [loading, setLoading] = useState(false);
  const [userActivity, setUserActivity] = useState<TenantUserActivity[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    api<{ users: TenantUserActivity[] }>(`/tenants/${tenantId}/user-activity?reminderLimit=250&logLimit=300`)
      .then((response) => setUserActivity(response.users))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load per-user activity'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1080 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>Active Reminders + Logs by Patient (WhatsApp)</h1>
        <p style={{ margin: 0, color: '#475569' }}>
          Monitor patient reminders and patient-attributed diagnostic logs grouped by WhatsApp user.
        </p>
      </div>

      {error ? <div style={{ color: '#b91c1c', fontWeight: 500 }}>{error}</div> : null}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' }}>
        {loading ? (
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Loading per-user activity…</p>
        ) : userActivity.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
            No active patient reminders or patient-attributed diagnostic logs found.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8, maxHeight: '70vh', overflowY: 'auto', paddingRight: 2 }}>
            {userActivity.slice(0, 80).map((user) => (
              <details key={user.userKey} style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
                <summary style={{ cursor: 'pointer', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#0f172a', overflowWrap: 'anywhere' }}>{user.userKey}</span>
                  <span style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                    <span style={{ background: '#e0f2fe', color: '#075985', padding: '2px 8px', borderRadius: 999 }}>
                      reminders: {user.reminderCount}
                    </span>
                    <span style={{ background: '#ecfccb', color: '#3f6212', padding: '2px 8px', borderRadius: 999 }}>
                      logs: {user.logCount}
                    </span>
                  </span>
                </summary>
                <div style={{ padding: '0 10px 10px 10px', fontSize: 12, color: '#334155', display: 'grid', gap: 8 }}>
                  <div>
                    <strong>Active reminders</strong> ({user.reminderCount}, due in 24h: {user.dueSoonCount})
                    {user.reminders.length > 0 ? (
                      <ul style={{ margin: '6px 0 0 18px', padding: 0, display: 'grid', gap: 4 }}>
                        {user.reminders.slice(0, 12).map((reminder) => (
                          <li key={reminder.reminderId}>
                            <span style={{ fontFamily: 'monospace' }}>{reminder.reminderId}</span> — {reminder.message || '—'}{' '}
                            ({reminder.dueAt ? new Date(reminder.dueAt).toLocaleString() : 'no due time'})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: '4px 0 0 0', color: '#64748b' }}>No active reminders.</p>
                    )}
                  </div>
                  <div>
                    <strong>Diagnostic logs</strong> ({user.logCount})
                    {user.logs.length > 0 ? (
                      <ul style={{ margin: '6px 0 0 18px', padding: 0, display: 'grid', gap: 4 }}>
                        {user.logs.slice(0, 10).map((log) => (
                          <li key={log.logId}>
                            {log.createdAt ? new Date(log.createdAt).toLocaleString() : 'Unknown time'} — {log.source}:{' '}
                            <span style={{ fontFamily: 'monospace' }}>{log.step}</span> ({log.status})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: '4px 0 0 0', color: '#64748b' }}>No logs captured for this user.</p>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
