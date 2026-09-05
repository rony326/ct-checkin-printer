import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import type { Env } from '../env.js';
import { labelLayouts, printerGroups, printers } from '../db/schema.js';
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

afterEach(() => {
  db.delete(labelLayouts).run();
  db.delete(printers).run();
  db.delete(printerGroups).run();
});

function authed(overrides: Record<string, unknown> = {}) {
  return { headers: { cookie: sessionCookie }, ...overrides };
}

describe('POST /api/printer-groups', () => {
  it('creates a single-leg group ("Einzel-Drucker")', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      ...authed(),
      payload: { name: 'Empfang', hostname: 'A1', legs: [{ name: 'Empfang', vendor: 'brother-ql', host: '10.0.0.1' }] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.hostname).toBe('A1');
    expect(body.legs).toHaveLength(1);
  });

  it('creates a multi-leg group ("Router-Drucker") atomically, with a layout assignment inline', async () => {
    const [layout] = db.insert(labelLayouts).values({ name: 'Kind-Etikett', ctTypeKey: 'child' }).returning().all();

    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      ...authed(),
      payload: {
        name: 'Kind',
        hostname: 'B2',
        legs: [
          { name: 'Kind', vendor: 'brother-ql', host: '10.0.0.10', layoutIds: [layout!.id] },
          { name: 'Eltern', vendor: 'zebra-zpl', host: '10.0.0.11' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.legs).toHaveLength(2);

    const updatedLayout = db.select().from(labelLayouts).where(eq(labelLayouts.id, layout!.id)).get();
    expect(updatedLayout!.printerId).toBe(body.legs[0].id);
  });

  it('rejects a duplicate hostname', async () => {
    await app.inject({ method: 'POST', url: '/api/printer-groups', ...authed(), payload: { name: 'A', hostname: 'DUP', legs: [{ name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }] } });
    const res = await app.inject({ method: 'POST', url: '/api/printer-groups', ...authed(), payload: { name: 'B', hostname: 'DUP', legs: [{ name: 'B', vendor: 'brother-ql', host: '10.0.0.2' }] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects zero legs', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/printer-groups', ...authed(), payload: { name: 'A', hostname: 'E1', legs: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a layoutId that is already assigned elsewhere', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'X', hostname: 'X1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'X', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [layout] = db.insert(labelLayouts).values({ name: 'Belegt', ctTypeKey: 'child', printerId: leg!.id }).returning().all();

    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      ...authed(),
      payload: { name: 'Y', hostname: 'Y1', legs: [{ name: 'Y', vendor: 'brother-ql', host: '10.0.0.2', layoutIds: [layout!.id] }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/printer-groups', payload: { name: 'A', hostname: 'E2', legs: [{ name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }] } });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/printer-groups', () => {
  it('lists groups with embedded legs', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    const res = await app.inject({ method: 'GET', url: '/api/printer-groups', ...authed() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].legs).toHaveLength(1);
  });
});

describe('GET /api/printer-groups/:id', () => {
  it('includes each leg`s assigned layouts', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    db.insert(labelLayouts).values({ name: 'Kind-Etikett', ctTypeKey: 'child', printerId: leg!.id }).run();

    const res = await app.inject({ method: 'GET', url: `/api/printer-groups/${group!.id}`, ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().legs[0].routes).toHaveLength(1);
  });
});

describe('POST /api/printer-groups/:id/legs', () => {
  it('adds a leg to an existing group', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    const res = await app.inject({ method: 'POST', url: `/api/printer-groups/${group!.id}/legs`, ...authed(), payload: { name: 'B', vendor: 'zebra-zpl', host: '10.0.0.2' } });
    expect(res.statusCode).toBe(201);

    const legs = db.select().from(printers).where(eq(printers.groupId, group!.id)).all();
    expect(legs).toHaveLength(2);
  });

  it('rejects an unknown layoutIds entry', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();

    const res = await app.inject({
      method: 'POST',
      url: `/api/printer-groups/${group!.id}/legs`,
      ...authed(),
      payload: { name: 'B', vendor: 'zebra-zpl', host: '10.0.0.2', layoutIds: [999999] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Unbekannte Etiketten-Layout-ID');
  });

  it('rejects a layoutId that is already assigned to a different printer', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [layout] = db.insert(labelLayouts).values({ name: 'Belegt', ctTypeKey: 'child', printerId: leg!.id }).returning().all();

    const res = await app.inject({
      method: 'POST',
      url: `/api/printer-groups/${group!.id}/legs`,
      ...authed(),
      payload: { name: 'B', vendor: 'zebra-zpl', host: '10.0.0.2', layoutIds: [layout!.id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Layout "Belegt" ist bereits einem Drucker zugeordnet');
  });
});

describe('DELETE /api/printer-groups/:id', () => {
  it('deletes the group and all its legs, unassigning their layouts', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [layout] = db.insert(labelLayouts).values({ name: 'X', ctTypeKey: 'child', printerId: leg!.id }).returning().all();

    const res = await app.inject({ method: 'DELETE', url: `/api/printer-groups/${group!.id}`, ...authed() });
    expect(res.statusCode).toBe(200);

    expect(db.select().from(printers).all()).toHaveLength(0);
    expect(db.select().from(printerGroups).all()).toHaveLength(0);
    expect(db.select().from(labelLayouts).all()[0]!.printerId).toBeNull();
  });
});

describe('DELETE /api/printers/:id', () => {
  it('rejects removing the last leg of a group', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();

    const res = await app.inject({ method: 'DELETE', url: `/api/printers/${leg!.id}`, ...authed() });
    expect(res.statusCode).toBe(400);
  });

  it('allows removing one of several legs', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).run();
    const [legB] = db.insert(printers).values({ groupId: group!.id, name: 'B', vendor: 'zebra-zpl', host: '10.0.0.2' }).returning().all();

    const res = await app.inject({ method: 'DELETE', url: `/api/printers/${legB!.id}`, ...authed() });
    expect(res.statusCode).toBe(200);
  });
});
