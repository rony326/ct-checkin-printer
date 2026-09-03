import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { sendWebhook } from './sendWebhook.js';

function startServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('sendWebhook', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('sendet Body als JSON und Secret als Bearer-Token', async () => {
    let receivedAuth: string | undefined;
    let receivedBody = '';
    const started = await startServer((req, res) => {
      receivedAuth = req.headers.authorization;
      req.on('data', (c) => (receivedBody += c));
      req.on('end', () => {
        res.writeHead(200).end('ok');
      });
    });
    server = started.server;

    const result = await sendWebhook({
      url: `http://127.0.0.1:${started.port}/hook`,
      method: 'POST',
      secret: 'my-secret',
      retry: 1,
      retryMs: 10,
      body: { event: 'checkin.printed' },
    });

    expect(result.success).toBe(true);
    expect(receivedAuth).toBe('Bearer my-secret');
    expect(JSON.parse(receivedBody)).toEqual({ event: 'checkin.printed' });
  });

  it('wiederholt bei Fehlern bis retry erreicht ist', async () => {
    let callCount = 0;
    const started = await startServer((req, res) => {
      callCount++;
      res.writeHead(500).end();
    });
    server = started.server;

    const result = await sendWebhook({ url: `http://127.0.0.1:${started.port}/hook`, method: 'POST', retry: 3, retryMs: 5, body: {} });

    expect(result.success).toBe(false);
    expect(callCount).toBe(3);
    expect(result.attempts).toBe(3);
  });

  it('gibt success zurück, sobald ein Versuch klappt', async () => {
    let callCount = 0;
    const started = await startServer((req, res) => {
      callCount++;
      if (callCount < 2) res.writeHead(500).end();
      else res.writeHead(200).end();
    });
    server = started.server;

    const result = await sendWebhook({ url: `http://127.0.0.1:${started.port}/hook`, method: 'POST', retry: 3, retryMs: 5, body: {} });
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  it('meldet einen Fehler ohne Server (Verbindung abgelehnt)', async () => {
    const result = await sendWebhook({ url: 'http://127.0.0.1:1/hook', method: 'POST', retry: 1, retryMs: 5, body: {} });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
  });
});
