import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useTenant } from '../TenantContext';

type QuestionnaireRow = { id: string; question: string; answer: string };
type QuestionnaireSession = { phone: string; status: 'queued'|'in_progress'|'completed'|'canceled'; rows: QuestionnaireRow[]; updatedAt: string };
type QuestionnaireCampaign = { id: string; name?: string; introMessage?: string; sessions?: QuestionnaireSession[]; createdAt?: string; updatedAt?: string };

const INTRO_MESSAGE_SUFFIX = 'Please reply YES to proceed or No to Cancel';

const buildIntroMessage = (rawIntroMessage: string) => {
  const trimmed = rawIntroMessage.trim();
  if (!trimmed) return '';
  if (trimmed.includes(INTRO_MESSAGE_SUFFIX)) return trimmed;
  return `${trimmed} -- ${INTRO_MESSAGE_SUFFIX}`;
};

export default function WhatsAppQuestionnaireFlow() {
  const { tenantId } = useTenant();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [questionUploadText, setQuestionUploadText] = useState('');
  const [questionnaireRecipientsText, setQuestionnaireRecipientsText] = useState('');
  const [questionnaireName, setQuestionnaireName] = useState('New WhatsApp Questionnaire');
  const [questionnaireRows, setQuestionnaireRows] = useState<QuestionnaireRow[]>([]);
  const [introMessage, setIntroMessage] = useState('');
  const [campaigns, setCampaigns] = useState<QuestionnaireCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');

  const selectedCampaign = useMemo(() => campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0], [campaigns, selectedCampaignId]);
  const sessions = selectedCampaign?.sessions ?? [];

  const loadCampaigns = async () => {
    if (!tenantId) return;
    const response = await api<{ campaigns: QuestionnaireCampaign[]; campaign: QuestionnaireCampaign | null }>(`/tenants/${tenantId}/integrations/whatsapp/questionnaire-campaign`);
    const nextCampaigns = response.campaigns ?? (response.campaign ? [response.campaign] : []);
    setCampaigns(nextCampaigns);
    setSelectedCampaignId((prev) => {
      if (prev && nextCampaigns.some((campaign) => campaign.id === prev)) return prev;
      return nextCampaigns[0]?.id ?? '';
    });
  };

  useEffect(() => { void loadCampaigns(); }, [tenantId]);

  const loadRecentContacts = async () => {
    if (!tenantId) return;
    setSaving(true); setError('');
    try {
      const response = await api<{ contacts: string[]; windowHours: number }>(`/tenants/${tenantId}/integrations/whatsapp/questionnaire-campaign/recent-contacts`);
      setQuestionnaireRecipientsText(response.contacts.join('\n'));
      setMessage(`Loaded ${response.contacts.length} contact(s) from the last ${response.windowHours} hours.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load contacts'); }
    finally { setSaving(false); }
  };

  const uploadQuestions = () => {
    const parsed = questionUploadText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (!parsed.length) { setError('Please paste at least one question.'); return; }
    setQuestionnaireRows(parsed.map((question, index) => ({ id: `q-${index + 1}`, question, answer: '' })));
    setMessage(`Loaded ${parsed.length} question(s).`); setError('');
  };

  const startQuestionnaireCampaign = async () => {
    if (!tenantId) return;
    const recipients = Array.from(new Set(questionnaireRecipientsText.split(/[\n,\s]+/).map((v) => v.trim()).filter(Boolean)));
    if (!questionnaireRows.length) { setError('Load questions first.'); return; }
    if (!recipients.length) { setError('Provide recipient numbers first.'); return; }
    const finalIntroMessage = buildIntroMessage(introMessage);
    if (!finalIntroMessage) { setError('Set an intro message first.'); return; }
    setSaving(true); setError('');
    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp/questionnaire-campaign`, { method: 'POST', body: JSON.stringify({ name: questionnaireName, introMessage: finalIntroMessage, recipients, rows: questionnaireRows.map(({ id, question }) => ({ id, question })) }) });
      await loadCampaigns();
      setMessage(`Questionnaire workflow "${questionnaireName}" created.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create questionnaire workflow'); }
    finally { setSaving(false); }
  };

  const launchCampaign = async (campaignId: string) => {
    if (!tenantId) return;
    setSaving(true); setError('');
    try {
      const response = await api<{ launched: number }>(`/tenants/${tenantId}/integrations/whatsapp/questionnaire-campaign/launch`, { method: 'POST', body: JSON.stringify({ campaignId }) });
      await loadCampaigns();
      setMessage(`Auto research launched for ${response.launched} contact(s).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to launch questionnaire workflow'); }
    finally { setSaving(false); }
  };

  const deleteCampaign = async (campaignId: string) => {
    if (!tenantId) return;
    if (!window.confirm('Delete this questionnaire workflow?')) return;
    setSaving(true); setError('');
    try {
      await api(`/tenants/${tenantId}/integrations/whatsapp/questionnaire-campaign/${campaignId}`, { method: 'DELETE' });
      await loadCampaigns();
      setMessage('Questionnaire workflow deleted.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete questionnaire workflow'); }
    finally { setSaving(false); }
  };

  const completedCount = useMemo(() => sessions.filter((s) => s.status === 'completed').length, [sessions]);
  const orderedSessions = useMemo(() => {
    const rank: Record<QuestionnaireSession['status'], number> = { completed: 0, in_progress: 1, queued: 2, canceled: 3 };
    return [...sessions].sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }, [sessions]);

  return <div style={{ display: 'grid', gap: 20 }}>
    <div>
      <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>WhatsApp Questionnaire Flow Builder</h1>
      <p style={{ marginTop: 8, color: '#475569' }}>Create workflows, launch them, view results, and delete old workflows.</p>
    </div>

    <div style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, display: 'grid', gap: 12, background: '#f8fafc' }}>
      <label style={{ display: 'grid', gap: 6 }}>Questionnaire Name<input value={questionnaireName} onChange={(e) => setQuestionnaireName(e.target.value)} /></label>
      <label style={{ display: 'grid', gap: 6 }}>Intro Message (required)<textarea rows={4} value={introMessage} onChange={(e) => setIntroMessage(e.target.value)} placeholder='Example: Reply YES to start the questionnaire, or NO to cancel.' /></label>
      <label style={{ display: 'grid', gap: 6 }}>Upload Questions (one per line)<textarea rows={8} value={questionUploadText} onChange={(e) => setQuestionUploadText(e.target.value)} /></label>
      <label style={{ display: 'grid', gap: 6 }}>Recipients<textarea rows={5} value={questionnaireRecipientsText} onChange={(e) => setQuestionnaireRecipientsText(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type='button' onClick={loadRecentContacts}>Auto-load last 23h contacts</button>
        <button type='button' onClick={uploadQuestions}>Load Questions</button>
        <button type='button' disabled={saving} onClick={startQuestionnaireCampaign}>Create Workflow</button>
      </div>
    </div>

    <div style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>All Questionnaire Workflows</h2>
      {campaigns.length === 0 ? <p style={{ color: '#64748b' }}>No workflows yet.</p> : <div style={{ display: 'grid', gap: 12 }}>
        {campaigns.map((campaign) => (
          <div key={campaign.id} style={{ border: selectedCampaign?.id === campaign.id ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong>{campaign.name || 'Untitled Questionnaire'}</strong>
                <div style={{ color: '#334155', fontSize: 13 }}>Intro: {campaign.introMessage || '-'}</div>
                <div style={{ color: '#64748b', fontSize: 13 }}>Created: {campaign.createdAt || '-'}</div>
                <div style={{ color: '#64748b', fontSize: 13 }}>Recipients: {campaign.sessions?.length ?? 0}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type='button' onClick={() => setSelectedCampaignId(campaign.id)}>{selectedCampaign?.id === campaign.id ? 'Viewing Results' : 'View Results'}</button>
                <button type='button' disabled={saving} onClick={() => launchCampaign(campaign.id)}>Launch</button>
                <button type='button' disabled={saving} onClick={() => deleteCampaign(campaign.id)} style={{ color: '#b91c1c' }}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>}
    </div>

    {selectedCampaign && sessions.length > 0 && <div style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>{selectedCampaign.name || 'Questionnaire'} Results ({completedCount}/{sessions.length} completed)</h2>
      <div style={{ display: 'grid', gap: 12 }}>
        {orderedSessions.map((session) => (
          <div key={session.phone} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: session.status === 'completed' ? '#f8fafc' : '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <strong>{session.phone}</strong>
              <span style={{ textTransform: 'capitalize', fontWeight: 600, color: session.status === 'completed' ? '#047857' : '#b45309' }}>{session.status.replace('_', ' ')}</span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {session.rows.map((row) => (
                <div key={row.id} style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.question}</div>
                  <div style={{ color: '#475569' }}>{row.answer || '[pending]'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>}

    {message && <div style={{ color: '#047857', fontWeight: 500 }}>{message}</div>}
    {error && <div style={{ color: '#b91c1c', fontWeight: 500 }}>{error}</div>}
  </div>;
}
