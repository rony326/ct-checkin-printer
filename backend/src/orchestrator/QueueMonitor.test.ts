import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { printers } from '../db/schema.js';
import { QueueMonitor } from './QueueMonitor.js';
import { enqueueJob, listPendingJobs } from './printQueueStore.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
let printerId: number;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  printerId = db.insert(printers).values({ name: 'B1', hostname: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!.id;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function fakePipeline(result: { success: boolean; errorMessage?: string }) {
  return { retryQueuedJob: vi.fn(async () => result) };
}

describe('QueueMonitor.tick', () => {
  it('marks a pending entry done when the retry succeeds', async () => {
    const entry = enqueueJob(db, { printerId, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'x' });
    const pipeline = fakePipeline({ success: true });
    const monitor = new QueueMonitor({ db, pipeline, limits: { maxRetries: 5, maxAgeMs: 1_800_000 }, intervalMs: 30000 });

    await monitor.tick();

    expect(pipeline.retryQueuedJob).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id }));
    expect(listPendingJobs(db, printerId)).toHaveLength(0);
  });

  it('keeps a failed entry pending with an incremented attempt count', async () => {
    enqueueJob(db, { printerId, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'x' });
    const pipeline = fakePipeline({ success: false, errorMessage: 'noch nicht bereit' });
    const monitor = new QueueMonitor({ db, pipeline, limits: { maxRetries: 5, maxAgeMs: 1_800_000 }, intervalMs: 30000 });

    await monitor.tick();

    const [pending] = listPendingJobs(db, printerId);
    expect(pending!.attempts).toBe(1);
  });

  it('processes multiple pending entries independently', async () => {
    enqueueJob(db, { printerId, layoutId: null, payload: { rawData: 'a', unixTimestampSeconds: 1 }, reason: 'x' });
    enqueueJob(db, { printerId, layoutId: null, payload: { rawData: 'b', unixTimestampSeconds: 1 }, reason: 'x' });
    const pipeline = fakePipeline({ success: true });
    const monitor = new QueueMonitor({ db, pipeline, limits: { maxRetries: 5, maxAgeMs: 1_800_000 }, intervalMs: 30000 });

    await monitor.tick();

    expect(pipeline.retryQueuedJob).toHaveBeenCalledTimes(2);
  });
});

describe('QueueMonitor.start/stop', () => {
  it('runs tick again after each interval until stopped', async () => {
    enqueueJob(db, { printerId, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'x' });
    const pipeline = fakePipeline({ success: false });
    const monitor = new QueueMonitor({ db, pipeline, limits: { maxRetries: 5, maxAgeMs: 1_800_000 }, intervalMs: 1000 });

    monitor.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pipeline.retryQueuedJob).toHaveBeenCalledTimes(2);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(pipeline.retryQueuedJob).toHaveBeenCalledTimes(2);
  });
});
