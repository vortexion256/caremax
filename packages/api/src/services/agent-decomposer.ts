/**
 * Decomposer - Complex Question Decomposition Layer
 * 
 * This module implements a decomposer that:
 * 1. Analyzes user messages for complexity
 * 2. Breaks down complex, multi-part questions into simpler sub-questions
 * 3. Helps the agent handle one part at a time to avoid getting lost
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export interface DecomposedQuestion {
  isComplex: boolean;
  originalQuestion: string;
  subQuestions: string[];
  reasoning: string;
}

/**
 * Decompose a complex user message into simpler sub-questions.
 */
export async function decomposeQuestion(
  model: ChatGoogleGenerativeAI,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<DecomposedQuestion> {
  const systemPrompt = `You are a question decomposition system. Your job is to analyze user messages and determine if they are "complex".
  
A message is complex if:
- It contains multiple distinct questions (e.g., "What are your hours AND do you take my insurance?")
- It asks for multiple actions (e.g., "Check my appointment and then tell me about Dr. Smith")
- It has multiple constraints or conditions (e.g., "I need an appointment on Monday but only if it's with Dr. Jones and before 10am")

If a message is complex, break it down into a list of simpler, atomic sub-questions or tasks that can be handled sequentially.
If it's simple, return it as a single sub-question.

Goal: Help the AI agent avoid getting lost by focusing on one part at a time.`;

  const decompositionTool = new DynamicStructuredTool({
    name: 'decompose_question',
    description: 'Decompose a complex question into simpler sub-questions',
    schema: z.object({
      isComplex: z.boolean().describe('Whether the original question is complex'),
      subQuestions: z.array(z.string()).describe('List of simpler sub-questions or tasks'),
      reasoning: z.string().describe('Why this decomposition was made'),
    }),
    func: async (args) => JSON.stringify(args),
  });

  const historyContext = conversationHistory
    .slice(-3)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `User message: "${userMessage}"

Recent conversation:
${historyContext}

Analyze and decompose this message if necessary. Use decompose_question to structure your response.`
    ),
  ];

  try {
    const modelWithTools = model.bindTools([decompositionTool]);
    const response = await modelWithTools.invoke(messages);

    const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const decompCall = toolCalls.find((tc) => tc.name === 'decompose_question');
      if (decompCall && decompCall.args) {
        const args = decompCall.args as any;
        return {
          isComplex: !!args.isComplex,
          originalQuestion: userMessage,
          subQuestions: Array.isArray(args.subQuestions) ? args.subQuestions : [userMessage],
          reasoning: args.reasoning || 'Decomposed by LLM',
        };
      }
    }
  } catch (e) {
    console.error('[Decomposer] Error during decomposition:', e);
  }

  // Fallback: simple heuristic decomposition
  const parts = userMessage.split(/\b(and|then|also|plus|as well as)\b/i).filter(p => p.trim().length > 5 && !/^(and|then|also|plus|as well as)$/i.test(p.trim()));
  
  if (parts.length > 1) {
    return {
      isComplex: true,
      originalQuestion: userMessage,
      subQuestions: parts.map(p => p.trim()),
      reasoning: 'Heuristic-based decomposition',
    };
  }

  return {
    isComplex: false,
    originalQuestion: userMessage,
    subQuestions: [userMessage],
    reasoning: 'Question appears simple',
  };
}
