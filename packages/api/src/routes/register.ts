import { Router } from 'express';
import { z } from 'zod';
import { auth, db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { FieldValue } from 'firebase-admin/firestore';

export const registerRouter: Router = Router();

const TRIAL_DAYS_DEFAULT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const registerBody = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(2).max(50).regex(slugRegex).optional(),
});

function generateTenantId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

registerRouter.post('/', requireAuth, async (req, res) => {
  const { uid, email, tenantId: existingTenantId } = res.locals as { uid: string; email?: string; tenantId?: string };
  if (existingTenantId) {
    res.status(400).json({ error: 'Already registered', tenantId: existingTenantId });
    return;
  }
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }
  const { name, slug } = parsed.data;
  let tenantId: string;
  if (slug) {
    const existing = await db.collection('tenants').doc(slug).get();
    if (existing.exists) {
      res.status(409).json({ error: 'Organization ID already taken', field: 'slug' });
      return;
    }
    tenantId = slug;
  } else {
    let attempts = 0;
    do {
      tenantId = generateTenantId();
      const exists = await db.collection('tenants').doc(tenantId).get();
      if (!exists.exists) break;
      attempts++;
    } while (attempts < 5);
  }
  await db.collection('tenants').doc(tenantId).set({
    name,
    allowedDomains: [],
    privacyPolicy: 'This is a placeholder privacy policy. We collect and process service data to operate and improve CareMax. Replace this text in SaaS Admin with your organization policy.',
    termsOfService: 'This is a placeholder Terms of Service. By using this service, users agree to lawful and acceptable use. Replace this text in SaaS Admin with your organization terms.',
    contactEmail: 'edrine.eminence@gmail.com',
    contactPhonePrimary: '0782830524',
    contactPhoneSecondary: '0753190830',
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    billingPlanId: 'free',
    trialUsed: true,
    trialStartedAt: new Date(),
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS_DEFAULT * DAY_MS),
    subscriptionStatus: 'trialing',
  });
  const agentName = name;
  const defaultPrompt = `You are ${agentName}, a clinical triage assistant for this organization. When asked your name or who you are, say you are ${agentName}.
You help users understand possible next steps based on their symptoms. Suggest when to see a doctor or seek care. Be clear you are not a doctor and cannot diagnose. For contact info, hours, or phone numbers, use the knowledge base if provided.`;
  await db.collection('agent_config').doc(tenantId).set({
    tenantId,
    agentName,
    systemPrompt: defaultPrompt,
    thinkingInstructions: 'Be concise, empathetic, and safety-conscious.',
    model: 'gemini-3-flash-preview',
    temperature: 0.7,
    ragEnabled: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  await auth.setCustomUserClaims(uid, { tenantId, isAdmin: true });
  res.status(201).json({ tenantId, name });
});
