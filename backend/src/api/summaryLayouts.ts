import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { decryptSecret, encryptSecret, secretsEqual } from '../crypto/secrets.js';
import { summaryLayouts } from '../db/schema.js';
import type { GenerateSummaryResult } from '../orchestrator/SummaryReportService.js';
import { summaryDesignSchema } from '../rendering/summaryDesign.js';

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
  /** Gestaltung der A4-Liste. Bei PUT: weggelassen = unverändert, null = zurück auf die Standards, Objekt = ersetzt komplett. */
  designJson: summaryDesignSchema.nullable().optional(),
});
const updateSchema = createSchema.partial();

const triggerAdminSchema = z.object({ enabled: z.boolean().optional(), regenerateSecret: z.boolean().optional() });

function generateToken(): string {
  return randomBytes(16).toString('hex');
}
function generateSecret(): string {
  return randomBytes(24).toString('base64url');
}

/** Heute 00:00 Ortszeit. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Nie das verschlüsselte Taster-Secret nach aussen geben — nur, ob eines existiert. */
function withoutTriggerSecret(row: typeof summaryLayouts.$inferSelect) {
  const { triggerSecretEnc, ...rest } = row;
  return { ...rest, hasTriggerSecret: Boolean(triggerSecretEnc) };
}

const triggerSchema = z.object({ since: z.string().datetime().optional(), until: z.string().datetime().optional() });

export async function registerSummaryLayoutRoutes(app: FastifyInstance) {
  // Pro Layout höchstens ein laufender Sammelausdruck (GUI-Button und Hardware-Taster teilen sich die Sperre).
  const printing = new Set<number>();

  async function runLocked(id: number, run: () => Promise<GenerateSummaryResult>): Promise<GenerateSummaryResult | 'busy'> {
    if (printing.has(id)) return 'busy';
    printing.add(id);
    try {
      return await run();
    } finally {
      printing.delete(id);
    }
  }

  app.get('/api/summary-layouts', { preHandler: requireAuth }, async () => {
    return app.db.select().from(summaryLayouts).all().map(withoutTriggerSecret);
  });

  app.get('/api/summary-layouts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Sammel-Layout nicht gefunden' });
    return withoutTriggerSecret(row);
  });

  app.post('/api/summary-layouts', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    if (!parsed.data.printerId && !parsed.data.documentPrinterId) {
      return reply.code(400).send({ error: 'Entweder printerId (Endlosband) oder documentPrinterId (IPP) angeben' });
    }

    const [row] = app.db.insert(summaryLayouts).values(parsed.data).returning().all();
    return reply.code(201).send(withoutTriggerSecret(row!));
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
    return withoutTriggerSecret(app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get()!);
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

    const since = parsed.data.since ? new Date(parsed.data.since) : startOfToday();
    const until = parsed.data.until ? new Date(parsed.data.until) : new Date();

    const result = await runLocked(id, () => app.orchestrator.triggerManualSummary(id, since, until));
    if (result === 'busy') return reply.code(409).send({ error: 'Sammelausdruck läuft bereits' });
    return result;
  });

  // Admin: Taster-Zugang (Token/Secret/enabled) verwalten. Token und Secret werden beim ersten Aufruf gemeinsam erzeugt.
  app.post('/api/summary-layouts/:id/trigger', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = triggerAdminSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Eingabe' });

    const existing = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Sammel-Layout nicht gefunden' });

    const isNew = !existing.triggerToken || !existing.triggerSecretEnc;
    const newSecret = isNew || parsed.data.regenerateSecret ? generateSecret() : undefined;

    app.db
      .update(summaryLayouts)
      .set({
        triggerToken: existing.triggerToken ?? generateToken(),
        triggerEnabled: parsed.data.enabled ?? existing.triggerEnabled,
        ...(newSecret ? { triggerSecretEnc: encryptSecret(newSecret, app.env.ENCRYPTION_KEY) } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(summaryLayouts.id, id))
      .run();

    const updated = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get()!;
    return { triggerToken: updated.triggerToken, triggerEnabled: updated.triggerEnabled, ...(newSecret ? { secret: newSecret } : {}) };
  });

  app.get('/api/summary-layouts/:id/trigger/secret', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Sammel-Layout nicht gefunden' });
    return { secret: row.triggerSecretEnc ? decryptSecret(row.triggerSecretEnc, app.env.ENCRYPTION_KEY) : null };
  });

  // Öffentlich (kein requireAuth): der Hardware-Taster (Raspberry Pi) hat keine Session, Absicherung über Token+Secret.
  // Bewusst ohne Body-Schema — der Pi sendet ein POST ohne Body und ohne Content-Type.
  app.post('/api/summary-trigger/:token', async (request, reply) => {
    const token = (request.params as { token: string }).token;
    const row = app.db.select().from(summaryLayouts).where(eq(summaryLayouts.triggerToken, token)).get();
    if (!row || !row.triggerEnabled || !row.triggerSecretEnc) {
      return reply.code(404).send({ error: 'Unbekannter oder deaktivierter Endpunkt' });
    }

    const authHeader = request.headers.authorization;
    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    const expected = decryptSecret(row.triggerSecretEnc, app.env.ENCRYPTION_KEY);
    if (!provided || !secretsEqual(provided, expected)) {
      return reply.code(401).send({ error: 'Ungültiges oder fehlendes Secret' });
    }

    const result = await runLocked(row.id, () => app.orchestrator.triggerManualSummary(row.id, startOfToday(), new Date()));
    if (result === 'busy') return reply.code(409).send({ error: 'Sammelausdruck läuft bereits' });
    // ok:false kommt als HTTP 200 zurück und wäre im Access-Log unsichtbar.
    if (!result.ok) request.log.warn({ layoutId: row.id, message: result.message }, 'Sammelausdruck fehlgeschlagen');
    return result;
  });
}
