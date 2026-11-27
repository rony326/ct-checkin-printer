import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
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
/** Bis auf diese Breite geben Abhak-Spalten Platz an Name und Gast-Spalte ab; breitere Überschriften brechen dann um. */
const CHECK_COLUMN_FLOOR = 52;
/** Schreibplatz für einen von Hand notierten Namen. */
const GUEST_COLUMN_MIN_WIDTH = 32 * PT_PER_MM;
/** Kleinste Schrift, auf welche die Tabelle für ungeteilte Namen verkleinert wird (Untergrenze der Einstellung). */
const MIN_TABLE_FONT_SIZE = 8;
const TITLE_MAX_HEIGHT_SHARE = 0.2;
const FOOTER_MAX_HEIGHT_SHARE = 0.15;
const FOOTER_FONT_SIZE = 9;
const MIN_HEADING_FONT_SIZE = 7;

const REGULAR = 'regular';
const BOLD = 'bold';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

/** Von pdfkit geöffnetes Bild (in den Typdefinitionen nicht beschrieben). */
interface PdfImage {
  width: number;
  height: number;
  orientation?: number;
}

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

/** Wörter samt folgendem Leerzeichen bzw. Bindestrich: an diesen Stellen bricht pdfkit um, und so breit misst es sie. */
function splitWords(text: string): string[] {
  return text.match(/[^\s-]+[\s-]*|[\s-]+/g) ?? [];
}

function widestWord(doc: PDFKit.PDFDocument, texts: string[], font: TextBlock['font'], size: number): number {
  doc.font(font).fontSize(size);
  return texts.flatMap(splitWords).reduce((widest, word) => Math.max(widest, doc.widthOfString(word)), 0);
}

/**
 * Reihenfolge: Abhak-Spalten, Datenspalten, Gast-Spalte. Name und Gast-Spalte bekommen den meisten Platz: reicht er
 * nicht, um die Namen zwischen den Wörtern umzubrechen, werden erst die Abhak-Spalten schmaler und dann die
 * Tabellenschrift kleiner. Nur ein Wort, das auch dann nicht passt, wird innerhalb des Wortes umbrochen.
 */
function layoutColumns(doc: PDFKit.PDFDocument, input: SummaryPdfInput, contentWidth: number): { columns: TableColumn[]; fontSize: number } {
  const { design, rows } = input;
  const padding = 2 * CELL_PADDING + 1;
  // Doppelt gewählte Spalten erscheinen einmal, sonst könnte die Tabelle breiter als die Seite werden.
  const unique = [...new Map(input.columns.map((column) => [column.key, column])).values()];
  const nameColumn = unique.find((column) => column.key === 'name');
  const guestMin = design.guestColumn.enabled ? GUEST_COLUMN_MIN_WIDTH : 0;

  function measure(size: number) {
    const widthOf = (text: string, font: TextBlock['font']) => doc.font(font).fontSize(size).widthOfString(text) + padding;
    const checks = design.checkColumns.map((heading) => {
      const box = CHECKBOX_SIZE + 2 * CELL_PADDING;
      const preferred = Math.min(Math.max(widthOf(heading, BOLD), box), contentWidth * CHECK_COLUMN_MAX_SHARE);
      const word = widestWord(doc, [heading], BOLD, MIN_HEADING_FONT_SIZE) + padding;
      return { heading, preferred, floor: Math.min(preferred, Math.max(box, Math.min(word, CHECK_COLUMN_FLOOR))) };
    });
    const data = unique.map(({ key, label }) => {
      if (key === 'name') return { key, label, width: 0 };
      const natural = rows.reduce((max, row) => Math.max(max, widthOf(row[key], REGULAR)), widthOf(label, BOLD));
      return { key, label, width: Math.min(natural, contentWidth * DATA_COLUMN_MAX_SHARE) };
    });
    const checkFloor = checks.reduce((sum, check) => sum + check.floor, 0);
    const dataWidth = data.reduce((sum, column) => sum + column.width, 0);
    return { size, checks, data, checkFloor, dataWidth };
  }

  // Wörter, die selbst bei kleinster Schrift nicht passen, verkleinern die Tabelle nicht.
  const smallest = measure(Math.min(MIN_TABLE_FONT_SIZE, design.fontSize));
  const roomAtSmallest = contentWidth - smallest.checkFloor - smallest.dataWidth - guestMin - padding;
  const nameWords = [...new Set(rows.flatMap((row) => splitWords(row.name)))].filter(
    (word) => widestWord(doc, [word], REGULAR, smallest.size) <= roomAtSmallest,
  );
  /** Mindestens so breit wie der Schreibplatz für Gäste, damit auch bei kurzen Namen keine Abhak-Spalte breiter wird. */
  const requiredNameWidth = (size: number) =>
    nameColumn
      ? Math.max(GUEST_COLUMN_MIN_WIDTH, widestWord(doc, [nameColumn.label], BOLD, size) + padding, widestWord(doc, nameWords, REGULAR, size) + padding)
      : 0;

  let table = measure(design.fontSize);
  while (table.size > smallest.size && table.checkFloor + table.dataWidth + requiredNameWidth(table.size) + guestMin > contentWidth) {
    table = measure(Math.max(smallest.size, table.size - 0.5));
  }

  const nameMin = Math.min(requiredNameWidth(table.size), Math.max(0, contentWidth - table.checkFloor - table.dataWidth - guestMin));
  const checkPreferred = table.checks.reduce((sum, check) => sum + check.preferred, 0);
  const checkRoom = contentWidth - table.dataWidth - nameMin - guestMin;
  const shrinkable = checkPreferred - table.checkFloor;
  const keep = shrinkable > 0 ? Math.min(1, Math.max(0, (checkRoom - table.checkFloor) / shrinkable)) : 1;
  const checks = table.checks.map(({ heading, preferred, floor }) => ({ kind: 'check' as const, heading, width: floor + (preferred - floor) * keep }));
  const data = table.data.map(({ key, label, width }) => ({ kind: 'data' as const, key, heading: label, width }));
  const guest = design.guestColumn.enabled ? [{ kind: 'guest' as const, heading: design.guestColumn.header, width: 0 }] : [];
  const columns = [...checks, ...data, ...guest];

  // Die Restbreite teilen sich Name und Gast-Spalte 3:2, ohne ihre Mindestbreiten zu unterschreiten.
  const rest = contentWidth - columns.reduce((sum, column) => sum + column.width, 0);
  const guestWidth = !guest.length ? 0 : !nameColumn ? rest : Math.min(Math.max(rest * 0.4, guestMin), rest - nameMin);
  for (const column of columns) {
    if (column.kind === 'guest') column.width = guestWidth;
    if (column.kind === 'data' && column.key === 'name') column.width = rest - guestWidth;
  }
  // Ohne Name und Gast-Spalte dehnen sich alle Spalten, damit die Tabelle die Seite füllt.
  if (!nameColumn && !guest.length) for (const column of columns) column.width += rest / columns.length;

  let x = PAGE_MARGIN;
  return {
    fontSize: table.size,
    columns: columns.map((column) => {
      const placed = { ...column, x };
      x += column.width;
      return placed;
    }),
  };
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
 * Prüft den Segmentaufbau eines JPEG: vollständige Segmente, ein Bildkopf (Baseline oder progressiv), Bilddaten und
 * Endmarke. So gelangt keine abgeschnittene Datei in den Druckauftrag; dekodiert wird das Bild erst im Drucker.
 */
function isCompleteJpeg(data: Buffer): boolean {
  if (data[0] !== 0xff || data[1] !== 0xd8) return false;
  let hasFrame = false;
  let pos = 2;
  while (pos + 4 <= data.length && data[pos] === 0xff) {
    const marker = data[pos + 1]!;
    if (marker === 0xff) {
      pos += 1; // Füllbyte
      continue;
    }
    const length = data.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > data.length) return false;
    if (marker >= 0xc0 && marker <= 0xc2) {
      if (length < 8) return false;
      const [bits, height, width, channels] = [data[pos + 4], data.readUInt16BE(pos + 5), data.readUInt16BE(pos + 7), data[pos + 9]!];
      if (bits !== 8 || height === 0 || width === 0 || ![1, 3, 4].includes(channels) || length !== 8 + 3 * channels) return false;
      hasFrame = true;
    }
    if (marker === 0xda) return hasFrame && data.includes(JPEG_END, end);
    pos = end;
  }
  return false;
}

/** Vollständig dekodiert (wirft bei defekten Daten) und als sauberes, auf Druckgrösse verkleinertes PNG neu geschrieben. */
function normalizePng(data: Buffer): Buffer {
  const decoded = PNG.sync.read(data);
  const source = createCanvas(decoded.width, decoded.height);
  const pixels = source.getContext('2d').createImageData(decoded.width, decoded.height);
  pixels.data.set(decoded.data);
  source.getContext('2d').putImageData(pixels, 0, 0);
  // 4 Pixel je Punkt sind knapp 300 dpi — mehr Auflösung vergrössert nur den Druckauftrag.
  const scale = Math.min(1, (LOGO_MAX_HEIGHT * 4) / decoded.height);
  const canvas = createCanvas(Math.max(1, Math.round(decoded.width * scale)), Math.max(1, Math.round(decoded.height * scale)));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}

/**
 * Öffnet das Logo für pdfkit; `null` = ohne Logo drucken, die Liste ist wichtiger. Die Bytes gehen nie an den
 * Bilddekoder von `@napi-rs/canvas` (Segfault bei defekten Dateien), und PNGs nur geprüft an pdfkit (das bei defekten
 * Bilddaten ausserhalb jedes try/catch wirft).
 */
function openLogo(doc: PDFKit.PDFDocument, logo: Buffer | undefined): { source: PdfImage; width: number; height: number } | null {
  if (!logo) return null;
  try {
    const data = logo.subarray(0, 4).equals(PNG_MAGIC) ? normalizePng(logo) : isCompleteJpeg(logo) ? logo : null;
    if (!data) return null;
    // Einmal geöffnet, bettet pdfkit das Bild nur einmal ein, auch wenn es auf jeder Seite steht.
    const image = (doc as unknown as { openImage(source: Buffer): PdfImage }).openImage(data);
    const rotated = (image.orientation ?? 1) > 4; // EXIF: um 90 Grad gedreht
    return { source: image, width: rotated ? image.height : image.width, height: rotated ? image.width : image.height };
  } catch {
    return null;
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
export function renderSummaryPdf(input: SummaryPdfInput): Promise<Buffer> {
  const { rows, design } = input;

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
    const logo = openLogo(doc, input.logo);
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

    const { columns, fontSize } = layoutColumns(doc, input, contentWidth);
    const headings = columns.map((column) => measureHeading(doc, column.heading, fontSize, column.width - 2 * CELL_PADDING));
    const rowsTop = PAGE_MARGIN + headerHeight + Math.max(0, ...headings.map((heading) => heading.height)) + 2 * CELL_PADDING;

    function drawPageHead(): void {
      if (logo) {
        try {
          doc.image(logo.source as unknown as Buffer, PAGE_MARGIN, PAGE_MARGIN, { width: logoWidth, height: logoHeight });
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
      let size = fontSize;
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
