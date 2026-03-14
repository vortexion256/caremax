# WhatsApp Next-of-Kin Reply Routing (Single Shared Number)

## Problem
CareMax uses one WhatsApp number for everyone. If Patient A asks the agent to contact their next of kin (NOK), the NOK receives a WhatsApp message from the same shared CareMax number. If NOK replies, the system may incorrectly treat it as a normal inbound chat from that NOK, instead of routing the message back into Patient A's conversation context.

## Recommended Solution (Best Practice)
Use **conversation-linked relay tickets** (a.k.a. escalation threads) with strict routing metadata.

### 1) Create a Relay Ticket per NOK outreach
When the patient asks "contact my next of kin," create a `relay_ticket` record:

- `relay_ticket_id` (short human-friendly code, e.g. `CMX-7KQ2`)
- `patient_user_id`
- `patient_whatsapp_id`
- `nok_whatsapp_id`
- `reason` (`emergency`, `patient_request`, etc.)
- `status` (`open`, `closed`, `expired`)
- `created_at`, `expires_at`
- `last_activity_at`

### 2) Send outbound NOK message with explicit context tag
Outbound template to NOK should include a visible reference token:

> "CareMax alert on behalf of [Patient First Name]. Reply in this thread and include code `CMX-7KQ2` (or tap the button) so we can route your response correctly."

If WhatsApp interactive buttons are available, include:
- "Acknowledge"
- "Call patient"
- "Need details"

Each button payload should include `relay_ticket_id`.

### 3) Route inbound messages by deterministic rules
Inbound message handler should do:

1. Match sender (`from`) to any open relay tickets where `nok_whatsapp_id == from`.
2. If one open ticket exists, auto-associate inbound to that ticket.
3. If multiple open tickets exist, require disambiguation by code (`CMX-xxxx`) or present a numbered menu.
4. If no open ticket exists, treat as standard CareMax chat for that sender.

### 4) Store messages as two linked streams
Persist every message once, but with two views:
- **NOK channel view** (actual WhatsApp sender/receiver)
- **Patient relay view** (what Patient A should see)

This avoids confusion and maintains auditability.

### 5) Deliver NOK reply to patient safely
When a NOK reply is associated with `relay_ticket_id`:
- Push into Patient A's chat timeline as:
  - "Reply from your next of kin: ..."
- Optionally mirror to patient on WhatsApp if patient is also on WhatsApp.
- Mark clearly as relayed content, not AI-generated text.

### 6) Consent, privacy, and emergency controls
- Require patient opt-in for NOK contacting.
- Log legal basis/consent timestamp.
- Minimize PHI in outbound NOK alerts until identity is confirmed.
- Add emergency override policy and full audit logs.

### 7) Close tickets automatically
Close or expire relay tickets after:
- fixed TTL (e.g. 24h),
- explicit closure by patient/agent,
- emergency workflow completion.

Closed tickets are never auto-reused.

## Why this is the best approach
- Works with a **single shared WhatsApp number**.
- Prevents cross-patient message bleed.
- Handles NOKs who are also direct CareMax users.
- Gives deterministic routing and compliance-grade audit trails.
- Scales to multiple concurrent emergency contacts.

## Fallback UX when ambiguous
If routing cannot be confidently resolved:

> "We found multiple active CareMax requests tied to this number. Please reply with your reference code (e.g., CMX-7KQ2)."

Never guess a patient when ambiguity exists.

## Minimal implementation checklist
- [ ] New `relay_tickets` table/collection
- [ ] Outbound message templates with reference code/button payloads
- [ ] Inbound router middleware with sender+ticket matching
- [ ] Relay projection into patient timeline
- [ ] Ticket TTL/closure job
- [ ] Audit + consent logging

## Why this can still fail (common misses)
If you already implemented the pattern and routing is still wrong, one of these is usually missing:

1. **No durable ticket write before send**
   - The outbound message is sent first, then ticket creation fails/rolls back.
   - Fix: write `relay_ticket` first in a committed transaction, then send the WhatsApp message.

2. **Not persisting provider message IDs**
   - Inbound webhook payload cannot be tied back to outbound interaction/button context.
   - Fix: store Twilio/Meta `message_id`, button payload, and `relay_ticket_id` together.

3. **Ticket matching only by phone number**
   - NOK has multiple active tickets and message is attached to the wrong patient.
   - Fix: require `CMX-xxxx` disambiguation whenever `open_ticket_count(from) > 1`.

4. **Ticket expiry not enforced at read time**
   - Expired tickets still participate in routing lookups.
   - Fix: inbound matcher must filter strictly on `status = open` and `expires_at > now()`.

5. **Race conditions in inbound webhooks**
   - Retries or duplicate webhook deliveries create inconsistent links.
   - Fix: idempotency key on provider event ID + upsert semantics for message ingestion.

6. **No explicit ambiguous-path UX**
   - System falls back to generic chat when there are multiple candidate tickets.
   - Fix: send the ambiguity prompt and pause routing until a valid code is received.

## Quick verification script (engineering handoff)
Use these tests before rollout:

- [ ] **Single open ticket path**: one NOK + one open ticket routes correctly to that patient timeline.
- [ ] **Multi-ticket ambiguity path**: one NOK + two open tickets requires code, no auto-guess.
- [ ] **Expired ticket path**: reply to an expired code is rejected or treated as generic chat.
- [ ] **Duplicate webhook path**: repeated provider event does not duplicate relay timeline entries.
- [ ] **Cross-tenant safety path**: same phone in different tenants never crosses tenant boundary.
