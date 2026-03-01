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

export const conversationRouter: Router = Router({ mergeParams: true });

const MESSAGES = 'messages';
const CONVERSATIONS = 'conversations';
const DIAGNOSTIC_LOGS = 'tenant_diagnostic_logs';

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
  tenantId: string;
  to: string;
  body: string;
}): Promise<void> {
  const integrationDoc = await db.collection('tenant_integrations').doc(params.tenantId).get();
  const whatsapp = integrationDoc.data()?.whatsapp;
  if (!whatsapp?.connected) {
    throw new Error('WhatsApp integration is not connected for this tenant.');
  }

  const accountSid = typeof whatsapp.accountSid === 'string' ? whatsapp.accountSid.trim() : '';
  const authToken = typeof whatsapp.authToken === 'string' ? whatsapp.authToken.trim() : '';
  const messagingServiceSid = typeof whatsapp.messagingServiceSid === 'string' ? whatsapp.messagingServiceSid.trim() : '';
  const whatsappNumber = typeof whatsapp.whatsappNumber === 'string' ? whatsapp.whatsappNumber.trim() : '';

  if (!accountSid || !authToken) {
    throw new Error('WhatsApp integration credentials are incomplete.');
  }

  if (!messagingServiceSid && !whatsappNumber) {
    throw new Error('WhatsApp integration requires either Messaging Service SID or WhatsApp number.');
  }

  const payload = new URLSearchParams({
    To: toWhatsAppAddress(params.to),
    Body: params.body,
  });
  if (messagingServiceSid) {
    payload.set('MessagingServiceSid', messagingServiceSid);
  } else {
    payload.set('From', toWhatsAppAddress(whatsappNumber));
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Twilio send failed (${response.status}): ${details}`);
  }
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

  const wantsHumanAgain = (text: string) =>
    /\b(talk|speak|connect|transfer|hand me off|get me)\s+(to|with)\s+(a\s+)?(human|real\s+person|person|agent|someone|care\s+team|staff|representative)/i.test(text) ||
    /\b(let me\s+)?(talk|speak)\s+to\s+(a\s+)?(human|person|someone)/i.test(text) ||
    /\b(want|need)\s+to\s+(speak|talk)\s+to\s+(a\s+)?(human|person|someone)/i.test(text) ||
    /\b(real\s+person|human\s+agent|live\s+agent)/i.test(text);

  if (alreadyRequestedHandoff && wantsHumanAgain(content)) {
    const shortMessage =
      "A care team member has already been notified and will join shortly. Please stay on this page.";
    const assistantMsgRef = await db.collection(MESSAGES).add({
      conversationId,
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

  const historySnap = await db.collection(MESSAGES).where('conversationId', '==', conversationId).orderBy('createdAt', 'asc').get();
  const history = historySnap.docs.map((d) => {
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
    agentResponse = await runConfiguredAgent(tenantId, history, {
      userId,
      conversationId,
    });
  } catch (err) {
    console.error('Agent error:', err);
    const message = err instanceof Error ? err.message : 'Agent failed';
    res.status(500).json({ error: 'Agent error', details: message });
    return;
  }

  const assistantMsgRef = await db.collection(MESSAGES).add({
    conversationId,
    role: 'assistant',
    content: agentResponse.text,
    createdAt: FieldValue.serverTimestamp(),
  });

  const handoffRequested = agentResponse.requestHandoff ?? false;
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
    if (channel === 'whatsapp') {
      if (!externalUserId) {
        res.status(400).json({ error: 'WhatsApp conversation is missing externalUserId' });
        return;
      }
      await sendWhatsAppHumanMessage({
        tenantId,
        to: externalUserId,
        body: body.data.content,
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
