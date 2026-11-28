import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db/client.js';
import type { Env } from '../env.js';
import { buildServer } from './server.js';

const PASSWORD = 'correcthorsebatterystaple';
const MINUTE = 60_000;

let app: FastifyInstance;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ct-security-test-'));
  const env: Env = {
    DB_PATH: path.join(tmpDir, 'test.db'),
    APP_PORT: 0,
    APP_HOST: '127.0.0.1',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(32).toString('base64'),
    LOG_LEVEL: 'error',
  };
  const db = createDb(env.DB_PATH);
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../migrations') });
  app = await buildServer(db, env);
  await app.ready();
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type Response = Awaited<ReturnType<FastifyInstance['inject']>>;

function cookieOf(res: Response): string {
  const cookie = res.cookies.find((c) => c.name === 'sessionId');
  if (!cookie) throw new Error('Kein Session-Cookie erhalten');
  return `${cookie.name}=${cookie.value}`;
}

const setup = () => app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: PASSWORD } });
const login = (password: string, options: { cookie?: string; ip?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
    headers: options.cookie ? { cookie: options.cookie } : {},
    remoteAddress: options.ip ?? '10.0.0.1',
  });
const protectedStatus = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/logos', headers: { cookie } })).statusCode;

describe('Sitzung bei der Anmeldung', () => {
  it.each([
    ['Anmeldung', async (cookie: string) => (await setup(), login(PASSWORD, { cookie }))],
    ['Ersteinrichtung', async (cookie: string) => app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: PASSWORD }, headers: { cookie } })],
  ])('gibt bei der %s ein neues Cookie aus und wertet das alte nicht auf', async (_label, authenticate) => {
    const before = cookieOf(await app.inject({ method: 'GET', url: '/api/auth/status' }));

    const res = await authenticate(before);

    expect(res.statusCode).toBe(200);
    expect(cookieOf(res)).not.toBe(before);
    expect(await protectedStatus(cookieOf(res))).toBe(200);
    expect(await protectedStatus(before)).toBe(401);
  });
});

describe('Begrenzung der Fehlversuche', () => {
  const failTimes = async (count: number, ip = '10.0.0.1') => {
    const codes: number[] = [];
    for (let i = 0; i < count; i++) codes.push((await login('falsches-passwort', { ip })).statusCode);
    return codes;
  };

  it('sperrt nach 10 Fehlversuchen, auch das richtige Passwort', { timeout: 30_000 }, async () => {
    await setup();

    expect(await failTimes(10)).toEqual(Array(10).fill(401));
    const blocked = await login(PASSWORD);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(14 * 60);
  });

  it('zählt auch gleichzeitige Versuche', { timeout: 30_000 }, async () => {
    await setup();

    const codes = (await Promise.all(Array.from({ length: 25 }, () => login('falsches-passwort')))).map((r) => r.statusCode);

    expect(codes.filter((c) => c === 401)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(15);
  });

  it('sperrt nur die betroffene Adresse', { timeout: 30_000 }, async () => {
    await setup();
    await failTimes(11);

    expect((await login(PASSWORD, { ip: '10.0.0.2' })).statusCode).toBe(200);
  });

  it('gibt die Adresse nach 15 Minuten wieder frei', { timeout: 30_000 }, async () => {
    await setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    await failTimes(10);

    vi.setSystemTime(Date.now() + 14 * MINUTE);
    expect((await login(PASSWORD)).statusCode).toBe(429);
    vi.setSystemTime(Date.now() + MINUTE + 1000);

    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it('beginnt nach einer erfolgreichen Anmeldung von vorn', { timeout: 30_000 }, async () => {
    await setup();
    await failTimes(9);
    expect((await login(PASSWORD)).statusCode).toBe(200);

    expect(await failTimes(10)).toEqual(Array(10).fill(401));
  });
});

describe('Sicherheits-Header', () => {
  it.each(['/', '/api/health', '/api/gibt-es-nicht'])('setzt sie auf %s', async (url) => {
    const res = await app.inject({ method: 'GET', url });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('Gespeichertes ChurchTools-Passwort', () => {
  const STORED = 'https://gemeinde.church.tools';
  const OTHER = 'https://fremd.example.org';
  const MESSAGE = 'Bei geänderter ChurchTools-Adresse muss das Passwort neu eingegeben werden.';
  let cookie: string;

  const save = (payload: object) => app.inject({ method: 'PUT', url: '/api/churchtools-connection', headers: { cookie }, payload });
  const test = (payload: object) => app.inject({ method: 'POST', url: '/api/churchtools-connection/test', headers: { cookie }, payload });
  const stored = async () => (await app.inject({ method: 'GET', url: '/api/churchtools-connection', headers: { cookie } })).json();

  beforeEach(async () => {
    cookie = cookieOf(await setup());
    expect((await save({ baseUrl: STORED, username: 'drucker', password: 'geheim123' })).statusCode).toBe(200);
  });

  it.each([OTHER, 'http://gemeinde.church.tools', 'https://gemeinde.church.tools:8443', 'https://gemeinde.church.tools@fremd.example.org'])(
    'wird beim Speichern nicht an die neue Adresse %s weitergegeben',
    async (baseUrl) => {
      const res = await save({ baseUrl, username: 'drucker' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(MESSAGE);
      expect((await stored()).baseUrl).toBe(STORED);
    },
  );

  it('wird beim Verbindungstest nicht an eine andere Adresse gesendet', async () => {
    const res = await test({ baseUrl: OTHER });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(MESSAGE);
  });

  it('bleibt erhalten, wenn sich die Adresse nur in der Schreibweise unterscheidet', async () => {
    expect((await save({ baseUrl: 'https://Gemeinde.church.tools/', username: 'anderer' })).statusCode).toBe(200);
  });

  it('erlaubt eine neue Adresse mit neu eingegebenem Passwort', async () => {
    expect((await save({ baseUrl: OTHER, username: 'drucker', password: 'neu-eingegeben' })).statusCode).toBe(200);
    expect((await stored()).baseUrl).toBe(OTHER);
  });
});
