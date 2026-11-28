import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import session from '@fastify/session';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerAuthRoutes } from '../auth/routes.js';
import { registerAppConfigRoutes } from './appConfig.js';
import { registerChurchToolsConnectionRoutes } from './churchToolsConnection.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerDocumentPrinterRoutes } from './documentPrinters.js';
import { registerFontRoutes } from './fonts.js';
import { registerLabelLayoutRoutes } from './labelLayouts.js';
import { registerLogoRoutes } from './logos.js';
import { registerMediaTypeRoutes } from './mediaTypes.js';
import { registerPrinterGroupRoutes } from './printerGroups.js';
import { registerPrinterRoutes } from './printers.js';
import { registerSummaryLayoutRoutes } from './summaryLayouts.js';
import { registerVariableRoutes } from './variables.js';
import { registerWebhookIncomingRoutes } from './webhooksIncoming.js';
import { registerWebhookOutgoingRoutes } from './webhooksOutgoing.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { noopOrchestrator, type OrchestratorLike } from '../orchestrator/orchestratorLike.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Gelten für jede Antwort. `style-src 'unsafe-inline'` braucht der Etiketten-Editor (eingefügtes `<style>` für
 * hochgeladene Schriften), `blob:` die Vorschauen. Kein HSTS: der Dienst läuft ohne eigenes HTTPS.
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export async function buildServer(db: Db, env: Env, orchestrator: OrchestratorLike = noopOrchestrator) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('orchestrator', orchestrator);

  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(SECURITY_HEADERS);
  });

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
  await registerPrinterGroupRoutes(app);
  await registerPrinterRoutes(app);
  await registerChurchToolsConnectionRoutes(app);
  await registerWebhookOutgoingRoutes(app);
  await registerWebhookIncomingRoutes(app);
  await registerDocumentPrinterRoutes(app);
  await registerSummaryLayoutRoutes(app);
  await registerDashboardRoutes(app);
  await registerAppConfigRoutes(app);

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
