import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { appConfig } from '../db/schema.js';
import { loadAppConfig, type AppConfigValues } from '../orchestrator/appConfig.js';
import { parseActiveTimes } from '../schedule/activeTimes.js';

const updateSchema = z.object({
  pollIdleMs: z.number().int().positive().optional(),
  pollActiveMs: z.number().int().positive().optional(),
  pollActiveTtlMs: z.number().int().positive().optional(),
  maxErrors: z.number().int().positive().optional(),
  pollerRestartDelayMs: z.number().int().positive().optional(),
  printerTimeoutMs: z.number().int().positive().optional(),
  activeTimesDefault: z.string().nullable().optional(),
  queueRetryMs: z.number().int().positive().optional(),
  queueMaxRetries: z.number().int().positive().optional(),
  queueMaxAgeMs: z.number().int().positive().optional(),
});

/** DB-Key je Feld (siehe orchestrator/appConfig.ts NUMERIC_KEYS, dort nicht exportiert). */
const KEY_BY_FIELD: Record<Exclude<keyof AppConfigValues, 'activeTimesDefault'>, string> = {
  pollIdleMs: 'poll_idle_ms',
  pollActiveMs: 'poll_active_ms',
  pollActiveTtlMs: 'poll_active_ttl_ms',
  maxErrors: 'max_errors',
  pollerRestartDelayMs: 'poller_restart_delay_ms',
  printerTimeoutMs: 'printer_timeout_ms',
  queueRetryMs: 'queue_retry_ms',
  queueMaxRetries: 'queue_max_retries',
  queueMaxAgeMs: 'queue_max_age_ms',
};

export async function registerAppConfigRoutes(app: FastifyInstance) {
  app.get('/api/app-config', { preHandler: requireAuth }, async () => {
    return loadAppConfig(app.db);
  });

  app.put('/api/app-config', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    if (parsed.data.activeTimesDefault) {
      try {
        parseActiveTimes(parsed.data.activeTimesDefault);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Ungültiges Zeitfenster' });
      }
    }

    for (const [field, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      const key = field === 'activeTimesDefault' ? 'active_times_default' : KEY_BY_FIELD[field as Exclude<keyof AppConfigValues, 'activeTimesDefault'>];
      const stringValue = field === 'activeTimesDefault' ? (value as string | null) ?? '' : String(value);
      app.db
        .insert(appConfig)
        .values({ key, value: stringValue })
        .onConflictDoUpdate({ target: appConfig.key, set: { value: stringValue } })
        .run();
    }

    await app.orchestrator.reload();
    return loadAppConfig(app.db);
  });
}
