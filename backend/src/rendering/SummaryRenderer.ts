import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import PDFDocument from 'pdfkit';
import type { MediaDefinition, RenderedBitmap } from '../adapters/printer/types.js';
import { ensureFallbackFontsRegistered, FALLBACK_BOLD_FAMILY, FALLBACK_REGULAR_FAMILY } from './LabelRenderer.js';
import { mmToPx } from './dimensions.js';

/**
 * Gruppen-Sammelausdruck (Bauschritt 10, siehe Plan) — anders als
 * `LabelRenderer.renderLabel()` KEIN frei positioniertes Editor-Layout,
 * sondern eine simple Tabelle mit einer Zeile je Person, deren Zeilenzahl
 * erst zur Druckzeit bekannt ist. Zwei getrennte Ausgabewege: fortlaufender
 * Etikettenstreifen (`renderSummaryLabelStrip`, über den bestehenden
 * `LabelPrinterAdapter` im Endlosband-Modus) und PDF (`renderSummaryPdf`,
 * über den `DocumentPrinterAdapter`/IPP).
 */
export interface SummaryRow {
  name: string;
  code: string;
  checkinTime: string;
}

export type SummaryColumnKey = 'name' | 'code' | 'checkinTime';

export interface SummaryColumn {
  key: SummaryColumnKey;
  label: string;
}

const TITLE_FONT_PX = 32;
const HEADER_FONT_PX = 20;
const ROW_FONT_PX = 22;
const LINE_HEIGHT_FACTOR = 1.4;
const MARGIN_MM = 3;
const MIN_HEIGHT_MM = 15;
/** Anteil der Medienbreite, an dem jede Spalte beginnt (siehe COLUMNS-Reihenfolge). */
const COLUMN_X_FRACTIONS: Record<SummaryColumnKey, number> = { name: 0, code: 0.55, checkinTime: 0.78 };

function drawRow(ctx: SKRSContext2D, columns: SummaryColumn[], values: Record<SummaryColumnKey, string>, xMm: number, yPx: number, widthMm: number, dpi: number): void {
  for (const column of columns) {
    const x = mmToPx(xMm + widthMm * COLUMN_X_FRACTIONS[column.key], dpi);
    ctx.fillText(values[column.key], x, yPx);
  }
}

/** Endlosband-Streifen mit dynamischer Höhe — eine Zeile je Person, gruppiert bereits vom `SummaryReportService`. */
export async function renderSummaryLabelStrip(rows: SummaryRow[], columns: SummaryColumn[], title: string, media: MediaDefinition, dpi: number): Promise<RenderedBitmap> {
  ensureFallbackFontsRegistered();

  const widthPx = mmToPx(media.widthMm, dpi);
  const titleLineHeightPx = TITLE_FONT_PX * LINE_HEIGHT_FACTOR;
  const headerLineHeightPx = HEADER_FONT_PX * LINE_HEIGHT_FACTOR;
  const rowLineHeightPx = ROW_FONT_PX * LINE_HEIGHT_FACTOR;
  const contentHeightPx = titleLineHeightPx + headerLineHeightPx + rows.length * rowLineHeightPx;
  const heightMm = Math.max((contentHeightPx * 25.4) / dpi + MARGIN_MM * 2, MIN_HEIGHT_MM);
  const heightPx = mmToPx(heightMm, dpi);

  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = 'black';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  let yPx = mmToPx(MARGIN_MM, dpi);
  ctx.font = `${TITLE_FONT_PX}px ${FALLBACK_BOLD_FAMILY}`;
  ctx.fillText(title, mmToPx(MARGIN_MM, dpi), yPx);
  yPx += titleLineHeightPx;

  const headerValues = { name: '', code: '', checkinTime: '' } as Record<SummaryColumnKey, string>;
  for (const column of columns) headerValues[column.key] = column.label;

  ctx.font = `${HEADER_FONT_PX}px ${FALLBACK_BOLD_FAMILY}`;
  drawRow(ctx, columns, headerValues, MARGIN_MM, yPx, media.widthMm - MARGIN_MM * 2, dpi);
  yPx += headerLineHeightPx;

  ctx.font = `${ROW_FONT_PX}px ${FALLBACK_REGULAR_FAMILY}`;
  for (const row of rows) {
    drawRow(ctx, columns, row, MARGIN_MM, yPx, media.widthMm - MARGIN_MM * 2, dpi);
    yPx += rowLineHeightPx;
  }

  return { data: canvas.toBuffer('image/png'), widthPx, heightPx };
}

/** A4-PDF-Tabelle für den IPP/Büro-Netzwerkdrucker-Pfad. */
export function renderSummaryPdf(rows: SummaryRow[], columns: SummaryColumn[], title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(title, { align: 'center' });
    doc.moveDown();

    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(columns.map((c) => c.label).join('    '));
    doc.moveDown(0.5);

    doc.font('Helvetica');
    for (const row of rows) {
      doc.text(columns.map((c) => row[c.key]).join('    '));
    }
    if (rows.length === 0) doc.font('Helvetica-Oblique').text('Keine Check-ins in diesem Zeitraum.');

    doc.end();
  });
}
