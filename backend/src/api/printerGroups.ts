import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { labelLayouts, printerGroups, printers } from '../db/schema.js';
import { parseActiveTimes } from '../schedule/activeTimes.js';
import { getAlsoLayoutIds } from './labelLayouts.js';

const legInputSchema = z.object({
  name: z.string().min(1),
  vendor: z.enum(['brother-ql', 'zebra-zpl']),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  layoutIds: z.array(z.number()).optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1),
  activeTimesMode: z.enum(['inherit', 'always', 'custom']).optional(),
  activeTimesExpr: z.string().optional(),
  checkEnabled: z.boolean().optional(),
  checkRetryMs: z.number().int().positive().optional(),
  statusWebhookEnabled: z.boolean().optional(),
  legs: z.array(legInputSchema).min(1),
});

const updateGroupSchema = createGroupSchema.omit({ legs: true }).partial();

function validateActiveTimes(mode: string | undefined, expr: string | undefined): string | null {
  if (mode !== 'custom') return null;
  try {
    parseActiveTimes(expr);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Ungültiges Zeitfenster';
  }
}

function legsWithRoutes(app: FastifyInstance, groupId: number) {
  return app.db
    .select()
    .from(printers)
    .where(eq(printers.groupId, groupId))
    .orderBy(asc(printers.id))
    .all()
    .map((leg) => ({
      ...leg,
      routes: app.db
        .select()
        .from(labelLayouts)
        .where(eq(labelLayouts.printerId, leg.id))
        .all()
        .map((route) => ({ ...route, alsoLayoutIds: getAlsoLayoutIds(app, route.id) })),
    }));
}

export async function registerPrinterGroupRoutes(app: FastifyInstance) {
  app.get('/api/printer-groups', { preHandler: requireAuth }, async () => {
    return app.db
      .select()
      .from(printerGroups)
      .all()
      .map((group) => ({
        ...group,
        legs: app.db.select().from(printers).where(eq(printers.groupId, group.id)).orderBy(asc(printers.id)).all(),
      }));
  });

  app.get('/api/printer-groups/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const group = app.db.select().from(printerGroups).where(eq(printerGroups.id, id)).get();
    if (!group) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    return { ...group, legs: legsWithRoutes(app, id) };
  });

  app.post('/api/printer-groups', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createGroupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const scheduleError = validateActiveTimes(parsed.data.activeTimesMode, parsed.data.activeTimesExpr);
    if (scheduleError) return reply.code(400).send({ error: scheduleError });

    const existing = app.db.select().from(printerGroups).where(eq(printerGroups.hostname, parsed.data.hostname)).get();
    if (existing) return reply.code(400).send({ error: `Hostname „${parsed.data.hostname}" wird bereits verwendet` });

    const requestedLayoutIds = parsed.data.legs.flatMap((leg) => leg.layoutIds ?? []);
    if (requestedLayoutIds.length > 0) {
      const foundLayouts = app.db.select().from(labelLayouts).where(inArray(labelLayouts.id, requestedLayoutIds)).all();
      if (foundLayouts.length !== requestedLayoutIds.length) return reply.code(400).send({ error: 'Unbekannte Etiketten-Layout-ID' });
      const alreadyAssigned = foundLayouts.find((l) => l.printerId !== null);
      if (alreadyAssigned) return reply.code(400).send({ error: `Layout "${alreadyAssigned.name}" ist bereits einem Drucker zugeordnet` });
    }

    const { legs, ...groupFields } = parsed.data;
    const [group] = app.db.insert(printerGroups).values(groupFields).returning().all();

    for (const legInput of legs) {
      const { layoutIds, ...legFields } = legInput;
      const [leg] = app.db.insert(printers).values({ ...legFields, groupId: group!.id }).returning().all();
      for (const layoutId of layoutIds ?? []) {
        app.db.update(labelLayouts).set({ printerId: leg!.id }).where(eq(labelLayouts.id, layoutId)).run();
      }
    }

    await app.orchestrator.reload();
    return reply.code(201).send({ ...group, legs: app.db.select().from(printers).where(eq(printers.groupId, group!.id)).orderBy(asc(printers.id)).all() });
  });

  app.post('/api/printer-groups/:id/legs', { preHandler: requireAuth }, async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const group = app.db.select().from(printerGroups).where(eq(printerGroups.id, groupId)).get();
    if (!group) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    const parsed = legInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const { layoutIds, ...legFields } = parsed.data;
    const [leg] = app.db.insert(printers).values({ ...legFields, groupId }).returning().all();
    for (const layoutId of layoutIds ?? []) {
      app.db.update(labelLayouts).set({ printerId: leg!.id }).where(eq(labelLayouts.id, layoutId)).run();
    }

    await app.orchestrator.reload();
    return reply.code(201).send(leg);
  });

  app.put('/api/printer-groups/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateGroupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(printerGroups).where(eq(printerGroups.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    const scheduleError = validateActiveTimes(parsed.data.activeTimesMode ?? existing.activeTimesMode, parsed.data.activeTimesExpr ?? existing.activeTimesExpr ?? undefined);
    if (scheduleError) return reply.code(400).send({ error: scheduleError });

    if (parsed.data.hostname && parsed.data.hostname !== existing.hostname) {
      const conflict = app.db.select().from(printerGroups).where(eq(printerGroups.hostname, parsed.data.hostname)).get();
      if (conflict) return reply.code(400).send({ error: `Hostname „${parsed.data.hostname}" wird bereits verwendet` });
    }

    app.db.update(printerGroups).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(printerGroups.id, id)).run();
    await app.orchestrator.reload();
    return app.db.select().from(printerGroups).where(eq(printerGroups.id, id)).get();
  });

  app.delete('/api/printer-groups/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    const legIds = app.db.select({ id: printers.id }).from(printers).where(eq(printers.groupId, id)).all().map((row) => row.id);
    if (legIds.length > 0) {
      app.db.update(labelLayouts).set({ printerId: null }).where(inArray(labelLayouts.printerId, legIds)).run();
      app.db.delete(printers).where(eq(printers.groupId, id)).run();
    }
    app.db.delete(printerGroups).where(eq(printerGroups.id, id)).run();
    await app.orchestrator.reload();
    return { ok: true };
  });
}
