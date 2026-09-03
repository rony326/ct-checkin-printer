import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import session from '@fastify/session';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerAuthRoutes } from '../auth/routes.js';
import { registerChurchToolsConnectionRoutes } from './churchToolsConnection.js';
import { registerDocumentPrinterRoutes } from './documentPrinters.js';
import { registerFontRoutes } from './fonts.js';
import { registerLabelLayoutRoutes } from './labelLayouts.js';
import { registerLogoRoutes } from './logos.js';
import { registerMediaTypeRoutes } from './mediaTypes.js';
import { registerPrinterRoutes } from './printers.js';
import { registerSummaryLayoutRoutes } from './summaryLayouts.js';
import { registerVariableRoutes } from './variables.js';
import { registerWebhookIncomingRoutes } from './webhooksIncoming.js';
import { registerWebhookOutgoingRoutes } from './webhooksOutgoing.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { noopOrchestrator, type OrchestratorLike } from '../orchestrator/orchestratorLike.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer(db: Db, env: Env, orchestrator: OrchestratorLike = noopOrchestrator) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('orchestrator', orchestrator);

  await app.register(cookie);
  await app.register(session, {
    secret: env.SESSION_SECRET,
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' }, // secure:true sobald TLS terminiert (Reverse Proxy)
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB reicht für Fonts/Logos deutlich

  const frontendDist = path.join(__dirname, '../../../frontend/dist');
  await app.register(staticPlugin, { root: frontendDist, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  await registerAuthRoutes(app);
  await registerMediaTypeRoutes(app);
  await registerVariableRoutes(app);
  await registerFontRoutes(app);
  await registerLogoRoutes(app);
  await registerLabelLayoutRoutes(app);
  await registerPrinterRoutes(app);
  await registerChurchToolsConnectionRoutes(app);
  await registerWebhookOutgoingRoutes(app);
  await registerWebhookIncomingRoutes(app);
  await registerDocumentPrinterRoutes(app);
  await registerSummaryLayoutRoutes(app);

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
