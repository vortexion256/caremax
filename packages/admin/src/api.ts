const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  return localStorage.getItem('caremax_id_token');
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errorMessage = (err as { error?: string }).error ?? res.statusText;
    throw new Error(errorMessage);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json();
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
