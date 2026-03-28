import { refreshIdToken } from './firebase';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  return localStorage.getItem('caremax_id_token');
}

async function buildHeaders(options: RequestInit, tokenOverride?: string | null): Promise<HeadersInit> {
  const token = tokenOverride ?? getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
}

async function parseApiError(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({ error: res.statusText }));
  return (err as { error?: string }).error ?? res.statusText;
}

function shouldRefreshAuthToken(res: Response, errorMessage: string): boolean {
  if (res.status !== 401) return false;
  const normalized = errorMessage.trim().toLowerCase();
  return normalized === 'invalid token' || normalized === 'id token has expired';
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let headers = await buildHeaders(options);
  let res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const errorMessage = await parseApiError(res);
    if (shouldRefreshAuthToken(res, errorMessage)) {
      const refreshedToken = await refreshIdToken();
      if (refreshedToken) {
        setAuthToken(refreshedToken);
        headers = await buildHeaders(options, refreshedToken);
        res = await fetch(`${API_URL}${path}`, { ...options, headers });
        if (res.ok) {
          if (res.status === 204 || res.headers.get('content-length') === '0') {
            return undefined as T;
          }
          return res.json();
        }
        throw new Error(await parseApiError(res));
      }
    }
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
  /** Whether the custom learning-only prompt should override defaults */
  learningOnlyPromptEnabled?: boolean;
  /** Advanced prompt for consolidation mode (merging duplicate records) */
  consolidationPrompt?: string;
  /** Whether the custom consolidation prompt should override defaults */
  consolidationPromptEnabled?: boolean;
  /** If > 0, WhatsApp replies at or above this character length can be sent as voice notes. */
  whatsappVoiceNoteCharThreshold?: number;
  /** If true, all WhatsApp text replies will also attempt TTS voice replies. */
  whatsappForceVoiceReplies?: boolean;
  /** Which TTS provider should be used for WhatsApp voice replies. */
  whatsappTtsProvider?: 'sunbird' | 'google-cloud-tts' | 'elevenlabs' | 'gemini-2.5-flash-preview-tts';
  /** Which provider should detect WhatsApp conversation language changes. */
  whatsappLanguageDetectionProvider?: 'gemini' | 'sunbird';
  /** Sunbird-only temperature used for WhatsApp TTS generation. */
  whatsappSunbirdTemperature?: number;
  /** Sunbird speaker IDs for local-language WhatsApp voice replies. */
  whatsappSunbirdAcholiSpeakerId?: number;
  whatsappSunbirdAtesoSpeakerId?: number;
  whatsappSunbirdLugandaSpeakerId?: number;
  whatsappSunbirdLugbaraSpeakerId?: number;
  whatsappSunbirdRunyankoleSpeakerId?: number;
  /** Google Cloud TTS language code used for WhatsApp voice replies (for example en-US). */
  whatsappGoogleTtsLanguageCode?: string;
  /** Google Cloud TTS voice name used for WhatsApp voice replies (for example en-US-Neural2-F). */
  whatsappGoogleTtsVoiceName?: string;
  /** ElevenLabs voice ID used for English WhatsApp voice replies. */
  whatsappElevenLabsVoiceId?: string;
  xPersonProfileEnabled?: boolean;
  xPersonProfileCustomFields?: { field: string; description?: string }[];
  /** IANA timezone for agent date/time context (for example Africa/Kampala). */
  agentTimezone?: string;
  /** Optional ISO-3166 country code used for locale-sensitive date/time hints. */
  agentCountryCode?: string;
  /** Enables AI-created follow-up reminders for low-risk conversations. */
  autoFollowupEnabled?: boolean;
  /** Delay in hours before automatic follow-up reminders are sent. */
  autoFollowupDelayHours?: number;
  /** Sleep window start hour (0-23) used to avoid overnight reminders. */
  autoFollowupSleepStartHour?: number;
  /** Sleep window end hour (0-23) used to avoid overnight reminders. */
  autoFollowupSleepEndHour?: number;
  /** Enable nightly rollup generation for important clinical analytics. */
  autoClinicalAnalyticsNightlyEnabled?: boolean;
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
  scope: 'shared' | 'user';
  userId: string | null;
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
