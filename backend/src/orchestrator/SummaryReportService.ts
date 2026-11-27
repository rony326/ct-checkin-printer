import { and, eq, gte, lt } from 'drizzle-orm';
import { toMediaDefinition } from '../api/labelLayouts.js';
import type { LabelPrinterAdapter, DocumentPrinterAdapter, PrintResult } from '../adapters/printer/types.js';
import type { Db } from '../db/client.js';
import { documentPrinters, mediaTypes, printLog, printers, summaryLayouts } from '../db/schema.js';
import { VENDOR_DPI } from '../rendering/dimensions.js';
import { resolveSummaryDesign, type SummaryDesign } from '../rendering/summaryDesign.js';
import { renderSummaryLabelStrip, renderSummaryPdf, type SummaryColumn, type SummaryColumnKey, type SummaryRow } from '../rendering/SummaryRenderer.js';
import { loadLogoBuffers } from './renderAssets.js';
import { groupSummaryRows, type SummaryEntry } from './summaryData.js';

export interface SummaryLabelAdapters {
  getAdapter(printer: { id: number; vendor: 'brother-ql' | 'zebra-zpl'; name: string; host: string; port: number }): Promise<LabelPrinterAdapter>;
}

export interface SummaryDocumentAdapters {
  getAdapter(documentPrinter: { id: number; host: string; port: number; ippQueue: string }): Promise<DocumentPrinterAdapter>;
}

export interface SummaryReportDeps {
  db: Db;
  /** Pfad der SQLite-Datei — die hochgeladenen Logos liegen daneben. */
  dbPath: string;
  labelAdapters: SummaryLabelAdapters;
  documentAdapters: SummaryDocumentAdapters;
}

export interface GenerateSummaryResult {
  ok: boolean;
  message?: string;
  groupsPrinted: number;
  groupsFailed: number;
  /** true = keine empfangenen Check-ins im Zeitraum, nichts gedruckt (ok bleibt true). */
  empty: boolean;
}

const COLUMN_LABELS: Record<SummaryColumnKey, string> = { name: 'Name', code: 'Code', checkinTime: 'Zeit' };

export function toSqliteUtcTimestamp(date: Date): string {
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

// Die folgenden Schritte teilen sich Ausdruck und Vorschau, damit beide gleich aussehen.

export function toSummaryRows(entries: SummaryEntry[]): SummaryRow[] {
  return entries.map(({ name, code, printedAt, isGuest }) => ({ name, code, checkinTime: formatTime(printedAt), isGuest }));
}

export function resolveSummaryColumns(columnsJson: string[]): SummaryColumn[] {
  return columnsJson.filter(isSummaryColumnKey).map((key) => ({ key, label: COLUMN_LABELS[key] }));
}

export function formatSummaryTitle(titleTemplate: string, groupName: string): string {
  return titleTemplate.replace('{{checkin.group}}', groupName);
}

/** Ein fehlendes oder unlesbares Logo darf die Liste nie verhindern. */
async function loadLogo(db: Db, dbPath: string, logoId: number | null): Promise<Buffer | undefined> {
  if (logoId === null) return undefined;
  try {
    return (await loadLogoBuffers(db, dbPath, [logoId]))[logoId];
  } catch {
    return undefined;
  }
}

/** A4-Liste einer Gruppe samt dem im Design gewählten Logo. */
export async function renderGroupPdf(
  { db, dbPath }: Pick<SummaryReportDeps, 'db' | 'dbPath'>,
  rows: SummaryRow[],
  columns: SummaryColumn[],
  title: string,
  design: SummaryDesign,
): Promise<Buffer> {
  const logo = await loadLogo(db, dbPath, design.logoId);
  return renderSummaryPdf({ rows, columns, title, design, logo, printedAt: new Date() });
}

/**
 * Gruppen-Sammelausdruck (Bauschritt 10, siehe Plan). Datenquelle ist
 * ausschliesslich der eigene `print_log` (alle empfangenen Check-ins im
 * Zeitfenster, auch mit fehlgeschlagenem Druck) — der optionale `verify_against_ct`-Abgleich gegen
 * ChurchTools' eigene Checkin-Liste ist im Schema vorgesehen, aber noch
 * NICHT implementiert (erfordert Recherche zu einem oldApi-Endpunkt für
 * gruppenweise Checkin-Listen, die für diesen Plan nie gemacht wurde) —
 * bewusste Lücke, siehe Projekt-Memory.
 */
export class SummaryReportService {
  constructor(private readonly deps: SummaryReportDeps) {}

  async generate(summaryLayoutId: number, since: Date, until: Date): Promise<GenerateSummaryResult> {
    const layout = this.deps.db.select().from(summaryLayouts).where(eq(summaryLayouts.id, summaryLayoutId)).get();
    if (!layout) return { ok: false, message: 'Sammel-Layout nicht gefunden', groupsPrinted: 0, groupsFailed: 0, empty: false };

    const design = resolveSummaryDesign(layout.designJson);
    const grouped = this.collectGroupedRows(since, until, design.guestColumn.keyword);
    const columns = resolveSummaryColumns(layout.columnsJson);

    let groupsPrinted = 0;
    let groupsFailed = 0;
    let message: string | undefined;

    for (const [groupName, rows] of grouped) {
      const title = formatSummaryTitle(layout.titleTemplate, groupName);
      let result: PrintResult;
      try {
        if (layout.printerId) {
          result = await this.printToLabelPrinter(layout.printerId, rows, columns, title);
        } else if (layout.documentPrinterId) {
          result = await this.printToDocumentPrinter(layout.documentPrinterId, rows, columns, title, design);
        } else {
          result = { success: false, errorMessage: 'Kein Ausgabedrucker im Sammel-Layout konfiguriert' };
        }
      } catch (err) {
        result = { success: false, errorMessage: err instanceof Error ? err.message : String(err) };
      }

      if (result.success) {
        groupsPrinted++;
      } else {
        groupsFailed++;
        message ??= `Gruppe „${groupName}“: ${result.errorMessage ?? 'Unbekannter Druckfehler'}`;
      }
    }

    return { ok: groupsFailed === 0, ...(message ? { message } : {}), groupsPrinted, groupsFailed, empty: grouped.size === 0 };
  }

  private collectGroupedRows(since: Date, until: Date, guestKeyword: string): Map<string, SummaryRow[]> {
    const rows = this.deps.db
      .select()
      .from(printLog)
      .where(and(gte(printLog.printedAt, toSqliteUtcTimestamp(since)), lt(printLog.printedAt, toSqliteUtcTimestamp(until))))
      .all();

    return new Map([...groupSummaryRows(rows, guestKeyword)].map(([groupName, entries]) => [groupName, toSummaryRows(entries)]));
  }

  private async printToLabelPrinter(printerId: number, rows: SummaryRow[], columns: SummaryColumn[], title: string): Promise<PrintResult> {
    const printer = this.deps.db.select().from(printers).where(eq(printers.id, printerId)).get();
    if (!printer) return { success: false, errorMessage: `Drucker „${printerId}“ nicht gefunden` };
    if (!printer.mediaId) return { success: false, errorMessage: `Drucker „${printer.name}“ hat kein Medium konfiguriert` };
    const mediaRow = this.deps.db.select().from(mediaTypes).where(eq(mediaTypes.id, printer.mediaId)).get();
    if (!mediaRow) return { success: false, errorMessage: `Medium von Drucker „${printer.name}“ nicht gefunden` };

    const media = toMediaDefinition(mediaRow);
    const bitmap = await renderSummaryLabelStrip(rows, columns, title, media, VENDOR_DPI[printer.vendor]);
    const adapter = await this.deps.labelAdapters.getAdapter(printer);
    return adapter.printLabel(bitmap, media, { copies: 1, rotate: '0' });
  }

  private async printToDocumentPrinter(documentPrinterId: number, rows: SummaryRow[], columns: SummaryColumn[], title: string, design: SummaryDesign): Promise<PrintResult> {
    const docPrinter = this.deps.db.select().from(documentPrinters).where(eq(documentPrinters.id, documentPrinterId)).get();
    if (!docPrinter) return { success: false, errorMessage: `Drucker „${documentPrinterId}“ nicht gefunden` };

    const pdf = await renderGroupPdf(this.deps, rows, columns, title, design);
    const adapter = await this.deps.documentAdapters.getAdapter(docPrinter);
    return adapter.printDocument(pdf, { copies: 1 });
  }
}
