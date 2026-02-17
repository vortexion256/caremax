import { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { requireAuth, requireTenantParam, requireAdmin } from '../middleware/auth.js';

export const agentFlowRouter: Router = Router({ mergeParams: true });

agentFlowRouter.use(requireTenantParam);

async function requireAgentFlowEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = res.locals.tenantId as string;
  try {
    const doc = await db.collection('tenants').doc(tenantId).get();
    if (!doc.exists || doc.data()?.agentFlowEnabled !== true) {
      res.status(403).json({ error: 'Agent flow is not enabled for this tenant. Enable it in Platform → Tenants → tenant details.' });
      return;
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Failed to check tenant settings' });
  }
}

agentFlowRouter.use(requireAgentFlowEnabled);

const dataSourceSchema = z.object({
  type: z.enum(['rag', 'sheet', 'doc', 'api', 'search']),
  sourceId: z.string(),
});

const nodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['llm']),
  model: z.string(),
  systemPrompt: z.string(),
  thinkingInstructions: z.string().optional(),
  temperature: z.number().min(0).max(2),
  ragEnabled: z.boolean().optional(),
  dataSources: z.array(dataSourceSchema).optional(),
});

const edgeSchema = z.object({
  id: z.string(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  label: z.string().optional(),
  condition: z.string().optional(),
});

const flowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  mainNodeId: z.string(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

// Load the current agent flow for a tenant.
// If no flow is saved yet, synthesize a default flow from agent_config.
agentFlowRouter.get('/', async (_req, res) => {
  const tenantId = res.locals.tenantId as string;

  // Check for an existing flow document
  const docRef = db.collection('agent_flows').doc(tenantId);
  const snap = await docRef.get();
  if (snap.exists) {
    const data = snap.data() ?? {};
    res.json({
      tenantId,
      flow: {
        name: data.name ?? 'Default agent flow',
        description: data.description ?? '',
        mainNodeId: data.mainNodeId,
        nodes: data.nodes ?? [],
        edges: data.edges ?? [],
      },
    });
    return;
  }

  // Fallback: synthesize from existing agent_config so current setups keep working
  const agentConfigDoc = await db.collection('agent_config').doc(tenantId).get();
  const cfg = agentConfigDoc.data() ?? {};

  const mainNodeId = 'main';
  const node = {
    id: mainNodeId,
    name: cfg.agentName ?? 'CareMax Assistant',
    description: 'Default agent for this tenant',
    type: 'llm' as const,
    model: cfg.model ?? 'gemini-3-flash-preview',
    systemPrompt: cfg.systemPrompt ?? '',
    thinkingInstructions: cfg.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
    ragEnabled: cfg.ragEnabled === true,
    dataSources: cfg.ragEnabled ? [{ type: 'rag' as const, sourceId: 'default' }] : [],
  };

  res.json({
    tenantId,
    flow: {
      name: 'Default agent flow',
      description: '',
      mainNodeId,
      nodes: [node],
      edges: [],
    },
  });
});

// Create or update the agent flow for a tenant.
agentFlowRouter.put('/', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = res.locals.tenantId as string;
  const parsed = flowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    return;
  }

  const flow = parsed.data;

  // Ensure mainNodeId refers to an existing node
  const hasMain = flow.nodes.some((n) => n.id === flow.mainNodeId);
  if (!hasMain) {
    res.status(400).json({ error: 'mainNodeId must refer to an existing node' });
    return;
  }

  const docRef = db.collection('agent_flows').doc(tenantId);
  await docRef.set(
    {
      tenantId,
      name: flow.name,
      description: flow.description ?? '',
      mainNodeId: flow.mainNodeId,
      nodes: flow.nodes,
      edges: flow.edges,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const saved = await docRef.get();
  const data = saved.data() ?? {};

  res.json({
    tenantId,
    flow: {
      name: data.name ?? flow.name,
      description: data.description ?? flow.description ?? '',
      mainNodeId: data.mainNodeId,
      nodes: data.nodes ?? [],
      edges: data.edges ?? [],
    },
  });
});

