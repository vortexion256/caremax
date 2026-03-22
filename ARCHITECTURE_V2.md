# CareMax Agent Architecture V2

## Overview

This document describes the production-grade agent architecture refactoring for CareMax. The new architecture follows OpenAI-style patterns where **the LLM is a reasoning engine, not a state engine**.

## Key Principles

1. **LLM suggests, backend decides** - The LLM extracts intent and suggests actions, but deterministic backend code controls execution
2. **Strict tool contracts** - All tools return strongly-typed results with `success` flags
3. **State verification** - Operations are verified against the database after execution
4. **Multi-layer memory** - Separates conversation memory, structured state, execution logs, and long-term memory
5. **Context optimization** - Aggressively trims conversation history and limits RAG chunks

## Architecture Layers

```
User Input
   ↓
Intent + Extraction Layer (LLM) - agent-intent.ts
   ↓
Orchestrator / Planner (Deterministic Backend) - agent-orchestrator.ts
   ↓
Tool Executor Layer (Strict Contracts) - agent-orchestrator.ts
   ↓
State Store / Database
   ↓
Verification Layer - agent-orchestrator.ts
   ↓
Response Formatter (LLM) - agent-v2.ts
```

## Components

### 1. Intent Extraction (`agent-intent.ts`)

**Purpose**: First LLM pass to extract intent and entities from user input.

**Key Features**:
- Extracts structured intent (book_appointment, query_information, etc.)
- Identifies entities (patientName, phone, date, time, etc.)
- Suggests which tools might be needed
- **Does NOT execute tools** - pure reasoning

**Usage**:
```typescript
const intent = await extractIntent(model, userMessage, conversationHistory);
if (intent.intent === 'request_human') {
  // Early handoff
}
```

### 2. Orchestrator (`agent-orchestrator.ts`)

**Purpose**: Deterministic control layer that decides which tools to execute.

**Key Features**:
- Validates tool call arguments
- Executes tools deterministically
- Verifies state after write operations
- Maintains execution logs
- **The orchestrator decides, not the LLM**

**Usage**:
```typescript
const orchestrator = new AgentOrchestrator(tenantId, bookingsSheetEntry);
const result = await orchestrator.executeToolCall(toolCall, googleSheetsList, conversationId, userId);
// result.success === true only if execution AND verification passed
```

### 3. Tool Executor (`agent-orchestrator.ts`)

**Purpose**: Executes tools with strict contracts.

**Key Features**:
- All tools return `ToolResult<T>` with `success` boolean
- No loose string returns - everything is typed
- Handles retries and error cases deterministically

**Tool Contracts**:
```typescript
interface BookAppointmentResult extends ToolResult {
  success: boolean;
  data?: {
    appointmentId: string;
    date: string;
    doctor: string;
    time: string;
    action: 'created' | 'updated';
  };
  error?: string;
}
```

### 4. State Verifier (`agent-orchestrator.ts`)

**Purpose**: Verifies operations were actually persisted to the database.

**Key Features**:
- Called automatically after write operations
- Queries database to confirm state
- Prevents false confirmations

**Example**:
```typescript
// After append_booking_row
const verification = await stateVerifier.verifyBooking({
  phone: params.phone,
  date: params.date,
  expectedAppointmentId: result.data.appointmentId,
});
// Only mark success if verification.verified === true
```

### 5. Memory System (`agent-memory.ts`)

**Purpose**: Multi-layer memory management.

**Layers**:
1. **Conversation Memory** - Aggressively trimmed (last 10 messages)
2. **Structured State** - Database truth (appointments, notes)
3. **Execution Logs** - Tool result history
4. **Long-Term Memory** - Conversation summaries and embeddings

**Usage**:
```typescript
const trimmedMemory = trimConversationHistory(history, 10);
const agentContext = await buildAgentContext(
  tenantId,
  conversationId,
  trimmedMemory.recentMessages,
  executionLogs,
  ragContext,
  3 // Max 3 RAG chunks
);
```

### 6. Main Agent (`agent-v2.ts`)

**Purpose**: Orchestrates all layers and formats final response.

**Flow**:
1. Extract intent
2. Setup orchestrator
3. Build optimized context
4. Create tools (for LLM to call)
5. Execute with orchestrator (LLM suggests, orchestrator decides)
6. Format response
7. Validate response (orchestrator guards)
8. Return result

## Migration Guide

### Current System (V1)

- LLM directly controls tool execution
- Tools return loose strings
- Verification is prompt-based
- Full conversation history sent every turn
- State managed by LLM "memory"

### New System (V2)

- LLM suggests, orchestrator executes
- Tools return strict contracts
- Verification is deterministic (database queries)
- Optimized context (trimmed history, limited RAG)
- State managed by database + execution logs

### To Use V2

1. **Option A: Gradual Migration**
   - Keep `runAgent` (V1) for existing functionality
   - Use `runAgentV2` for new features
   - Gradually migrate conversations

2. **Option B: Full Migration**
   - Replace `runAgent` with `runAgentV2` in `routes/conversations.ts`
   - Test thoroughly
   - Monitor execution logs for verification failures

### Example Migration

**Before (V1)**:
```typescript
// routes/conversations.ts
agentResponse = await runAgent(tenantId, history, {
  userId,
  conversationId,
});
```

**After (V2)**:
```typescript
// routes/conversations.ts
import { runAgentV2 } from '../services/agent-v2.js';

agentResponse = await runAgentV2(tenantId, history, {
  userId,
  conversationId,
});
```

## Benefits

1. **Reliability**: Deterministic execution prevents hallucinated confirmations
2. **Performance**: Optimized context reduces token usage (from ~20k to ~5-8k)
3. **Debugging**: Execution logs show exactly what happened
4. **State Consistency**: Verification ensures database matches reality
5. **Scalability**: Architecture supports planning models, reflection layers, etc.

## Testing

Test the new architecture by:

1. **Booking Flow**: Verify bookings are confirmed only after database verification
2. **Context Size**: Check token usage is reduced
3. **State Consistency**: Ensure no false confirmations
4. **Error Handling**: Verify errors are handled deterministically

## Future Enhancements

1. **Planning Models**: Add hierarchical planning (planner + worker models)
2. **Reflection Layer**: Add self-critique after tool execution
3. **Multi-Model**: Use different models for intent extraction vs response formatting
4. **Advanced Memory**: Semantic search for long-term memory retrieval
5. **Perception / Encounter State Layer**: Add a deterministic layer that converts incoming multimodal evidence (for example images, documents, audio, and extracted medication names) into structured encounter facts that persist for the active conversation and, when appropriate, user-scoped memory. This helps the agent remember that "the user already showed Clarinase" without relying on raw chat history alone.

### Recommendation for multimodal continuity

For the kind of issue where a user first shares an image of a medication and later expects advice to stay grounded in that image, the best next step is usually **to strengthen the orchestrator path rather than add a separate always-on "seer agent" first**.

Why:

1. The current architecture already separates reasoning from state and explicitly says the LLM should not be trusted as the memory engine.
2. `agent-memory.ts` already supports recent messages plus structured state, but today that structured state is mostly notes, plans, and summaries.
3. A new deterministic **perception-to-facts** stage can turn image understanding into reusable state such as:
   - `medication_detected: Clarinase`
   - `evidence_source: user_uploaded_image`
   - `confidence: high`
   - `captured_at_turn: 1`
   - `safety_flags: decongestant, antihistamine`
4. The orchestrator can then inject those facts into subsequent medication, symptom, and triage decisions so later responses stay aligned with what the user already shared.

Recommended implementation order:

1. **Perception extraction**
   - When a message contains `imageUrls`, run image understanding once and extract structured facts.
2. **Structured encounter state**
   - Save those facts as conversation-scoped encounter memory, and optionally promote safe user-specific facts to user-scoped memory when identity is reliable.
3. **Context builder updates**
   - Include the active encounter facts in `buildAgentContext()` before the model answers.
4. **Orchestrator policy checks**
   - Require medication-related answers to cross-check against stored encounter facts before responding.
5. **Supervisor/planner awareness**
   - Let the supervisor see those facts for planning, but keep the source of truth in deterministic state rather than a second independent agent.

When a separate "seer" agent makes sense:

- If you want a specialized multimodal worker that only interprets images/documents/audio and outputs structured facts.
- If you need richer perception pipelines such as OCR, package recognition, dosage extraction, and uncertainty scoring.

Even then, that "seer" should act as a **subsystem that writes facts into orchestrator-controlled state**, not as a parallel source of conversational truth.

## Files Created

- `packages/api/src/services/agent-orchestrator.ts` - Orchestrator, tool executor, state verifier
- `packages/api/src/services/agent-memory.ts` - Multi-layer memory system
- `packages/api/src/services/agent-intent.ts` - Intent extraction layer
- `packages/api/src/services/agent-v2.ts` - Main agent using new architecture

## Files Modified

- None (V1 remains intact for backward compatibility)
