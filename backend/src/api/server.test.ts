import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PNG } from 'pngjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedMediaTypes } from '../db/seed.js';
import { createDb, type Db } from '../db/client.js';
import type { Env } from '../env.js';
import { buildServer } from './server.js';

let app: FastifyInstance;
let db: Db;
let tmpDir: string;
let sessionCookie: string;

async function login(): Promise<string> {
  const setupRes = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correcthorsebatterystaple' } });
  const cookie = setupRes.cookies.find((c) => c.name === 'sessionId');
  if (!cookie) throw new Error('Kein Session-Cookie nach Setup erhalten');
  return `${cookie.name}=${cookie.value}`;
}

function multipartRequest(fields: Record<string, string>, file: { field: string; filename: string; content: Buffer; type: string }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append(file.field, new Blob([file.content], { type: file.type }), file.filename);
  return form;
}

async function formToInjectPayload(form: FormData): Promise<{ payload: Buffer; contentType: string }> {
  const req = new Request('http://localhost/', { method: 'POST', body: form });
  const payload = Buffer.from(await req.arrayBuffer());
  const contentType = req.headers.get('content-type')!;
  return { payload, contentType };
}

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
  seedMediaTypes(db);

  app = await buildServer(db, env);
  await app.ready();
  sessionCookie = await login();
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/media-types', () => {
  it('liefert die geseedete Referenzliste', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/media-types', headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThan(20);
    expect(body.some((m: { externalId: string }) => m.externalId === '62')).toBe(true);
  });

  it('verweigert den Zugriff ohne Login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/media-types' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/variables', () => {
  it('liefert Text- und QR-Variablendefinitionen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/variables', headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.textFields.some((f: { path: string }) => f.path === 'person.name')).toBe(true);
    expect(body.qrContents.some((f: { path: string }) => f.path === 'qr:hash')).toBe(true);
  });
});

describe('Fonts API', () => {
  it('lädt eine Font hoch, listet sie und löscht sie wieder', async () => {
    const form = multipartRequest({ name: 'Meine Schrift' }, { field: 'file', filename: 'test.ttf', content: Buffer.from('fake-ttf-bytes'), type: 'font/ttf' });
    const { payload, contentType } = await formToInjectPayload(form);

    const uploadRes = await app.inject({ method: 'POST', url: '/api/fonts', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });
    expect(uploadRes.statusCode).toBe(201);
    const created = uploadRes.json();
    expect(created.name).toBe('Meine Schrift');

    const listRes = await app.inject({ method: 'GET', url: '/api/fonts', headers: { cookie: sessionCookie } });
    expect(listRes.json().some((f: { id: number }) => f.id === created.id)).toBe(true);

    const fileRes = await app.inject({ method: 'GET', url: `/api/fonts/${created.id}/file`, headers: { cookie: sessionCookie } });
    expect(fileRes.statusCode).toBe(200);
    expect(fileRes.rawPayload.toString()).toBe('fake-ttf-bytes');

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/fonts/${created.id}`, headers: { cookie: sessionCookie } });
    expect(deleteRes.statusCode).toBe(200);
  });

  it('lehnt eine Datei mit falscher Endung ab', async () => {
    const form = multipartRequest({}, { field: 'file', filename: 'evil.exe', content: Buffer.from('x'), type: 'application/octet-stream' });
    const { payload, contentType } = await formToInjectPayload(form);
    const res = await app.inject({ method: 'POST', url: '/api/fonts', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });
    expect(res.statusCode).toBe(400);
  });
});

describe('Logos API', () => {
  it('lädt ein Logo hoch und listet es', async () => {
    const png = new PNG({ width: 4, height: 4 });
    const form = multipartRequest({ name: 'Gemeindelogo' }, { field: 'file', filename: 'logo.png', content: PNG.sync.write(png), type: 'image/png' });
    const { payload, contentType } = await formToInjectPayload(form);

    const uploadRes = await app.inject({ method: 'POST', url: '/api/logos', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });
    expect(uploadRes.statusCode).toBe(201);
    const listRes = await app.inject({ method: 'GET', url: '/api/logos', headers: { cookie: sessionCookie } });
    expect(listRes.json().some((l: { name: string }) => l.name === 'Gemeindelogo')).toBe(true);
  });
});

describe('Label-Layouts API', () => {
  it('legt ein Layout an, aktualisiert es und liest es wieder', async () => {
    const mediaListRes = await app.inject({ method: 'GET', url: '/api/media-types', headers: { cookie: sessionCookie } });
    const mediaId = mediaListRes.json().find((m: { externalId: string }) => m.externalId === '62').id;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/label-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Kind-Etikett', ctTypeKey: 'child', mediaId },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.elementsJson).toEqual([]);

    const elements = [{ id: 'a', type: 'static', xMm: 5, yMm: 5, value: 'Hallo', fontSize: 30, bold: false, align: 'left' }];
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/label-layouts/${created.id}`,
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { elementsJson: elements },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().elementsJson).toEqual(elements);

    const getRes = await app.inject({ method: 'GET', url: `/api/label-layouts/${created.id}`, headers: { cookie: sessionCookie } });
    expect(getRes.json().elementsJson).toEqual(elements);
  });

  it('lehnt eine unbekannte mediaId beim Anlegen ab', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/label-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'X', ctTypeKey: 'x', mediaId: 999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rendert eine echte Vorschau-PNG über /preview', async () => {
    const mediaListRes = await app.inject({ method: 'GET', url: '/api/media-types', headers: { cookie: sessionCookie } });
    const media = mediaListRes.json().find((m: { externalId: string }) => m.externalId === '60x86');

    const elements = [
      { id: 'a', type: 'text', xMm: 5, yMm: 5, field: 'person.name', fontSize: 50, bold: true, align: 'left' },
      { id: 'b', type: 'qr', xMm: 5, yMm: 30, content: 'qr:hash', sizeMm: 20 },
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/api/label-layouts/preview',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { elements, mediaId: media.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    const png = PNG.sync.read(res.rawPayload);
    expect(png.width).toBeGreaterThan(100);
  });
});

function startFakeHttp(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('Printers API', () => {
  it('legt einen Drucker an, aktualisiert und löscht ihn wieder', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Empfang', hostname: 'B2', vendor: 'brother-ql', host: '192.168.1.50' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/printers/${created.id}`,
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { activeTimesMode: 'custom', activeTimesExpr: 'So:09:00-12:00' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().activeTimesExpr).toBe('So:09:00-12:00');

    const detailRes = await app.inject({ method: 'GET', url: `/api/printers/${created.id}`, headers: { cookie: sessionCookie } });
    expect(detailRes.json().routes).toEqual([]);

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/printers/${created.id}`, headers: { cookie: sessionCookie } });
    expect(deleteRes.statusCode).toBe(200);
  });

  it('lehnt ein ungültiges activeTimesExpr ab', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'X', hostname: 'B3', vendor: 'brother-ql', host: '192.168.1.51', activeTimesMode: 'custom', activeTimesExpr: 'Xx:99:00-10:00' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lehnt einen doppelten Hostname ab', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'A', hostname: 'DUP', vendor: 'brother-ql', host: '192.168.1.60' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'B', hostname: 'DUP', vendor: 'brother-ql', host: '192.168.1.61' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('hebt beim Löschen die Layout-Zuordnung auf statt das Layout zu löschen', async () => {
    const printerRes = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Temp', hostname: 'TEMP1', vendor: 'brother-ql', host: '192.168.1.70' },
    });
    const printer = printerRes.json();

    const layoutRes = await app.inject({
      method: 'POST',
      url: '/api/label-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Mit Drucker', ctTypeKey: 'x', printerId: printer.id },
    });
    const layout = layoutRes.json();

    await app.inject({ method: 'DELETE', url: `/api/printers/${printer.id}`, headers: { cookie: sessionCookie } });

    const layoutAfter = await app.inject({ method: 'GET', url: `/api/label-layouts/${layout.id}`, headers: { cookie: sessionCookie } });
    expect(layoutAfter.json().printerId).toBeNull();
  });
});

describe('Label-Layouts also[] (v1 also[])', () => {
  it('speichert und liest alsoLayoutIds', async () => {
    const layoutA = (
      await app.inject({ method: 'POST', url: '/api/label-layouts', headers: { cookie: sessionCookie, 'content-type': 'application/json' }, payload: { name: 'A', ctTypeKey: 'a' } })
    ).json();
    const layoutB = (
      await app.inject({ method: 'POST', url: '/api/label-layouts', headers: { cookie: sessionCookie, 'content-type': 'application/json' }, payload: { name: 'B', ctTypeKey: 'b' } })
    ).json();

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/label-layouts/${layoutA.id}`,
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { alsoLayoutIds: [layoutB.id] },
    });
    expect(updateRes.json().alsoLayoutIds).toEqual([layoutB.id]);

    const getRes = await app.inject({ method: 'GET', url: `/api/label-layouts/${layoutA.id}`, headers: { cookie: sessionCookie } });
    expect(getRes.json().alsoLayoutIds).toEqual([layoutB.id]);
  });
});

describe('ChurchTools-Verbindung', () => {
  let fakeCt: { server: Server; port: number };

  afterEach(() => {
    fakeCt?.server.close();
  });

  it('speichert die Verbindung verschlüsselt und meldet configured:true', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/churchtools-connection',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { baseUrl: 'https://example.church.tools', username: 'drucker', password: 'geheim123' },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({ method: 'GET', url: '/api/churchtools-connection', headers: { cookie: sessionCookie } });
    const body = getRes.json();
    expect(body.configured).toBe(true);
    expect(body.username).toBe('drucker');
    expect(body).not.toHaveProperty('password');
  });

  it('testet die Verbindung erfolgreich gegen einen simulierten ChurchTools-Server', async () => {
    fakeCt = await startFakeHttp((req, res) => {
      if (req.method === 'POST' && req.url?.startsWith('/api/login')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'success', personId: 1 }));
      } else {
        res.writeHead(404).end();
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/churchtools-connection/test',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { baseUrl: `http://127.0.0.1:${fakeCt.port}`, username: 'user', password: 'pass' },
    });
    expect(res.json().success).toBe(true);
  });

  it('meldet einen fehlgeschlagenen Verbindungstest ohne HTTP-Fehlerstatus', async () => {
    fakeCt = await startFakeHttp((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'error', message: 'Login fehlgeschlagen' }));
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/churchtools-connection/test',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { baseUrl: `http://127.0.0.1:${fakeCt.port}`, username: 'user', password: 'wrong' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });
});

describe('Outgoing-Webhooks API', () => {
  let fakeReceiver: { server: Server; port: number };

  afterEach(() => {
    fakeReceiver?.server.close();
  });

  it('legt einen Webhook an und verbirgt das Secret in der Liste', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/outgoing',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Prod', url: 'https://example.com/hook', secret: 'top-secret', retry: 2, retryMs: 10 },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json()).not.toHaveProperty('secretEnc');
    expect(createRes.json().hasSecret).toBe(true);

    const listRes = await app.inject({ method: 'GET', url: '/api/webhooks/outgoing', headers: { cookie: sessionCookie } });
    expect(listRes.json().some((w: { name: string }) => w.name === 'Prod')).toBe(true);
  });

  it('sendet einen echten Testversand an eine konfigurierte URL', async () => {
    let receivedAuth: string | undefined;
    fakeReceiver = await startFakeHttp((req, res) => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200).end();
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/webhooks/outgoing',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Test', url: `http://127.0.0.1:${fakeReceiver.port}/hook`, secret: 'abc', retry: 1, retryMs: 10 },
    });
    const created = createRes.json();

    const testRes = await app.inject({ method: 'POST', url: `/api/webhooks/outgoing/${created.id}/test`, headers: { cookie: sessionCookie } });
    expect(testRes.json().success).toBe(true);
    expect(receivedAuth).toBe('Bearer abc');
  });
});

describe('Incoming-Webhooks API', () => {
  it('legt einen Endpunkt an und liefert das Secret einmalig direkt zurück', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/incoming',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().secret).toBeDefined();
    expect(res.json().pathToken).toBeDefined();
  });

  it('nimmt einen Job über den öffentlichen Endpunkt mit korrektem Secret an', async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/webhooks/incoming', headers: { cookie: sessionCookie, 'content-type': 'application/json' }, payload: { enabled: true } })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/in/${created.pathToken}`,
      headers: { authorization: `Bearer ${created.secret}`, 'content-type': 'application/json' },
      payload: { hostname: 'B2', data: 'name=Max\nid=1\ncode=AB12' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
  });

  it('lehnt den öffentlichen Endpunkt mit falschem Secret ab', async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/webhooks/incoming', headers: { cookie: sessionCookie, 'content-type': 'application/json' }, payload: { enabled: true } })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/in/${created.pathToken}`,
      headers: { authorization: 'Bearer falsch', 'content-type': 'application/json' },
      payload: { hostname: 'B2', data: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lehnt einen deaktivierten Endpunkt ab', async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/webhooks/incoming', headers: { cookie: sessionCookie, 'content-type': 'application/json' }, payload: { enabled: false } })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/in/${created.pathToken}`,
      headers: { authorization: `Bearer ${created.secret}`, 'content-type': 'application/json' },
      payload: { hostname: 'B2', data: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GUI-Testversand nutzt denselben Validierungspfad wie der echte Endpunkt', async () => {
    const created = (
      await app.inject({ method: 'POST', url: '/api/webhooks/incoming', headers: { cookie: sessionCookie, 'content-type': 'application/json' }, payload: { enabled: true } })
    ).json();
    const res = await app.inject({ method: 'POST', url: `/api/webhooks/incoming/${created.id}/test`, headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
  });
});

describe('Document-Printers API', () => {
  it('legt einen Dokumentendrucker an und listet ihn', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/document-printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Büro-Drucker', host: '192.168.1.80' },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().port).toBe(631);

    const listRes = await app.inject({ method: 'GET', url: '/api/document-printers', headers: { cookie: sessionCookie } });
    expect(listRes.json().some((d: { name: string }) => d.name === 'Büro-Drucker')).toBe(true);
  });
});

describe('Summary-Layouts API', () => {
  it('legt ein Sammel-Layout mit einem Endlosband-Zieldrucker an und liefert die Default-Spalten', async () => {
    const printerRes = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Sammelband', hostname: 'SAMMEL1', vendor: 'brother-ql', host: '192.168.1.90' },
    });
    const printerId = printerRes.json().id;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/summary-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Kids-Sammelzettel', printerId },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().columnsJson).toEqual(['name', 'code', 'checkinTime']);
    expect(createRes.json().trigger).toBe('manual');

    const listRes = await app.inject({ method: 'GET', url: '/api/summary-layouts', headers: { cookie: sessionCookie } });
    expect(listRes.json().some((l: { name: string }) => l.name === 'Kids-Sammelzettel')).toBe(true);
  });

  it('lehnt ein Sammel-Layout ohne jedes Zielgerät ab', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/summary-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Ohne Ziel' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('aktualisiert und löscht ein Sammel-Layout', async () => {
    const docPrinterRes = await app.inject({
      method: 'POST',
      url: '/api/document-printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Sammel-Büro', host: '192.168.1.91' },
    });
    const documentPrinterId = docPrinterRes.json().id;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/summary-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Teens-Sammelzettel', documentPrinterId },
    });
    const id = createRes.json().id;

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/summary-layouts/${id}`,
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { trigger: 'window_close' },
    });
    expect(updateRes.json().trigger).toBe('window_close');

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/summary-layouts/${id}`, headers: { cookie: sessionCookie } });
    expect(deleteRes.json()).toEqual({ ok: true });
  });

  it('meldet "Sammel-Layout nicht gefunden" für eine unbekannte ID beim manuellen Trigger', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/summary-layouts/999999/print', headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('ruft den Orchestrator für den manuellen Trigger auf (hier: noop-Orchestrator ohne laufenden Dienst)', async () => {
    const printerRes = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Sammelband2', hostname: 'SAMMEL2', vendor: 'brother-ql', host: '192.168.1.92' },
    });
    const printerId = printerRes.json().id;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/summary-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Trigger-Test', printerId },
    });
    const id = createRes.json().id;

    const res = await app.inject({ method: 'POST', url: `/api/summary-layouts/${id}/print`, headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, message: 'Orchestrator nicht verfügbar', groupsPrinted: 0 });
  });
});

describe('Auth API', () => {
  it('rejects protected routes without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/printers' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects protected routes with a garbage cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/printers', headers: { cookie: 'sessionId=not-a-real-session' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a second /setup once an admin already exists (setup already ran in beforeAll)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'irrelevant-but-8-chars' } });
    expect(res.statusCode).toBe(409);
  });

  it('reports setupRequired:false and authenticated:false for an anonymous request', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.json()).toEqual({ setupRequired: false, authenticated: false });
  });

  it('reports authenticated:true for a request carrying a valid session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: sessionCookie } });
    expect(res.json()).toEqual({ setupRequired: false, authenticated: true });
  });

  it('rejects login with a wrong password', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'totally-wrong-password' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login with a too-short password before even checking it against the hash', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'short' } });
    expect(res.statusCode).toBe(400);
  });

  it('logs in with the correct password and the resulting cookie authorizes protected routes', async () => {
    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correcthorsebatterystaple' } });
    expect(loginRes.statusCode).toBe(200);
    const cookie = loginRes.cookies.find((c) => c.name === 'sessionId');
    expect(cookie).toBeDefined();

    const protectedRes = await app.inject({ method: 'GET', url: '/api/printers', headers: { cookie: `${cookie!.name}=${cookie!.value}` } });
    expect(protectedRes.statusCode).toBe(200);
  });

  it('logout destroys the session so it no longer authorizes protected routes', async () => {
    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correcthorsebatterystaple' } });
    const cookie = loginRes.cookies.find((c) => c.name === 'sessionId')!;
    const ownCookie = `${cookie.name}=${cookie.value}`;

    const logoutRes = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: ownCookie } });
    expect(logoutRes.json()).toEqual({ ok: true });

    const afterLogout = await app.inject({ method: 'GET', url: '/api/printers', headers: { cookie: ownCookie } });
    expect(afterLogout.statusCode).toBe(401);

    // Die für den Rest der Testsuite geteilte `sessionCookie` bleibt von diesem isolierten Login/Logout unberührt.
    const sharedStillWorks = await app.inject({ method: 'GET', url: '/api/printers', headers: { cookie: sessionCookie } });
    expect(sharedStillWorks.statusCode).toBe(200);
  });
});
