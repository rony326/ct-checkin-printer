import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { labelLayouts, printers } from '../db/schema.js';

const updateLegSchema = z.object({
  name: z.string().min(1).optional(),
  vendor: z.enum(['brother-ql', 'zebra-zpl']).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  mediaId: z.number().nullable().optional(),
});

export async function registerPrinterRoutes(app: FastifyInstance) {
  app.put('/api/printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateLegSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(printers).where(eq(printers.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Gerät nicht gefunden' });

    app.db.update(printers).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(printers.id, id)).run();
    await app.orchestrator.reload();
    return app.db.select().from(printers).where(eq(printers.id, id)).get();
  });

  app.delete('/api/printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const existing = app.db.select().from(printers).where(eq(printers.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Gerät nicht gefunden' });

    const siblingCount = app.db.select().from(printers).where(eq(printers.groupId, existing.groupId)).all().length;
    if (siblingCount <= 1) {
      return reply.code(400).send({ error: 'Letztes Gerät einer Gruppe kann nicht einzeln entfernt werden — dazu die ganze Druckergruppe löschen.' });
    }

    app.db.update(labelLayouts).set({ printerId: null }).where(eq(labelLayouts.printerId, id)).run();
    app.db.delete(printers).where(eq(printers.id, id)).run();
    await app.orchestrator.reload();
    return { ok: true };
  });
}
