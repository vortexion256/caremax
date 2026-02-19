/**
 * Intent + Extraction Layer
 * 
 * First LLM pass: Extract intent and structured data from user input.
 * This separates reasoning (what does the user want?) from execution (how do we do it?).
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export interface ExtractedIntent {
  intent: 'book_appointment' | 'check_availability' | 'query_information' | 'create_note' | 'general_conversation' | 'request_human' | 'confirm_action';
  confidence: number;
  entities: {
    patientName?: string;
    phone?: string;
    date?: string;
    time?: string;
    doctor?: string;
    notes?: string;
    query?: string;
  };
  requiresTools: boolean;
  suggestedTools: string[];
}

/**
 * Extract intent and entities from user message.
 * This is the first LLM pass - pure reasoning, no execution.
 */
export async function extractIntent(
  model: ChatGoogleGenerativeAI,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<ExtractedIntent> {
  const systemPrompt = `You are an intent extraction system. Your job is to analyze user messages and extract:
1. What the user wants (intent)
2. Structured data (entities) from their message
3. Which tools might be needed

You do NOT execute tools or make decisions - you only extract information.

Intents:
- book_appointment: User wants to schedule/book an appointment
- check_availability: User wants to check if a doctor or time slot is free/available
- query_information: User wants to look up information (general facts, policies, etc.)
- create_note: User or system wants to create a note/record
- general_conversation: General chat, questions, greetings
- request_human: User wants to speak with a human
- confirm_action: User is confirming an action (e.g., "yes", "proceed", "do it", "that's correct")

Extract entities like: patientName, phone, date, time, doctor, notes, query.`;

  const extractTool = new DynamicStructuredTool({
    name: 'extract_intent',
    description: 'Extract intent and entities from user message',
    schema: z.object({
      intent: z
        .enum(['book_appointment', 'check_availability', 'query_information', 'create_note', 'general_conversation', 'request_human', 'confirm_action'])
        .describe('The primary intent of the user'),
      confidence: z.number().min(0).max(1).describe('Confidence level (0-1)'),
      entities: z
        .object({
          patientName: z.string().optional(),
          phone: z.string().optional(),
          date: z.string().optional(),
          time: z.string().optional(),
          doctor: z.string().optional(),
          notes: z.string().optional(),
          query: z.string().optional(),
        })
        .describe('Extracted entities from the message'),
      requiresTools: z.boolean().describe('Whether this intent requires tool execution'),
      suggestedTools: z.array(z.string()).describe('List of tool names that might be needed'),
    }),
    func: async (args) => JSON.stringify(args),
  });

  const historyContext = conversationHistory
    .slice(-5)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `User message: "${userMessage}"

Recent conversation:
${historyContext}

Extract the intent and entities. Use extract_intent to structure your response.`
    ),
  ];

  const modelWithTools = model.bindTools([extractTool]);
  const response = await modelWithTools.invoke(messages);

  const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const extractCall = toolCalls.find((tc) => tc.name === 'extract_intent');
    if (extractCall && extractCall.args) {
      const args = extractCall.args as ExtractedIntent;
      return args;
    }
  }

  // Fallback: simple heuristic extraction
  const messageLower = userMessage.toLowerCase();
  let intent: ExtractedIntent['intent'] = 'general_conversation';
  let requiresTools = false;
  const suggestedTools: string[] = [];

  if (/\b(book|schedule|appointment|appt)\b/i.test(userMessage)) {
    intent = 'book_appointment';
    requiresTools = true;
    suggestedTools.push('query_google_sheet', 'append_booking_row', 'get_appointment_by_phone');
  } else if (/\b(available|free|slot|when|is dr|is doctor)\b/i.test(userMessage)) {
    intent = 'check_availability';
    requiresTools = true;
    suggestedTools.push('query_google_sheet', 'get_appointment_by_phone');
  } else if (/\b(schedule|time|info|policy|hours)\b/i.test(userMessage)) {
    intent = 'query_information';
    requiresTools = true;
    suggestedTools.push('query_google_sheet');
  } else if (/\b(talk|speak|human|person|agent|representative)\b/i.test(userMessage)) {
    intent = 'request_human';
    requiresTools = false;
  }

  // Simple entity extraction
  const phoneMatch = userMessage.match(/\b\d{10,}\b/);
  const dateMatch = userMessage.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}\/?\d{0,4})\b/i);
  const timeMatch = userMessage.match(/\b(\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm))\b/i);

  return {
    intent,
    confidence: 0.7,
    entities: {
      phone: phoneMatch ? phoneMatch[0] : undefined,
      date: dateMatch ? dateMatch[0] : undefined,
      time: timeMatch ? timeMatch[0] : undefined,
    },
    requiresTools,
    suggestedTools,
  };
}
