import { buildServer } from './api/server.js';
import { createDb } from './db/client.js';
import { seedMediaTypes } from './db/seed.js';
import { loadEnv } from './env.js';
import { PrintOrchestrator } from './orchestrator/PrintOrchestrator.js';

async function main() {
  const env = loadEnv();
  const db = createDb(env.DB_PATH);
  seedMediaTypes(db);
  const orchestrator = new PrintOrchestrator({ db, env });
  const app = await buildServer(db, env, orchestrator);

  await orchestrator.start();
  await app.listen({ host: env.APP_HOST, port: env.APP_PORT });
  app.log.info(`ct-checkin-printer v2 läuft auf http://${env.APP_HOST}:${env.APP_PORT}`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} — fahre herunter...`);
    await orchestrator.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
