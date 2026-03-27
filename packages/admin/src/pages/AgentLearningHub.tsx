import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useTenant } from '../TenantContext';
import { useIsMobile } from '../hooks/useIsMobile';

type RankedMetric = { symptom?: string; signal?: string; count: number };

type LearningLoopResponse = {
  windowDays: number;
  generatedAt: number;
  interactionAnalytics: {
    totalSessions: number;
    dropoffAfterFirstResponseRate: number;
    triageEscalationRate: number;
    avgMessagesPerSession: number;
    repeatUserRate: number;
    fallbackResponseRate: number;
  };
  clinicalInsights: {
    topSymptoms: RankedMetric[];
    topRiskSignals: RankedMetric[];
    highRiskCaseCount: number;
  };
  patientMemory: {
    trackedProfiles: number;
    profilesWithRecentActivity: number;
    profilesCoverageRate: number;
    sessionsWithClinicalSnapshot?: number;
  };
  feedbackLoop: {
    totalFeedbackEntries: number;
    helpfulRate: number | null;
    outcomeCaptureRate: number | null;
    adviceAccuracyRate: number | null;
  };
  recommendations: string[];
  suggestedCollections: string[];
};

const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
} as const;

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export default function AgentLearningHub() {
  const { tenantId } = useTenant();
  const { isMobile } = useIsMobile();
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LearningLoopResponse | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({
    sessionId: '',
    helpful: 'yes',
    visitedClinic: 'unknown',
    realOutcome: '',
    accuracy: 'unknown',
    notes: '',
  });

  useEffect(() => {
    if (!tenantId || tenantId === 'platform') return;
    const run = async () => {
      setLoading(true);
      try {
        const response = await api<LearningLoopResponse>(`/tenants/${tenantId}/analytics/learning-loop?days=${days}`);
        setData(response);
        setError(null);
      } catch (e) {
        console.error('Failed to load learning loop analytics', e);
        setError('Failed to load learning-loop analytics');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [tenantId, days]);


  const submitFeedback = async () => {
    if (!tenantId || tenantId === 'platform') return;
    const sessionId = feedbackForm.sessionId.trim();
    if (!sessionId) {
      setFeedbackMessage('Session ID is required.');
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackMessage(null);
    try {
      await api(`/tenants/${tenantId}/analytics/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          helpful: feedbackForm.helpful === 'yes',
          ...(feedbackForm.visitedClinic === 'unknown' ? {} : { visitedClinic: feedbackForm.visitedClinic === 'yes' }),
          ...(feedbackForm.realOutcome.trim() ? { realOutcome: feedbackForm.realOutcome.trim() } : {}),
          ...(feedbackForm.accuracy === 'unknown' ? {} : { accuracy: feedbackForm.accuracy === 'yes' }),
          ...(feedbackForm.notes.trim() ? { notes: feedbackForm.notes.trim() } : {}),
        }),
      });
      setFeedbackMessage('Feedback submitted successfully.');
      setFeedbackForm((prev) => ({ ...prev, sessionId: '', realOutcome: '', notes: '' }));

      const response = await api<LearningLoopResponse>(`/tenants/${tenantId}/analytics/learning-loop?days=${days}`);
      setData(response);
    } catch (error) {
      console.error('Failed to submit feedback', error);
      setFeedbackMessage('Failed to submit feedback.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const sections = useMemo(() => {
    if (!data) return [];

    return [
      {
        title: '1) Interaction Analytics',
        metrics: [
          { label: 'Total Sessions', value: data.interactionAnalytics.totalSessions },
          { label: 'Drop-off after first response', value: formatPercent(data.interactionAnalytics.dropoffAfterFirstResponseRate) },
          { label: 'Triage escalation rate', value: formatPercent(data.interactionAnalytics.triageEscalationRate) },
          { label: 'Avg messages / session', value: data.interactionAnalytics.avgMessagesPerSession },
          { label: 'Repeat user rate', value: formatPercent(data.interactionAnalytics.repeatUserRate) },
          { label: 'Fallback response rate', value: formatPercent(data.interactionAnalytics.fallbackResponseRate) },
        ],
      },
      {
        title: '2) Clinical Insights',
        metrics: [
          { label: 'High-risk cases (escalated)', value: data.clinicalInsights.highRiskCaseCount },
          { label: 'Top symptoms tracked', value: data.clinicalInsights.topSymptoms.length },
          { label: 'Top risk signals tracked', value: data.clinicalInsights.topRiskSignals.length },
        ],
      },
      {
        title: '3) Patient Memory',
        metrics: [
          { label: 'Tracked patient profiles', value: data.patientMemory.trackedProfiles },
          { label: 'Profiles with recent activity', value: data.patientMemory.profilesWithRecentActivity },
          { label: 'Profile/session coverage', value: formatPercent(data.patientMemory.profilesCoverageRate) },
          { label: 'Sessions with clinical snapshot', value: data.patientMemory.sessionsWithClinicalSnapshot ?? 0 },
        ],
      },
      {
        title: '4) Feedback Loop',
        metrics: [
          { label: 'Feedback entries', value: data.feedbackLoop.totalFeedbackEntries },
          { label: 'Helpful rate', value: formatPercent(data.feedbackLoop.helpfulRate) },
          { label: 'Outcome capture rate', value: formatPercent(data.feedbackLoop.outcomeCaptureRate) },
          { label: 'Advice accuracy rate', value: formatPercent(data.feedbackLoop.adviceAccuracyRate) },
        ],
      },
    ];
  }, [data]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: isMobile ? 24 : 32 }}>Agent Learning Hub</h1>
      <p style={{ margin: 0, color: '#64748b' }}>
        Track the 4 growth layers: interaction analytics, clinical insights, patient memory, and feedback loops.
      </p>

      <div style={{ ...cardStyle, marginTop: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <label style={{ fontWeight: 600, color: '#334155' }}>
          Time Window
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            style={{ marginLeft: 10, border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px' }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <div style={{ color: '#64748b', fontSize: 13 }}>
          Generated: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link to="/conversations" style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open Conversations →</Link>
          <Link to="/patient-profile" style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open Patient Profiles →</Link>
        </div>
      </div>

      {loading && <div style={{ marginTop: 16, color: '#64748b' }}>Loading learning analytics...</div>}
      {error && <div style={{ marginTop: 16, color: '#dc2626' }}>{error}</div>}

      {data && (
        <>
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {sections.map((section) => (
              <section key={section.title} style={cardStyle}>
                <h2 style={{ margin: '0 0 10px 0', fontSize: 18, color: '#0f172a' }}>{section.title}</h2>
                <div style={{ display: 'grid', gap: 8 }}>
                  {section.metrics.map((item) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ color: '#64748b', fontSize: 13 }}>{item.label}</span>
                      <span style={{ color: '#0f172a', fontWeight: 700 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Top Symptoms</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: '#334155' }}>
                {data.clinicalInsights.topSymptoms.length === 0 ? <li>No structured symptoms captured yet.</li> : data.clinicalInsights.topSymptoms.map((item, index) => (
                  <li key={`${item.symptom}-${index}`}>{item.symptom} ({item.count})</li>
                ))}
              </ul>
            </section>
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Risk Signals</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: '#334155' }}>
                {data.clinicalInsights.topRiskSignals.length === 0 ? <li>No risk signals captured yet.</li> : data.clinicalInsights.topRiskSignals.map((item, index) => (
                  <li key={`${item.signal}-${index}`}>{item.signal} ({item.count})</li>
                ))}
              </ul>
            </section>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Recommended next steps</h3>
              <ol style={{ margin: 0, paddingLeft: 18, color: '#334155' }}>
                {data.recommendations.map((item) => <li key={item} style={{ marginBottom: 8 }}>{item}</li>)}
              </ol>
            </section>
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Suggested Firestore collections</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: '#334155' }}>
                {data.suggestedCollections.map((item) => <li key={item}><code>{item}</code></li>)}
              </ul>
            </section>
          </div>

          <section style={{ ...cardStyle, marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Capture session feedback</h3>
            <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
              Use this to record real outcomes so the learning loop has ground truth.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Session ID
                <input value={feedbackForm.sessionId} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, sessionId: event.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} placeholder="conversation/session id" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Helpful?
                <select value={feedbackForm.helpful} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, helpful: event.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Visited clinic?
                <select value={feedbackForm.visitedClinic} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, visitedClinic: event.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Advice accurate?
                <select value={feedbackForm.accuracy} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, accuracy: event.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}>
                  <option value="unknown">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, gridColumn: isMobile ? 'span 1' : 'span 2' }}>
                Real diagnosis/outcome (optional)
                <input value={feedbackForm.realOutcome} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, realOutcome: event.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }} placeholder="e.g. confirmed fracture" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13, gridColumn: isMobile ? 'span 1' : 'span 2' }}>
                Notes (optional)
                <textarea value={feedbackForm.notes} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, notes: event.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', minHeight: 76 }} placeholder="Any context from clinician follow-up" />
              </label>
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" disabled={feedbackSubmitting} onClick={submitFeedback} style={{ border: '1px solid #2563eb', borderRadius: 8, background: '#2563eb', color: '#fff', padding: '8px 12px', cursor: 'pointer' }}>
                {feedbackSubmitting ? 'Submitting…' : 'Submit feedback'}
              </button>
              {feedbackMessage ? <span style={{ fontSize: 13, color: feedbackMessage.includes('success') ? '#047857' : '#dc2626' }}>{feedbackMessage}</span> : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
