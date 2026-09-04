import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { documentPrinters, mediaTypes, printerGroups, printLog, printers, summaryLayouts } from '../db/schema.js';
import type { LabelPrinterAdapter } from '../adapters/printer/types.js';
import type { DocumentPrinterAdapter } from '../adapters/printer/types.js';
import { SummaryReportService } from './SummaryReportService.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

/** Deckt "jetzt" garantiert ab — die Test-print_log-Zeilen nutzen den DB-Default `current_timestamp`. */
const WIDE_WINDOW: [Date, Date] = [new Date('2000-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z')];

function insertPrintLog(overrides: Partial<typeof printLog.$inferInsert> & { printerId: number }) {
  db.insert(printLog)
    .values({ labelType: 'parent', status: 'success', groupName: 'Kids', personName: 'Max Muster', code: 'ZRYK', ...overrides })
    .run();
}

function fakeLabelAdapter() {
  const adapter: Partial<LabelPrinterAdapter> = { printLabel: vi.fn(async () => ({ success: true })) };
  return { getAdapter: vi.fn(async () => adapter as LabelPrinterAdapter), adapter };
}

function fakeDocumentAdapter() {
  const adapter: Partial<DocumentPrinterAdapter> = { printDocument: vi.fn(async () => ({ success: true })) };
  return { getAdapter: vi.fn(async () => adapter as DocumentPrinterAdapter), adapter };
}

describe('SummaryReportService.generate — Endlosband-Ausgabe', () => {
  it('groups successful check-ins by group and prints one strip per group', async () => {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const media = db.insert(mediaTypes).values({ vendor: 'brother-ql', externalId: '62', name: '62mm', widthMm: 62, heightMm: null, printableWidthMm: 60 }).returning().all()[0]!;
    const [outputGroup] = db.insert(printerGroups).values({ name: 'Ausgabe', hostname: 'OUT' }).returning().all();
    const outputPrinter = db.insert(printers).values({ groupId: outputGroup!.id, name: 'Ausgabe', vendor: 'brother-ql', host: '10.0.0.9', mediaId: media.id }).returning().all()[0]!;

    insertPrintLog({ printerId: printer.id, groupName: 'Kids', personName: 'Max Muster', code: 'ZRYK' });
    insertPrintLog({ printerId: printer.id, groupName: 'Teens', personName: 'Erika Muster', code: 'AB12' });
    insertPrintLog({ printerId: printer.id, groupName: 'Kids', personName: 'Failed Person', code: 'XX99', status: 'failed' });

    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', printerId: outputPrinter.id }).returning().all();
    const label = fakeLabelAdapter();
    const service = new SummaryReportService({ db, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(true);
    expect(result.groupsPrinted).toBe(2); // Kids, Teens — der fehlgeschlagene Druck zählt nicht mit
    expect(label.adapter.printLabel).toHaveBeenCalledTimes(2);
  });

  it('reports zero groups without touching any adapter when there is nothing to summarize', async () => {
    const [outputGroup] = db.insert(printerGroups).values({ name: 'Ausgabe', hostname: 'OUT' }).returning().all();
    const outputPrinter = db.insert(printers).values({ groupId: outputGroup!.id, name: 'Ausgabe', vendor: 'brother-ql', host: '10.0.0.9' }).returning().all()[0]!;
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', printerId: outputPrinter.id }).returning().all();
    const label = fakeLabelAdapter();
    const service = new SummaryReportService({ db, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.groupsPrinted).toBe(0);
    expect(label.adapter.printLabel).not.toHaveBeenCalled();
  });

  it('only includes check-ins inside the requested time window', async () => {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const [outputGroup] = db.insert(printerGroups).values({ name: 'Ausgabe', hostname: 'OUT' }).returning().all();
    const outputPrinter = db.insert(printers).values({ groupId: outputGroup!.id, name: 'Ausgabe', vendor: 'brother-ql', host: '10.0.0.9' }).returning().all()[0]!;
    insertPrintLog({ printerId: printer.id, printedAt: '2020-01-01 10:00:00' });
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', printerId: outputPrinter.id }).returning().all();
    const label = fakeLabelAdapter();
    const service = new SummaryReportService({ db, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout!.id, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

    expect(result.groupsPrinted).toBe(0);
  });
});

describe('SummaryReportService.generate — IPP/PDF-Ausgabe', () => {
  it('renders a PDF and sends it to the configured document printer', async () => {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const docPrinter = db.insert(documentPrinters).values({ name: 'Büro', host: '10.0.0.50' }).returning().all()[0]!;
    insertPrintLog({ printerId: printer.id });
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', documentPrinterId: docPrinter.id }).returning().all();
    const documentAdapters = fakeDocumentAdapter();
    const service = new SummaryReportService({ db, labelAdapters: fakeLabelAdapter(), documentAdapters });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.groupsPrinted).toBe(1);
    expect(documentAdapters.adapter.printDocument).toHaveBeenCalledTimes(1);
    const [pdfArg] = (documentAdapters.adapter.printDocument as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(Buffer.isBuffer(pdfArg)).toBe(true);
  });
});

describe('SummaryReportService.generate — Fehlerfälle', () => {
  it('returns ok:false for an unknown summary layout id', async () => {
    const service = new SummaryReportService({ db, labelAdapters: fakeLabelAdapter(), documentAdapters: fakeDocumentAdapter() });
    const result = await service.generate(9999, new Date(), new Date());
    expect(result.ok).toBe(false);
  });
});
