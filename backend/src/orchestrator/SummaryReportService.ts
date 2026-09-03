import { and, eq, gte, lt } from 'drizzle-orm';
import { toMediaDefinition } from '../api/labelLayouts.js';
import type { LabelPrinterAdapter, DocumentPrinterAdapter } from '../adapters/printer/types.js';
import type { Db } from '../db/client.js';
import { documentPrinters, mediaTypes, printLog, printers, summaryLayouts } from '../db/schema.js';
import { VENDOR_DPI } from '../rendering/dimensions.js';
import { renderSummaryLabelStrip, renderSummaryPdf, type SummaryColumn, type SummaryColumnKey, type SummaryRow } from '../rendering/SummaryRenderer.js';

export interface SummaryLabelAdapters {
  getAdapter(printer: { id: number; vendor: 'brother-ql' | 'zebra-zpl'; name: string; host: string; port: number }): Promise<LabelPrinterAdapter>;
}

export interface SummaryDocumentAdapters {
  getAdapter(documentPrinter: { id: number; host: string; port: number; ippQueue: string }): Promise<DocumentPrinterAdapter>;
}

export interface SummaryReportDeps {
  db: Db;
  labelAdapters: SummaryLabelAdapters;
  documentAdapters: SummaryDocumentAdapters;
}

export interface GenerateSummaryResult {
  ok: boolean;
  message?: string;
  groupsPrinted: number;
}

const COLUMN_LABELS: Record<SummaryColumnKey, string> = { name: 'Name', code: 'Code', checkinTime: 'Zeit' };
const UNGROUPED_LABEL = 'Ohne Gruppe';

function toSqliteUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatTime(printedAt: string): string {
  // SQLite `current_timestamp` liefert UTC ohne Zeitzonen-Marker — vor dem Parsen explizit als UTC kennzeichnen
  // (siehe printQueueStore.ts, derselbe Stolperstein: sonst wird lokal interpretiert).
  const date = new Date(`${printedAt.replace(' ', 'T')}Z`);
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function isSummaryColumnKey(key: string): key is SummaryColumnKey {
  return key === 'name' || key === 'code' || key === 'checkinTime';
}

/**
 * Gruppen-Sammelausdruck (Bauschritt 10, siehe Plan). Datenquelle ist
 * ausschliesslich der eigene `print_log` (erfolgreiche Drucke im
 * Zeitfenster) — der optionale `verify_against_ct`-Abgleich gegen
 * ChurchTools' eigene Checkin-Liste ist im Schema vorgesehen, aber noch
 * NICHT implementiert (erfordert Recherche zu einem oldApi-Endpunkt für
 * gruppenweise Checkin-Listen, die für diesen Plan nie gemacht wurde) —
 * bewusste Lücke, siehe Projekt-Memory.
 */
export class SummaryReportService {
  constructor(private readonly deps: SummaryReportDeps) {}

  async generate(summaryLayoutId: number, since: Date, until: Date): Promise<GenerateSummaryResult> {
    const layout = this.deps.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, summaryLayoutId)).get();
    if (!layout) return { ok: false, message: 'Sammel-Layout nicht gefunden', groupsPrinted: 0 };

    const grouped = this.collectGroupedRows(since, until);
    const columns = this.resolveColumns(layout.columnsJson);

    for (const [groupName, rows] of grouped) {
      const title = layout.titleTemplate.replace('{{checkin.group}}', groupName);
      if (layout.printerId) {
        await this.printToLabelPrinter(layout.printerId, rows, columns, title);
      } else if (layout.documentPrinterId) {
        await this.printToDocumentPrinter(layout.documentPrinterId, rows, columns, title);
      }
    }

    return { ok: true, groupsPrinted: grouped.size };
  }

  private collectGroupedRows(since: Date, until: Date): Map<string, SummaryRow[]> {
    const rows = this.deps.db
      .select()
      .from(printLog)
      .where(and(eq(printLog.status, 'success'), gte(printLog.printedAt, toSqliteUtcTimestamp(since)), lt(printLog.printedAt, toSqliteUtcTimestamp(until))))
      .all();

    const grouped = new Map<string, SummaryRow[]>();
    for (const row of rows) {
      const groupName = row.groupName ?? UNGROUPED_LABEL;
      const summaryRow: SummaryRow = { name: row.personName ?? '', code: row.code ?? '', checkinTime: formatTime(row.printedAt) };
      grouped.set(groupName, [...(grouped.get(groupName) ?? []), summaryRow]);
    }
    return grouped;
  }

  private resolveColumns(columnsJson: string[]): SummaryColumn[] {
    return columnsJson.filter(isSummaryColumnKey).map((key) => ({ key, label: COLUMN_LABELS[key] }));
  }

  private async printToLabelPrinter(printerId: number, rows: SummaryRow[], columns: SummaryColumn[], title: string): Promise<void> {
    const printer = this.deps.db.select().from(printers).where(eq(printers.id, printerId)).get();
    if (!printer?.mediaId) return;
    const mediaRow = this.deps.db.select().from(mediaTypes).where(eq(mediaTypes.id, printer.mediaId)).get();
    if (!mediaRow) return;

    const media = toMediaDefinition(mediaRow);
    const bitmap = await renderSummaryLabelStrip(rows, columns, title, media, VENDOR_DPI[printer.vendor]);
    const adapter = await this.deps.labelAdapters.getAdapter(printer);
    await adapter.printLabel(bitmap, media, { copies: 1, rotate: '0' });
  }

  private async printToDocumentPrinter(documentPrinterId: number, rows: SummaryRow[], columns: SummaryColumn[], title: string): Promise<void> {
    const docPrinter = this.deps.db.select().from(documentPrinters).where(eq(documentPrinters.id, documentPrinterId)).get();
    if (!docPrinter) return;

    const pdf = await renderSummaryPdf(rows, columns, title);
    const adapter = await this.deps.documentAdapters.getAdapter(docPrinter);
    await adapter.printDocument(pdf, { copies: 1 });
  }
}
