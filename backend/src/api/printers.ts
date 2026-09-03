import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { labelLayouts, printers } from '../db/schema.js';
import { parseActiveTimes } from '../schedule/activeTimes.js';
import { getAlsoLayoutIds } from './labelLayouts.js';

const createPrinterSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1),
  vendor: z.enum(['brother-ql', 'zebra-zpl']),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  activeTimesMode: z.enum(['inherit', 'always', 'custom']).optional(),
  activeTimesExpr: z.string().optional(),
  checkEnabled: z.boolean().optional(),
  checkRetryMs: z.number().int().positive().optional(),
  statusWebhookEnabled: z.boolean().optional(),
  mediaId: z.number().optional(),
});

const updatePrinterSchema = createPrinterSchema.partial();

function validateActiveTimes(mode: string | undefined, expr: string | undefined): string | null {
  if (mode !== 'custom') return null;
  try {
    parseActiveTimes(expr);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Ungültiges Zeitfenster';
  }
}

export async function registerPrinterRoutes(app: FastifyInstance) {
  app.get('/api/printers', { preHandler: requireAuth }, async () => {
    return app.db.select().from(printers).all();
  });

  app.get('/api/printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const printer = app.db.select().from(printers).where(eq(printers.id, id)).get();
    if (!printer) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    const routes = app.db
      .select()
      .from(labelLayouts)
      .where(eq(labelLayouts.printerId, id))
      .all()
      .map((route) => ({ ...route, alsoLayoutIds: getAlsoLayoutIds(app, route.id) }));
    return { ...printer, routes };
  });

  app.post('/api/printers', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createPrinterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const scheduleError = validateActiveTimes(parsed.data.activeTimesMode, parsed.data.activeTimesExpr);
    if (scheduleError) return reply.code(400).send({ error: scheduleError });

    const existing = app.db.select().from(printers).where(eq(printers.hostname, parsed.data.hostname)).get();
    if (existing) return reply.code(400).send({ error: `Hostname „${parsed.data.hostname}" wird bereits verwendet` });

    const [row] = app.db.insert(printers).values(parsed.data).returning().all();
    await app.orchestrator.reload();
    return reply.code(201).send(row);
  });

  app.put('/api/printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updatePrinterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(printers).where(eq(printers.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    const scheduleError = validateActiveTimes(parsed.data.activeTimesMode ?? existing.activeTimesMode, parsed.data.activeTimesExpr ?? existing.activeTimesExpr ?? undefined);
    if (scheduleError) return reply.code(400).send({ error: scheduleError });

    if (parsed.data.hostname && parsed.data.hostname !== existing.hostname) {
      const conflict = app.db.select().from(printers).where(eq(printers.hostname, parsed.data.hostname)).get();
      if (conflict) return reply.code(400).send({ error: `Hostname „${parsed.data.hostname}" wird bereits verwendet` });
    }

    app.db
      .update(printers)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(printers.id, id))
      .run();
    await app.orchestrator.reload();
    return app.db.select().from(printers).where(eq(printers.id, id)).get();
  });

  app.delete('/api/printers/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    // Zugeordnete Layouts nicht mitlöschen — nur die Zuordnung aufheben (Layout bleibt als Entwurf erhalten).
    app.db.update(labelLayouts).set({ printerId: null }).where(eq(labelLayouts.printerId, id)).run();
    app.db.delete(printers).where(eq(printers.id, id)).run();
    await app.orchestrator.reload();
    return { ok: true };
  });
}
