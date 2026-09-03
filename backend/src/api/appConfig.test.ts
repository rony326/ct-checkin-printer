import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import type { Env } from '../env.js';
import { DEFAULT_APP_CONFIG } from '../orchestrator/appConfig.js';
import { buildServer } from './server.js';

let app: FastifyInstance;
let db: Db;
let tmpDir: string;
let sessionCookie: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ct-checkin-printer-test-'));
  const env: Env = {
    DB_PATH: path.join(tmpDir, 'test.db'),
    APP_PORT: 0,
    APP_HOST: '127.0.0.1',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(32).toString('base64'),
    LOG_LEVEL: 'error',
  };
  db = createDb(env.DB_PATH);
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../migrations') });

  app = await buildServer(db, env);
  await app.ready();

  const setupRes = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correcthorsebatterystaple' } });
  const cookie = setupRes.cookies.find((c) => c.name === 'sessionId')!;
  sessionCookie = `${cookie.name}=${cookie.value}`;
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(async () => {
  // Zurücksetzen, damit Tests sich nicht gegenseitig beeinflussen.
  await app.inject({
    method: 'PUT',
    url: '/api/app-config',
    headers: { cookie: sessionCookie },
    payload: { ...DEFAULT_APP_CONFIG },
  });
});

describe('GET /api/app-config', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/app-config' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the defaults when nothing was overridden', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/app-config', headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_APP_CONFIG);
  });
});

describe('PUT /api/app-config', () => {
  it('persists a partial update and leaves other fields untouched', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/app-config',
      headers: { cookie: sessionCookie },
      payload: { pollIdleMs: 20000, maxErrors: 3 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pollIdleMs).toBe(20000);
    expect(body.maxErrors).toBe(3);
    expect(body.pollActiveMs).toBe(DEFAULT_APP_CONFIG.pollActiveMs);
  });

  it('updates the same key on a second write instead of duplicating rows', async () => {
    await app.inject({ method: 'PUT', url: '/api/app-config', headers: { cookie: sessionCookie }, payload: { pollIdleMs: 11111 } });
    const res = await app.inject({ method: 'PUT', url: '/api/app-config', headers: { cookie: sessionCookie }, payload: { pollIdleMs: 22222 } });

    expect(res.json().pollIdleMs).toBe(22222);
  });

  it('accepts a valid global activeTimesDefault expression', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/app-config',
      headers: { cookie: sessionCookie },
      payload: { activeTimesDefault: 'Mo-Fr:08:00-17:00' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().activeTimesDefault).toBe('Mo-Fr:08:00-17:00');
  });

  it('rejects an invalid activeTimesDefault expression', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/app-config',
      headers: { cookie: sessionCookie },
      payload: { activeTimesDefault: 'nicht-valide' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-positive numeric field', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/app-config', headers: { cookie: sessionCookie }, payload: { pollIdleMs: -5 } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/app-config', payload: { pollIdleMs: 1000 } });
    expect(res.statusCode).toBe(401);
  });
});
