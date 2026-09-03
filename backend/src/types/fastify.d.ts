import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import type { OrchestratorLike } from '../orchestrator/orchestratorLike.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    env: Env;
    orchestrator: OrchestratorLike;
  }
}
