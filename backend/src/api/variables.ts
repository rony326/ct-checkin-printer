import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { QR_CONTENT_DEFINITIONS, TEXT_FIELD_DEFINITIONS } from '../template/variables.js';

/** Für den Variablen-Picker im visuellen Editor (siehe Plan, "Variablen sollen im GUI auswählbar sein"). */
export async function registerVariableRoutes(app: FastifyInstance) {
  app.get('/api/variables', { preHandler: requireAuth }, async () => {
    return { textFields: TEXT_FIELD_DEFINITIONS, qrContents: QR_CONTENT_DEFINITIONS };
  });
}
