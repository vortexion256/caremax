import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getAgentConfig } from './agent.js';

export type ActionPlan = {
  actionsRequired: boolean;
  steps: Array<{
    stepNumber: number;
    action: string;
    description: string;
    toolToUse?: string;
    status?: 'pending' | 'in_progress' | 'completed';
    needsUserInput?: boolean;
    userPrompt?: string;
  }>;
  currentStep: number;
  missingInfo?: string[];
};

/**
 * Supervisor agent that helps the main agent by:
 * 1. Creating a high-level roadmap of what needs to be done
 * 2. Tracking what is currently being done
 * 3. Tracking what has been completed
 * 4. Guiding the main agent so it doesn't get lost with complex instructions
 * 
 * The supervisor does NOT access tools or block execution - it only provides guidance and tracking.
 */
export class SupervisorAgent {
  private model: ChatGoogleGenerativeAI;
  private tenantId: string;

  constructor(tenantId: string, model: ChatGoogleGenerativeAI) {
    this.tenantId = tenantId;
    this.model = model;
  }

  /**
   * Analyze user request and create a high-level roadmap/plan
   * This creates a map of what needs to be done, not detailed tool parameters
   */
  async analyzeAndPlan(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>,
    availableTools: string[]
  ): Promise<ActionPlan> {
    const systemPrompt = `You are a supervisor agent that creates high-level roadmaps to guide the main agent.

Your role:
1. Analyze user requests to understand the overall goal
2. Break down complex tasks into clear, sequential high-level steps
3. Create a roadmap showing: what needs to be done → what is being done → what is completed
4. Guide the main agent so it doesn't get lost with complex instructions

IMPORTANT:
- You do NOT access tools or execute actions - you only plan and track
- You do NOT need to specify exact tool parameters - the main agent will handle that
- Focus on WHAT needs to be done, not HOW (the main agent figures out the how)
- Create clear, logical steps that guide the main agent through the process

Available tools: ${availableTools.join(', ')}

For booking/appointment requests, create a roadmap like:
1. Extract user information (name: Celine, code: A170, phone: 0753190830)
2. Determine the specific date (convert "Monday" to actual date)
3. Query available slots for that date between 7am-3pm
4. Present available slots to user for selection
5. Create the booking once user confirms

Focus on creating a clear roadmap, not detailed tool parameters.`;

    const historyContext = conversationHistory
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const planTool = new DynamicStructuredTool({
      name: 'create_action_plan',
      description: 'Create a step-by-step action plan for the user request',
      schema: z.object({
        actionsRequired: z.boolean().describe('Whether any actions/tools need to be called'),
        steps: z
          .array(
            z.object({
              stepNumber: z.number().describe('Step number (1, 2, 3...)'),
              action: z.string().describe('What action to take (e.g., "Extract user info", "Query available slots", "Create booking")'),
              description: z.string().describe('Detailed description of this step'),
              toolToUse: z.string().optional().describe('Which tool category/type might be needed (e.g., "query_google_sheet", "append_google_sheet_row") - just guidance, main agent will fill parameters'),
              status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Current status of this step'),
              needsUserInput: z.boolean().optional().describe('Whether user input is needed before this step'),
              userPrompt: z.string().optional().describe('What information to ask the user if input is needed'),
            })
          )
          .describe('Ordered list of steps to execute'),
        missingInfo: z.array(z.string()).optional().describe('List of missing information that must be collected'),
      }),
      func: async ({ actionsRequired, steps, missingInfo }) => {
        // This is just for schema validation - actual logic is in the model response
        return JSON.stringify({ actionsRequired, steps, missingInfo });
      },
    });

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(
        `User request: "${userMessage}"

Recent conversation history:
${historyContext}

Analyze this request and create a step-by-step action plan. Use create_action_plan to structure your response.`
      ),
    ];

    const modelWithTools = this.model.bindTools([planTool]);
    const response = await modelWithTools.invoke(messages);

    // Extract plan from response
    const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const planCall = toolCalls.find((tc) => tc.name === 'create_action_plan');
      if (planCall && planCall.args) {
        const args = planCall.args as {
          actionsRequired: boolean;
          steps: Array<{
            stepNumber: number;
            action: string;
            description: string;
            toolToUse?: string;
            parameters?: Record<string, unknown>;
            needsUserInput?: boolean;
            userPrompt?: string;
          }>;
          missingInfo?: string[];
        };
        return {
          actionsRequired: args.actionsRequired,
          steps: args.steps.sort((a, b) => a.stepNumber - b.stepNumber).map(step => ({
            ...step,
            status: step.status || 'pending',
          })),
          currentStep: 1,
          missingInfo: args.missingInfo,
        };
      }
    }

    // Fallback: parse from text response
    const text = typeof response.content === 'string' ? response.content : '';
    const hasActionKeywords =
      /\b(book|schedule|appointment|create|add|update|delete|query|search|find)\b/i.test(userMessage);

    return {
      actionsRequired: hasActionKeywords,
      steps: hasActionKeywords
        ? [
            {
              stepNumber: 1,
              action: 'Analyze request',
              description: 'Extract information from user message and determine required actions',
            },
          ]
        : [],
      currentStep: 1,
    };
  }

  /**
   * Track progress and provide guidance for the current step
   * Returns guidance on what step should be done next, not validation
   */
  async trackProgress(
    plan: ActionPlan,
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>,
    completedSteps?: Array<{ step: number; result: string; success: boolean }>
  ): Promise<{ currentStepGuidance: string; nextStep?: number; allStepsCompleted: boolean }> {
    const systemPrompt = `You are a supervisor agent tracking progress and providing guidance to the main agent.

Your role:
1. Review the action plan and track which steps are completed
2. Identify what step should be done next
3. Provide clear guidance to help the main agent stay on track
4. Help prevent the main agent from getting lost or repeating steps

You do NOT block execution - you only guide and track progress.`;

    const historyContext = conversationHistory
      .slice(-5)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const completedStepsInfo = completedSteps && completedSteps.length > 0
      ? `Completed steps:\n${completedSteps.map((r) => `Step ${r.step}: ${r.success ? '✓ Completed' : '✗ Failed'} - ${r.result.substring(0, 100)}`).join('\n')}`
      : 'No steps completed yet';

    const planStatus = plan.steps.map(s => {
      const completed = completedSteps?.find(cs => cs.step === s.stepNumber && cs.success);
      return `Step ${s.stepNumber}: ${s.action} - ${completed ? 'COMPLETED' : 'PENDING'}`;
    }).join('\n');

    const guidanceTool = new DynamicStructuredTool({
      name: 'provide_guidance',
      description: 'Provide guidance on what step to do next',
      schema: z.object({
        currentStepGuidance: z.string().describe('Clear guidance on what the main agent should focus on for the current/next step'),
        nextStep: z.number().optional().describe('Which step number should be done next'),
        allStepsCompleted: z.boolean().describe('Whether all steps in the plan are completed'),
      }),
      func: async ({ currentStepGuidance, nextStep, allStepsCompleted }) => {
        return JSON.stringify({ currentStepGuidance, nextStep, allStepsCompleted });
      },
    });

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(
        `Action Plan Status:
${planStatus}

${completedStepsInfo}

User's latest message: "${userMessage}"

Recent conversation:
${historyContext}

Review the plan and provide guidance on what step the main agent should focus on next. Use provide_guidance to give clear, actionable guidance.`
      ),
    ];

    const modelWithTools = this.model.bindTools([guidanceTool]);
    const response = await modelWithTools.invoke(messages);

    const toolCalls = (response as { tool_calls?: Array<{ name: string; args?: unknown }> }).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const guidanceCall = toolCalls.find((tc) => tc.name === 'provide_guidance');
      if (guidanceCall && guidanceCall.args) {
        const args = guidanceCall.args as {
          currentStepGuidance: string;
          nextStep?: number;
          allStepsCompleted: boolean;
        };
        return args;
      }
    }

    // Fallback: determine next step from plan
    const nextStepNum = completedSteps && completedSteps.length > 0
      ? Math.max(...completedSteps.map(cs => cs.step)) + 1
      : 1;
    const nextStep = plan.steps.find(s => s.stepNumber === nextStepNum);
    const allCompleted = completedSteps?.length === plan.steps.length;

    return {
      currentStepGuidance: nextStep
        ? `Focus on: ${nextStep.action} - ${nextStep.description}`
        : 'All steps appear to be completed. Review the conversation to ensure the task is finished.',
      nextStep: nextStepNum <= plan.steps.length ? nextStepNum : undefined,
      allStepsCompleted: allCompleted || false,
    };
  }

  /**
   * Check if we need to ask the user for more information before proceeding
   */
  async checkMissingInfo(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>,
    plan: ActionPlan
  ): Promise<{ needsInfo: boolean; prompt?: string; missingFields?: string[] }> {
    if (!plan.missingInfo || plan.missingInfo.length === 0) {
      return { needsInfo: false };
    }

    // Check if missing info was provided in recent messages
    const recentMessages = conversationHistory.slice(-3).map((m) => m.content.toLowerCase()).join(' ');
    const stillMissing: string[] = [];

    for (const info of plan.missingInfo) {
      const infoLower = info.toLowerCase();
      // Simple check - could be enhanced
      if (!recentMessages.includes(infoLower) && !userMessage.toLowerCase().includes(infoLower)) {
        stillMissing.push(info);
      }
    }

    if (stillMissing.length === 0) {
      return { needsInfo: false };
    }

    // Generate a prompt to ask for missing info
    const prompt = `To proceed with your request, I need a bit more information:\n${stillMissing.map((info, i) => `${i + 1}. ${info}`).join('\n')}\n\nCould you please provide these details?`;

    return {
      needsInfo: true,
      prompt,
      missingFields: stillMissing,
    };
  }
}

/**
 * Create a supervisor agent instance
 */
export async function createSupervisorAgent(tenantId: string): Promise<SupervisorAgent> {
  const config = await getAgentConfig(tenantId);
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not set');

  const model = new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: 0.3, // Lower temperature for more consistent validation
    apiKey,
  });

  return new SupervisorAgent(tenantId, model);
}
