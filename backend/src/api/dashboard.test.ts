import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { printerGroups, printers } from '../db/schema.js';
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
  return { groupId: 1, legIds: [1], running: true, mode: 'idle', consecutiveErrors: 0, lastJobAt: null, ...overrides };
}

describe('buildDashboardStatus', () => {
  it('enriches a poller status with the group name/hostname', () => {
    const [group] = db.insert(printerGroups).values({ name: 'Minis', hostname: 'B2' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'Minis', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    const result = buildDashboardStatus(db, [makePoller({ groupId: group!.id, legIds: [1], mode: 'active', consecutiveErrors: 2, lastJobAt: 12345 })]);

    expect(result).toEqual([
      { groupId: group!.id, hostname: 'B2', name: 'Minis', running: true, mode: 'active', consecutiveErrors: 2, lastJobAt: 12345, pendingQueueCount: 0 },
    ]);
  });

  it('sums pending queue entries across every physical leg of a multi-printer group', () => {
    const [group] = db.insert(printerGroups).values({ name: 'Kind', hostname: 'B2' }).returning().all();
    const [legA] = db.insert(printers).values({ groupId: group!.id, name: 'Kind', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [legB] = db.insert(printers).values({ groupId: group!.id, name: 'Eltern', vendor: 'zebra-zpl', host: '10.0.0.2' }).returning().all();
    enqueueJob(db, { printerId: legA!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });
    enqueueJob(db, { printerId: legA!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });
    enqueueJob(db, { printerId: legB!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });

    const result = buildDashboardStatus(db, [makePoller({ groupId: group!.id, legIds: [legA!.id, legB!.id] })]);

    expect(result[0]!.pendingQueueCount).toBe(3);
  });

  it('falls back to "?" when the group no longer exists (deleted mid-run)', () => {
    const result = buildDashboardStatus(db, [makePoller({ groupId: 999, legIds: [999] })]);

    expect(result[0]!.hostname).toBe('?');
    expect(result[0]!.name).toBe('?');
  });

  it('returns an empty array for no pollers', () => {
    expect(buildDashboardStatus(db, [])).toEqual([]);
  });
});
