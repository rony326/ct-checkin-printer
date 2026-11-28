import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedMediaTypes } from '../db/seed.js';
import { createDb, type Db } from '../db/client.js';
import type { Env } from '../env.js';
import { printerGroups, printers } from '../db/schema.js';
import type { GenerateSummaryResult } from '../orchestrator/SummaryReportService.js';
import { noopOrchestrator, type OrchestratorLike } from '../orchestrator/orchestratorLike.js';
import { DEFAULT_SUMMARY_DESIGN } from '../rendering/summaryDesign.js';
import { renderSummaryPdf } from '../rendering/SummaryRenderer.js';
import { mmToPx, VENDOR_DPI } from '../rendering/dimensions.js';
import { buildServer } from './server.js';

// Der echte Renderer läuft weiter — der Spion zeigt nur, womit er aufgerufen wird.
vi.mock('../rendering/SummaryRenderer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rendering/SummaryRenderer.js')>();
  return { ...actual, renderSummaryPdf: vi.fn(actual.renderSummaryPdf) };
});

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

describe('Druckschrift für den Editor', () => {
  it.each(['regular', 'bold'])('liefert die mitgelieferte Schrift %s als TrueType-Datei', async (variant) => {
    const res = await app.inject({ method: 'GET', url: `/api/fonts/default/${variant}`, headers: { cookie: sessionCookie } });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^font\/ttf/);
    expect(res.rawPayload.readUInt32BE(0)).toBe(0x00010000);
  });

  it('verweigert den Zugriff ohne Login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fonts/default/regular' });
    expect(res.statusCode).toBe(401);
  });

  it.each(['italic', 'constructor'])('kennt die Variante %s nicht', async (variant) => {
    const res = await app.inject({ method: 'GET', url: `/api/fonts/default/${variant}`, headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Schrift nicht gefunden');
  });
});

describe('Logos API', () => {
  it.each([
    ['kaputt.png', Buffer.from('kein Bild')],
    ['rumpf.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])],
  ])('lehnt die defekte Datei %s beim Hochladen ab', async (filename, content) => {
    const form = multipartRequest({ name: filename }, { field: 'file', filename, content, type: 'image/png' });
    const { payload, contentType } = await formToInjectPayload(form);

    const res = await app.inject({ method: 'POST', url: '/api/logos', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('kein lesbares PNG- oder JPEG-Bild');
    const list = await app.inject({ method: 'GET', url: '/api/logos', headers: { cookie: sessionCookie } });
    expect(list.json().some((l: { name: string }) => l.name === filename)).toBe(false);
  });

  it('lädt ein Logo hoch und listet es', async () => {
    const png = new PNG({ width: 4, height: 4 });
    const form = multipartRequest({ name: 'Gemeindelogo' }, { field: 'file', filename: 'logo.png', content: PNG.sync.write(png), type: 'image/png' });
    const { payload, contentType } = await formToInjectPayload(form);

    const uploadRes = await app.inject({ method: 'POST', url: '/api/logos', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });
    expect(uploadRes.statusCode).toBe(201);
    const listRes = await app.inject({ method: 'GET', url: '/api/logos', headers: { cookie: sessionCookie } });
    expect(listRes.json().some((l: { name: string }) => l.name === 'Gemeindelogo')).toBe(true);
  });

  async function uploadLogo(filename: string, content: Buffer): Promise<number> {
    const form = multipartRequest({}, { field: 'file', filename, content, type: 'application/octet-stream' });
    const { payload, contentType } = await formToInjectPayload(form);
    const res = await app.inject({ method: 'POST', url: '/api/logos', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  const smallPng = () => PNG.sync.write(new PNG({ width: 4, height: 4 }));
  const smallJpeg = () => Buffer.from(jpeg.encode({ width: 4, height: 4, data: Buffer.alloc(4 * 4 * 4, 200) }, 80).data);

  it.each([
    ['logo.png', smallPng(), 'image/png'],
    ['logo.jpg', smallJpeg(), 'image/jpeg'],
    ['logo.jpeg', smallJpeg(), 'image/jpeg'],
    // Der Inhalt zählt, nicht die Endung.
    ['eigentlich-jpeg.png', smallJpeg(), 'image/jpeg'],
  ])('liefert die Bilddatei %s unverändert aus', async (filename, content, expectedType) => {
    const id = await uploadLogo(filename, content);

    const res = await app.inject({ method: 'GET', url: `/api/logos/${id}/file`, headers: { cookie: sessionCookie } });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(expectedType);
    expect(res.rawPayload).toEqual(content);
  });

  it('meldet 404 für ein unbekanntes Logo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logos/999999/file', headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Logo nicht gefunden');
  });

  it('liefert die Bilddatei nicht ohne Login aus', async () => {
    const id = await uploadLogo('geheim.png', smallPng());
    const res = await app.inject({ method: 'GET', url: `/api/logos/${id}/file` });
    expect(res.statusCode).toBe(401);
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

  async function continuousMedia(): Promise<{ id: number; vendor: keyof typeof VENDOR_DPI }> {
    const res = await app.inject({ method: 'GET', url: '/api/media-types', headers: { cookie: sessionCookie } });
    return res.json().find((m: { externalId: string }) => m.externalId === '62');
  }

  it('speichert eine feste Länge und setzt sie mit null wieder auf automatisch', async () => {
    const { id: mediaId } = await continuousMedia();
    const headers = { cookie: sessionCookie, 'content-type': 'application/json' };

    const createRes = await app.inject({ method: 'POST', url: '/api/label-layouts', headers, payload: { name: 'Fest', ctTypeKey: 'fixed', mediaId, lengthMm: 80 } });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().lengthMm).toBe(80);
    const url = `/api/label-layouts/${createRes.json().id}`;

    const getRes = await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } });
    expect(getRes.json().lengthMm).toBe(80);

    // Ein PUT ohne lengthMm lässt den gespeicherten Wert stehen.
    const renameRes = await app.inject({ method: 'PUT', url, headers, payload: { name: 'Fest 2' } });
    expect(renameRes.json().lengthMm).toBe(80);

    const updateRes = await app.inject({ method: 'PUT', url, headers, payload: { lengthMm: null } });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().lengthMm).toBeNull();

    const getAfterRes = await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } });
    expect(getAfterRes.json().lengthMm).toBeNull();
  });

  it.each([0, 1001])('lehnt die feste Länge %s ab', async (lengthMm) => {
    const { id: mediaId } = await continuousMedia();
    const res = await app.inject({
      method: 'POST',
      url: '/api/label-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'X', ctTypeKey: 'x', mediaId, lengthMm },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rendert die Vorschau eines Endlosmediums in der festen Länge', async () => {
    const media = await continuousMedia();
    const res = await app.inject({
      method: 'POST',
      url: '/api/label-layouts/preview',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { elements: [], mediaId: media.id, lengthMm: 50 },
    });
    expect(res.statusCode).toBe(200);
    expect(PNG.sync.read(res.rawPayload).height).toBe(mmToPx(50, VENDOR_DPI[media.vendor]));
  });
});

function startFakeHttp(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('Printers API', () => {
  it('legt eine Druckergruppe an, aktualisiert ihr Zeitfenster und löscht sie wieder', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Empfang', hostname: 'B2', legs: [{ name: 'Empfang', vendor: 'brother-ql', host: '192.168.1.50' }] },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/printer-groups/${created.id}`,
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { activeTimesMode: 'custom', activeTimesExpr: 'So:09:00-12:00' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().activeTimesExpr).toBe('So:09:00-12:00');

    const detailRes = await app.inject({ method: 'GET', url: `/api/printer-groups/${created.id}`, headers: { cookie: sessionCookie } });
    expect(detailRes.json().legs[0].routes).toEqual([]);

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/printer-groups/${created.id}`, headers: { cookie: sessionCookie } });
    expect(deleteRes.statusCode).toBe(200);
  });

  it('lehnt ein ungültiges activeTimesExpr beim Anlegen einer Druckergruppe ab', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        name: 'X',
        hostname: 'B3',
        legs: [{ name: 'X', vendor: 'brother-ql', host: '192.168.1.51' }],
        activeTimesMode: 'custom',
        activeTimesExpr: 'Xx:99:00-10:00',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('hebt beim Löschen eines einzelnen Beins die Layout-Zuordnung auf statt das Layout zu löschen', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'Temp', hostname: 'TEMP1' }).returning().all();
    const [legA] = db.insert(printers).values({ groupId: group!.id, name: 'Temp-A', vendor: 'brother-ql', host: '192.168.1.70' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'Temp-B', vendor: 'brother-ql', host: '192.168.1.71' }).run();

    const layoutRes = await app.inject({
      method: 'POST',
      url: '/api/label-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Mit Drucker', ctTypeKey: 'x', printerId: legA!.id },
    });
    const layout = layoutRes.json();

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/printers/${legA!.id}`, headers: { cookie: sessionCookie } });
    expect(deleteRes.statusCode).toBe(200);

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
    const [group] = db.insert(printerGroups).values({ name: 'Sammelband', hostname: 'SAMMEL1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'Sammelband', vendor: 'brother-ql', host: '192.168.1.90' }).returning().all();
    const printerId = leg!.id;

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

  it('speichert die Design-Einstellungen, behält sie bei PUT ohne designJson und löscht sie mit null', async () => {
    const headers = { cookie: sessionCookie, 'content-type': 'application/json' };
    const documentPrinterId = (
      await app.inject({ method: 'POST', url: '/api/document-printers', headers, payload: { name: 'Design-Büro', host: '192.168.1.93' } })
    ).json().id;
    const designJson = {
      logoId: null,
      fontSize: 14,
      orientation: 'portrait',
      checkColumns: ['Da'],
      guestColumn: { enabled: false, header: 'Gast von', keyword: 'Besuch' },
      footer: 'Bitte abhaken',
    };

    const createRes = await app.inject({ method: 'POST', url: '/api/summary-layouts', headers, payload: { name: 'Design-Layout', documentPrinterId, designJson } });
    expect(createRes.statusCode).toBe(201);
    const url = `/api/summary-layouts/${createRes.json().id}`;
    const read = async () => (await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })).json();
    expect((await read()).designJson).toEqual(designJson);

    await app.inject({ method: 'PUT', url, headers, payload: { name: 'Design-Layout 2' } });
    expect((await read()).designJson).toEqual(designJson);

    const invalid = await app.inject({ method: 'PUT', url, headers, payload: { designJson: { fontSize: 30 } } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('Schriftgrösse darf höchstens 18 pt sein');
    expect((await read()).designJson).toEqual(designJson);

    await app.inject({ method: 'PUT', url, headers, payload: { designJson: { fontSize: 9 } } });
    expect((await read()).designJson).toEqual({ fontSize: 9 });

    const cleared = await app.inject({ method: 'PUT', url, headers, payload: { designJson: null } });
    expect(cleared.statusCode).toBe(200);
    expect((await read()).designJson).toBeNull();
  });

  it('meldet "Sammel-Layout nicht gefunden" für eine unbekannte ID beim manuellen Trigger', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/summary-layouts/999999/print', headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('ruft den Orchestrator für den manuellen Trigger auf (hier: noop-Orchestrator ohne laufenden Dienst)', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'Sammelband2', hostname: 'SAMMEL2' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'Sammelband2', vendor: 'brother-ql', host: '192.168.1.92' }).returning().all();
    const printerId = leg!.id;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/summary-layouts',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { name: 'Trigger-Test', printerId },
    });
    const id = createRes.json().id;

    const res = await app.inject({ method: 'POST', url: `/api/summary-layouts/${id}/print`, headers: { cookie: sessionCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, message: 'Orchestrator nicht verfügbar', groupsPrinted: 0, groupsFailed: 0, empty: false });
  });
});

describe('Summary-Trigger API', () => {
  const okResult: GenerateSummaryResult = { ok: true, groupsPrinted: 2, groupsFailed: 0, empty: false };
  let triggerApp: FastifyInstance;
  const triggerMock = vi.fn<OrchestratorLike['triggerManualSummary']>();
  let layoutId: number;
  let token: string;
  let secret: string;

  const adminHeaders = () => ({ cookie: sessionCookie, 'content-type': 'application/json' });

  async function enableTrigger(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: `/api/summary-layouts/${layoutId}/trigger`, headers: adminHeaders(), payload });
  }
  const callTrigger = (bearer?: string, t: string = token) =>
    triggerApp.inject({ method: 'POST', url: `/api/summary-trigger/${t}`, ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}) });

  beforeAll(async () => {
    const env: Env = {
      DB_PATH: path.join(tmpDir, 'test.db'),
      APP_PORT: 0,
      APP_HOST: '127.0.0.1',
      ENCRYPTION_KEY: (app as unknown as { env: Env }).env.ENCRYPTION_KEY,
      SESSION_SECRET: (app as unknown as { env: Env }).env.SESSION_SECRET,
      LOG_LEVEL: 'error',
    };
    triggerApp = await buildServer(db, env, { ...noopOrchestrator, triggerManualSummary: triggerMock });
    await triggerApp.ready();

    const [group] = db.insert(printerGroups).values({ name: 'TriggerBand', hostname: 'TRIG1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'TriggerBand', vendor: 'brother-ql', host: '192.168.1.95' }).returning().all();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/summary-layouts',
      headers: adminHeaders(),
      payload: { name: 'Taster-Layout', printerId: leg!.id },
    });
    layoutId = createRes.json().id;
  });

  afterAll(async () => {
    await triggerApp.close();
  });

  it('requires a session for the trigger admin routes', async () => {
    const post = await app.inject({ method: 'POST', url: `/api/summary-layouts/${layoutId}/trigger`, payload: { enabled: true } });
    expect(post.statusCode).toBe(401);
    const get = await app.inject({ method: 'GET', url: `/api/summary-layouts/${layoutId}/trigger/secret` });
    expect(get.statusCode).toBe(401);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await callTrigger('whatever', 'doesnotexist');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBeTruthy();
  });

  it('returns 404 when the trigger is disabled', async () => {
    const res = await enableTrigger({ enabled: false });
    expect(res.statusCode).toBe(200);
    token = res.json().triggerToken;
    secret = res.json().secret;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(secret).toBeTruthy();
    expect(res.json().triggerEnabled).toBe(false);

    const call = await callTrigger(secret);
    expect(call.statusCode).toBe(404);
  });

  it('returns 401 for a missing or wrong secret', async () => {
    await enableTrigger({ enabled: true });
    expect((await callTrigger()).statusCode).toBe(401);
    expect((await callTrigger('wrong-secret')).statusCode).toBe(401);
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('returns the secret via the admin route and keeps the same token on a second call', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/summary-layouts/${layoutId}/trigger/secret`, headers: { cookie: sessionCookie } });
    expect(res.json()).toEqual({ secret });
    const again = await enableTrigger({ enabled: true });
    expect(again.json().triggerToken).toBe(token);
    expect(again.json().secret).toBeUndefined();
  });

  it('accepts a POST without body and without content-type and returns the summary result', async () => {
    triggerMock.mockResolvedValueOnce(okResult);
    const before = new Date();
    const res = await callTrigger(secret);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(okResult);
    expect(triggerMock).toHaveBeenCalledTimes(1);
    const [id, since, until] = triggerMock.mock.calls[0]!;
    expect(id).toBe(layoutId);
    const startOfToday = new Date(before);
    startOfToday.setHours(0, 0, 0, 0);
    expect(since.getTime()).toBe(startOfToday.getTime());
    expect(until.getTime()).toBeGreaterThanOrEqual(before.getTime());
    triggerMock.mockReset();
  });

  it('passes ok:false results through as 200', async () => {
    triggerMock.mockResolvedValueOnce({ ok: false, message: 'Orchestrator läuft nicht', groupsPrinted: 0, groupsFailed: 0, empty: false });
    const res = await callTrigger(secret);
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    triggerMock.mockReset();
  });

  it('returns 409 while a summary for the same layout is still printing', async () => {
    let release!: (r: GenerateSummaryResult) => void;
    triggerMock.mockReturnValueOnce(new Promise<GenerateSummaryResult>((resolve) => (release = resolve)));
    const first = callTrigger(secret);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));

    const second = await callTrigger(secret);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'Sammelausdruck läuft bereits' });
    expect(triggerMock).toHaveBeenCalledTimes(1);

    release(okResult);
    expect((await first).statusCode).toBe(200);

    triggerMock.mockResolvedValueOnce(okResult);
    expect((await callTrigger(secret)).statusCode).toBe(200);
    triggerMock.mockReset();
  });

  it('blocks the GUI /print endpoint while a trigger print is running', async () => {
    let release!: (r: GenerateSummaryResult) => void;
    triggerMock.mockReturnValueOnce(new Promise<GenerateSummaryResult>((resolve) => (release = resolve)));
    const first = callTrigger(secret);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));

    const loginRes = await triggerApp.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correcthorsebatterystaple' } });
    const c = loginRes.cookies.find((x) => x.name === 'sessionId')!;
    const print = await triggerApp.inject({ method: 'POST', url: `/api/summary-layouts/${layoutId}/print`, headers: { cookie: `${c.name}=${c.value}` } });
    expect(print.statusCode).toBe(409);

    release(okResult);
    await first;
    triggerMock.mockReset();
  });

  it('rejects the old secret after regenerateSecret', async () => {
    const res = await enableTrigger({ regenerateSecret: true });
    expect(res.statusCode).toBe(200);
    const newSecret = res.json().secret;
    expect(newSecret).toBeTruthy();
    expect(newSecret).not.toBe(secret);
    expect(res.json().triggerToken).toBe(token);

    expect((await callTrigger(secret)).statusCode).toBe(401);
    triggerMock.mockResolvedValueOnce(okResult);
    expect((await callTrigger(newSecret)).statusCode).toBe(200);
    triggerMock.mockReset();
    secret = newSecret;
  });

  it('never exposes triggerSecretEnc in layout listings', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/summary-layouts', headers: { cookie: sessionCookie } });
    expect(list.body).not.toContain('triggerSecretEnc');
    const row = list.json().find((l: { id: number }) => l.id === layoutId);
    expect(row.hasTriggerSecret).toBe(true);

    const single = await app.inject({ method: 'GET', url: `/api/summary-layouts/${layoutId}`, headers: { cookie: sessionCookie } });
    expect(single.body).not.toContain('triggerSecretEnc');
    expect(single.json().hasTriggerSecret).toBe(true);
  });
});

describe('Summary-Vorschau API', () => {
  const orchestratorStub = {
    handleIncomingJob: vi.fn<OrchestratorLike['handleIncomingJob']>(),
    reload: vi.fn<OrchestratorLike['reload']>(),
    triggerManualSummary: vi.fn<OrchestratorLike['triggerManualSummary']>(),
    status: vi.fn<OrchestratorLike['status']>(),
  };
  const renderSpy = vi.mocked(renderSummaryPdf);
  let previewApp: FastifyInstance;
  let previewCookie: string;

  const preview = (payload: Record<string, unknown>) =>
    previewApp.inject({ method: 'POST', url: '/api/summary-layouts/preview', headers: { cookie: previewCookie }, payload });
  const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

  beforeAll(async () => {
    previewApp = await buildServer(db, (app as unknown as { env: Env }).env, orchestratorStub);
    await previewApp.ready();
    const loginRes = await previewApp.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correcthorsebatterystaple' } });
    const c = loginRes.cookies.find((x) => x.name === 'sessionId')!;
    previewCookie = `${c.name}=${c.value}`;
  });

  afterAll(async () => {
    await previewApp.close();
  });

  beforeEach(() => {
    renderSpy.mockClear();
  });

  it('verweigert den Zugriff ohne Login', async () => {
    const res = await previewApp.inject({ method: 'POST', url: '/api/summary-layouts/preview', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('liefert für ein leeres Objekt ein mehrseitiges PDF und druckt nie', async () => {
    const res = await preview({});
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(res.rawPayload)).toBeGreaterThanOrEqual(2);
    for (const method of Object.values(orchestratorStub)) expect(method).not.toHaveBeenCalled();
  });

  it('verwendet Beispieldaten und die Standards des Ausdrucks', async () => {
    await preview({});
    const input = renderSpy.mock.calls[0]![0];
    expect(input.title).toBe('Sammelausdruck Beispielgruppe');
    expect(input.columns).toEqual([
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'checkinTime', label: 'Zeit' },
    ]);
    expect(input.design).toEqual(DEFAULT_SUMMARY_DESIGN);
    expect(input.logo).toBeUndefined();
    expect(input.rows).toHaveLength(42);
    expect(input.rows.filter((r) => r.isGuest).map((r) => r.name)).toEqual(['Gast 1 Beispielgruppe', 'Gast 2 Beispielgruppe']);
    expect(input.rows.slice(0, 2).every((r) => r.isGuest)).toBe(true);
    for (const row of input.rows) expect(row.checkinTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('übernimmt Titel, Spalten und Design aus der Anfrage', async () => {
    const res = await preview({
      titleTemplate: 'Liste {{checkin.group}}',
      columnsJson: ['name'],
      designJson: { orientation: 'portrait', guestColumn: { keyword: 'Besuch' } },
    });
    expect(res.statusCode).toBe(200);
    const input = renderSpy.mock.calls[0]![0];
    expect(input.title).toBe('Liste Beispielgruppe');
    expect(input.columns).toEqual([{ key: 'name', label: 'Name' }]);
    expect(input.design.orientation).toBe('portrait');
    expect(input.rows.filter((r) => r.isGuest).map((r) => r.name)).toEqual(['Besuch 1 Beispielgruppe', 'Besuch 2 Beispielgruppe']);
  });

  it('nimmt designJson: null als Standard-Design', async () => {
    expect((await preview({ designJson: null })).statusCode).toBe(200);
    expect(renderSpy.mock.calls[0]![0].design).toEqual(DEFAULT_SUMMARY_DESIGN);
  });

  it('bettet ein hochgeladenes Logo ein', async () => {
    const png = new PNG({ width: 4, height: 4 });
    const form = multipartRequest({ name: 'Vorschaulogo' }, { field: 'file', filename: 'logo.png', content: PNG.sync.write(png), type: 'image/png' });
    const { payload, contentType } = await formToInjectPayload(form);
    const upload = await app.inject({ method: 'POST', url: '/api/logos', headers: { cookie: sessionCookie, 'content-type': contentType }, payload });

    const res = await preview({ designJson: { logoId: upload.json().id } });
    expect(res.statusCode).toBe(200);
    expect(renderSpy.mock.calls[0]![0].logo).toEqual(PNG.sync.write(png));
    expect(res.rawPayload.toString('latin1')).toContain('/Subtype /Image');
  });

  it('liefert bei unbekannter logoId das PDF ohne Logo', async () => {
    const res = await preview({ designJson: { logoId: 999999 } });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(renderSpy.mock.calls[0]![0].logo).toBeUndefined();
  });

  it.each([
    [{ designJson: { fontSize: 99 } }, 'Schriftgrösse darf höchstens 18 pt sein'],
    [{ titleTemplate: '' }, 'Titel darf nicht leer sein'],
    [{ titleTemplate: 5 }, 'Titel muss ein Text sein'],
    [{ columnsJson: ['alter'] }, 'Unbekannte Spalte'],
    [{ columnsJson: 'name' }, 'Spalten müssen eine Liste sein'],
    [[], 'Ungültige Eingabe'],
  ])('lehnt %j mit 400 ab', async (payload, error) => {
    const res = await preview(payload as Record<string, unknown>);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe('Auth API', () => {
  it('rejects protected routes without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/printer-groups' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects protected routes with a garbage cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/printer-groups', headers: { cookie: 'sessionId=not-a-real-session' } });
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

    const protectedRes = await app.inject({ method: 'GET', url: '/api/printer-groups', headers: { cookie: `${cookie!.name}=${cookie!.value}` } });
    expect(protectedRes.statusCode).toBe(200);
  });

  it('logout destroys the session so it no longer authorizes protected routes', async () => {
    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correcthorsebatterystaple' } });
    const cookie = loginRes.cookies.find((c) => c.name === 'sessionId')!;
    const ownCookie = `${cookie.name}=${cookie.value}`;

    const logoutRes = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: ownCookie } });
    expect(logoutRes.json()).toEqual({ ok: true });

    const afterLogout = await app.inject({ method: 'GET', url: '/api/printer-groups', headers: { cookie: ownCookie } });
    expect(afterLogout.statusCode).toBe(401);

    // Die für den Rest der Testsuite geteilte `sessionCookie` bleibt von diesem isolierten Login/Logout unberührt.
    const sharedStillWorks = await app.inject({ method: 'GET', url: '/api/printer-groups', headers: { cookie: sessionCookie } });
    expect(sharedStillWorks.statusCode).toBe(200);
  });
});
