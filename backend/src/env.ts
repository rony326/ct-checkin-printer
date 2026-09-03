import { z } from 'zod';

/**
 * Nur technische Bootstrap-Werte, die zwingend vor DB-Zugriff nötig sind.
 * Alle fachlichen Einstellungen (ChurchTools, Drucker, Webhooks, ...) leben
 * verschlüsselt in der DB und werden über das Web-GUI verwaltet, siehe
 * /config/.claude/plans/cozy-fluttering-cray.md.
 */
const envSchema = z.object({
  DB_PATH: z.string().default('./data/app.db'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  APP_HOST: z.string().default('0.0.0.0'),
  ENCRYPTION_KEY: z
    .string()
    .min(1, 'ENCRYPTION_KEY fehlt — z.B. mit `openssl rand -base64 32` erzeugen'),
  SESSION_SECRET: z
    .string()
    .min(1, 'SESSION_SECRET fehlt — z.B. mit `openssl rand -base64 32` erzeugen'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Umgebungsvariablen:\n${issues}`);
  }
  return result.data;
}
