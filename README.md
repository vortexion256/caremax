# CareMax

Multi-tenant SaaS for AI-powered clinical triage chat (symptoms + optional images) with embeddable widget, tenant admin (agent config, RAG), and human handoff. Built with Google Gemini, LangChain, and Firebase.

## Structure

- **packages/api** – Node.js (TypeScript) API: auth, tenants, conversations, agent (LangChain + Gemini), upload, agent-config, handoffs, RAG.
- **packages/widget** – Embeddable chat UI (React + Vite). Use `embed.html?tenant=...&theme=...` in an iframe or the loader script.
- **packages/admin** – Admin dashboard (React + Vite): agent settings, handoff queue, RAG documents, embed snippet. Google sign-in required; admin actions require Firebase custom claims.

## Setup

### 1. Firebase

- Create a Firebase project and enable Firestore and Storage.
- Enable Authentication → Google sign-in.
- Add a Web app to get client config (API key, auth domain, project ID, etc.).
- For the API, use a service account: Project settings → Service accounts → Generate new private key. Set `GOOGLE_APPLICATION_CREDENTIALS` to the JSON path, or set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` in env.
- Deploy rules: `firebase deploy --only firestore,storage` (from repo root).

### 2. Admin custom claims (for tenant + admin)

The API expects Firebase ID tokens to optionally include `tenantId` and `isAdmin`. Set them via the Admin SDK (e.g. a one-off script or Cloud Function):

```js
const admin = require('firebase-admin');
admin.initializeApp();
await admin.auth().setCustomUserClaims(uid, { tenantId: 'demo', isAdmin: true });
```

Without claims, Agent settings GET and RAG documents GET still work; PUT and Handoffs require admin.

### 3. Environment

Put your `.env` in the **repo root** (`e:\caremax\.env`). The API loads it from there (or from `packages/api/.env` as fallback).

- **API**: Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). For Firebase, use either:
  - **Option A**: Download the service account JSON (Firebase Console → Project settings → Service accounts → Generate new private key). Save it as `service-account.json` in the repo root. In `.env` set `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`.
  - **Option B**: In `.env` set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` (copy these from the same service account JSON; keep the key in quotes and use `\n` for newlines).
- Optionally set `FIREBASE_STORAGE_BUCKET`, `ALLOWED_ORIGINS`, `PORT`. Use the bucket name only (for example `your_project_id.firebasestorage.app` or legacy `your_project_id.appspot.com`; `gs://...` is also accepted).
- For Marz Pay subscription collections (tenant pays you), configure these env vars:
  - `MARZPAY_COLLECTIONS_URL=https://wallet.wearemarz.com/api/v1/collect-money`
  - `MARZPAY_API_KEY` and `MARZPAY_API_SECRET` (used to build Basic auth as `base64(key:secret)`)
    - optional alternative: `MARZPAY_API_CREDENTIALS` (already base64-encoded `key:secret`)
  - `ADMIN_APP_URL` (e.g. `http://localhost:3002`, used for hosted-link redirects)
  - `MARZPAY_CALLBACK_URL` (recommended, e.g. `https://caremax-api.vercel.app/integrations/marzpay/callback`)
  - `API_BASE_URL` (optional fallback base URL used to build callback endpoint when `MARZPAY_CALLBACK_URL` is not set; defaults to `https://caremax-api.vercel.app`)
  - `MARZPAY_VERIFY_URL` (optional server-side verification endpoint)
  - Fallback (legacy hosted checkout): `MARZPAY_PAYMENT_LINK` or `MARZPAY_CHECKOUT_URL`, with optional `MARZPAY_SECRET_KEY` bearer auth.
  - Notes:
    - Use raw values only (no surrounding quotes).
    - Restart/redeploy the API whenever env values change.

Example `.env` snippet:

```bash
MARZPAY_COLLECTIONS_URL=https://wallet.wearemarz.com/api/v1/collect-money
MARZPAY_API_KEY=your_api_key
MARZPAY_API_SECRET=your_api_secret
# optional if you prefer pre-encoded auth instead of key+secret:
# MARZPAY_API_CREDENTIALS=base64_of_key_colon_secret

ADMIN_APP_URL=http://localhost:3002
MARZPAY_CALLBACK_URL=https://caremax-api.vercel.app/integrations/marzpay/callback
API_BASE_URL=https://caremax-api.vercel.app
MARZPAY_VERIFY_URL=https://wallet.wearemarz.com/api/v1/collect-money/verify

# optional legacy fallback:
# MARZPAY_PAYMENT_LINK=https://wallet.wearemarz.com/pay/<id>
# MARZPAY_CHECKOUT_URL=https://wallet.wearemarz.com/checkout
# MARZPAY_SECRET_KEY=legacy_bearer_secret
```
- Tenant checkout and verification routes: `POST /tenants/:tenantId/payments/marzpay/initialize` and `POST /tenants/:tenantId/payments/marzpay/verify`.
  - `initialize` now supports direct collection fields in request body: `phoneNumber`, `country` (default `UG`), `description`, `callbackUrl`.
  - You can send customer phone using either camelCase (`phoneNumber`) or snake_case (`phone_number`).
  - You can send callback using either camelCase (`callbackUrl`) or Marz-style snake_case (`callback_url`).
  - If callback is not provided by the client, API auto-fills callback to `MARZPAY_CALLBACK_URL`, or `${API_BASE_URL}/integrations/marzpay/callback` (default `https://caremax-api.vercel.app/integrations/marzpay/callback`), then finally `<current-api-origin>/integrations/marzpay/callback`.
  - Example:

```bash
curl -X POST "https://your-api.com/tenants/<tenantId>/payments/marzpay/initialize" \
  -H "Authorization: Bearer <your_firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "billingPlanId": "starter",
    "phone_number": "+256781230949",
    "country": "UG",
    "description": "Tenant subscription payment",
    "callback_url": "https://your-app.com/marz/callback"
  }'
```
- For collection webhooks, callback URL must point to your API webhook endpoint (not admin UI): `https://<api-domain>/integrations/marzpay/callback`.
- Callback URL for Marz hosted links should point back to your admin billing page, for example:
  - local: `http://localhost:5173/billing?payment=marzpay`
  - production: `https://caremax-admin.vercel.app/billing?payment=marzpay`
  - If Marz supports placeholders, append `&tx_ref={tx_ref}` so verification can map transactions reliably.
- **Widget**: Set `VITE_API_URL` to your API URL (e.g. `http://localhost:3001`).
- **Admin**: Set `VITE_API_URL` and Firebase client env vars (`VITE_FIREBASE_*`).

#### WhatsApp integration setup (Twilio + Meta Cloud API)

You now have **three channels** in practice:
1. Widget (web chat)
2. WhatsApp via Twilio
3. WhatsApp via Meta/Facebook Cloud API

For WhatsApp integrations specifically:

- **No extra server env var is required just to store credentials**; Twilio and Meta credentials are saved per-tenant from Admin → WhatsApp page.
- You still need the baseline API env values above (`GEMINI_API_KEY` or `GOOGLE_API_KEY`, Firebase creds, etc.) so agent responses can be generated.

Twilio (per-tenant fields in Admin):
- `accountSid`
- `authToken`
- `whatsappNumber` (or messaging service SID)
- optional `webhookSecret`
- Configure Twilio inbound webhook to:
  - `https://<api-domain>/integrations/twilio/whatsapp/webhook/<tenantId>`

Meta Cloud API (per-tenant fields in Admin):
- `phoneNumberId`
- `accessToken` (prefer permanent system-user token)
- optional `webhookVerifyToken`
- Configure Meta webhook callback URL to:
  - `https://<api-domain>/integrations/meta/whatsapp/webhook/<tenantId>`
- Configure Meta webhook verify token to match the per-tenant `webhookVerifyToken` you saved in Admin.

Notes:
- Meta path currently handles text messages/replies.
- Twilio path keeps the existing voice-note/audio behavior.

##### WhatsApp TTS provider and Google Cloud voice selection

- You can pick the WhatsApp TTS engine per tenant in **Admin → Agent Settings → WhatsApp TTS Provider**:
  - `Sunbird`
  - `Google Cloud TTS`
  - `ElevenLabs`
  - `Gemini 2.5 Flash Preview TTS` (this currently reuses the Google Cloud TTS synthesis path/server-side credentials).
- If no provider has been saved yet, backend fallback is `sunbird`.
- The saved conversation language flag is what decides the voice stack at send time:
  - English (`en`/`eng`/`english`) uses the tenant's configured English provider (`google-cloud-tts` or `elevenlabs`), and falls back to `google-cloud-tts` when another provider is selected
  - Luganda (`lg`/`luganda`) and the supported local-language flags use `sunbird`
- When an incoming WhatsApp message appears to change the conversation language flag, the system now acknowledges the change and asks the user to confirm before continuing in the new language.

For the Google Cloud synthesis path, the voice and output format are configurable with env vars:

- `GOOGLE_CLOUD_TTS_LANGUAGE_CODE` (default: `en-US`)
- `GOOGLE_CLOUD_TTS_VOICE_NAME` (default: `en-US-Neural2-F`)
- `GOOGLE_CLOUD_TTS_AUDIO_ENCODING` (default: `OGG_OPUS`)

So if you want a different Google voice, set `GOOGLE_CLOUD_TTS_VOICE_NAME` (and optionally language code/encoding), then restart the API service.

For ElevenLabs synthesis, set:

- `ELEVENLABS_API_KEY` (required when provider is `elevenlabs`)
- `ELEVENLABS_VOICE_ID` (optional, default: `JBFqnCBsd6RMkjVDRZzb`)
- `ELEVENLABS_MODEL_ID` (optional, default: `eleven_multilingual_v2`)
- `ELEVENLABS_OUTPUT_FORMAT` (optional, default: `mp3_44100_128`)

Notes:

- There is currently **no ElevenLabs voice picker in the Admin UI**. ElevenLabs voice/model/output are configured on the API server via environment variables.
- The Admin voice dropdown only controls Google Cloud voice selection (`whatsappGoogleTtsVoiceName`) and is ignored when ElevenLabs is selected.

### 4. Install and run

If you see peer dependency conflicts with LangChain, use: `npm install --legacy-peer-deps`.

```bash
npm install
npm run dev:api      # API on :3001
npm run dev:widget   # Widget on :5173
npm run dev:admin    # Admin on :3002
```

- Open the widget: http://localhost:5173 (dev) or http://localhost:5173/embed.html?tenant=demo
- Open admin: http://localhost:3002 (sign in with Google).

### 5. Tenants and admin access

**Where do tenants come from?**  
There is no self-service tenant registration. To add a tenant:

1. Create a document in Firestore in the `tenants` collection with document ID = tenant id (e.g. `demo`), and fields: `name`, `allowedDomains` (array of allowed embed origins). Example: `{ name: "Demo", allowedDomains: ["http://localhost:5173", "https://your-site.com"] }`.
2. Use that same id in the widget embed as `data-tenant="demo"`.

**Why do I get 403 on Handoffs / when saving Agent settings?**  
Those routes require the signed-in user to have **admin** access. Set Firebase custom claims (see step 2 above) so your user has `tenantId: "demo"` and `isAdmin: true`. Until then, you can still **view** Agent settings and RAG documents; saving and Handoffs will return 403 until your user is an admin.

## Embed

Add to your site:

```html
<script src="https://your-widget-origin/loader.js" data-tenant="YOUR_TENANT_ID" data-theme="light"></script>
```

Optional: `data-theme="dark"`.

## API overview

- `GET /health` – Health check.
- `POST /auth/google` – Body: `{ idToken }`. Returns user info.
- `GET /tenants/:tenantId` – Get tenant (auth optional).
- `POST /tenants/:tenantId/conversations` – Create conversation (body may include `userId`).
- `GET /tenants/:tenantId/conversations/:id/messages` – List messages.
- `POST /tenants/:tenantId/conversations/:id/messages` – Send message (body: `content`, optional `imageUrls`).
- `POST /tenants/:tenantId/upload` – Multipart file upload; returns `{ url }`.
- `GET /tenants/:tenantId/agent-config` – Get agent config.
- `PUT /tenants/:tenantId/agent-config` – Update agent config (admin).
- `GET /tenants/:tenantId/handoffs` – List handoff conversations (admin).
- `POST /tenants/:tenantId/conversations/:id/join` – Human join (admin).
- `POST /tenants/:tenantId/conversations/:id/agent-message` – Send message as human agent (admin).
- `GET /tenants/:tenantId/rag/documents` – List RAG documents.
- `POST /tenants/:tenantId/rag/documents` – Add document (admin; body: `name`, `content`).

## Safety

Agent responses include a disclaimer. Configure Gemini safety settings and monitor logs as needed. For production, consider HIPAA and data retention.

## Preventing user-memory mixups in the widget

If your AI is remembering user-specific details (like names) and then reusing them with other visitors, treat this as a **memory-scoping** issue.

Recommended setup (best-practice order):

1. **Use a stable `userId` per end user** when creating conversations (`POST /tenants/:tenantId/conversations`).
   - Do not rely on random anonymous IDs for returning users.
   - Prefer your website/app's own unique user ID (or a generated browser UUID persisted in local storage/cookie if users are anonymous).
2. **Scope memory by both `tenantId` + `userId`** for anything learned from chat.
   - Tenant-only memory can leak one user's details to another user in the same tenant.
3. **Separate "shared business knowledge" from "personal memory"**.
   - Keep operational knowledge (clinic hours, services, policies) in shared tenant RAG.
   - Keep personal details (names, phone numbers, preferences) in user-scoped storage only.
4. **Add TTL/retention + deletion controls** for personal memory.
5. **Default to privacy-first behavior**:
   - If no reliable user identity is available, do not store personal memory.
   - Optionally disable learned-memory tools entirely and use conversation-only context.

Practical recommendation for this codebase:

- For a website widget where users are not strongly authenticated, either:
  - pass a stable unique ID from your app as `userId` and only store/retrieve personal memory under that ID, or
  - disable personal memory capture (Auto Agent Brain for user facts) and keep only session/conversation context.

This approach prevents cross-user name/personality leakage while still allowing high-quality shared support knowledge.

## WhatsApp autonomous reminders

This project now supports AI-created WhatsApp reminders:

- The agent can call the `set_reminder` tool during a WhatsApp conversation. `set_reminder` now supports explicit recipient routing (`targetType`: `self` or `next_of_kin`) so reminders can be sent to next of kin when requested.
- The agent can call `list_user_reminders` / `get_upcoming_reminders` to retrieve only safe reminder fields (`id`, `due time`, `message`, `status`) for the current tenant + WhatsApp user identity.
- The agent can call `edit_reminder` and `delete_reminder` to update/cancel a pending reminder when the user asks.
- Reminders are stored in Firestore collection `reminders` with status `pending`.
- A secured dispatch endpoint sends due reminders and marks them `sent` or `failed`:
  - `POST /public/reminders/dispatch`
  - Header required: `x-reminder-secret: <REMINDER_DISPATCH_SECRET>`

### Required env var

- `REMINDER_DISPATCH_SECRET` (required for dispatcher auth)

### Cloud Scheduler / Cloud Function setup

You have two options:

1. **Recommended (simpler): Cloud Scheduler -> HTTP endpoint**
   - Create a scheduler job (every 1 minute)
   - URL: `https://<your-api-domain>/public/reminders/dispatch`
   - Method: `POST`
   - Add header `x-reminder-secret: <REMINDER_DISPATCH_SECRET>`

2. **If you want Cloud Function in the middle**
   - Create a scheduled Cloud Function (every 1 minute)
   - In the function, do an authenticated `POST` to `/public/reminders/dispatch` with `x-reminder-secret`
   - Keep `REMINDER_DISPATCH_SECRET` in Secret Manager / function env

### Manual test command

```bash
curl -X POST "https://<your-api-domain>/public/reminders/dispatch" \
  -H "x-reminder-secret: <REMINDER_DISPATCH_SECRET>"
```

### Troubleshooting 500 on `/public/reminders/dispatch`

If you still receive `500`, inspect the JSON body from the endpoint response and verify:

- `REMINDER_DISPATCH_SECRET` exists in the API runtime environment.
- Firebase server credentials are set for the deployed environment.
- Firestore has the required query index for reminders dispatch (`status` + `dueAt`).
- The API service account has permission to read and update Firestore `reminders` documents.
