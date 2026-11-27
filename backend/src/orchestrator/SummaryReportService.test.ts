import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { documentPrinters, logos, mediaTypes, printerGroups, printLog, printers, summaryLayouts } from '../db/schema.js';
import type { LabelPrinterAdapter } from '../adapters/printer/types.js';
import type { DocumentPrinterAdapter } from '../adapters/printer/types.js';
import * as summaryRenderer from '../rendering/SummaryRenderer.js';
import { getUploadsDir } from '../storage/uploadsDir.js';
import { SummaryReportService } from './SummaryReportService.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
/** Verzeichnis ohne hochgeladene Dateien — Logo-Zeilen in den Tests zeigen also immer ins Leere. */
const dbPath = path.join(tmpdir(), 'summary-report-service-test', 'app.db');

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
  it('groups all received check-ins by group, failed prints included, and prints one strip per group', async () => {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const media = db.insert(mediaTypes).values({ vendor: 'brother-ql', externalId: '62', name: '62mm', widthMm: 62, heightMm: null, printableWidthMm: 60 }).returning().all()[0]!;
    const [outputGroup] = db.insert(printerGroups).values({ name: 'Ausgabe', hostname: 'OUT' }).returning().all();
    const outputPrinter = db.insert(printers).values({ groupId: outputGroup!.id, name: 'Ausgabe', vendor: 'brother-ql', host: '10.0.0.9', mediaId: media.id }).returning().all()[0]!;

    insertPrintLog({ printerId: printer.id, groupName: 'Kids', personName: 'Max Muster', code: 'ZRYK' });
    insertPrintLog({ printerId: printer.id, groupName: 'Teens', personName: 'Erika Muster', code: 'AB12' });
    insertPrintLog({ printerId: printer.id, groupName: 'Minis', personName: 'Failed Person', code: 'XX99', status: 'failed' });

    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', printerId: outputPrinter.id }).returning().all();
    const label = fakeLabelAdapter();
    const service = new SummaryReportService({ db, dbPath, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(true);
    expect(result.groupsFailed).toBe(0);
    expect(result.empty).toBe(false);
    expect(result.groupsPrinted).toBe(3); // Kids, Teens, Minis — auch wer nur einen fehlgeschlagenen Druck hat, war da
    expect(label.adapter.printLabel).toHaveBeenCalledTimes(3);
  });

  it('reports zero groups without touching any adapter when there is nothing to summarize', async () => {
    const [outputGroup] = db.insert(printerGroups).values({ name: 'Ausgabe', hostname: 'OUT' }).returning().all();
    const outputPrinter = db.insert(printers).values({ groupId: outputGroup!.id, name: 'Ausgabe', vendor: 'brother-ql', host: '10.0.0.9' }).returning().all()[0]!;
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', printerId: outputPrinter.id }).returning().all();
    const label = fakeLabelAdapter();
    const service = new SummaryReportService({ db, dbPath, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.groupsPrinted).toBe(0);
    expect(result.empty).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.groupsFailed).toBe(0);
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
    const service = new SummaryReportService({ db, dbPath, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

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
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.groupsPrinted).toBe(1);
    expect(documentAdapters.adapter.printDocument).toHaveBeenCalledTimes(1);
    const [pdfArg] = (documentAdapters.adapter.printDocument as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(Buffer.isBuffer(pdfArg)).toBe(true);
  });
});

describe('SummaryReportService.generate — Listeninhalt', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hands the renderer each person once with the earliest time, guests first', async () => {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const docPrinter = db.insert(documentPrinters).values({ name: 'Büro', host: '10.0.0.50' }).returning().all()[0]!;
    insertPrintLog({ printerId: printer.id, printedAt: '2026-11-27 09:30:00' });
    insertPrintLog({ printerId: printer.id, printedAt: '2026-11-27 08:55:00', status: 'failed' });
    insertPrintLog({ printerId: printer.id, printedAt: '2026-11-27 09:40:00', personName: 'Gast 1', code: 'QX7P' });
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', documentPrinterId: docPrinter.id }).returning().all();
    const render = vi.spyOn(summaryRenderer, 'renderSummaryPdf');
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters: fakeDocumentAdapter() });

    await service.generate(layout!.id, ...WIDE_WINDOW);

    const localTime = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0].rows).toEqual([
      { name: 'Gast 1', code: 'QX7P', checkinTime: localTime('2026-11-27T09:40:00Z'), isGuest: true },
      { name: 'Max Muster', code: 'ZRYK', checkinTime: localTime('2026-11-27T08:55:00Z'), isGuest: false },
    ]);
  });
});

describe('SummaryReportService.generate — Design', () => {
  afterEach(() => vi.restoreAllMocks());

  function setupDesignLayout(designJson: NonNullable<typeof summaryLayouts.$inferInsert.designJson>) {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const docPrinter = db.insert(documentPrinters).values({ name: 'Büro', host: '10.0.0.50' }).returning().all()[0]!;
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', documentPrinterId: docPrinter.id, designJson }).returning().all();
    return { printer, layout: layout! };
  }

  it('prints without logo when the logo file is missing', async () => {
    const logo = db.insert(logos).values({ name: 'Logo', filePath: 'fehlt.png' }).returning().all()[0]!;
    const { printer, layout } = setupDesignLayout({ logoId: logo.id });
    insertPrintLog({ printerId: printer.id });
    const render = vi.spyOn(summaryRenderer, 'renderSummaryPdf');
    const documentAdapters = fakeDocumentAdapter();
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters });

    const result = await service.generate(layout.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(true);
    expect(documentAdapters.adapter.printDocument).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0].logo).toBeUndefined();
  });

  it('hands an existing logo file to the renderer', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'summary-logo-'));
    const withUploads = path.join(dir, 'app.db');
    writeFileSync(path.join(getUploadsDir(withUploads, 'logos'), 'logo.png'), 'bilddaten');
    const logo = db.insert(logos).values({ name: 'Logo', filePath: 'logo.png' }).returning().all()[0]!;
    const { printer, layout } = setupDesignLayout({ logoId: logo.id });
    insertPrintLog({ printerId: printer.id });
    const render = vi.spyOn(summaryRenderer, 'renderSummaryPdf');
    const service = new SummaryReportService({ db, dbPath: withUploads, labelAdapters: fakeLabelAdapter(), documentAdapters: fakeDocumentAdapter() });

    await service.generate(layout.id, ...WIDE_WINDOW);

    expect(render.mock.calls[0]![0].logo?.toString()).toBe('bilddaten');
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses the guest keyword and hands the resolved design to the renderer', async () => {
    const { printer, layout } = setupDesignLayout({ orientation: 'portrait', guestColumn: { enabled: true, header: 'Name Gast', keyword: 'Besuch' } });
    insertPrintLog({ printerId: printer.id, personName: 'Besuch 1', code: 'QX7P' });
    insertPrintLog({ printerId: printer.id, personName: 'Gast 1', code: 'AB12' });
    const render = vi.spyOn(summaryRenderer, 'renderSummaryPdf');
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters: fakeDocumentAdapter() });

    await service.generate(layout.id, ...WIDE_WINDOW);

    const input = render.mock.calls[0]![0];
    expect(input.rows.map((r) => [r.name, r.isGuest])).toEqual([
      ['Besuch 1', true],
      ['Gast 1', false],
    ]);
    expect(input.design).toMatchObject({ orientation: 'portrait', fontSize: 11 });
    expect(input.title).toContain('Kids');
    expect(input.printedAt).toBeInstanceOf(Date);
  });
});

describe('SummaryReportService.generate — Fehlerfälle', () => {
  it('returns ok:false for an unknown summary layout id', async () => {
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters: fakeDocumentAdapter() });
    const result = await service.generate(9999, new Date(), new Date());
    expect(result.ok).toBe(false);
  });

  function setupDocPrinterLayout(groups: string[]) {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    const docPrinter = db.insert(documentPrinters).values({ name: 'Büro', host: '10.0.0.50' }).returning().all()[0]!;
    for (const groupName of groups) insertPrintLog({ printerId: printer.id, groupName });
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', documentPrinterId: docPrinter.id }).returning().all();
    return { layout: layout!, docPrinter };
  }

  it('reports ok:false with the printer error when the document printer fails', async () => {
    const { layout } = setupDocPrinterLayout(['Kids']);
    const documentAdapters = fakeDocumentAdapter();
    (documentAdapters.adapter.printDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, errorMessage: 'IPP: connection refused' });
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters });

    const result = await service.generate(layout.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(false);
    expect(result.groupsPrinted).toBe(0);
    expect(result.groupsFailed).toBe(1);
    expect(result.message).toContain('IPP: connection refused');
    expect(result.message).toContain('Kids');
  });

  it('keeps printing remaining groups after one group fails', async () => {
    const { layout } = setupDocPrinterLayout(['Kids', 'Teens']);
    const documentAdapters = fakeDocumentAdapter();
    (documentAdapters.adapter.printDocument as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: false, errorMessage: 'Papierstau' })
      .mockResolvedValueOnce({ success: true });
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters });

    const result = await service.generate(layout.id, ...WIDE_WINDOW);

    expect(documentAdapters.adapter.printDocument).toHaveBeenCalledTimes(2);
    expect(result.groupsPrinted).toBe(1);
    expect(result.groupsFailed).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('treats a thrown adapter error as a failed group', async () => {
    const { layout } = setupDocPrinterLayout(['Kids']);
    const documentAdapters = fakeDocumentAdapter();
    (documentAdapters.adapter.printDocument as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('socket hang up'));
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters });

    const result = await service.generate(layout.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(false);
    expect(result.groupsFailed).toBe(1);
    expect(result.message).toContain('socket hang up');
  });

  it('reports ok:false when the referenced document printer no longer exists', async () => {
    const { layout, docPrinter } = setupDocPrinterLayout(['Kids']);
    db.$client.pragma('foreign_keys = OFF');
    db.delete(documentPrinters).where(eq(documentPrinters.id, docPrinter.id)).run();
    const service = new SummaryReportService({ db, dbPath, labelAdapters: fakeLabelAdapter(), documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(false);
    expect(result.groupsFailed).toBe(1);
  });

  it('reports ok:false when the label printer has no media', async () => {
    const [printerGroup] = db.insert(printerGroups).values({ name: 'B1', hostname: 'B1' }).returning().all();
    const printer = db.insert(printers).values({ groupId: printerGroup!.id, name: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all()[0]!;
    insertPrintLog({ printerId: printer.id });
    const [layout] = db.insert(summaryLayouts).values({ name: 'Sammel', printerId: printer.id }).returning().all();
    const label = fakeLabelAdapter();
    const service = new SummaryReportService({ db, dbPath, labelAdapters: label, documentAdapters: fakeDocumentAdapter() });

    const result = await service.generate(layout!.id, ...WIDE_WINDOW);

    expect(result.ok).toBe(false);
    expect(result.groupsFailed).toBe(1);
    expect(label.adapter.printLabel).not.toHaveBeenCalled();
  });
});
