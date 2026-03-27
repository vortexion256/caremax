import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';

export const analyticsRouter: Router = Router({ mergeParams: true });

analyticsRouter.use(requireTenantParam);
analyticsRouter.use(requireAuth);
analyticsRouter.use(requireAdmin);

analyticsRouter.get('/interactions', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const now = Date.now();

  const periods = {
    '1d': now - 24 * 60 * 60 * 1000,
    '7d': now - 7 * 24 * 60 * 60 * 1000,
    '1w': now - 7 * 24 * 60 * 60 * 1000, // Same as 7d
    '1m': now - 30 * 24 * 60 * 60 * 1000,
    '1y': now - 365 * 24 * 60 * 60 * 1000,
  };

  try {
    // Fetch all conversations for the tenant once to avoid multiple queries and potential index issues
    // We'll filter in-memory for the different periods since the dataset for a single tenant is likely manageable
    const [conversationSnap, messageSnap] = await Promise.all([
      db.collection('conversations')
        .where('tenantId', '==', tenantId)
        .get(),
      db.collection('messages')
        .where('tenantId', '==', tenantId)
        .where('role', '==', 'human_agent')
        .get(),
    ]);

    const conversationsWithHumanMessages = new Set(
      messageSnap.docs
        .map((doc) => doc.data().conversationId as string | undefined)
        .filter((conversationId): conversationId is string => Boolean(conversationId)),
    );

    const results: Record<string, any> = {};
    const allDocs = conversationSnap.docs.map(doc => ({
      id: doc.id,
      data: doc.data(),
      createdAtMs: doc.data().createdAt?.toMillis?.() || 0
    }));

    for (const [label, startTime] of Object.entries(periods)) {
      let aiOnly = 0;
      let handoff = 0;
      const uniqueUsers = new Set();
      let count = 0;

      allDocs.forEach(doc => {
        if (doc.createdAtMs >= startTime) {
          count++;
          const data = doc.data;
          uniqueUsers.add(data.userId);

          const hasHumanMessage = conversationsWithHumanMessages.has(doc.id);
          if (hasHumanMessage || data.status === 'handoff_requested' || data.status === 'human_joined') {
            handoff++;
          } else {
            aiOnly++;
          }
        }
      });

      results[label] = {
        totalConversations: count,
        aiOnlyResolved: aiOnly,
        humanAiResolved: handoff,
        uniqueUsers: uniqueUsers.size,
      };
    }

    res.json(results);
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});


analyticsRouter.get('/conversations', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const period = typeof req.query.period === 'string' ? req.query.period : '7d';
  const now = Date.now();

  const offsetByPeriod: Record<string, number> = {
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
  };
  const startTime = now - (offsetByPeriod[period] ?? offsetByPeriod['7d']);

  try {
    const [conversationSnap, messageSnap] = await Promise.all([
      db.collection('conversations').where('tenantId', '==', tenantId).get(),
      db.collection('messages').where('tenantId', '==', tenantId).get(),
    ]);

    const conversationMap = new Map<string, { conversationId: string; createdAt: number; totalMessages: number }>();
    for (const doc of conversationSnap.docs) {
      const data = doc.data();
      const createdAt = data.createdAt?.toMillis?.() ?? 0;
      if (createdAt >= startTime) {
        conversationMap.set(doc.id, { conversationId: doc.id, createdAt, totalMessages: 0 });
      }
    }

    for (const doc of messageSnap.docs) {
      const data = doc.data();
      const convId = typeof data.conversationId === 'string' ? data.conversationId : null;
      if (!convId || !conversationMap.has(convId)) continue;
      const bucket = conversationMap.get(convId)!;
      bucket.totalMessages += 1;
    }

    const conversations = Array.from(conversationMap.values()).sort((a, b) => b.createdAt - a.createdAt);

    res.json({
      period,
      totalConversations: conversations.length,
      conversations,
    });
  } catch (e) {
    console.error('Conversation analytics error:', e);
    res.status(500).json({ error: 'Failed to fetch conversation analytics' });
  }
});


analyticsRouter.post('/feedback', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const body = (req.body ?? {}) as {
    sessionId?: unknown;
    helpful?: unknown;
    visitedClinic?: unknown;
    realOutcome?: unknown;
    accuracy?: unknown;
    notes?: unknown;
  };

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  if (typeof body.helpful !== 'boolean') {
    res.status(400).json({ error: 'helpful must be a boolean' });
    return;
  }

  const visitedClinic = typeof body.visitedClinic === 'boolean' ? body.visitedClinic : null;
  const realOutcome = typeof body.realOutcome === 'string' ? body.realOutcome.trim() : '';
  const accuracy = typeof body.accuracy === 'boolean' ? body.accuracy : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  try {
    const feedbackRef = db.collection('ai_feedback').doc();
    await feedbackRef.set({
      feedbackId: feedbackRef.id,
      tenantId,
      sessionId,
      helpful: body.helpful,
      ...(visitedClinic === null ? {} : { visitedClinic }),
      ...(realOutcome ? { realOutcome } : {}),
      ...(accuracy === null ? {} : { accuracy }),
      ...(notes ? { notes } : {}),
      createdAt: Date.now(),
      createdAtServer: new Date(),
    });

    res.status(201).json({ feedbackId: feedbackRef.id, ok: true });
  } catch (error) {
    console.error('Feedback submission error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});


analyticsRouter.get('/learning-loop', async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const now = Date.now();
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
  const startTime = now - days * 24 * 60 * 60 * 1000;

  const fallbackPatterns = [
    'i can\'t',
    'i cannot',
    'not sure',
    'unable to',
    'contact a clinician',
    'visit a clinic',
  ];

  const toMs = (value: any): number => value?.toMillis?.() ?? (typeof value === 'number' ? value : 0);

  const extractTaggedValue = (text: string | undefined, keys: string[]): string | null => {
    if (!text) return null;
    const lower = text.toLowerCase();
    for (const key of keys) {
      const marker = `${key.toLowerCase()}:`;
      const index = lower.indexOf(marker);
      if (index < 0) continue;
      const start = index + marker.length;
      const rest = text.slice(start).trim();
      if (!rest) continue;
      const line = rest.split(/\n|\.|,/)[0]?.trim();
      if (line) return line;
    }
    return null;
  };

  try {
    const [conversationSnap, profileSnap, encounterFactsSnap, feedbackSnap, clinicalSnapshotSnap] = await Promise.all([
      db.collection('conversations').where('tenantId', '==', tenantId).get(),
      db.collection('xperson_profiles').where('tenantId', '==', tenantId).get(),
      db.collection('encounter_facts').where('tenantId', '==', tenantId).get(),
      db.collection('ai_feedback').where('tenantId', '==', tenantId).get(),
      db.collection('session_clinical_snapshots').where('tenantId', '==', tenantId).get(),
    ]);

    const recentConversations = conversationSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((row) => toMs((row as any).createdAt) >= startTime);
    const recentConversationIds = new Set(recentConversations.map((row) => row.id));

    const messagesByConversation = new Map<string, Array<{ role: string; content: string }>>();
    const recentConversationIdList = Array.from(recentConversationIds);
    for (let i = 0; i < recentConversationIdList.length; i += 10) {
      const chunk = recentConversationIdList.slice(i, i + 10);
      if (chunk.length === 0) continue;
      const chunkSnap = await db.collection('messages').where('conversationId', 'in', chunk).get();
      for (const doc of chunkSnap.docs) {
        const data = doc.data();
        const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
        if (!conversationId || !recentConversationIds.has(conversationId)) continue;
        const bucket = messagesByConversation.get(conversationId) ?? [];
        bucket.push({ role: data.role as string, content: typeof data.content === 'string' ? data.content : '' });
        messagesByConversation.set(conversationId, bucket);
      }
    }

    let firstResponseDropoffCount = 0;
    let totalAssistantMessages = 0;
    let fallbackAssistantMessages = 0;
    const users = new Map<string, number>();
    const topSymptoms = new Map<string, number>();
    const topRiskSignals = new Map<string, number>();

    for (const convo of recentConversations) {
      const userId = typeof (convo as any).userId === 'string' ? (convo as any).userId : '';
      if (userId) users.set(userId, (users.get(userId) ?? 0) + 1);

      const convoMessages = messagesByConversation.get(convo.id) ?? [];
      const userCount = convoMessages.filter((msg) => msg.role === 'user').length;
      if (userCount <= 1) firstResponseDropoffCount += 1;

      for (const msg of convoMessages) {
        if (msg.role !== 'assistant') continue;
        totalAssistantMessages += 1;
        const lower = msg.content.toLowerCase();
        if (fallbackPatterns.some((pattern) => lower.includes(pattern))) {
          fallbackAssistantMessages += 1;
        }
      }
    }


    for (const doc of clinicalSnapshotSnap.docs) {
      const data = doc.data();
      if (!recentConversationIds.has(String(data.conversationId ?? ''))) continue;

      const symptoms = Array.isArray(data.symptoms) ? data.symptoms.filter((value): value is string => typeof value === 'string') : [];
      for (const symptom of symptoms) {
        const key = symptom.trim().toLowerCase();
        if (key) topSymptoms.set(key, (topSymptoms.get(key) ?? 0) + 1);
      }

      const riskLevel = typeof data.riskLevel === 'string' ? data.riskLevel.trim().toLowerCase() : '';
      if (riskLevel) {
        topRiskSignals.set(`risk:${riskLevel}`, (topRiskSignals.get(`risk:${riskLevel}`) ?? 0) + 1);
      }

      const tags = Array.isArray(data.smartTags) ? data.smartTags.filter((value): value is string => typeof value === 'string') : [];
      for (const tag of tags) {
        const key = `tag:${tag.trim().toLowerCase()}`;
        topRiskSignals.set(key, (topRiskSignals.get(key) ?? 0) + 1);
      }
    }

    for (const doc of encounterFactsSnap.docs) {
      const data = doc.data();
      const createdAtMs = toMs(data.createdAt);
      if (createdAtMs < startTime) continue;
      if (data.factType === 'symptom') {
        const symptom = (typeof data.title === 'string' ? data.title : '').trim().toLowerCase();
        if (symptom) topSymptoms.set(symptom, (topSymptoms.get(symptom) ?? 0) + 1);
      }
      const riskFlag = Array.isArray(data.safetyFlags) ? data.safetyFlags.find((flag) => typeof flag === 'string' && flag.trim()) : null;
      if (riskFlag) {
        const key = String(riskFlag).trim().toLowerCase();
        topRiskSignals.set(key, (topRiskSignals.get(key) ?? 0) + 1);
      }
    }

    for (const doc of profileSnap.docs) {
      const data = doc.data();
      const attributes = data.attributes && typeof data.attributes === 'object' ? data.attributes as Record<string, unknown> : {};
      const symptom = extractTaggedValue(typeof attributes.symptoms === 'string' ? attributes.symptoms : undefined, ['symptom', 'symptoms']);
      if (symptom) {
        const key = symptom.toLowerCase();
        topSymptoms.set(key, (topSymptoms.get(key) ?? 0) + 1);
      }

      const chronic = typeof attributes.chronicFlags === 'string' ? attributes.chronicFlags : typeof attributes.chronic_flags === 'string' ? attributes.chronic_flags : undefined;
      if (chronic) {
        const key = chronic.toLowerCase();
        topRiskSignals.set(key, (topRiskSignals.get(key) ?? 0) + 1);
      }
    }

    const totalSessions = recentConversations.length;
    const escalatedSessions = recentConversations.filter((row: any) => row.status === 'handoff_requested' || row.status === 'human_joined').length;
    const repeatUsers = Array.from(users.values()).filter((count) => count > 1).length;

    const profilesWithHistory = profileSnap.docs.filter((doc) => {
      const data = doc.data();
      return Boolean(data.lastConversationId || toMs(data.updatedAt) >= startTime);
    }).length;

    const feedbackDocs = feedbackSnap.docs
      .map((doc) => doc.data())
      .filter((data) => toMs(data.createdAt) >= startTime);
    const helpfulFeedback = feedbackDocs.filter((data) => data.helpful === true).length;
    const withClinicalOutcome = feedbackDocs.filter((data) => typeof data.realOutcome === 'string' && data.realOutcome.trim().length > 0).length;
    const accuracyConfirmed = feedbackDocs.filter((data) => data.accuracy === true).length;

    res.json({
      windowDays: days,
      generatedAt: now,
      interactionAnalytics: {
        totalSessions,
        dropoffAfterFirstResponseRate: totalSessions > 0 ? Number((firstResponseDropoffCount / totalSessions).toFixed(4)) : 0,
        triageEscalationRate: totalSessions > 0 ? Number((escalatedSessions / totalSessions).toFixed(4)) : 0,
        avgMessagesPerSession: totalSessions > 0 ? Number((Array.from(messagesByConversation.values()).reduce((sum, rows) => sum + rows.length, 0) / totalSessions).toFixed(2)) : 0,
        repeatUserRate: users.size > 0 ? Number((repeatUsers / users.size).toFixed(4)) : 0,
        fallbackResponseRate: totalAssistantMessages > 0 ? Number((fallbackAssistantMessages / totalAssistantMessages).toFixed(4)) : 0,
      },
      clinicalInsights: {
        topSymptoms: Array.from(topSymptoms.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([symptom, count]) => ({ symptom, count })),
        topRiskSignals: Array.from(topRiskSignals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([signal, count]) => ({ signal, count })),
        highRiskCaseCount: escalatedSessions,
      },
      patientMemory: {
        trackedProfiles: profileSnap.size,
        profilesWithRecentActivity: profilesWithHistory,
        profilesCoverageRate: totalSessions > 0 ? Number((profilesWithHistory / totalSessions).toFixed(4)) : 0,
        sessionsWithClinicalSnapshot: clinicalSnapshotSnap.docs.filter((doc) => recentConversationIds.has(String(doc.data().conversationId ?? ''))).length,
      },
      feedbackLoop: {
        totalFeedbackEntries: feedbackDocs.length,
        helpfulRate: feedbackDocs.length > 0 ? Number((helpfulFeedback / feedbackDocs.length).toFixed(4)) : null,
        outcomeCaptureRate: feedbackDocs.length > 0 ? Number((withClinicalOutcome / feedbackDocs.length).toFixed(4)) : null,
        adviceAccuracyRate: feedbackDocs.length > 0 ? Number((accuracyConfirmed / feedbackDocs.length).toFixed(4)) : null,
      },
      recommendations: [
        'Capture explicit per-session feedback (helpful yes/no + optional diagnosis) into /ai_feedback to unlock measurable quality improvements.',
        'Persist structured symptom, severity, duration, bodyPart, and riskLevel fields on each session for cleaner clinical dashboards.',
        'Store session smart-tags (emergency_case, repeat_user, low_confidence_response) to improve triage monitoring and QA workflows.',
      ],
      suggestedCollections: [
        'sessions/{sessionId}/analytics',
        'sessions/{sessionId}/clinical_snapshot',
        'users/{userId}/history/{eventId}',
        'ai_feedback/{feedbackId}',
      ],
    });
  } catch (e) {
    console.error('Learning loop analytics error:', e);
    res.status(500).json({ error: 'Failed to fetch learning loop analytics' });
  }
});
