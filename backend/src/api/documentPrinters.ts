import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { documentPrinters } from '../db/schema.js';

const createSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  ippQueue: z.string().min(1).optional(),
});
const updateSchema = createSchema.partial();

export async function registerDocumentPrinterRoutes(app: FastifyInstance) {
  app.get('/api/document-printers', { preHandler: requireAuth }, async () => {
    return app.db.select().from(documentPrinters).all();
  });

  app.post('/api/document-printers', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    const [row] = app.db.insert(documentPrinters).values(parsed.data).returning().all();
    return reply.code(201).send(row);
  });

  app.put('/api/document-printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(documentPrinters).where(eq(documentPrinters.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    app.db
      .update(documentPrinters)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(documentPrinters.id, id))
      .run();
    return app.db.select().from(documentPrinters).where(eq(documentPrinters.id, id)).get();
  });

  app.delete('/api/document-printers/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    app.db.delete(documentPrinters).where(eq(documentPrinters.id, id)).run();
    return { ok: true };
  });
}
