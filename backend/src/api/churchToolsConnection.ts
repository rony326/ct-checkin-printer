import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ChurchToolsOldApiClient } from '../adapters/churchtools/ChurchToolsOldApiClient.js';
import { requireAuth } from '../auth/routes.js';
import { decryptSecret, encryptSecret } from '../crypto/secrets.js';
import { churchtoolsConnection } from '../db/schema.js';

const connectionSchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1),
  /** Nur bei Änderung mitgeben — leer/weggelassen lässt das gespeicherte Passwort unverändert. */
  password: z.string().min(1).optional(),
});

function getRow(app: FastifyInstance) {
  return app.db.select().from(churchtoolsConnection).get();
}

export async function registerChurchToolsConnectionRoutes(app: FastifyInstance) {
  app.get('/api/churchtools-connection', { preHandler: requireAuth }, async () => {
    const row = getRow(app);
    if (!row) return { configured: false };
    return { configured: true, baseUrl: row.baseUrl, username: row.username, hasLoginToken: Boolean(row.loginTokenEnc) };
  });

  app.put('/api/churchtools-connection', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = connectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = getRow(app);
    if (!parsed.data.password && !existing) {
      return reply.code(400).send({ error: 'Passwort erforderlich bei der ersten Einrichtung' });
    }

    const passwordEnc = parsed.data.password ? encryptSecret(parsed.data.password, app.env.ENCRYPTION_KEY) : existing!.passwordEnc;

    if (existing) {
      app.db
        .update(churchtoolsConnection)
        .set({
          baseUrl: parsed.data.baseUrl,
          username: parsed.data.username,
          passwordEnc,
          // Zugangsdaten geändert -> gespeichertes Login-Token wird ungültig, neu einloggen lassen.
          loginTokenEnc: parsed.data.password ? null : existing.loginTokenEnc,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(churchtoolsConnection.id, existing.id))
        .run();
    } else {
      app.db.insert(churchtoolsConnection).values({ baseUrl: parsed.data.baseUrl, username: parsed.data.username, passwordEnc }).run();
    }
    await app.orchestrator.reload();

    const row = getRow(app);
    return { configured: true, baseUrl: row!.baseUrl, username: row!.username, hasLoginToken: Boolean(row!.loginTokenEnc) };
  });

  app.post('/api/churchtools-connection/test', { preHandler: requireAuth }, async (request, reply) => {
    const bodySchema = z.object({ baseUrl: z.string().url().optional(), username: z.string().optional(), password: z.string().optional() });
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Eingabe' });

    const existing = getRow(app);
    const baseUrl = parsed.data.baseUrl ?? existing?.baseUrl;
    const username = parsed.data.username ?? existing?.username;
    const password = parsed.data.password ?? (existing ? decryptSecret(existing.passwordEnc, app.env.ENCRYPTION_KEY) : undefined);

    if (!baseUrl || !username || !password) {
      return reply.code(400).send({ error: 'ChurchTools-URL, Benutzername und Passwort werden benötigt' });
    }

    const client = new ChurchToolsOldApiClient({ baseUrl, username, password });
    try {
      await client.testLogin();
      return { success: true, message: 'Verbindung erfolgreich.' };
    } catch (err) {
      return reply.code(200).send({ success: false, message: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen' });
    }
  });
}
