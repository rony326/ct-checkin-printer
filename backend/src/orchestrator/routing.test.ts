import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts, printerGroups, printers } from '../db/schema.js';
import { resolveLayoutsForJob } from './routing.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

function makeGroup(hostname: string) {
  return db.insert(printerGroups).values({ name: hostname, hostname }).returning().all()[0]!;
}

function makeLeg(groupId: number, vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  return db.insert(printers).values({ groupId, name: 'Leg', vendor, host: '10.0.0.1' }).returning().all()[0]!;
}

describe('resolveLayoutsForJob', () => {
  it('returns an empty array when no group with this hostname exists', () => {
    expect(resolveLayoutsForJob(db, 'does-not-exist', 'parent')).toEqual([]);
  });

  it('returns an empty array when no layout matches the printer + ctTypeKey', () => {
    const group = makeGroup('B1');
    makeLeg(group.id);
    expect(resolveLayoutsForJob(db, 'B1', 'parent')).toEqual([]);
  });

  it('returns just the primary layout when it has no also[] links', () => {
    const group = makeGroup('B1');
    const leg = makeLeg(group.id);
    const [layout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: leg.id }).returning().all();

    const result = resolveLayoutsForJob(db, 'B1', 'parent');
    expect(result.map((l) => l.id)).toEqual([layout!.id]);
  });

  it('appends also[] layouts, even when they target a different printer', () => {
    const groupA = makeGroup('B1');
    const legA = makeLeg(groupA.id);
    const groupB = makeGroup('B2');
    const legB = makeLeg(groupB.id);
    const [primary] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: legA.id }).returning().all();
    const [also] = db.insert(labelLayouts).values({ name: 'Sammelzettel', ctTypeKey: 'summary', printerId: legB.id }).returning().all();
    db.insert(labelLayoutAlso).values({ layoutId: primary!.id, alsoLayoutId: also!.id }).run();

    const result = resolveLayoutsForJob(db, 'B1', 'parent');
    expect(result.map((l) => l.id)).toEqual([primary!.id, also!.id]);
    expect(result[1]!.printerId).toBe(legB.id);
  });

  it('resolves the PRIMARY layout to a different physical leg within the SAME group (v1 routing-mode: one CT location, per-type physical printer)', () => {
    const group = makeGroup('B2');
    const legChild = makeLeg(group.id, 'brother-ql'); // z.B. "child", 54mm
    const legParent = makeLeg(group.id, 'zebra-zpl'); // "parent", anderes Format, anderer physischer Drucker

    const [childLayout] = db.insert(labelLayouts).values({ name: 'Kind', ctTypeKey: 'child', printerId: legChild.id }).returning().all();
    const [parentLayout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: legParent.id }).returning().all();

    expect(resolveLayoutsForJob(db, 'B2', 'child').map((l) => l.id)).toEqual([childLayout!.id]);
    expect(resolveLayoutsForJob(db, 'B2', 'parent').map((l) => l.id)).toEqual([parentLayout!.id]);
  });
});
