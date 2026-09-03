import bcrypt from 'bcrypt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminUser } from '../db/schema.js';

const BCRYPT_ROUNDS = 12;

const credentialsSchema = z.object({
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
});

declare module 'fastify' {
  interface Session {
    authenticated?: boolean;
  }
}

/**
 * Auth-Routen für das Web-GUI: ein einzelner Admin-Login (siehe Plan,
 * Abschnitt "Web-GUI") statt Mehrbenutzer-System. Erststart läuft über
 * /setup, solange noch kein admin_user existiert.
 */
export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (request) => {
    const existing = app.db.select().from(adminUser).get();
    return {
      setupRequired: !existing,
      authenticated: Boolean(request.session.authenticated),
    };
  });

  app.post('/api/auth/setup', async (request, reply) => {
    const existing = app.db.select().from(adminUser).get();
    if (existing) {
      return reply.code(409).send({ error: 'Setup bereits abgeschlossen' });
    }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    app.db.insert(adminUser).values({ passwordHash }).run();
    request.session.authenticated = true;
    return { ok: true };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Ungültige Eingabe' });
    }
    const existing = app.db.select().from(adminUser).get();
    if (!existing) {
      return reply.code(409).send({ error: 'Setup noch nicht abgeschlossen' });
    }
    const valid = await bcrypt.compare(parsed.data.password, existing.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Passwort falsch' });
    }
    request.session.authenticated = true;
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request) => {
    request.session.authenticated = false;
    await request.session.destroy();
    return { ok: true };
  });
}

/** preHandler für alle geschützten API-Routen. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.session.authenticated) {
    reply.code(401).send({ error: 'Nicht angemeldet' });
  }
}
