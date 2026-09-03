import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { encryptSecret } from '../crypto/secrets.js';
import type { Env } from '../env.js';
import { webhooksOutgoing } from '../db/schema.js';
import { dispatchOutgoingWebhooks } from './webhookDispatch.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
let server: Server;
let baseUrl: string;
let receivedBodies: unknown[];
const ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';
const env = { ENCRYPTION_KEY } as Env;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      receivedBodies.push(JSON.parse(body));
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  receivedBodies = [];
});

afterEach(() => cleanup());

describe('dispatchOutgoingWebhooks', () => {
  it('sends the payload to enabled webhooks matching the event scope', async () => {
    db.insert(webhooksOutgoing).values({ name: 'A', url: baseUrl, eventScope: 'checkin', retry: 1, retryMs: 10 }).run();

    await dispatchOutgoingWebhooks(db, env, 'checkin', { event: 'checkin.printed' });

    expect(receivedBodies).toEqual([{ event: 'checkin.printed' }]);
  });

  it('also sends to webhooks scoped "both"', async () => {
    db.insert(webhooksOutgoing).values({ name: 'A', url: baseUrl, eventScope: 'both', retry: 1, retryMs: 10 }).run();

    await dispatchOutgoingWebhooks(db, env, 'status', { event: 'printer.error' });

    expect(receivedBodies).toHaveLength(1);
  });

  it('does not send to a webhook scoped for the other event type', async () => {
    db.insert(webhooksOutgoing).values({ name: 'A', url: baseUrl, eventScope: 'status', retry: 1, retryMs: 10 }).run();

    await dispatchOutgoingWebhooks(db, env, 'checkin', { event: 'checkin.printed' });

    expect(receivedBodies).toHaveLength(0);
  });

  it('does not send to a disabled webhook', async () => {
    db.insert(webhooksOutgoing).values({ name: 'A', url: baseUrl, eventScope: 'both', enabled: false, retry: 1, retryMs: 10 }).run();

    await dispatchOutgoingWebhooks(db, env, 'checkin', { event: 'checkin.printed' });

    expect(receivedBodies).toHaveLength(0);
  });

  it('sends an Authorization bearer header decrypted from the stored secret', async () => {
    let authHeader: string | undefined;
    server.once('request', (req) => {
      authHeader = req.headers.authorization;
    });
    db.insert(webhooksOutgoing)
      .values({ name: 'A', url: baseUrl, eventScope: 'both', secretEnc: encryptSecret('s3cr3t', ENCRYPTION_KEY), retry: 1, retryMs: 10 })
      .run();

    await dispatchOutgoingWebhooks(db, env, 'checkin', { event: 'checkin.printed' });

    expect(authHeader).toBe('Bearer s3cr3t');
  });

  it('does not throw when a webhook target is unreachable', async () => {
    db.insert(webhooksOutgoing).values({ name: 'Broken', url: 'http://127.0.0.1:1', eventScope: 'both', retry: 1, retryMs: 10 }).run();

    await expect(dispatchOutgoingWebhooks(db, env, 'checkin', { event: 'checkin.printed' })).resolves.not.toThrow();
  });
});
