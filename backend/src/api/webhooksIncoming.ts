import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { decryptSecret, encryptSecret } from '../crypto/secrets.js';
import { webhooksIncoming } from '../db/schema.js';

const createSchema = z.object({ enabled: z.boolean().optional() });
const updateSchema = z.object({ enabled: z.boolean().optional(), regenerateSecret: z.boolean().optional() });

const incomingPayloadSchema = z.object({ hostname: z.string().min(1), data: z.string() });

function generateToken(): string {
  return randomBytes(16).toString('hex');
}
function generateSecret(): string {
  return randomBytes(24).toString('base64url');
}

function withoutSecret(row: typeof webhooksIncoming.$inferSelect) {
  const { secretEnc, ...rest } = row;
  return { ...rest, hasSecret: Boolean(secretEnc) };
}

/**
 * Gemeinsame Validierung für den öffentlichen Empfangs-Endpunkt und den
 * GUI-Testversand. Speist den Job in den PrintOrchestrator ein (Bauschritt 9,
 * siehe Plan, "Zukunfts-Notiz webhooks_incoming") — quittiert den Empfang
 * aber unabhängig vom Druckergebnis mit 200/`accepted`, damit ein
 * sendender Dienst (n8n o.ä.) nicht auf interne Druckfehler mit Retries
 * reagiert; Fehlschläge landen ohnehin in `print_log`/der Retry-Queue.
 */
async function handleIncomingPayload(app: FastifyInstance, token: string, providedSecret: string | undefined, body: unknown) {
  const row = app.db.select().from(webhooksIncoming).where(eq(webhooksIncoming.pathToken, token)).get();
  if (!row || !row.enabled) return { status: 404 as const, body: { error: 'Unbekannter oder deaktivierter Endpunkt' } };

  if (row.secretEnc) {
    const expected = decryptSecret(row.secretEnc, app.env.ENCRYPTION_KEY);
    if (providedSecret !== expected) return { status: 401 as const, body: { error: 'Ungültiges oder fehlendes Secret' } };
  }

  const parsed = incomingPayloadSchema.safeParse(body);
  if (!parsed.success) return { status: 400 as const, body: { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' } };

  app.log.info({ hostname: parsed.data.hostname }, 'Check-in-Job über eingehenden Webhook empfangen');
  const result = await app.orchestrator.handleIncomingJob(parsed.data.hostname, parsed.data.data);
  if (!result.ok) app.log.warn({ hostname: parsed.data.hostname, message: result.message }, 'Eingehender Webhook: Job konnte nicht verarbeitet werden');

  return { status: 200 as const, body: { accepted: true } };
}

export async function registerWebhookIncomingRoutes(app: FastifyInstance) {
  app.get('/api/webhooks/incoming', { preHandler: requireAuth }, async () => {
    return app.db.select().from(webhooksIncoming).all().map(withoutSecret);
  });

  app.post('/api/webhooks/incoming', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Eingabe' });

    const secret = generateSecret();
    const [row] = app.db
      .insert(webhooksIncoming)
      .values({ pathToken: generateToken(), secretEnc: encryptSecret(secret, app.env.ENCRYPTION_KEY), enabled: parsed.data.enabled ?? false })
      .returning()
      .all();
    return reply.code(201).send({ ...withoutSecret(row!), secret });
  });

  app.put('/api/webhooks/incoming/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Eingabe' });

    const existing = app.db.select().from(webhooksIncoming).where(eq(webhooksIncoming.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Endpunkt nicht gefunden' });

    let newSecret: string | undefined;
    if (parsed.data.regenerateSecret) newSecret = generateSecret();

    app.db
      .update(webhooksIncoming)
      .set({
        enabled: parsed.data.enabled ?? existing.enabled,
        ...(newSecret ? { secretEnc: encryptSecret(newSecret, app.env.ENCRYPTION_KEY) } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(webhooksIncoming.id, id))
      .run();

    const updated = app.db.select().from(webhooksIncoming).where(eq(webhooksIncoming.id, id)).get()!;
    return { ...withoutSecret(updated), ...(newSecret ? { secret: newSecret } : {}) };
  });

  app.delete('/api/webhooks/incoming/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    app.db.delete(webhooksIncoming).where(eq(webhooksIncoming.id, id)).run();
    return { ok: true };
  });

  app.get('/api/webhooks/incoming/:id/secret', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(webhooksIncoming).where(eq(webhooksIncoming.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Endpunkt nicht gefunden' });
    return { secret: row.secretEnc ? decryptSecret(row.secretEnc, app.env.ENCRYPTION_KEY) : null };
  });

  app.post('/api/webhooks/incoming/:id/test', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(webhooksIncoming).where(eq(webhooksIncoming.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Endpunkt nicht gefunden' });

    const secret = row.secretEnc ? decryptSecret(row.secretEnc, app.env.ENCRYPTION_KEY) : undefined;
    const result = await handleIncomingPayload(app, row.pathToken, secret, { hostname: 'TEST', data: 'name=Test\nid=0\ncode=0000' });
    return reply.code(result.status).send(result.body);
  });

  // Öffentlicher Empfangs-Endpunkt — bewusst NICHT hinter requireAuth (externe
  // Systeme wie n8n haben keine Session-Cookie), Absicherung über Token+Secret.
  app.post('/api/webhooks/in/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.params as { token: string }).token;
    const authHeader = request.headers.authorization;
    const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    const result = await handleIncomingPayload(app, token, providedSecret, request.body);
    return reply.code(result.status).send(result.body);
  });
}
