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
- Optionally set `FIREBASE_STORAGE_BUCKET`, `ALLOWED_ORIGINS`, `PORT`.
- For Marz Pay subscription collections (tenant pays you), configure these env vars:
  - `MARZPAY_COLLECTIONS_URL=https://wallet.wearemarz.com/api/v1/collect-money`
  - `MARZPAY_API_KEY` and `MARZPAY_API_SECRET` (used to build Basic auth as `base64(key:secret)`)
    - optional alternative: `MARZPAY_API_CREDENTIALS` (already base64-encoded `key:secret`)
  - `ADMIN_APP_URL` (e.g. `http://localhost:3002`, used for hosted-link redirects)
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
MARZPAY_VERIFY_URL=https://wallet.wearemarz.com/api/v1/collect-money/verify

# optional legacy fallback:
# MARZPAY_PAYMENT_LINK=https://wallet.wearemarz.com/pay/<id>
# MARZPAY_CHECKOUT_URL=https://wallet.wearemarz.com/checkout
# MARZPAY_SECRET_KEY=legacy_bearer_secret
```
- Tenant checkout and verification routes: `POST /tenants/:tenantId/payments/marzpay/initialize` and `POST /tenants/:tenantId/payments/marzpay/verify`.
  - `initialize` now supports direct collection fields in request body: `phoneNumber`, `country` (default `UG`), `description`, `callbackUrl`.
  - You can send callback using either camelCase (`callbackUrl`) or Marz-style snake_case (`callback_url`).
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
- Callback URL for Marz hosted links should point back to your admin billing page, for example:
  - local: `http://localhost:5173/billing?payment=marzpay`
  - production: `https://caremax-admin.vercel.app/billing?payment=marzpay`
  - If Marz supports placeholders, append `&tx_ref={tx_ref}` so verification can map transactions reliably.
- **Widget**: Set `VITE_API_URL` to your API URL (e.g. `http://localhost:3001`).
- **Admin**: Set `VITE_API_URL` and Firebase client env vars (`VITE_FIREBASE_*`).

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
