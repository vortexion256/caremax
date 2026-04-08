import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin, type AuthLocals } from '../middleware/auth.js';
import { extractAndRecordLearningFromHistory } from '../services/agent.js';
import { runConfiguredAgent } from '../services/agent-dispatcher.js';
import { getTenantBillingStatus, WIDGET_BILLING_ERROR } from '../services/billing.js';
import type { ConversationStatus } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveConversationIdentity } from '../services/user-identity.js';
import { extractCustomProfileAttributes, extractDefaultProfileFields, getConversationDurationSeconds, normalizeXPersonCustomFields, syncXPersonProfileConversationDuration, upsertXPersonProfile } from '../services/xperson-profile.js';
import { isExplicitHumanRequest, isImmediateEmergencyHandoffSituation } from '../services/handoff-policy.js';
import { upsertClinicalSnapshot } from '../services/clinical-snapshot.js';
import { upsertConversationClinicalAnalytics } from '../services/clinical-analytics.js';
import { createAutoFollowupReminderIfNeeded } from '../services/reminders.js';
import { sendWhatsAppOutboundMessage } from '../services/whatsapp-outbound.js';

export const conversationRouter: Router = Router({ mergeParams: true });

const MESSAGES = 'messages';
const CONVERSATIONS = 'conversations';
const DIAGNOSTIC_LOGS = 'tenant_diagnostic_logs';
const DEFAULT_AGENT_HISTORY_LIMIT = 10;
const MIN_AGENT_HISTORY_LIMIT = 10;
const MAX_AGENT_HISTORY_LIMIT = 20;

function resolveAgentHistoryLimit(): number {
  const fromEnv = Number(process.env.AGENT_HISTORY_LIMIT);
  if (!Number.isFinite(fromEnv)) {
    return DEFAULT_AGENT_HISTORY_LIMIT;
  }

  const normalized = Math.floor(fromEnv);
  if (normalized < MIN_AGENT_HISTORY_LIMIT) {
    return MIN_AGENT_HISTORY_LIMIT;
  }
  if (normalized > MAX_AGENT_HISTORY_LIMIT) {
    return MAX_AGENT_HISTORY_LIMIT;
  }
  return normalized;
}

function shouldIncludeDebugTrace(opts: {
  isDebugRequested: boolean;
  isDevWidgetHeader: boolean;
  channel: string;
}): boolean {
  const isDevEnv = process.env.NODE_ENV !== 'production';
  return opts.isDebugRequested && opts.isDevWidgetHeader && isDevEnv && opts.channel === 'widget';
}

async function loadDebugTrace(params: {
  tenantId: string;
  conversationId: string;
  traceStartedAt: number;
  limit?: number;
}) {
  const logsSnap = await db
    .collection(DIAGNOSTIC_LOGS)
    .where('tenantId', '==', params.tenantId)
    .where('conversationId', '==', params.conversationId)
    .orderBy('createdAt', 'desc')
    .limit(params.limit ?? 40)
    .get();

  return logsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        logId: d.id,
        source: typeof data.source === 'string' ? data.source : 'unknown',
        step: typeof data.step === 'string' ? data.step : 'unknown',
        status: typeof data.status === 'string' ? data.status : 'ok',
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
        error: typeof data.error === 'string' ? data.error : null,
        metadata: (data.metadata && typeof data.metadata === 'object') ? (data.metadata as Record<string, unknown>) : null,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    })
    .filter((log) => {
      if (typeof log.createdAt !== 'number') return true;
      return log.createdAt >= params.traceStartedAt - 5000;
    })
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function toWhatsAppAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

async function sendWhatsAppHumanMessage(params: {
  to: string;
  body: string;
  tenantId: string;
  preferredChannel?: 'whatsapp' | 'whatsapp_meta';
}): Promise<void> {
  await sendWhatsAppOutboundMessage({
    tenantId: params.tenantId,
    to: toWhatsAppAddress(params.to),
    body: params.body,
    preferredChannel: params.preferredChannel,
  });
}

conversationRouter.use(requireTenantParam);

const createBody = z.object({
  userId: z.string().optional(),
  externalUserId: z.string().optional(),
  channel: z.enum(['widget']).optional(),
});
const messageBody = z.object({
  content: z.string().min(1),
  imageUrls: z.array(z.string().url()).optional(),
});

conversationRouter.post('/', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const billing = await getTenantBillingStatus(tenantId);
  if (!billing.isActive) {
    res.status(402).json({ error: WIDGET_BILLING_ERROR, code: 725, details: WIDGET_BILLING_ERROR });
    return;
  }
  const parsed = createBody.safeParse(req.body);
  const identity = resolveConversationIdentity({
    channel: 'widget',
    externalUserId: parsed.success ? parsed.data.externalUserId : undefined,
    fallbackUserId: parsed.success ? parsed.data.userId : undefined,
  });
  const ref = await db.collection(CONVERSATIONS).add({
    tenantId,
    userId: identity.scopedUserId,
    externalUserId: identity.externalUserId,
    channel: 'widget',
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({
    conversationId: ref.id,
    tenantId,
    userId: identity.scopedUserId,
    externalUserId: identity.externalUserId,
    status: 'open',
  });
});

conversationRouter.get('/:conversationId/messages', async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const conv = await db.collection(CONVERSATIONS).doc(conversationId).get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  const snap = await db.collection(MESSAGES).where('conversationId', '==', conversationId).orderBy('createdAt', 'asc').get();
  const messages = snap.docs.map((d) => {
    const data = d.data();
    return {
      messageId: d.id,
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      imageUrls: data.imageUrls,
      createdAt: data.createdAt?.toMillis?.() ?? null,
    };
  });
  const convStatus = (conv.data()?.status as string) ?? 'open';
  res.json({ messages, status: convStatus });
});

conversationRouter.get('/:conversationId/debug-trace', async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const conv = await db.collection(CONVERSATIONS).doc(conversationId).get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const convData = conv.data() ?? {};
  const channel = typeof convData.channel === 'string' ? convData.channel : 'widget';
  const includeDebugTrace = shouldIncludeDebugTrace({
    isDebugRequested: req.query.debug === '1',
    isDevWidgetHeader: req.headers['x-caremax-dev-widget'] === '1',
    channel,
  });
  if (!includeDebugTrace) {
    res.json({ debugTrace: [] });
    return;
  }

  const traceStartedAtRaw = Number(req.query.traceStartedAt);
  const traceStartedAt = Number.isFinite(traceStartedAtRaw) ? traceStartedAtRaw : Date.now() - 30000;
  try {
    const debugTrace = await loadDebugTrace({ tenantId, conversationId, traceStartedAt, limit: 80 });
    res.json({ debugTrace });
  } catch (e) {
    console.error('Failed to load debug trace for widget:', e);
    res.status(500).json({ error: 'Failed to load debug trace' });
  }
});

conversationRouter.post('/:conversationId/messages', async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const billing = await getTenantBillingStatus(tenantId);
  if (!billing.isActive) {
    res.status(402).json({ error: WIDGET_BILLING_ERROR, code: 725, details: WIDGET_BILLING_ERROR });
    return;
  }
  const parsed = messageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const convRef = db.collection(CONVERSATIONS).doc(conversationId);
  const conv = await convRef.get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  const { content, imageUrls } = parsed.data;
  const convData = conv.data() ?? {};
  const channel = typeof convData.channel === 'string' ? convData.channel : 'widget';
  const includeDebugTrace = shouldIncludeDebugTrace({
    isDebugRequested: req.query.debug === '1',
    isDevWidgetHeader: req.headers['x-caremax-dev-widget'] === '1',
    channel,
  });

  const userMsgRef = await db.collection(MESSAGES).add({
    conversationId,
    tenantId,
    role: 'user',
    content,
    imageUrls: imageUrls ?? [],
    createdAt: FieldValue.serverTimestamp(),
  });


  try {
    const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
    const configData = agentConfigDoc.data();
    if (configData?.xPersonProfileEnabled === true) {
      const profileDetails = extractDefaultProfileFields(content);
      const customFields = normalizeXPersonCustomFields(configData?.xPersonProfileCustomFields);
      const extractedAttributes = extractCustomProfileAttributes(content, customFields);
      const conversationDurationLastConversationSeconds = await getConversationDurationSeconds(conversationId);
      await upsertXPersonProfile({
        tenantId,
        userId: typeof convData?.userId === 'string' ? convData.userId : undefined,
        externalUserId: typeof convData?.externalUserId === 'string' ? convData.externalUserId : undefined,
        channel: channel === 'whatsapp' ? 'whatsapp' : 'widget',
        conversationId,
        details: {
          ...profileDetails,
          ...(typeof conversationDurationLastConversationSeconds === 'number'
            ? { conversationDurationLastConversationSeconds }
            : {}),
        },
        ...(Object.keys(extractedAttributes).length > 0 ? { attributes: extractedAttributes } : {}),
      });
    }
  } catch (profileError) {
    console.warn('[Conversations] Failed to upsert XPersonProfile from incoming message:', profileError);
  }


  let recentClinicalSummary: { primarySymptom: string; symptomDuration: string | null; severity: 'mild' | 'moderate' | 'severe' | 'critical' | 'unknown'; triageOutcome: 'home_care' | 'monitor' | 'clinic_visit' | 'escalate' | 'unknown'; redFlags: string[] } | null = null;
  try {
    await upsertClinicalSnapshot({
      tenantId,
      conversationId,
      userId: typeof convData?.userId === 'string' ? convData.userId : undefined,
      externalUserId: typeof convData?.externalUserId === 'string' ? convData.externalUserId : undefined,
      text: content,
      source: channel === 'whatsapp_meta' ? 'whatsapp_meta' : channel === 'whatsapp' ? 'whatsapp' : 'widget',
    });
  } catch (snapshotError) {
    console.warn('[Conversations] Failed to upsert clinical snapshot:', snapshotError);
  }

  try {
    recentClinicalSummary = await upsertConversationClinicalAnalytics({
      tenantId,
      conversationId,
      userId: typeof convData?.userId === 'string' ? convData.userId : undefined,
      externalUserId: typeof convData?.externalUserId === 'string' ? convData.externalUserId : undefined,
      text: content,
      source: channel === 'whatsapp_meta' ? 'whatsapp_meta' : channel === 'whatsapp' ? 'whatsapp' : 'widget',
    });
  } catch (analyticsCaptureError) {
    console.warn('[Conversations] Failed to upsert conversation clinical analytics:', analyticsCaptureError);
  }

  const status = (conv.data()?.status as string) ?? 'open';
  const humanActive = status === 'human_joined';
  const alreadyRequestedHandoff = status === 'handoff_requested';

  if (humanActive) {
    await convRef.update({ updatedAt: FieldValue.serverTimestamp() });
    res.status(201).json({
      userMessageId: userMsgRef.id,
      assistantMessageId: null,
      assistantContent: null,
      requestHandoff: false,
    });
    return;
  }

  const wantsHumanAgain = (text: string) => isExplicitHumanRequest(text) || isImmediateEmergencyHandoffSituation(text);

  if (alreadyRequestedHandoff && wantsHumanAgain(content)) {
    const shortMessage =
      "A human agent has already been notified and will join shortly. Please stay on this page.";
    const assistantMsgRef = await db.collection(MESSAGES).add({
      conversationId,
      tenantId,
      role: 'assistant',
      content: shortMessage,
      createdAt: FieldValue.serverTimestamp(),
    });
    await convRef.update({ updatedAt: FieldValue.serverTimestamp() });
    res.status(201).json({
      userMessageId: userMsgRef.id,
      assistantMessageId: assistantMsgRef.id,
      assistantContent: shortMessage,
      requestHandoff: false,
    });
    return;
  }

  // Reserve handoff immediately when user asks for human (status still open) so a second
  // request (double-send or quick repeat) gets the short reply instead of running the agent again.
  if (status === 'open' && wantsHumanAgain(content)) {
    await convRef.update({
      status: 'handoff_requested',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const historyLimit = resolveAgentHistoryLimit();
  const historySnap = await db
    .collection(MESSAGES)
    .where('conversationId', '==', conversationId)
    .orderBy('createdAt', 'desc')
    .limit(historyLimit)
    .get();
  const history = historySnap.docs.reverse().map((d) => {
    const data = d.data();
    return { role: data.role, content: data.content, imageUrls: data.imageUrls ?? [] };
  });

  let agentResponse: { text: string; requestHandoff?: boolean };
  const traceStartedAt = Date.now();
  try {
    const userId = (convData?.userId as string | undefined)
      ?? ((convData?.channel as string | undefined) && (convData?.externalUserId as string | undefined)
        ? `${convData.channel}:${convData.externalUserId}`
        : undefined);
    const externalUserId = typeof convData?.externalUserId === 'string' ? convData.externalUserId : undefined;
    agentResponse = await runConfiguredAgent(tenantId, history, {
      userId,
      externalUserId,
      conversationId,
      channel: channel === 'whatsapp_meta' ? 'whatsapp_meta' : channel === 'whatsapp' ? 'whatsapp' : 'widget',
    });
  } catch (err) {
    console.error('Agent error:', err);
    const message = err instanceof Error ? err.message : 'Agent failed';
    res.status(500).json({ error: 'Agent error', details: message });
    return;
  }

  const assistantMsgRef = await db.collection(MESSAGES).add({
    conversationId,
    tenantId,
    role: 'assistant',
    content: agentResponse.text,
    createdAt: FieldValue.serverTimestamp(),
  });

  const handoffRequested = agentResponse.requestHandoff ?? false;
  try {
    const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
    const configData = agentConfigDoc.data();
    if (configData?.xPersonProfileEnabled === true) {
      await syncXPersonProfileConversationDuration({
        tenantId,
        conversationId,
        userId: typeof convData?.userId === 'string' ? convData.userId : undefined,
        externalUserId: typeof convData?.externalUserId === 'string' ? convData.externalUserId : undefined,
        channel: channel === 'whatsapp' ? 'whatsapp' : 'widget',
      });
    }
    const autoFollowupEnabled = configData?.autoFollowupEnabled === true;
    if (
      autoFollowupEnabled
      && (channel === 'whatsapp' || channel === 'whatsapp_meta')
      && !handoffRequested
      && recentClinicalSummary?.primarySymptom
      && (recentClinicalSummary?.triageOutcome === 'home_care' || recentClinicalSummary?.triageOutcome === 'monitor' || recentClinicalSummary?.triageOutcome === 'unknown')
    ) {
      const timezone = typeof configData?.agentTimezone === 'string' && configData.agentTimezone.trim()
        ? configData.agentTimezone.trim()
        : 'UTC';
      const delayHoursRaw = Number(configData?.autoFollowupDelayHours);
      const delayHours = Number.isFinite(delayHoursRaw) ? Math.min(72, Math.max(1, Math.trunc(delayHoursRaw))) : 24;
      const sleepStartRaw = Number(configData?.autoFollowupSleepStartHour);
      const sleepEndRaw = Number(configData?.autoFollowupSleepEndHour);
      const sleepStartHour = Number.isFinite(sleepStartRaw) ? Math.min(23, Math.max(0, Math.trunc(sleepStartRaw))) : 22;
      const sleepEndHour = Number.isFinite(sleepEndRaw) ? Math.min(23, Math.max(0, Math.trunc(sleepEndRaw))) : 6;
      await createAutoFollowupReminderIfNeeded({
        tenantId,
        conversationId,
        externalUserId: typeof convData?.externalUserId === 'string' ? convData.externalUserId : undefined,
        userId: typeof convData?.userId === 'string' ? convData.userId : undefined,
        ownerLabel: typeof convData?.name === 'string' ? convData.name : undefined,
        timezone,
        delayHours: recentClinicalSummary.severity === 'mild' ? Math.max(delayHours, 24) : delayHours,
        sleepStartHour,
        sleepEndHour,
        primarySymptom: recentClinicalSummary.primarySymptom,
        symptomDuration: recentClinicalSummary.symptomDuration ?? undefined,
        severity: recentClinicalSummary.severity === 'unknown' ? undefined : recentClinicalSummary.severity,
      });
    }
  } catch (profileError) {
    console.warn('[Conversations] Failed to sync post-reply profile/follow-up routines:', profileError);
  }

  if (handoffRequested) {
    await convRef.update({
      status: 'handoff_requested',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await convRef.update({ updatedAt: FieldValue.serverTimestamp() });

  let debugTrace: Array<{
    logId: string;
    source: string;
    step: string;
    status: string;
    durationMs: number | null;
    error: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: number | null;
  }> | undefined;
  if (includeDebugTrace) {
    try {
      debugTrace = await loadDebugTrace({ tenantId, conversationId, traceStartedAt });
    } catch (e) {
      console.error('Failed to load debug trace for widget:', e);
    }
  }

  res.status(201).json({
    userMessageId: userMsgRef.id,
    assistantMessageId: assistantMsgRef.id,
    assistantContent: agentResponse.text,
    requestHandoff: handoffRequested,
    ...(includeDebugTrace ? { debugTrace: debugTrace ?? [] } : {}),
  });
});

conversationRouter.post('/:conversationId/join', requireAuth, async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const { uid } = res.locals as AuthLocals;
  const convRef = db.collection(CONVERSATIONS).doc(conversationId);
  const conv = await convRef.get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  await convRef.update({
    status: 'human_joined',
    updatedAt: FieldValue.serverTimestamp(),
    joinedBy: uid,
  });
  res.json({ conversationId, status: 'human_joined' });
});

conversationRouter.post('/:conversationId/return-to-agent', requireAuth, requireAdmin, async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const convRef = db.collection(CONVERSATIONS).doc(conversationId);
  const conv = await convRef.get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  await convRef.update({
    status: 'open',
    updatedAt: FieldValue.serverTimestamp(),
    joinedBy: FieldValue.delete(),
  });

  // Record what was learned from the human-handoff conversation so the agent doesn't miss it
  // when the user never sends another message after "Return to AI"
  const messagesSnap = await db.collection(MESSAGES).where('conversationId', '==', conversationId).orderBy('createdAt', 'asc').get();
  const history = messagesSnap.docs.map((d) => {
    const data = d.data();
    return {
      role: data.role as string,
      content: data.content ?? '',
      imageUrls: data.imageUrls as string[] | undefined,
    };
  });
  const convData = conv.data();
  const userId = (convData?.userId as string | undefined) ?? undefined;
  void extractAndRecordLearningFromHistory(tenantId, history, { userId, conversationId }).catch((e) => {
    console.error('extractAndRecordLearningFromHistory on return-to-agent failed:', e);
  });

  res.json({ conversationId, status: 'open' });
});

conversationRouter.post('/:conversationId/agent-message', requireAuth, requireAdmin, async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const body = z.object({ content: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Invalid body' });
    return;
  }
  const conv = await db.collection(CONVERSATIONS).doc(conversationId).get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  const convData = conv.data() ?? {};
  const channel = typeof convData.channel === 'string' ? convData.channel : 'widget';
  const externalUserId = typeof convData.externalUserId === 'string' ? convData.externalUserId : '';

  try {
    if (channel === 'whatsapp' || channel === 'whatsapp_meta') {
      if (!externalUserId) {
        res.status(400).json({ error: 'WhatsApp conversation is missing externalUserId' });
        return;
      }
      await sendWhatsAppHumanMessage({
        tenantId,
        to: externalUserId,
        body: body.data.content,
        preferredChannel: channel,
      });
    }
  } catch (error) {
    console.error('Failed to send human handoff message to WhatsApp:', error);
    const details = error instanceof Error ? error.message : 'Unknown send error';
    res.status(502).json({ error: 'Failed to send WhatsApp message', details });
    return;
  }

  await db.collection(MESSAGES).add({
    conversationId,
    tenantId,
    role: 'human_agent',
    content: body.data.content,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection(CONVERSATIONS).doc(conversationId).update({
    updatedAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ ok: true });
});

conversationRouter.delete('/:conversationId', requireAuth, requireAdmin, async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
  const convRef = db.collection(CONVERSATIONS).doc(conversationId);
  const conv = await convRef.get();
  if (!conv.exists || (conv.data()?.tenantId as string) !== tenantId) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  // Delete all messages in the conversation
  const messagesSnap = await db.collection(MESSAGES).where('conversationId', '==', conversationId).get();
  const batch = db.batch();
  messagesSnap.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  // Delete the conversation itself
  batch.delete(convRef);
  
  await batch.commit();
  
  res.json({ ok: true, message: 'Conversation and messages deleted' });
});
