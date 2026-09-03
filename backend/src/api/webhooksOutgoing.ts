import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { decryptSecret, encryptSecret } from '../crypto/secrets.js';
import { webhooksOutgoing } from '../db/schema.js';
import { sendWebhook } from '../webhooks/sendWebhook.js';

const createSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  method: z.string().min(1).optional(),
  secret: z.string().optional(),
  retry: z.number().int().positive().optional(),
  retryMs: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  eventScope: z.enum(['checkin', 'status', 'both']).optional(),
});

const updateSchema = createSchema.partial();

function withoutSecret(row: typeof webhooksOutgoing.$inferSelect) {
  const { secretEnc, ...rest } = row;
  return { ...rest, hasSecret: Boolean(secretEnc) };
}

export async function registerWebhookOutgoingRoutes(app: FastifyInstance) {
  app.get('/api/webhooks/outgoing', { preHandler: requireAuth }, async () => {
    return app.db.select().from(webhooksOutgoing).all().map(withoutSecret);
  });

  app.post('/api/webhooks/outgoing', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const { secret, ...values } = parsed.data;
    const [row] = app.db
      .insert(webhooksOutgoing)
      .values({ ...values, secretEnc: secret ? encryptSecret(secret, app.env.ENCRYPTION_KEY) : null })
      .returning()
      .all();
    return reply.code(201).send(withoutSecret(row!));
  });

  app.put('/api/webhooks/outgoing/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(webhooksOutgoing).where(eq(webhooksOutgoing.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Webhook nicht gefunden' });

    const { secret, ...values } = parsed.data;
    app.db
      .update(webhooksOutgoing)
      .set({
        ...values,
        ...(secret !== undefined ? { secretEnc: secret ? encryptSecret(secret, app.env.ENCRYPTION_KEY) : null } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(webhooksOutgoing.id, id))
      .run();
    return withoutSecret(app.db.select().from(webhooksOutgoing).where(eq(webhooksOutgoing.id, id)).get()!);
  });

  app.delete('/api/webhooks/outgoing/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    app.db.delete(webhooksOutgoing).where(eq(webhooksOutgoing.id, id)).run();
    return { ok: true };
  });

  app.post('/api/webhooks/outgoing/:id/test', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = app.db.select().from(webhooksOutgoing).where(eq(webhooksOutgoing.id, id)).get();
    if (!row) return reply.code(404).send({ error: 'Webhook nicht gefunden' });

    const result = await sendWebhook({
      url: row.url,
      method: row.method,
      secret: row.secretEnc ? decryptSecret(row.secretEnc, app.env.ENCRYPTION_KEY) : null,
      retry: 1,
      retryMs: row.retryMs,
      body: {
        event: 'test',
        timestamp: Math.floor(Date.now() / 1000),
        message: 'Testanfrage von ct-checkin-printer',
      },
    });
    return result;
  });
}
