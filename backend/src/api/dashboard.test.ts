import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { printers } from '../db/schema.js';
import type { OrchestratorPollerStatus } from '../orchestrator/orchestratorLike.js';
import { enqueueJob } from '../orchestrator/printQueueStore.js';
import { createTestDb } from '../orchestrator/testDb.js';
import { buildDashboardStatus } from './dashboard.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

function makePoller(overrides: Partial<OrchestratorPollerStatus> = {}): OrchestratorPollerStatus {
  return { printerId: 1, printerIds: [1], running: true, mode: 'idle', consecutiveErrors: 0, lastJobAt: null, ...overrides };
}

describe('buildDashboardStatus', () => {
  it('enriches a poller status with the printer name/hostname', () => {
    const [printer] = db.insert(printers).values({ name: 'Minis', hostname: 'B2', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();

    const result = buildDashboardStatus(db, [makePoller({ printerId: printer!.id, printerIds: [printer!.id], mode: 'active', consecutiveErrors: 2, lastJobAt: 12345 })]);

    expect(result).toEqual([
      { printerId: printer!.id, hostname: 'B2', name: 'Minis', running: true, mode: 'active', consecutiveErrors: 2, lastJobAt: 12345, pendingQueueCount: 0 },
    ]);
  });

  it('sums pending queue entries across every physical leg of a multi-printer group', () => {
    const [legA] = db.insert(printers).values({ name: 'Kind', hostname: 'B2', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [legB] = db.insert(printers).values({ name: 'Eltern', hostname: 'B2', vendor: 'zebra-zpl', host: '10.0.0.2' }).returning().all();
    enqueueJob(db, { printerId: legA!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });
    enqueueJob(db, { printerId: legA!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });
    enqueueJob(db, { printerId: legB!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });

    const result = buildDashboardStatus(db, [makePoller({ printerId: legA!.id, printerIds: [legA!.id, legB!.id] })]);

    expect(result[0]!.pendingQueueCount).toBe(3);
  });

  it('falls back to "?" when the printer row no longer exists (deleted mid-run)', () => {
    const result = buildDashboardStatus(db, [makePoller({ printerId: 999, printerIds: [999] })]);

    expect(result[0]!.hostname).toBe('?');
    expect(result[0]!.name).toBe('?');
  });

  it('returns an empty array for no pollers', () => {
    expect(buildDashboardStatus(db, [])).toEqual([]);
  });
});
