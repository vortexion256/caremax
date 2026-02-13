# Testing Agent V2

## Quick Start

### Option 1: Enable V2 via Environment Variable

Set the environment variable to enable V2:

```bash
# In your .env file or environment
AGENT_V2_ENABLED=true
```

Then restart your API server. All new conversations will use V2.

### Option 2: Test V2 Directly (Code Change)

Temporarily change the default in `packages/api/src/routes/conversations.ts`:

```typescript
// Change this line:
const useV2 = process.env.AGENT_V2_ENABLED === 'true';

// To this (for testing):
const useV2 = true; // Force V2 for testing
```

## What to Test

### 1. Basic Conversation Flow
- Send a simple greeting: "Hello"
- Verify response is natural and appropriate
- Check console logs for `[Agent V2]` prefix

### 2. Booking Flow (Critical Test)
- Try booking an appointment: "I want to book an appointment for John Doe, phone 1234567890, with Dr. Smith at 2pm today"
- **Verify**: 
  - Console shows booking creation AND verification
  - Response only confirms booking if verification passed
  - Check execution logs in console

### 3. Query Flow
- Ask about availability: "What times are available today?"
- Verify it queries sheets correctly
- Check that context is optimized (lower token usage)

### 4. Error Handling
- Try invalid booking data: "Book appointment" (missing info)
- Verify graceful error handling
- Check that no false confirmations occur

### 5. Handoff Detection
- Request human: "I want to speak with a human"
- Verify handoff is triggered correctly
- Check intent extraction logs

## Monitoring

### Console Logs to Watch

1. **Intent Extraction**:
   ```
   [Agent V2] Running agent...
   ```

2. **Tool Execution**:
   ```
   [ToolExecutor] Book appointment...
   [StateVerifier] Verifying booking...
   ```

3. **Verification**:
   ```
   [Agent] Booking verified: APT-xxx-xxx
   ```

4. **Token Usage**:
   ```
   ✅ Recorded usage: X input + Y output = Z total tokens
   ```
   Compare with V1 - should be significantly lower (~5-8k vs ~20k)

### Execution Logs

The orchestrator maintains execution logs. Check for:
- `verified: true` for successful bookings
- `verified: false` for failed verifications
- Tool call arguments and results

## Troubleshooting

### Issue: V2 not being used
- Check `AGENT_V2_ENABLED=true` is set
- Restart API server
- Check console logs for `[Agent V2]` prefix

### Issue: Bookings not verifying
- Check Google Sheets connection
- Verify bookings sheet is configured correctly
- Check execution logs for verification failures
- Ensure `get_appointment_by_phone` is being called after `append_booking_row`

### Issue: Higher token usage than expected
- Check conversation history length
- Verify RAG chunks are limited (max 3)
- Check if conversation summary is being used

### Issue: Errors in execution
- Check console for detailed error messages
- Verify all imports are correct
- Ensure all dependencies are installed

## Comparison: V1 vs V2

| Feature | V1 | V2 |
|---------|----|----|
| Tool Execution | LLM controls | Orchestrator controls |
| State Verification | Prompt-based | Database verification |
| Context Size | Full history (~20k tokens) | Optimized (~5-8k tokens) |
| Memory | Conversation only | Multi-layer |
| Tool Contracts | Loose strings | Strict types |
| Execution Logs | Limited | Full logging |

## Rollback

If you need to rollback to V1:

1. Set `AGENT_V2_ENABLED=false` or remove the env var
2. Or change code back to `const useV2 = false;`
3. Restart API server

## Next Steps

After successful testing:
1. Monitor production usage
2. Compare token costs (should be lower)
3. Check error rates (should be lower)
4. Gradually migrate more conversations
5. Consider full migration when confident
