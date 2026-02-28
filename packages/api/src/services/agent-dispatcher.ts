import { db } from '../config/firebase.js';
import { runAgent, type AgentResult } from './agent.js';
import { runAgentV2 } from './agent-v2.js';

type AgentHistoryMessage = { role: string; content: string; imageUrls?: string[] };
type AgentOptions = { userId?: string; conversationId?: string };
type AgentVersion = 'v1' | 'v2';

function normalizeAgentVersion(value: unknown): AgentVersion | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'v1' || normalized === 'v2') return normalized;
  return null;
}

async function getTenantAgentVersion(tenantId: string): Promise<AgentVersion | null> {
  try {
    const configDoc = await db.collection('agent_config').doc(tenantId).get();
    if (!configDoc.exists) return null;
    return normalizeAgentVersion(configDoc.data()?.agentVersion);
  } catch (e) {
    console.warn('[Agent Dispatcher] Failed to read tenant agent version, falling back to env/default:', e);
    return null;
  }
}

function getEnvAgentVersion(): AgentVersion | null {
  return normalizeAgentVersion(process.env.AGENT_VERSION);
}

async function resolveAgentVersion(tenantId: string): Promise<AgentVersion> {
  const tenantVersion = await getTenantAgentVersion(tenantId);
  if (tenantVersion) return tenantVersion;

  const envVersion = getEnvAgentVersion();
  if (envVersion) return envVersion;

  return 'v1';
}

export async function runConfiguredAgent(
  tenantId: string,
  history: AgentHistoryMessage[],
  options?: AgentOptions
): Promise<AgentResult> {
  const selectedVersion = await resolveAgentVersion(tenantId);
  if (selectedVersion === 'v2') {
    return runAgentV2(tenantId, history, options);
  }

  return runAgent(tenantId, history, options);
}
