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
  systemPrompt: string;
  thinkingInstructions: string;
  model: string;
  temperature: number;
  ragEnabled: boolean;
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
