import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getRagContext } from './rag.js';

export type AgentResult = { text: string; requestHandoff?: boolean };

const defaultSystemPrompt = `You are a helpful clinical triage assistant. You help users understand possible next steps based on their symptoms.
You may suggest: possible diagnoses (as possibilities, not certainties), tests they could discuss with a doctor, first aid or home care when appropriate, and when to seek emergency or in-person care.
Always be clear that you are not a doctor and cannot diagnose. If the user shares images (e.g. skin, wound), you may comment on what you observe and suggest next steps, but never give a definitive diagnosis from images alone.
If the situation sounds urgent or the user seems to need a human care coordinator, say so and suggest they speak with a care team member.`;

function defaultPromptForName(agentName: string): string {
  return `You are ${agentName}, a clinical triage assistant for this organization. When asked your name or who you are, say you are ${agentName}.
You help users understand possible next steps based on their symptoms. Suggest when to see a doctor or seek care. Be clear you are not a doctor and cannot diagnose. For contact info, hours, or phone numbers, use the knowledge base if provided.`;
}

export async function getAgentConfig(tenantId: string): Promise<{
  agentName: string;
  systemPrompt: string;
  thinkingInstructions: string;
  model: string;
  temperature: number;
  ragEnabled: boolean;
}> {
  const configRef = db.collection('agent_config').doc(tenantId);
  const configDoc = await configRef.get();
  const data = configDoc.data();

  if (configDoc.exists && data?.agentName) {
    const prompt = (data.systemPrompt?.trim() ?? '') || defaultPromptForName(data.agentName);
    return {
      agentName: data.agentName,
      systemPrompt: prompt,
      thinkingInstructions: data?.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
      model: data?.model ?? 'gemini-3-flash-preview',
      temperature: data?.temperature ?? 0.7,
      ragEnabled: data?.ragEnabled === true,
    };
  }

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  const tenantName = tenantDoc.data()?.name as string | undefined;
  const agentName = tenantName ?? data?.agentName ?? 'CareMax Assistant';
  const systemPrompt = (data?.systemPrompt?.trim() ?? '') || (tenantName ? defaultPromptForName(tenantName) : defaultSystemPrompt);

  if (!configDoc.exists && tenantName) {
    configRef.set({
      tenantId,
      agentName,
      systemPrompt,
      thinkingInstructions: 'Be concise, empathetic, and safety-conscious.',
      model: 'gemini-3-flash-preview',
      temperature: 0.7,
      ragEnabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return {
    agentName,
    systemPrompt,
    thinkingInstructions: data?.thinkingInstructions ?? 'Be concise, empathetic, and safety-conscious.',
    model: data?.model ?? 'gemini-3-flash-preview',
    temperature: data?.temperature ?? 0.7,
    ragEnabled: data?.ragEnabled === true,
  };
}

function toLangChainMessages(
  history: { role: string; content: string; imageUrls?: string[] }[]
): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') {
      out.push(new HumanMessage({ content: m.content }));
    } else if (m.role === 'assistant') {
      out.push(new AIMessage({ content: m.content }));
    } else if (m.role === 'human_agent') {
      out.push(new AIMessage({ content: `[Care team said to the user]: ${m.content}` }));
    }
  }
  return out;
}

export async function runAgent(
  tenantId: string,
  history: { role: string; content: string; imageUrls?: string[] }[]
): Promise<AgentResult> {
  const config = await getAgentConfig(tenantId);
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not set');

  const model = new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: config.temperature,
    apiKey,
  });

  const avoidGeneric = config.agentName !== 'CareMax Assistant'
    ? ` Never say "CareMax Assistant" or "I don't have a name"—always say you are ${config.agentName}.`
    : '';
  const nameInstruction = `Your name is ${config.agentName}. You must always use this name: when greeting, when asked "what's your name" or "who are you", and in any introduction.${avoidGeneric}`;
  const historyInstruction = `Use the full conversation history. Messages labeled "[Care team said to the user]: ..." are from a human care team member—treat them as what was actually said to the user. When the user asks what was recommended, what the care team said, or "what did you say?" / "what's the best?", answer in one short paragraph using only that history (e.g. "The care team suggested Panado Extra for your pain."). Do not repeat the same sentence or block twice in one reply. Do not repeat long triage unless the user asks for more detail.`;
  const toneInstruction = `Tone: Be natural and concise. For "hi", "hello", or "how are you?" reply in one short sentence (e.g. "Hi! How can I help?" or "Doing well, thanks—what can I help with?"). Do not repeat "I am [name], a clinical triage assistant" or "How can I assist you with your health concerns today?" in every message—say it only when the user asks who you are or what you do. Vary your wording; avoid the same phrases in every reply.`;
  let systemContent = `${nameInstruction}\n\n${config.systemPrompt}\n\n${historyInstruction}\n\n${toneInstruction}\n\nHow you should think: ${config.thinkingInstructions}`;
  if (config.ragEnabled) {
    const lastUser = history.filter((m) => m.role === 'user').pop();
    const ragContext = lastUser ? await getRagContext(tenantId, lastUser.content) : '';
    if (ragContext) {
      systemContent += `\n\nRelevant context from this organization's knowledge base (use this for contact info, phone numbers, hours, locations, and other org-specific details):\n${ragContext}`;
    }
  }

  const messages: BaseMessage[] = [
    new SystemMessage(systemContent),
    ...toLangChainMessages(history),
  ];

  const lastUserContent = history.filter((m) => m.role === 'user').pop()?.content ?? '';
  const userWantsHuman =
    /\b(talk|speak|connect|transfer|hand me off|get me)\s+(to|with)\s+(a\s+)?(human|real\s+person|person|agent|someone|care\s+team|staff|representative)/i.test(lastUserContent) ||
    /\b(let me\s+)?(talk|speak)\s+to\s+(a\s+)?(human|person|someone)/i.test(lastUserContent) ||
    /\b(want|need)\s+to\s+(speak|talk)\s+to\s+(a\s+)?(human|person|someone)/i.test(lastUserContent) ||
    /\b(real\s+person|human\s+agent|live\s+agent)/i.test(lastUserContent);

  if (userWantsHuman) {
    const handoffMessage =
      `I've requested that a care team member join this chat. They'll be with you shortly—please stay on this page.\n\nIf your need is urgent, please call your care team or 911 in an emergency.`;
    return { text: handoffMessage, requestHandoff: true };
  }

  const response = await model.invoke(messages);
  let text = '';
  if (typeof response.content === 'string') text = response.content;
  else if (Array.isArray(response.content))
    text = response.content.map((c: { text?: string }) => c?.text ?? '').join('');
  const finalText = text || 'I could not generate a response. Please try rephrasing.';
  const requestHandoff =
    /speak with (a )?(care )?(coordinator|team|human|agent)/i.test(text) ||
    /recommend.*(speaking|talking) to/i.test(text);

  return { text: finalText, requestHandoff };
}
