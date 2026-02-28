import express, { Router } from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { tenantRouter } from './routes/tenants.js';
import { conversationRouter } from './routes/conversations.js';
import { uploadRouter } from './routes/upload.js';
import { agentConfigRouter } from './routes/agent-config.js';
import { handoffRouter } from './routes/handoff.js';
import { ragRouter } from './routes/rag.js';
import { agentRecordsRouter } from './routes/agent-records.js';
import { agentNotesRouter } from './routes/agent-notes.js';
import { analyticsRouter } from './routes/analytics.js';
import { registerRouter } from './routes/register.js';
import { platformRouter } from './routes/platform.js';
import { integrationsCallbackRouter, tenantIntegrationsRouter } from './routes/integrations.js';
import { rateLimit } from './middleware/rateLimit.js';
import { publicRouter } from './routes/public.js';
import { domainAllowlist } from './middleware/allowlist.js';

const app: express.Application = express();
const PORT = process.env.PORT ?? 3001;

const allowedFromEnv = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
const devOrigins = [
  'http://localhost:3002',
  'http://localhost:3010',
  'http://localhost:5173',
  'http://localhost:5177',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3010',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5177',
];
const corsOrigin = allowedFromEnv?.length
  ? [...new Set([...allowedFromEnv, ...devOrigins])]
  : true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const registerRoutes = (router: Router) => {
  router.use('/health', healthRouter);
  router.use('/auth', authRouter);
  router.use('/register', registerRouter);
  router.use('/public', publicRouter);
  router.use('/platform', platformRouter);
  router.use('/integrations', integrationsCallbackRouter);
  router.use('/tenants', rateLimit);
  router.use('/tenants', domainAllowlist);
  // Mount tenant-scoped routes first so they are not covered by tenantRouter (which requires auth)
  router.use('/tenants/:tenantId/integrations', tenantIntegrationsRouter);
  router.use('/tenants/:tenantId/conversations', conversationRouter);
  router.use('/tenants/:tenantId/upload', uploadRouter);
  router.use('/tenants/:tenantId/agent-config', agentConfigRouter);
  router.use('/tenants/:tenantId/handoffs', handoffRouter);
  router.use('/tenants/:tenantId/rag', ragRouter);
  router.use('/tenants/:tenantId/agent-records', agentRecordsRouter);
  router.use('/tenants/:tenantId/agent-notes', agentNotesRouter);
  router.use('/tenants/:tenantId/analytics', analyticsRouter);
  router.use('/tenants', tenantRouter);
};

const apiRouter = Router();
registerRoutes(apiRouter);
app.use(apiRouter);
app.use('/api', apiRouter);

export default app;

export function startApp() {
  const server = app.listen(PORT, () => {
    console.log(`CareMax API listening on http://localhost:${PORT}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use. Either:`);
      console.error(`  1. Stop the other process (in its terminal press Ctrl+C), or`);
      console.error(`  2. Free the port: run "netstat -ano | findstr :${PORT}" then "taskkill /PID <PID> /F", or`);
      console.error(`  3. Use another port: set PORT=3002 && npm run dev:api (cmd) or $env:PORT=3002; npm run dev:api (PowerShell)\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
