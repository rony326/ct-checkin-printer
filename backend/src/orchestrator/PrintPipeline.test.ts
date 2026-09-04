import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { labelLayoutAlso, labelLayouts, mediaTypes, printLog, printQueue, printerGroups, printers, type LabelElement } from '../db/schema.js';
import { PrinterStatus, type LabelPrinterAdapter, type PrinterStatusResult } from '../adapters/printer/types.js';
import { PrintPipeline } from './PrintPipeline.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
const env = { DB_PATH: '/tmp/does-not-matter/app.db', ENCRYPTION_KEY: 'x' } as Env;

const RAW_DATA = 'name=Max Muster\nid=2693\ncode=ZRYK\ngroup=Kids\ntype=parent';

function makeAdapter(overrides: Partial<LabelPrinterAdapter> = {}): LabelPrinterAdapter {
  const onlineStatus: PrinterStatusResult = { status: PrinterStatus.ONLINE, humanMessage: 'OK', source: 'print-channel', timestamp: new Date() };
  return {
    vendor: 'brother-ql',
    connect: vi.fn(async () => {}),
    printLabel: vi.fn(async () => ({ success: true })),
    getStatus: vi.fn(async () => onlineStatus),
    getStatusFromPrintChannel: vi.fn(async () => onlineStatus),
    listSupportedMedia: vi.fn(() => []),
    ...overrides,
  };
}

function makeMedia(vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  return db
    .insert(mediaTypes)
    .values({ vendor, externalId: '62', name: '62mm', widthMm: 62, heightMm: null, printableWidthMm: 60 })
    .returning()
    .all()[0]!;
}

function makePrinter(hostname: string, vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  const [group] = db.insert(printerGroups).values({ name: hostname, hostname }).returning().all();
  const [leg] = db.insert(printers).values({ groupId: group!.id, name: hostname, vendor, host: '10.0.0.1' }).returning().all();
  return { ...leg!, hostname: group!.hostname };
}

const STATIC_ELEMENTS: LabelElement[] = [{ id: 'a', type: 'static', xMm: 1, yMm: 1, value: 'Hallo', fontSize: 10, bold: false, align: 'left' }];

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

describe('PrintPipeline.processIncomingJob', () => {
  it('renders and prints the matching layout, then logs success', async () => {
    const printer = makePrinter('B1');
    const media = makeMedia();
    db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printer.id, mediaId: media.id, elementsJson: STATIC_ELEMENTS }).run();
    const adapter = makeAdapter();
    const pipeline = new PrintPipeline({ db, env, adapters: { getAdapter: async () => adapter } });

    const result = await pipeline.processIncomingJob(printer.hostname, RAW_DATA, () => 1735600000000);

    expect(result.enriched).toBe(true);
    expect(result.printed).toBe(1);
    expect(result.queued).toBe(0);
    expect(adapter.printLabel).toHaveBeenCalledTimes(1);

    const logs = db.select().from(printLog).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('success');
    expect(logs[0]!.labelType).toBe('parent');
    expect(logs[0]!.groupName).toBe('Kids');
    expect(logs[0]!.personName).toBe('Max Muster');
    expect(logs[0]!.code).toBe('ZRYK');
    expect(logs[0]!.qrHash).toMatch(/^[0-9a-f]{40}$/);
    expect(db.select().from(printQueue).all()).toHaveLength(0);
  });

  it('does nothing when the raw data is empty', async () => {
    const printer = makePrinter('B1');
    const pipeline = new PrintPipeline({ db, env, adapters: { getAdapter: async () => makeAdapter() } });

    const result = await pipeline.processIncomingJob(printer.hostname, '   ', () => Date.now());

    expect(result.enriched).toBe(false);
    expect(db.select().from(printLog).all()).toHaveLength(0);
  });

  it('enqueues the job and logs a failure when the target printer is not ready', async () => {
    const printer = makePrinter('B1');
    const media = makeMedia();
    db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printer.id, mediaId: media.id, elementsJson: STATIC_ELEMENTS }).run();
    const notReadyStatus: PrinterStatusResult = { status: PrinterStatus.PAPER_EMPTY, humanMessage: 'Kein Papier mehr', source: 'print-channel', timestamp: new Date() };
    const adapter = makeAdapter({ getStatus: vi.fn(async () => notReadyStatus) });
    const pipeline = new PrintPipeline({ db, env, adapters: { getAdapter: async () => adapter } });

    const result = await pipeline.processIncomingJob(printer.hostname, RAW_DATA, () => 1735600000000);

    expect(result.printed).toBe(0);
    expect(result.queued).toBe(1);
    expect(adapter.printLabel).not.toHaveBeenCalled();

    const [queued] = db.select().from(printQueue).all();
    expect(queued!.reason).toBe('Kein Papier mehr');
    expect(queued!.printError).toBe(false);
    expect(queued!.printerId).toBe(printer.id);

    const [log] = db.select().from(printLog).all();
    expect(log!.status).toBe('failed');
    expect(log!.errorMessage).toBe('Kein Papier mehr');
  });

  it('enqueues the job with printError=true when printing itself fails', async () => {
    const printer = makePrinter('B1');
    const media = makeMedia();
    db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printer.id, mediaId: media.id, elementsJson: STATIC_ELEMENTS }).run();
    const adapter = makeAdapter({ printLabel: vi.fn(async () => ({ success: false, errorMessage: 'Kabel raus' })) });
    const pipeline = new PrintPipeline({ db, env, adapters: { getAdapter: async () => adapter } });

    const result = await pipeline.processIncomingJob(printer.hostname, RAW_DATA, () => 1735600000000);

    expect(result.queued).toBe(1);
    const [queued] = db.select().from(printQueue).all();
    expect(queued!.printError).toBe(true);
    expect(queued!.reason).toBe('Kabel raus');
  });

  it('does not print or queue anything when no layout matches the ctTypeKey, but still reports the job as enriched', async () => {
    const printer = makePrinter('B1');
    const pipeline = new PrintPipeline({ db, env, adapters: { getAdapter: async () => makeAdapter() } });

    const result = await pipeline.processIncomingJob(printer.hostname, RAW_DATA, () => 1735600000000);

    expect(result.enriched).toBe(true);
    expect(result.printed).toBe(0);
    expect(result.queued).toBe(0);
    expect(db.select().from(printQueue).all()).toHaveLength(0);
  });

  it('also prints also[]-linked layouts on a different target printer', async () => {
    const printerA = makePrinter('B1');
    const printerB = makePrinter('B2');
    const media = makeMedia();
    const [primary] = db
      .insert(labelLayouts)
      .values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printerA.id, mediaId: media.id, elementsJson: STATIC_ELEMENTS })
      .returning()
      .all();
    const [also] = db
      .insert(labelLayouts)
      .values({ name: 'Sammelzettel', ctTypeKey: 'summary', printerId: printerB.id, mediaId: media.id, elementsJson: STATIC_ELEMENTS })
      .returning()
      .all();
    db.insert(labelLayoutAlso).values({ layoutId: primary!.id, alsoLayoutId: also!.id }).run();

    const adapterA = makeAdapter();
    const adapterB = makeAdapter();
    const pipeline = new PrintPipeline({
      db,
      env,
      adapters: { getAdapter: async (p) => (p.id === printerA.id ? adapterA : adapterB) },
    });

    const result = await pipeline.processIncomingJob(printerA.hostname, RAW_DATA, () => 1735600000000);

    expect(result.printed).toBe(2);
    expect(adapterA.printLabel).toHaveBeenCalledTimes(1);
    expect(adapterB.printLabel).toHaveBeenCalledTimes(1);
    const labelTypes = db.select().from(printLog).all().map((l) => l.labelType);
    expect(labelTypes.sort()).toEqual(['parent', 'summary']);
  });
});

describe('PrintPipeline.retryQueuedJob', () => {
  it('re-renders and reprints a queued entry from its stored payload', async () => {
    const printer = makePrinter('B1');
    const media = makeMedia();
    const [layout] = db
      .insert(labelLayouts)
      .values({ name: 'Eltern', ctTypeKey: 'parent', printerId: printer.id, mediaId: media.id, elementsJson: STATIC_ELEMENTS })
      .returning()
      .all();
    const [entry] = db
      .insert(printQueue)
      .values({ printerId: printer.id, layoutId: layout!.id, jobPayloadJson: { rawData: RAW_DATA, unixTimestampSeconds: 1735600000 }, reason: 'Drucker nicht erreichbar' })
      .returning()
      .all();

    const adapter = makeAdapter();
    const pipeline = new PrintPipeline({ db, env, adapters: { getAdapter: async () => adapter } });

    const result = await pipeline.retryQueuedJob(entry!);

    expect(result.success).toBe(true);
    expect(adapter.printLabel).toHaveBeenCalledTimes(1);
  });
});
