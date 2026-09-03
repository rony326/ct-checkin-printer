import type { FastifyInstance } from 'fastify';
import { mediaTypes } from '../db/schema.js';
import { requireAuth } from '../auth/routes.js';

export async function registerMediaTypeRoutes(app: FastifyInstance) {
  app.get('/api/media-types', { preHandler: requireAuth }, async () => {
    return app.db.select().from(mediaTypes).all();
  });
}
