const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function normalizeApiUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    const isVercelDomain = parsed.hostname.endsWith('.vercel.app');
    const hasApiPrefix = parsed.pathname === '/api' || parsed.pathname.startsWith('/api/');
    if (isVercelDomain && !hasApiPrefix) {
      parsed.pathname = `/api${parsed.pathname === '/' ? '' : parsed.pathname}`;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function getAlternateApiUrl(rawApiUrl: string): string | null {
  try {
    const parsed = new URL(rawApiUrl);
    if (!parsed.hostname.endsWith('.vercel.app')) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const hasApiPrefix = pathname === '/api' || pathname.startsWith('/api/');

    if (hasApiPrefix) {
      parsed.pathname = pathname === '/api' ? '/' : pathname.replace(/^\/api/, '') || '/';
    } else {
      parsed.pathname = `/api${pathname === '/' ? '' : pathname}`;
    }

    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

const API_URL = normalizeApiUrl(DEFAULT_API_URL);
const FALLBACK_API_URL = getAlternateApiUrl(API_URL);

function getToken(): string | null {
  return localStorage.getItem('caremax_id_token');
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isReadOnlyMethod = method === 'GET' || method === 'HEAD';
  const isPublicPath = path.startsWith('/public/');
  const token = isPublicPath ? null : getToken();
  const headers = new Headers(options.headers);

  if (!isReadOnlyMethod && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const candidateUrls = [API_URL];
  if (isReadOnlyMethod && FALLBACK_API_URL && FALLBACK_API_URL !== API_URL) {
    candidateUrls.push(FALLBACK_API_URL);
  }

  let lastNetworkError: unknown = null;

  for (let i = 0; i < candidateUrls.length; i += 1) {
    const baseUrl = candidateUrls[i];
    try {
      const res = await fetch(`${baseUrl}${path}`, { ...options, headers });

      if (!res.ok) {
        if (res.status === 404 && i < candidateUrls.length - 1) {
          continue;
        }

        const err = await res.json().catch(() => ({ error: res.statusText }));
        const errorMessage = (err as { error?: string }).error ?? res.statusText;
        throw new Error(errorMessage);
      }

      if (res.status === 204 || res.headers.get('content-length') === '0') {
        return undefined as T;
      }
      return res.json();
    } catch (error) {
      lastNetworkError = error;
      if (i < candidateUrls.length - 1) {
        continue;
      }
      throw error;
    }
  }

  throw (lastNetworkError instanceof Error ? lastNetworkError : new Error('Request failed'));
}

export function setAuthToken(token: string) {
  localStorage.setItem('caremax_id_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('caremax_id_token');
}

export type AgentConfig = {
  tenantId: string;
  agentName: string;
  chatTitle?: string;
  welcomeText?: string;
  suggestedQuestions?: string[];
  widgetColor?: string;
  systemPrompt: string;
  thinkingInstructions: string;
  model: string;
  temperature: number;
  ragEnabled: boolean;
  googleSheetsEnabled?: boolean;
  googleSheetsSpreadsheetId?: string;
  googleSheetsRange?: string;
  /** Multiple sheets; each has spreadsheetId, optional range, and useWhen (when the agent should query this sheet). */
  googleSheets?: { spreadsheetId: string; range?: string; useWhen: string }[];
  /** Advanced prompt for learning-only mode (extracting knowledge from conversations) */
  learningOnlyPrompt?: string;
  /** Advanced prompt for consolidation mode (merging duplicate records) */
  consolidationPrompt?: string;
  availableModels?: string[];
};

export type HandoffItem = {
  conversationId: string;
  tenantId: string;
  userId: string;
  status: string;
  updatedAt: number | null;
};

export type RagDoc = {
  documentId: string;
  name: string;
  status: string;
  createdAt: number | null;
};

export type RagDocDetail = RagDoc & { content: string };

export type AgentRecord = {
  recordId: string;
  title: string;
  content: string;
  createdAt: number | null;
  updatedAt?: number | null;
};

export type AgentBrainModificationRequest = {
  requestId: string;
  tenantId: string;
  type: 'edit' | 'delete';
  recordId: string;
  title?: string;
  content?: string;
  reason?: string;
  status: string;
  createdAt: number | null;
  updatedAt?: number | null;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
};
