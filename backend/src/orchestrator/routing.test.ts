import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts, printers } from '../db/schema.js';
import { resolveLayoutsForJob } from './routing.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

function makePrinter(hostname: string) {
  return db
    .insert(printers)
    .values({ name: hostname, hostname, vendor: 'brother-ql', host: '10.0.0.1' })
    .returning()
    .all()[0]!;
}

describe('resolveLayoutsForJob', () => {
  it('returns an empty array when no printer with this hostname exists', () => {
    expect(resolveLayoutsForJob(db, 'does-not-exist', 'parent')).toEqual([]);
  });

  it('returns an empty array when no layout matches the printer + ctTypeKey', () => {
    const printer = makePrinter('B1');
    expect(resolveLayoutsForJob(db, printer.hostname, 'parent')).toEqual([]);
  });

  it('returns just the primary layout when it has no also[] links', () => {
    const printer = makePrinter('B1');
    const [layout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printer.id }).returning().all();

    const result = resolveLayoutsForJob(db, printer.hostname, 'parent');
    expect(result.map((l) => l.id)).toEqual([layout!.id]);
  });

  it('appends also[] layouts, even when they target a different printer', () => {
    const printerA = makePrinter('B1');
    const printerB = makePrinter('B2');
    const [primary] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printerA.id }).returning().all();
    const [also] = db.insert(labelLayouts).values({ name: 'Sammelzettel', ctTypeKey: 'summary', printerId: printerB.id }).returning().all();
    db.insert(labelLayoutAlso).values({ layoutId: primary!.id, alsoLayoutId: also!.id }).run();

    const result = resolveLayoutsForJob(db, printerA.hostname, 'parent');
    expect(result.map((l) => l.id)).toEqual([primary!.id, also!.id]);
    expect(result[1]!.printerId).toBe(printerB.id);
  });

  it('resolves the PRIMARY layout to a different physical printer sharing the same hostname (v1 routing-mode: one CT location, per-type physical printer)', () => {
    const legA = makePrinter('B2'); // z.B. Etikettendrucker für "child", 54mm
    const legB = db.insert(printers).values({ name: 'B2', hostname: 'B2', vendor: 'zebra-zpl', host: '10.0.0.2' }).returning().all()[0]!; // "parent", anderes Format, anderer physischer Drucker

    const [childLayout] = db.insert(labelLayouts).values({ name: 'Kind', ctTypeKey: 'child', printerId: legA.id }).returning().all();
    const [parentLayout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: legB.id }).returning().all();

    expect(resolveLayoutsForJob(db, 'B2', 'child').map((l) => l.id)).toEqual([childLayout!.id]);
    expect(resolveLayoutsForJob(db, 'B2', 'parent').map((l) => l.id)).toEqual([parentLayout!.id]);
  });
});
