import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { summaryLayouts } from '../db/schema.js';

const createSchema = z.object({
  name: z.string().min(1),
  /** Aktuell wird ausschliesslich nach `checkin.group` gruppiert — `print_log` (die Datenquelle) hat keine weiteren
   * gruppierbaren Felder gespeichert. Das Feld bleibt frei editierbar für spätere Erweiterung, wird aber vom
   * `SummaryReportService` derzeit ignoriert (siehe dort). */
  groupByField: z.string().min(1).optional(),
  printerId: z.number().nullable().optional(),
  documentPrinterId: z.number().nullable().optional(),
  columnsJson: z.array(z.enum(['name', 'code', 'checkinTime'])).optional(),
  titleTemplate: z.string().min(1).optional(),
  trigger: z.enum(['window_close', 'manual']).optional(),
  verifyAgainstCt: z.boolean().optional(),
});
const updateSchema = createSchema.partial();

const triggerSchema = z.object({ since: z.string().datetime().optional(), until: z.string().datetime().optional() });

export async function registerSummaryLayoutRoutes(app: FastifyInstance) {
  app.get('/api/summary-layouts', { preHandler: requireAuth }, async () => {
    return app.db.select().from(summaryLayouts).all();
  });

  app.get('/api/summary-layouts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Sammel-Layout nicht gefunden' });
    return row;
  });

  app.post('/api/summary-layouts', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    if (!parsed.data.printerId && !parsed.data.documentPrinterId) {
      return reply.code(400).send({ error: 'Entweder printerId (Endlosband) oder documentPrinterId (IPP) angeben' });
    }

    const [row] = app.db.insert(summaryLayouts).values(parsed.data).returning().all();
    return reply.code(201).send(row);
  });

  app.put('/api/summary-layouts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Sammel-Layout nicht gefunden' });

    app.db
      .update(summaryLayouts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(summaryLayouts.id, id))
      .run();
    return app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
  });

  app.delete('/api/summary-layouts/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    app.db.delete(summaryLayouts).where(eq(summaryLayouts.id, id)).run();
    return { ok: true };
  });

  // "Sammelausdruck jetzt drucken" (siehe Plan) — ohne Zeitraumangabe wird der heutige Tag (00:00 bis jetzt) verwendet.
  app.post('/api/summary-layouts/:id/print', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const existing = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Sammel-Layout nicht gefunden' });

    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const since = parsed.data.since ? new Date(parsed.data.since) : startOfToday;
    const until = parsed.data.until ? new Date(parsed.data.until) : new Date();

    const result = await app.orchestrator.triggerManualSummary(id, since, until);
    return result;
  });
}
