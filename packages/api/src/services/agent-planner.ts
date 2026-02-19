/**
 * Planner Agent - Multi-Step Task Planning and Execution
 * 
 * This module implements a planner that:
 * 1. Decides if a task needs planning (multi-step vs single-step)
 * 2. Creates step-by-step plans for complex tasks
 * 3. Tracks plan execution and identifies missing information
 * 4. Works hand-in-hand with the main agent and orchestrator
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ExtractedIntent } from './agent-intent.js';

export interface PlanStep {
  stepNumber: number;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  requiredInfo?: string[]; // List of information needed to execute this step
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'awaiting_confirmation';
  result?: {
    success: boolean;
    data?: unknown;
    error?: string;
  };
  verified?: boolean;
  requiresConfirmation?: boolean;
  confirmed?: boolean;
}

export interface ExecutionPlan {
  planId: string;
  needsPlanning: boolean;
  complexity: 'simple' | 'multi_step';
  description: string;
  steps: PlanStep[];
  missingInfo: string[]; // Information needed from user before execution
  status: 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'needs_info' | 'awaiting_confirmation';
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanningDecision {
  needsPlanning: boolean;
  complexity: 'simple' | 'multi_step';
  reasoning: string;
  estimatedSteps?: number;
}

/**
 * Decide if a task needs planning based on intent and context.
 */
export async function decideIfNeedsPlanning(
  model: ChatGoogleGenerativeAI,
  intent: ExtractedIntent,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<PlanningDecision> {
  const systemPrompt = `You are a planning decision system. Your job is to determine if a user's request requires multi-step planning.

A task needs planning if:
- It involves multiple sequential actions (e.g., "book an appointment AND send a confirmation")
- It requires gathering information before taking action (e.g., "check availability then book")
- It has dependencies between steps (e.g., "update my record then notify the team")
- It involves conditional logic (e.g., "if available, book; otherwise suggest alternatives")

A task is simple if:
- It's a single action (e.g., "book appointment", "query information")
- All required information is already available
- No dependencies or conditional logic needed

Analyze the user's intent and message to make this decision.`;

  const decisionTool = new DynamicStructuredTool({
    name: 'decide_planning',
    description: 'Decide if a task needs multi-step planning',
    schema: z.object({
      needsPlanning: z.boolean().describe('Whether this task requires multi-step planning'),
      complexity: z.enum(['simple', 'multi_step']).describe('Task complexity level'),
      reasoning: z.string().describe('Why this decision was made'),
      estimatedSteps: z.number().optional().describe('Estimated number of steps if planning is needed'),
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
      `User intent: ${intent.intent}
User message: "${userMessage}"
Confidence: ${intent.confidence}
Suggested tools: ${intent.suggestedTools.join(', ')}

Recent conversation:
${historyContext}

Decide if this task needs planning. Use decide_planning to structure your response.`
    ),
  ];

  const modelWithTools = model.bindTools([decisionTool]);
  const response = await modelWithTools.invoke(messages);

  const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const decisionCall = toolCalls.find((tc) => tc.name === 'decide_planning');
    if (decisionCall && decisionCall.args) {
      const args = decisionCall.args as PlanningDecision;
      return args;
    }
  }

  // Fallback: heuristic-based decision
  const messageLower = userMessage.toLowerCase();
  const hasMultipleActions = /\b(and|then|after|before|also|plus)\b/i.test(userMessage);
  const hasConditionals = /\b(if|when|check|verify|then)\b/i.test(userMessage);
  const needsPlanning = hasMultipleActions || hasConditionals || intent.suggestedTools.length > 2;

  return {
    needsPlanning,
    complexity: needsPlanning ? 'multi_step' : 'simple',
    reasoning: needsPlanning
      ? 'Task involves multiple actions or conditional logic'
      : 'Single-step task with all information available',
    estimatedSteps: needsPlanning ? intent.suggestedTools.length + 1 : undefined,
  };
}

/**
 * Create a detailed execution plan for a multi-step task.
 */
export async function createExecutionPlan(
  model: ChatGoogleGenerativeAI,
  intent: ExtractedIntent,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  availableTools: string[]
): Promise<ExecutionPlan> {
  const planId = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const systemPrompt = `You are a task planning system. Create a detailed step-by-step execution plan for the user's request.

Available tools: ${availableTools.join(', ')}

Create a plan that:
1. Breaks down the task into sequential steps
2. Identifies which tool is needed for each step
3. Lists required information for each step
4. Handles dependencies between steps
5. Identifies any missing information needed from the user

Each step should be clear, actionable, and specify:
- What needs to be done
- Which tool to use (if any)
- What information is required
- Any dependencies on previous steps`;

  const planTool = new DynamicStructuredTool({
    name: 'create_plan',
    description: 'Create a step-by-step execution plan',
    schema: z.object({
      description: z.string().describe('Overall description of the plan'),
      steps: z.array(
        z.object({
          stepNumber: z.number(),
          description: z.string(),
          toolName: z.string().optional(),
          toolArgs: z.record(z.unknown()).optional(),
          requiredInfo: z.array(z.string()).optional(),
          requiresConfirmation: z.boolean().optional().describe('Whether this step requires explicit user confirmation before execution (e.g. for bookings)'),
        })
      ),
      missingInfo: z.array(z.string()).describe('Information needed from user before execution can start'),
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
      `User intent: ${intent.intent}
User message: "${userMessage}"
Extracted entities: ${JSON.stringify(intent.entities)}
Available tools: ${availableTools.join(', ')}

Recent conversation:
${historyContext}

Create a detailed execution plan. Use create_plan to structure your response.`
    ),
  ];

  const modelWithTools = model.bindTools([planTool]);
  const response = await modelWithTools.invoke(messages);

  const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const planCall = toolCalls.find((tc) => tc.name === 'create_plan');
    if (planCall && planCall.args) {
      const planData = planCall.args as {
        description: string;
        steps: Array<{
          stepNumber: number;
          description: string;
          toolName?: string;
          toolArgs?: Record<string, unknown>;
          requiredInfo?: string[];
          requiresConfirmation?: boolean;
        }>;
        missingInfo: string[];
      };

      const steps: PlanStep[] = planData.steps.map((s) => {
        // Force confirmation for any step that uses a tool and isn't just a query
        const isExecutionTool = s.toolName && !['query_google_sheet', 'list_notes', 'get_record', 'list_records'].includes(s.toolName);
        const requiresConfirmation = !!(s.requiresConfirmation || isExecutionTool);
        
        return {
          ...s,
          requiresConfirmation,
          status: 'pending' as const,
          confirmed: requiresConfirmation ? false : undefined,
        };
      });

      const hasImmediateConfirmationNeeded = steps.some(s => s.stepNumber === 1 && s.requiresConfirmation && !s.confirmed);

      return {
        planId,
        needsPlanning: true,
        complexity: 'multi_step',
        description: planData.description,
        steps,
        missingInfo: planData.missingInfo,
        status: planData.missingInfo.length > 0 ? 'needs_info' : (hasImmediateConfirmationNeeded ? 'awaiting_confirmation' : 'ready'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  // Fallback: create a simple plan based on intent
  const steps: PlanStep[] = [];
  if (intent.intent === 'book_appointment' || intent.intent === 'check_availability') {
    steps.push(
      {
        stepNumber: 1,
        description: 'Cross-reference current conversation notes and bookings sheet for availability',
        toolName: 'query_google_sheet',
        toolArgs: { useWhen: 'booking' },
        status: 'pending',
        requiredInfo: intent.entities.date ? undefined : ['date'],
      }
    );

    if (intent.intent === 'book_appointment') {
      steps.push({
        stepNumber: 2,
        description: 'Book the appointment after confirming availability',
        toolName: 'append_booking_row',
        toolArgs: {
          date: intent.entities.date,
          patientName: intent.entities.patientName,
          phone: intent.entities.phone,
          doctorName: intent.entities.doctor,
          appointmentTime: intent.entities.time,
        },
        status: 'pending',
        requiredInfo: [
          ...(intent.entities.date ? [] : ['date']),
          ...(intent.entities.patientName ? [] : ['patientName']),
          ...(intent.entities.phone ? [] : ['phone']),
          ...(intent.entities.doctor ? [] : ['doctor']),
          ...(intent.entities.time ? [] : ['time']),
        ],
      });
    }
  }

  const missingInfo: string[] = [];
  steps.forEach((step) => {
    if (step.requiredInfo) {
      missingInfo.push(...step.requiredInfo);
    }
  });

  return {
    planId,
    needsPlanning: true,
    complexity: 'multi_step',
    description: `Execute ${intent.intent} task`,
    steps,
    missingInfo: [...new Set(missingInfo)], // Remove duplicates
    status: missingInfo.length > 0 ? 'needs_info' : 'ready',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Update plan with execution results and determine next steps.
 */
export function updatePlanWithResult(
  plan: ExecutionPlan,
  stepNumber: number,
  result: { success: boolean; data?: unknown; error?: string; verified?: boolean }
): ExecutionPlan {
  const updatedSteps = plan.steps.map((step) => {
    if (step.stepNumber === stepNumber) {
      return {
        ...step,
        status: result.success ? ('completed' as const) : ('failed' as const),
        result: {
          success: result.success,
          data: result.data,
          error: result.error,
        },
        verified: result.verified,
      };
    }
    // Mark next step as in_progress if previous step completed
    if (step.stepNumber === stepNumber + 1 && result.success) {
      const nextStepRequiresConfirmation = step.requiresConfirmation && !step.confirmed;
      return {
        ...step,
        status: nextStepRequiresConfirmation ? ('awaiting_confirmation' as const) : ('in_progress' as const),
      };
    }
    return step;
  });

  const allCompleted = updatedSteps.every((s) => s.status === 'completed' || s.status === 'skipped');
  const hasFailures = updatedSteps.some((s) => s.status === 'failed');
  const awaitingConfirmation = updatedSteps.some((s) => s.status === 'awaiting_confirmation');

  let status: ExecutionPlan['status'] = plan.status;
  if (hasFailures) {
    status = 'failed';
  } else if (allCompleted) {
    status = 'completed';
  } else if (awaitingConfirmation) {
    status = 'awaiting_confirmation';
  } else {
    status = 'executing';
  }

  return {
    ...plan,
    steps: updatedSteps,
    status,
    updatedAt: new Date(),
  };
}

/**
 * Get the next step to execute from the plan.
 */
export function getNextStep(plan: ExecutionPlan): PlanStep | null {
  // If we are awaiting confirmation, don't return a next step for execution
  if (plan.status === 'awaiting_confirmation') return null;
  
  return plan.steps.find((step) => step.status === 'pending' || step.status === 'in_progress') || null;
}

/**
 * Check if plan needs information from user.
 */
export function planNeedsInfo(plan: ExecutionPlan): boolean {
  return plan.status === 'needs_info' || plan.missingInfo.length > 0;
}

/**
 * Format missing information as a user-friendly question.
 */
export async function formatMissingInfoQuestion(
  model: ChatGoogleGenerativeAI,
  missingInfo: string[],
  context: string
): Promise<string> {
  const systemPrompt = `You are a helpful assistant. Format missing information requests as natural, friendly questions to ask the user.

Be concise and clear. Ask for one piece of information at a time if possible, or group related information together.`;

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `Context: ${context}

Missing information: ${missingInfo.join(', ')}

Format this as a friendly question to ask the user.`
    ),
  ];

  const response = await model.invoke(messages);
  const content = (response as { content?: string }).content;
  return typeof content === 'string' ? content : `I need some information: ${missingInfo.join(', ')}`;
}

/**
 * Analyze why an empty response occurred and determine the root cause.
 */
export interface EmptyResponseAnalysis {
  cause: 'tool_only' | 'timeout' | 'context_overflow' | 'ambiguous_request' | 'missing_context' | 'model_error' | 'unknown';
  confidence: number;
  suggestedAction: 'retry_simple' | 'retry_with_context' | 'ask_clarification' | 'use_planner' | 'fallback_response';
  reasoning: string;
  retryStrategy?: {
    reduceContext?: boolean;
    simplifyPrompt?: boolean;
    addExamples?: boolean;
    usePlanner?: boolean;
  };
}

/**
 * Analyze the cause of an empty response.
 */
export async function analyzeEmptyResponse(
  model: ChatGoogleGenerativeAI,
  response: BaseMessage,
  currentMessages: BaseMessage[],
  executionPlan: ExecutionPlan | null,
  toolResults?: Array<{ success: boolean; error?: string }>
): Promise<EmptyResponseAnalysis> {
  const hasToolCalls = response != null && ((response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0;
  const hasText = typeof response.content === 'string' 
    ? response.content.trim().length > 0 
    : Array.isArray(response.content) 
      ? (response.content as { text?: string }[]).some((c) => (c?.text ?? '').trim().length > 0)
      : false;
  
  const messageCount = currentMessages.length;
  const hasPlan = executionPlan !== null;
  const hasToolResults = toolResults && toolResults.length > 0;
  const hasFailures = toolResults?.some((r) => !r.success) ?? false;

  // Analyze cause
  let cause: EmptyResponseAnalysis['cause'] = 'unknown';
  let confidence = 0.5;
  let reasoning = '';
  let suggestedAction: EmptyResponseAnalysis['suggestedAction'] = 'fallback_response';
  const retryStrategy: EmptyResponseAnalysis['retryStrategy'] = {};

  if (hasToolCalls && !hasText) {
    cause = 'tool_only';
    confidence = 0.9;
    reasoning = 'Response contains only tool calls without text content';
    suggestedAction = 'retry_with_context';
    retryStrategy.usePlanner = true;
  } else if (messageCount > 20) {
    cause = 'context_overflow';
    confidence = 0.7;
    reasoning = 'Too many messages in context, may be causing confusion';
    suggestedAction = 'retry_simple';
    retryStrategy.reduceContext = true;
  } else if (hasPlan && executionPlan?.status === 'failed') {
    cause = 'missing_context';
    confidence = 0.8;
    reasoning = 'Plan execution failed, may need more context or clarification';
    suggestedAction = 'use_planner';
    retryStrategy.usePlanner = true;
  } else if (hasFailures) {
    cause = 'model_error';
    confidence = 0.7;
    reasoning = 'Tool execution failures may have confused the model';
    suggestedAction = 'retry_with_context';
    retryStrategy.addExamples = true;
  } else if (!hasText && !hasToolCalls) {
    cause = 'ambiguous_request';
    confidence = 0.6;
    reasoning = 'Completely empty response suggests ambiguous or unclear request';
    suggestedAction = 'ask_clarification';
  }

  return {
    cause,
    confidence,
    suggestedAction,
    reasoning,
    retryStrategy,
  };
}

/**
 * Create a recovery plan when empty response occurs.
 */
export async function createRecoveryPlan(
  model: ChatGoogleGenerativeAI,
  analysis: EmptyResponseAnalysis,
  originalIntent: ExtractedIntent,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  toolResults?: Array<{ success: boolean; error?: string }>
): Promise<ExecutionPlan | null> {
  if (analysis.suggestedAction !== 'use_planner' && analysis.suggestedAction !== 'retry_with_context') {
    return null;
  }

  // Create a simplified recovery plan
  const planId = `recovery-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const steps: PlanStep[] = [];

  // Step 1: Analyze what went wrong
  steps.push({
    stepNumber: 1,
    description: `Analyze the issue: ${analysis.reasoning}`,
    status: 'completed',
  });

  // Step 2: Retry with better context
  if (analysis.cause === 'tool_only' && toolResults && toolResults.length > 0) {
    steps.push({
      stepNumber: 2,
      description: 'Generate response based on tool execution results',
      status: 'pending',
      requiredInfo: [],
    });
  } else if (analysis.cause === 'missing_context') {
    steps.push({
      stepNumber: 2,
      description: 'Request clarification from user about their request',
      status: 'pending',
      requiredInfo: ['clarification'],
    });
  } else {
    steps.push({
      stepNumber: 2,
      description: 'Retry with simplified context and clearer instructions',
      status: 'pending',
      requiredInfo: [],
    });
  }

  return {
    planId,
    needsPlanning: true,
    complexity: 'multi_step',
    description: `Recovery plan for empty response: ${analysis.cause}`,
    steps,
    missingInfo: [],
    status: 'ready',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Confirm a step in the plan.
 */
export function confirmStep(plan: ExecutionPlan, stepNumber: number): ExecutionPlan {
  const updatedSteps = plan.steps.map((step) => {
    if (step.stepNumber === stepNumber) {
      return {
        ...step,
        confirmed: true,
        status: 'in_progress' as const,
      };
    }
    return step;
  });

  return {
    ...plan,
    steps: updatedSteps,
    status: 'executing',
    updatedAt: new Date(),
  };
}

/**
 * Format a confirmation question for the user.
 */
export async function formatConfirmationQuestion(
  model: ChatGoogleGenerativeAI,
  step: PlanStep,
  context: string
): Promise<string> {
  const systemPrompt = `You are a helpful assistant. Format a confirmation request for a specific action as a natural, friendly question to ask the user.
  
The user needs to confirm this action before you can proceed. Be clear about what you are going to do and what information you are using.`;

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `Context: ${context}
      
Action to confirm: ${step.description}
Tool: ${step.toolName}
Arguments: ${JSON.stringify(step.toolArgs)}

Format this as a friendly confirmation question to ask the user before executing the action.`
    ),
  ];

  const response = await model.invoke(messages);
  const content = (response as { content?: string }).content;
  return typeof content === 'string' ? content : `I'm ready to ${step.description}. Should I proceed?`;
}
