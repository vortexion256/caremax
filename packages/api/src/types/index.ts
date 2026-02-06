import type { Timestamp } from 'firebase-admin/firestore';

export type Tenant = {
  tenantId: string;
  name: string;
  allowedDomains: string[];
  createdAt: Timestamp;
};

export type AgentConfig = {
  tenantId: string;
  agentName: string;
  systemPrompt: string;
  thinkingInstructions: string;
  model: string;
  temperature: number;
  ragEnabled: boolean;
  updatedAt: Timestamp;
};

export type ConversationStatus = 'open' | 'handoff_requested' | 'human_joined';

export type Conversation = {
  conversationId: string;
  tenantId: string;
  userId: string;
  status: ConversationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type MessageRole = 'user' | 'assistant' | 'human_agent';

export type Message = {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  imageUrls?: string[];
  createdAt: Timestamp;
};

export type RagDocument = {
  documentId: string;
  tenantId: string;
  name: string;
  status: 'pending' | 'indexed' | 'failed';
  createdAt: Timestamp;
};
