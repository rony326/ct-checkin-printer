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
  it('returns an empty array when no layout matches the printer + ctTypeKey', () => {
    const printer = makePrinter('B1');
    expect(resolveLayoutsForJob(db, printer.id, 'parent')).toEqual([]);
  });

  it('returns just the primary layout when it has no also[] links', () => {
    const printer = makePrinter('B1');
    const [layout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printer.id }).returning().all();

    const result = resolveLayoutsForJob(db, printer.id, 'parent');
    expect(result.map((l) => l.id)).toEqual([layout!.id]);
  });

  it('appends also[] layouts, even when they target a different printer', () => {
    const printerA = makePrinter('B1');
    const printerB = makePrinter('B2');
    const [primary] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printerA.id }).returning().all();
    const [also] = db.insert(labelLayouts).values({ name: 'Sammelzettel', ctTypeKey: 'summary', printerId: printerB.id }).returning().all();
    db.insert(labelLayoutAlso).values({ layoutId: primary!.id, alsoLayoutId: also!.id }).run();

    const result = resolveLayoutsForJob(db, printerA.id, 'parent');
    expect(result.map((l) => l.id)).toEqual([primary!.id, also!.id]);
    expect(result[1]!.printerId).toBe(printerB.id);
  });
});
