import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ChurchToolsOldApiClient } from './ChurchToolsOldApiClient.js';

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

interface FakeChurchToolsOptions {
  jobData?: string | null;
  requireCookie?: boolean;
  failHidePrinter?: string;
}

/** Simuliert die für uns relevanten ChurchTools-Endpunkte: Login (mit Session-Cookie), CSRF-Token, oldApi. */
function startFakeChurchTools(opts: FakeChurchToolsOptions = {}): Promise<{ server: Server; oldApiCalls: any[] }> {
  const oldApiCalls: any[] = [];
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? '';

      if (req.method === 'POST' && url.startsWith('/api/login')) {
        const body = await readJsonBody(req);
        if (body.username === 'user' && body.password === 'pass') {
          sendJson(res, 200, { status: 'success', personId: 42 }, { 'Set-Cookie': 'ct_session=abc123; Path=/' });
        } else {
          sendJson(res, 401, { status: 'error', message: 'Login fehlgeschlagen' });
        }
        return;
      }

      if (req.method === 'GET' && url.startsWith('/api/csrftoken')) {
        sendJson(res, 200, 'FAKE-CSRF-TOKEN');
        return;
      }

      if (req.method === 'GET' && url.includes('/logintoken')) {
        res.writeHead(404).end();
        return;
      }

      if (req.method === 'POST' && url.startsWith('/?q=churchcheckin/ajax')) {
        if (opts.requireCookie && !req.headers.cookie?.includes('ct_session=abc123')) {
          sendJson(res, 401, { status: 'error', message: 'Session expired!' });
          return;
        }
        const body = await readJsonBody(req);
        oldApiCalls.push(body);

        if (body.func === 'getNextPrinterJob') {
          sendJson(res, 200, { status: 'success', data: opts.jobData ?? null });
        } else if (body.func === 'hidePrinter' && opts.failHidePrinter) {
          sendJson(res, 200, { status: 'error', message: opts.failHidePrinter });
        } else if (body.func === 'activatePrinter' || body.func === 'hidePrinter') {
          sendJson(res, 200, { status: 'success', data: {} });
        } else {
          sendJson(res, 200, { status: 'error', message: `Unbekannte func: ${body.func}` });
        }
        return;
      }

      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, oldApiCalls }));
  });
}

describe('ChurchToolsOldApiClient (gegen einen simulierten ChurchTools-HTTP-Server)', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function makeClient(baseUrl: string) {
    return new ChurchToolsOldApiClient({ baseUrl, username: 'user', password: 'pass' });
  }

  it('loggt sich per Benutzername/Passwort ein (testLogin)', async () => {
    const fake = await startFakeChurchTools();
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await expect(client.testLogin()).resolves.toBeUndefined();
  });

  it('wirft bei falschen Zugangsdaten', async () => {
    const fake = await startFakeChurchTools();
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = new ChurchToolsOldApiClient({ baseUrl: `http://127.0.0.1:${port}`, username: 'user', password: 'FALSCH' });
    await expect(client.testLogin()).rejects.toThrow();
  });

  it('sendet das Session-Cookie aus dem Login bei nachfolgenden oldApi-Aufrufen mit', async () => {
    const fake = await startFakeChurchTools({ requireCookie: true, jobData: null });
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await client.testLogin();
    const result = await client.getNextPrinterJob('B2');

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('baut den oldApi-Request-Body korrekt (func + ort)', async () => {
    const fake = await startFakeChurchTools({ jobData: 'name=Max\nid=123\ncode=AB12' });
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await client.testLogin();
    const result = await client.getNextPrinterJob('B2');

    expect(result.success).toBe(true);
    expect(result.data).toBe('name=Max\nid=123\ncode=AB12');
    expect(fake.oldApiCalls).toContainEqual({ func: 'getNextPrinterJob', ort: 'B2' });
  });

  it('activatePrinter sendet ort + bezeichnung', async () => {
    const fake = await startFakeChurchTools();
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await client.testLogin();
    const result = await client.activatePrinter('B2', 'Minis');

    expect(result.success).toBe(true);
    expect(fake.oldApiCalls).toContainEqual({ func: 'activatePrinter', ort: 'B2', bezeichnung: 'Minis' });
  });

  it('hidePrinter sendet ort', async () => {
    const fake = await startFakeChurchTools();
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await client.testLogin();
    const result = await client.hidePrinter('B2');

    expect(result.success).toBe(true);
    expect(fake.oldApiCalls).toContainEqual({ func: 'hidePrinter', ort: 'B2' });
  });

  it('normalisiert einen logischen oldApi-Fehler (status !== success) zu einem Fehlerergebnis', async () => {
    const fake = await startFakeChurchTools({ failHidePrinter: 'Ort nicht gefunden' });
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await client.testLogin();
    const result = await client.hidePrinter('unbekannt');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe('Ort nicht gefunden');
  });

  it('bündelt mehrere Poller über ensureLogin/onWindowClose auf eine Session', async () => {
    const fake = await startFakeChurchTools();
    server = fake.server;
    const port = (server.address() as { port: number }).port;

    const client = makeClient(`http://127.0.0.1:${port}`);
    await client.ensureLogin();
    await client.ensureLogin(); // zweiter "Poller" — darf keinen zweiten Login auslösen
    await client.onWindowClose();
    const result = await client.getNextPrinterJob('B2'); // erster Poller ist noch "aktiv"
    await client.onWindowClose();

    expect(result.success).toBe(true);
  });
});
