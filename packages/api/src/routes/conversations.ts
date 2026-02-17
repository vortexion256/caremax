import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin, type AuthLocals } from '../middleware/auth.js';
import { runAgent, extractAndRecordLearningFromHistory } from '../services/agent.js';
import type { ConversationStatus } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';

export const conversationRouter: Router = Router({ mergeParams: true });

const MESSAGES = 'messages';
const CONVERSATIONS = 'conversations';

conversationRouter.use(requireTenantParam);

const createBody = z.object({ userId: z.string().optional() });
const messageBody = z.object({
  content: z.string().min(1),
  imageUrls: z.array(z.string().url()).optional(),
});

conversationRouter.post('/', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = createBody.safeParse(req.body);
  const userId = parsed.success ? (parsed.data.userId ?? `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`) : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ref = await db.collection(CONVERSATIONS).add({
    tenantId,
    userId,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({
    conversationId: ref.id,
    tenantId,
    userId,
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

conversationRouter.post('/:conversationId/messages', async (req, res) => {
  const { conversationId } = req.params;
  const tenantId = res.locals.tenantId as string;
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
  try {
    const convData = conv.data();
    const userId = (convData?.userId as string | undefined) ?? undefined;
    agentResponse = await runAgent(tenantId, history, {
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

  res.status(201).json({
    userMessageId: userMsgRef.id,
    assistantMessageId: assistantMsgRef.id,
    assistantContent: agentResponse.text,
    requestHandoff: handoffRequested,
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
