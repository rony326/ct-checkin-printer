import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { printerGroups, printers } from '../db/schema.js';
import { enqueueJob, listPendingJobs, recordFailedAttempt, recordSuccess, type QueuedJobPayload } from './printQueueStore.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
let printerId: number;

const payload: QueuedJobPayload = { rawData: 'name=Max\nid=1\ncode=AB12\ntype=parent', unixTimestampSeconds: 1000 };

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  const [group] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
  printerId = db.insert(printers).values({ groupId: group!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!.id;
});

afterEach(() => cleanup());

describe('enqueueJob / listPendingJobs', () => {
  it('makes a newly enqueued job show up as pending for its printer', () => {
    enqueueJob(db, { printerId, layoutId: null, payload, reason: 'Drucker nicht erreichbar' });

    const pending = listPendingJobs(db, printerId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.reason).toBe('Drucker nicht erreichbar');
    expect(pending[0]!.attempts).toBe(0);
    expect(pending[0]!.jobPayloadJson).toEqual(payload);
  });

  it('does not return jobs enqueued for a different printer', () => {
    const [group] = db.insert(printerGroups).values({ name: 'B2', hostname: 'B2' }).returning().all();
    const otherPrinterId = db.insert(printers).values({ groupId: group!.id, name: 'B2', vendor: 'brother-ql', host: '10.0.0.2' }).returning().all()[0]!.id;
    enqueueJob(db, { printerId, layoutId: null, payload, reason: 'x' });

    expect(listPendingJobs(db, otherPrinterId)).toHaveLength(0);
  });
});

describe('recordFailedAttempt', () => {
  it('keeps the job pending and increments attempts while under the retry/age limits', () => {
    const entry = enqueueJob(db, { printerId, layoutId: null, payload, reason: 'x' });

    recordFailedAttempt(db, entry.id, { maxRetries: 5, maxAgeMs: 1_800_000 }, Date.now());

    const [updated] = listPendingJobs(db, printerId);
    expect(updated!.attempts).toBe(1);
    expect(updated!.status).toBe('pending');
  });

  it('marks the job "failed" once max retries is reached', () => {
    const entry = enqueueJob(db, { printerId, layoutId: null, payload, reason: 'x' });

    for (let i = 0; i < 3; i++) {
      recordFailedAttempt(db, entry.id, { maxRetries: 3, maxAgeMs: 1_800_000 }, Date.now());
    }

    expect(listPendingJobs(db, printerId)).toHaveLength(0);
  });

  it('marks the job "expired" once it is older than maxAgeMs, even on the first retry', () => {
    const entry = enqueueJob(db, { printerId, layoutId: null, payload, reason: 'x' });
    const farFuture = Date.now() + 2 * 60 * 60 * 1000;

    recordFailedAttempt(db, entry.id, { maxRetries: 5, maxAgeMs: 1_800_000 }, farFuture);

    expect(listPendingJobs(db, printerId)).toHaveLength(0);
  });
});

describe('printer deletion', () => {
  it('cascades pending queue entries away instead of raising a foreign-key error', () => {
    enqueueJob(db, { printerId, layoutId: null, payload, reason: 'x' });

    expect(() => db.delete(printers).where(eq(printers.id, printerId)).run()).not.toThrow();
    expect(listPendingJobs(db, printerId)).toHaveLength(0);
  });
});

describe('recordSuccess', () => {
  it('marks the job done and removes it from the pending list', () => {
    const entry = enqueueJob(db, { printerId, layoutId: null, payload, reason: 'x' });
    recordSuccess(db, entry.id);
    expect(listPendingJobs(db, printerId)).toHaveLength(0);
  });
});
