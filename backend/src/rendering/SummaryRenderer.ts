import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import PDFDocument from 'pdfkit';
import { PNG } from 'pngjs';
import type { MediaDefinition, RenderedBitmap } from '../adapters/printer/types.js';
import {
  ensureFallbackFontsRegistered,
  FALLBACK_BOLD_FAMILY,
  FALLBACK_BOLD_FONT_PATH,
  FALLBACK_REGULAR_FAMILY,
  FALLBACK_REGULAR_FONT_PATH,
} from './LabelRenderer.js';
import { mmToPx } from './dimensions.js';
import type { SummaryDesign } from './summaryDesign.js';

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
  isGuest?: boolean;
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

export interface SummaryPdfInput {
  rows: SummaryRow[];
  columns: SummaryColumn[];
  title: string;
  design: SummaryDesign;
  logo?: Buffer;
  printedAt: Date;
}

/** Alle PDF-Masse in Punkt (pt). */
const PT_PER_MM = 72 / 25.4;
const PAGE_MARGIN = 36;
const GAP = 10;
const CELL_PADDING = 4;
/** Platz zum Schreiben und Abhaken von Hand. */
const MIN_ROW_HEIGHT = 8 * PT_PER_MM;
const CHECKBOX_SIZE = 4.5 * PT_PER_MM;
const LOGO_MAX_HEIGHT = 16 * PT_PER_MM;
/** Obergrenzen als Anteil der Satzbreite bzw. Seitenhöhe, damit Name, Titel und Tabelle immer Platz behalten. */
const LOGO_MAX_WIDTH_SHARE = 0.2;
const CHECK_COLUMN_MAX_SHARE = 0.12;
const DATA_COLUMN_MAX_SHARE = 0.17;
const TITLE_MAX_HEIGHT_SHARE = 0.2;
const FOOTER_MAX_HEIGHT_SHARE = 0.15;
const FOOTER_FONT_SIZE = 9;
const MIN_HEADING_FONT_SIZE = 7;

const REGULAR = 'regular';
const BOLD = 'bold';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

type TableColumn = { heading: string; x: number; width: number } & ({ kind: 'check' } | { kind: 'data'; key: SummaryColumnKey } | { kind: 'guest' });

/** Vermessener Textblock: `height` gilt für genau diese Schrift, Grösse und Breite. */
interface TextBlock {
  text: string;
  font: typeof REGULAR | typeof BOLD;
  size: number;
  width: number;
  height: number;
}

/** Misst einen umbrechenden Text und verkleinert die Schrift nur, wenn er sonst höher als `maxHeight` würde — gekürzt wird nie. */
function measureBlock(doc: PDFKit.PDFDocument, text: string, font: TextBlock['font'], size: number, width: number, maxHeight = Infinity): TextBlock {
  let fitted = size;
  let height = doc.font(font).fontSize(fitted).heightOfString(text, { width });
  while (height > maxHeight && fitted > 1) {
    fitted -= 0.5;
    height = doc.fontSize(fitted).heightOfString(text, { width });
  }
  return { text, font, size: fitted, width, height };
}

function drawBlock(doc: PDFKit.PDFDocument, block: TextBlock, x: number, y: number, align: 'left' | 'center' | 'right' = 'left'): void {
  if (!block.text) return;
  doc.font(block.font).fontSize(block.size).fillColor('black').text(block.text, x, y, { width: block.width, align });
}

function drawLine(doc: PDFKit.PDFDocument, x1: number, y1: number, x2: number, y2: number, lineWidth: number, color: string): void {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(lineWidth).strokeColor(color).stroke();
}

/** Reihenfolge: Abhak-Spalten, Datenspalten, Gast-Spalte. Name und Gast-Spalte teilen sich die Restbreite. */
function layoutColumns(doc: PDFKit.PDFDocument, input: SummaryPdfInput, contentWidth: number): TableColumn[] {
  const { design, rows } = input;
  const widthOf = (text: string, font: TextBlock['font']) => doc.font(font).fontSize(design.fontSize).widthOfString(text) + 2 * CELL_PADDING + 1;

  const checks = design.checkColumns.map((heading) => ({
    kind: 'check' as const,
    heading,
    width: Math.min(Math.max(widthOf(heading, BOLD), CHECKBOX_SIZE + 2 * CELL_PADDING), contentWidth * CHECK_COLUMN_MAX_SHARE),
    weight: 0,
  }));
  // Doppelt gewählte Spalten erscheinen einmal, sonst könnte die Tabelle breiter als die Seite werden.
  const unique = [...new Map(input.columns.map((column) => [column.key, column])).values()];
  const data = unique.map(({ key, label }) => {
    if (key === 'name') return { kind: 'data' as const, key, heading: label, width: 0, weight: 3 };
    const natural = rows.reduce((max, row) => Math.max(max, widthOf(row[key], REGULAR)), widthOf(label, BOLD));
    return { kind: 'data' as const, key, heading: label, width: Math.min(natural, contentWidth * DATA_COLUMN_MAX_SHARE), weight: 0 };
  });
  const guest = design.guestColumn.enabled ? [{ kind: 'guest' as const, heading: design.guestColumn.header, width: 0, weight: 2 }] : [];

  const columns = [...checks, ...data, ...guest];
  // Ohne Name und Gast-Spalte dehnen sich alle Spalten, damit die Tabelle die Seite füllt.
  if (columns.every((column) => column.weight === 0)) for (const column of columns) column.weight = 1;
  const remaining = contentWidth - columns.reduce((sum, column) => sum + column.width, 0);
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);

  let x = PAGE_MARGIN;
  return columns.map(({ weight, ...column }) => {
    const width = column.width + (weight ? (remaining * weight) / totalWeight : 0);
    const placed = { ...column, x, width };
    x += width;
    return placed;
  });
}

/**
 * Überschriften und Titel (fett) brechen zwischen Wörtern um: passt ein einzelnes Wort nicht in die Zeile, wird zuerst die
 * Schrift verkleinert. Das folgende Leerzeichen zählt mit, weil pdfkit es mitmisst und sonst in die nächste Zeile schiebt.
 */
function measureHeading(doc: PDFKit.PDFDocument, text: string, fontSize: number, width: number, maxHeight?: number): TextBlock {
  const words: string[] = text.match(/\S+\s*/g) ?? [];
  let size = fontSize;
  doc.font(BOLD).fontSize(size);
  while (size > MIN_HEADING_FONT_SIZE && words.some((word) => doc.widthOfString(word) > width)) {
    size -= 0.5;
    doc.fontSize(size);
  }
  return measureBlock(doc, text, BOLD, size, width, maxHeight);
}

/**
 * Prüft, dekodiert und verkleinert das Logo vorab: bei defekten PNG-Bilddaten wirft pdfkit ausserhalb jedes try/catch
 * (Absturz des Prozesses), und `loadImage` nimmt sie stillschweigend an — deshalb prüft `pngjs` PNGs zuerst.
 */
async function prepareLogo(logo: Buffer | undefined): Promise<{ data: Buffer; width: number; height: number } | null> {
  if (!logo) return null;
  try {
    if (logo.subarray(0, 4).equals(PNG_MAGIC)) PNG.sync.read(logo);
    const image = await loadImage(logo);
    // 4 Pixel je Punkt sind knapp 300 dpi — mehr Auflösung vergrössert nur den Druckauftrag.
    const scale = Math.min(1, (LOGO_MAX_HEIGHT * 4) / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return { data: canvas.toBuffer('image/png'), width, height };
  } catch {
    return null; // Defektes Logo: die Liste ist wichtiger und wird ohne Logo gedruckt.
  }
}

function formatDateTime(date: Date): string {
  const day = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/**
 * A4-Anwesenheitsliste (Checkout und Evakuierung) für den IPP/Büro-Netzwerkdrucker-Pfad. Die Seiten werden selbst
 * umbrochen: Kopf und Tabellenkopf stehen auf jeder Seite, keine Zeile wird geteilt oder gekürzt.
 */
export async function renderSummaryPdf(input: SummaryPdfInput): Promise<Buffer> {
  const { rows, design } = input;
  const logo = await prepareLogo(input.logo);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: design.orientation,
      // Ohne unteren Rand legt pdfkit nicht selbst Seiten an (sonst Leerseiten durch Text nahe am Seitenende).
      margins: { top: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 0 },
      bufferPages: true,
      font: FALLBACK_REGULAR_FONT_PATH,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont(REGULAR, FALLBACK_REGULAR_FONT_PATH);
    doc.registerFont(BOLD, FALLBACK_BOLD_FONT_PATH);

    const { width: pageWidth, height: pageHeight } = doc.page;
    const contentWidth = pageWidth - 2 * PAGE_MARGIN;
    const rightEdge = pageWidth - PAGE_MARGIN;

    // Kopf: Logo links, daneben Titel und Anzahl, rechts der Druckzeitpunkt.
    const logoScale = logo ? Math.min(LOGO_MAX_HEIGHT / logo.height, (contentWidth * LOGO_MAX_WIDTH_SHARE) / logo.width) : 0;
    const logoWidth = logo ? logo.width * logoScale : 0;
    const logoHeight = logo ? logo.height * logoScale : 0;
    const printedAt = formatDateTime(input.printedAt);
    const dateWidth = doc.font(REGULAR).fontSize(design.fontSize).widthOfString(printedAt) + 1;
    const date = measureBlock(doc, printedAt, REGULAR, design.fontSize, dateWidth);
    const titleX = PAGE_MARGIN + (logo ? logoWidth + GAP : 0);
    const titleWidth = rightEdge - dateWidth - GAP - titleX;
    const title = measureHeading(doc, input.title, design.fontSize + 5, titleWidth, pageHeight * TITLE_MAX_HEIGHT_SHARE);
    const countText = rows.length === 1 ? '1 Person' : `${rows.length} Personen`;
    const count = measureBlock(doc, countText, REGULAR, design.fontSize, titleWidth);
    const headerHeight = Math.max(logoHeight, title.height + count.height, date.height) + GAP;

    // Fusszeile: ihr Platz wird vorab reserviert, geschrieben wird sie erst, wenn die Seitenzahl feststeht.
    const pageLabelWidth = doc.font(REGULAR).fontSize(FOOTER_FONT_SIZE).widthOfString('Seite 999/999') + 1;
    const pageLabelHeight = doc.currentLineHeight(true);
    const footer = measureBlock(doc, design.footer, REGULAR, FOOTER_FONT_SIZE, contentWidth - pageLabelWidth - GAP, pageHeight * FOOTER_MAX_HEIGHT_SHARE);
    const footerTop = pageHeight - PAGE_MARGIN - Math.max(footer.height, pageLabelHeight);
    const bodyBottom = footerTop - GAP;

    const columns = layoutColumns(doc, input, contentWidth);
    const headings = columns.map((column) => measureHeading(doc, column.heading, design.fontSize, column.width - 2 * CELL_PADDING));
    const rowsTop = PAGE_MARGIN + headerHeight + Math.max(0, ...headings.map((heading) => heading.height)) + 2 * CELL_PADDING;

    function drawPageHead(): void {
      if (logo) {
        try {
          doc.image(logo.data, PAGE_MARGIN, PAGE_MARGIN, { width: logoWidth, height: logoHeight });
        } catch {
          // Ohne Logo weiterdrucken.
        }
      }
      drawBlock(doc, title, titleX, PAGE_MARGIN);
      drawBlock(doc, count, titleX, PAGE_MARGIN + title.height);
      drawBlock(doc, date, rightEdge - dateWidth, PAGE_MARGIN);
      columns.forEach((column, i) => {
        const heading = headings[i]!;
        drawBlock(doc, heading, column.x + CELL_PADDING, rowsTop - CELL_PADDING - heading.height, column.kind === 'check' ? 'center' : 'left');
      });
      drawLine(doc, PAGE_MARGIN, rowsTop, rightEdge, rowsTop, 1.2, 'black');
    }

    function measureRow(row: SummaryRow, size: number) {
      const cells = columns.map((column) => (column.kind === 'data' ? measureBlock(doc, row[column.key], REGULAR, size, column.width - 2 * CELL_PADDING) : null));
      return { cells, textHeight: Math.max(0, ...cells.map((cell) => cell?.height ?? 0)) };
    }

    drawPageHead();
    let y = rowsTop;
    for (const row of rows) {
      let size = design.fontSize;
      let { cells, textHeight } = measureRow(row, size);
      // Nur eine Zeile, die höher als eine ganze Seite wäre, wird kleiner gesetzt statt geteilt oder gekürzt.
      while (textHeight + 2 * CELL_PADDING > bodyBottom - rowsTop && size > 1) {
        size -= 0.5;
        ({ cells, textHeight } = measureRow(row, size));
      }
      const rowHeight = Math.max(MIN_ROW_HEIGHT, textHeight + 2 * CELL_PADDING);
      if (y + rowHeight > bodyBottom && y > rowsTop) {
        doc.addPage();
        drawPageHead();
        y = rowsTop;
      }

      columns.forEach((column, i) => {
        const cell = cells[i];
        if (cell) drawBlock(doc, cell, column.x + CELL_PADDING, y + (rowHeight - textHeight) / 2);
        if (column.kind === 'check') {
          const boxX = column.x + (column.width - CHECKBOX_SIZE) / 2;
          doc.rect(boxX, y + (rowHeight - CHECKBOX_SIZE) / 2, CHECKBOX_SIZE, CHECKBOX_SIZE).lineWidth(0.8).strokeColor('black').stroke();
        }
        if (column.kind === 'guest' && row.isGuest) {
          const lineY = y + rowHeight - CELL_PADDING;
          drawLine(doc, column.x + CELL_PADDING, lineY, column.x + column.width - CELL_PADDING, lineY, 0.6, 'black');
        }
        if (i > 0) drawLine(doc, column.x, y, column.x, y + rowHeight, 0.4, '#999999');
      });
      y += rowHeight;
      drawLine(doc, PAGE_MARGIN, y, rightEdge, y, 0.4, '#999999');
    }
    if (rows.length === 0) {
      const empty = measureBlock(doc, 'Keine Check-ins in diesem Zeitraum.', REGULAR, design.fontSize, contentWidth);
      drawBlock(doc, empty, PAGE_MARGIN, rowsTop + CELL_PADDING);
    }

    const { start, count: pageCount } = doc.bufferedPageRange();
    for (let page = 0; page < pageCount; page++) {
      doc.switchToPage(start + page);
      drawBlock(doc, footer, PAGE_MARGIN, footerTop);
      const pageLabel = measureBlock(doc, `Seite ${page + 1}/${pageCount}`, REGULAR, FOOTER_FONT_SIZE, pageLabelWidth);
      drawBlock(doc, pageLabel, rightEdge - pageLabelWidth, footerTop, 'right');
    }

    doc.end();
  });
}
