import PDFDocument from 'pdfkit';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaDefinition } from '../adapters/printer/types.js';
import { renderSummaryLabelStrip, renderSummaryPdf, type SummaryColumn, type SummaryPdfInput, type SummaryRow } from './SummaryRenderer.js';
import { DEFAULT_SUMMARY_DESIGN, type SummaryDesign } from './summaryDesign.js';

const CONTINUOUS_MEDIA: MediaDefinition = {
  id: '62',
  vendor: 'brother-ql',
  name: '62mm Endlos',
  widthMm: 62,
  heightMm: null,
  printableAreaMm: { width: 60, height: 0 },
  dieCut: false,
};

const COLUMNS: SummaryColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'code', label: 'Code' },
  { key: 'checkinTime', label: 'Zeit' },
];

const ROWS: SummaryRow[] = [
  { name: 'Max Muster', code: 'ZRYK', checkinTime: '10:01' },
  { name: 'Erika Muster', code: 'AB12', checkinTime: '10:03' },
];

function decode(bitmap: { data: Buffer }) {
  return PNG.sync.read(bitmap.data);
}

function hasNonWhitePixel(png: PNG, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) * 4;
      if (png.data[idx] !== 255 || png.data[idx + 1] !== 255 || png.data[idx + 2] !== 255) return true;
    }
  }
  return false;
}

describe('renderSummaryLabelStrip', () => {
  it('sizes the canvas to the media width in pixels at the given DPI', async () => {
    const bitmap = await renderSummaryLabelStrip(ROWS, COLUMNS, 'Kids', CONTINUOUS_MEDIA, 300);
    expect(bitmap.widthPx).toBe(732); // 62mm/25.4*300 gerundet
  });

  it('grows the strip height as more rows are added', async () => {
    const few = await renderSummaryLabelStrip(ROWS, COLUMNS, 'Kids', CONTINUOUS_MEDIA, 300);
    const many = await renderSummaryLabelStrip([...ROWS, ...ROWS, ...ROWS, ...ROWS, ...ROWS], COLUMNS, 'Kids', CONTINUOUS_MEDIA, 300);
    expect(many.heightPx).toBeGreaterThan(few.heightPx);
  });

  it('actually draws content, not a blank strip', async () => {
    const bitmap = await renderSummaryLabelStrip(ROWS, COLUMNS, 'Kids', CONTINUOUS_MEDIA, 300);
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, png.width, png.height)).toBe(true);
  });

  it('produces an empty-but-valid strip when there are no rows', async () => {
    const bitmap = await renderSummaryLabelStrip([], COLUMNS, 'Kids', CONTINUOUS_MEDIA, 300);
    expect(bitmap.heightPx).toBeGreaterThan(0);
  });
});

const MM = 72 / 25.4;

function pdfInput(overrides: Partial<Omit<SummaryPdfInput, 'design'>> & { design?: Partial<SummaryDesign> } = {}): SummaryPdfInput {
  const { design, ...rest } = overrides;
  return {
    rows: ROWS,
    columns: COLUMNS,
    title: 'Anwesenheitsliste: Kids',
    printedAt: new Date(2026, 10, 29, 10, 5),
    ...rest,
    design: { ...DEFAULT_SUMMARY_DESIGN, ...design },
  };
}

function manyRows(count: number): SummaryRow[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Person ${i + 1}`, code: 'AB12', checkinTime: '10:01', isGuest: false }));
}

const countPages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

interface DrawnText {
  text: string;
  page: object;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

/** Zeichnet jeden `text`-Aufruf samt belegter Fläche auf, ohne das Zeichnen selbst zu ersetzen. */
function recordTexts(): DrawnText[] {
  const drawn: DrawnText[] = [];
  const original = PDFDocument.prototype.text as (...args: unknown[]) => PDFKit.PDFDocument;
  vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    const [text, x, y, options] = args as [string, number, number, { width: number }];
    const height = this.heightOfString(text, { width: options.width });
    drawn.push({ text, page: this.page, x, y, width: options.width, height, pageWidth: this.page.width, pageHeight: this.page.height });
    return original.apply(this, args);
  });
  return drawn;
}

const textsOf = (drawn: DrawnText[]) => drawn.map((d) => d.text);
const occurrences = (drawn: DrawnText[], text: string) => drawn.filter((d) => d.text === text).length;

function wideLogo(): Buffer {
  const png = new PNG({ width: 40, height: 16 });
  png.data.fill(128);
  return PNG.sync.write(png);
}

/** Gültig aufgebautes PNG mit Alphakanal, dessen Bilddaten zerstört sind. */
function pngWithBrokenImageData(): Buffer {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(128);
  const buffer = PNG.sync.write(png);
  const start = buffer.indexOf('IDAT') + 4;
  buffer.fill(0x55, start, start + 8);
  return buffer;
}

describe('renderSummaryPdf', () => {
  afterEach(() => vi.restoreAllMocks());

  it('produces a PDF in A4 landscape or portrait as designed', async () => {
    const landscape = await renderSummaryPdf(pdfInput());
    const portrait = await renderSummaryPdf(pdfInput({ design: { orientation: 'portrait' } }));

    expect(landscape.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(landscape.toString('latin1')).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(portrait.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
  });

  it('fits a few rows on a single page', async () => {
    const pdf = await renderSummaryPdf(pdfInput({ rows: manyRows(3) }));
    expect(countPages(pdf)).toBe(1);
  });

  it('repeats header and table header on every page and numbers the pages', async () => {
    const drawn = recordTexts();
    const pdf = await renderSummaryPdf(pdfInput({ rows: manyRows(80), design: { footer: 'Fusstext' } }));
    const pages = countPages(pdf);

    expect(pages).toBeGreaterThan(1);
    for (const repeated of ['Anwesenheitsliste: Kids', 'Name', 'Abgeholt', '80 Personen', '29.11.2026, 10:05', 'Fusstext']) {
      expect(occurrences(drawn, repeated), repeated).toBe(pages);
    }
    for (let page = 1; page <= pages; page++) expect(occurrences(drawn, `Seite ${page}/${pages}`)).toBe(1);
    for (let i = 1; i <= 80; i++) expect(occurrences(drawn, `Person ${i}`)).toBe(1);
  });

  it('counts persons in singular and plural', async () => {
    const drawn = recordTexts();
    await renderSummaryPdf(pdfInput());
    expect(textsOf(drawn)).toContain('2 Personen');

    await renderSummaryPdf(pdfInput({ rows: manyRows(1) }));
    expect(textsOf(drawn)).toContain('1 Person');
  });

  it('draws the check column and guest column headings', async () => {
    const drawn = recordTexts();
    await renderSummaryPdf(pdfInput());
    expect(textsOf(drawn)).toEqual(expect.arrayContaining(['Abgeholt', 'Da', 'Name Gast']));
  });

  it('omits the guest column when it is disabled', async () => {
    const drawn = recordTexts();
    await renderSummaryPdf(pdfInput({ design: { guestColumn: { ...DEFAULT_SUMMARY_DESIGN.guestColumn, enabled: false } } }));
    expect(textsOf(drawn)).toContain('Name');
    expect(textsOf(drawn)).not.toContain('Name Gast');
  });

  it('draws one checkbox per person and check column', async () => {
    const rect = vi.spyOn(PDFDocument.prototype, 'rect');
    await renderSummaryPdf(pdfInput({ rows: manyRows(3), design: { checkColumns: ['A', 'B', 'C'] } }));
    expect(rect).toHaveBeenCalledTimes(9);
  });

  it('draws a writing line for guests only', async () => {
    const lineTo = vi.spyOn(PDFDocument.prototype, 'lineTo');
    await renderSummaryPdf(pdfInput({ rows: manyRows(3) }));
    const withoutGuests = lineTo.mock.calls.length;
    lineTo.mockClear();

    await renderSummaryPdf(pdfInput({ rows: manyRows(3).map((row, i) => ({ ...row, isGuest: i === 0 })) }));

    expect(lineTo.mock.calls.length).toBe(withoutGuests + 1);
  });

  it('places the columns in order: checks, data columns as configured, guest', async () => {
    const drawn = recordTexts();
    await renderSummaryPdf(
      pdfInput({
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Name' },
        ],
      }),
    );
    const x = (text: string) => drawn.find((d) => d.text === text)!.x;

    expect(x('Abgeholt')).toBeLessThan(x('Da'));
    expect(x('Da')).toBeLessThan(x('Code'));
    expect(x('Code')).toBeLessThan(x('Name'));
    expect(x('Name')).toBeLessThan(x('Name Gast'));
    expect(x('ZRYK')).toBeLessThan(x('Max Muster'));
    expect(textsOf(drawn)).not.toContain('10:01');
  });

  it('draws a repeatedly configured column only once, so the table cannot outgrow the page', async () => {
    const drawn = recordTexts();
    const columns = Array.from({ length: 12 }, () => ({ key: 'code' as const, label: 'Code' }));

    await renderSummaryPdf(pdfInput({ columns }));

    expect(occurrences(drawn, 'Code')).toBe(1);
  });

  it('keeps rows at least 8 mm high', async () => {
    const drawn = recordTexts();
    await renderSummaryPdf(pdfInput({ rows: manyRows(3), design: { fontSize: 8 } }));
    const y = (text: string) => drawn.find((d) => d.text === text)!.y;

    expect(y('Person 2') - y('Person 1')).toBeGreaterThanOrEqual(8 * MM - 0.01);
  });

  it.each(['landscape', 'portrait'] as const)('keeps everything on the %s page and clear of the footer with the widest settings', async (orientation) => {
    const drawn = recordTexts();
    const footer = 'Fusszeile '.repeat(20);
    const rows = manyRows(60).map((row, i) => ({ ...row, name: i % 7 === 0 ? `Gast ${i} ${'Lang '.repeat(20)}` : row.name, code: `WWWWWWWW${i}` }));
    const checkColumns = ['Abgeholt von Eltern', 'WWWWWWWWWWWWWWWWWWWW', 'Allergie geprüft ok', 'Da'];

    const pdf = await renderSummaryPdf(
      pdfInput({
        rows,
        title: `Anwesenheitsliste: ${'Sehr lange Gruppe '.repeat(8)}`,
        design: { orientation, fontSize: 18, checkColumns, footer, guestColumn: { enabled: true, header: 'W'.repeat(30), keyword: 'Gast' } },
      }),
    );

    expect(countPages(pdf)).toBe(new Set(drawn.map((d) => d.page)).size);
    for (const d of drawn) {
      expect(d.x, d.text).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width, d.text).toBeLessThanOrEqual(d.pageWidth);
      expect(d.y + d.height, d.text).toBeLessThanOrEqual(d.pageHeight);
    }
    for (const row of rows) {
      const cell = drawn.find((d) => d.text === row.name)!;
      const footerOnPage = drawn.find((d) => d.page === cell.page && d.text === footer)!;
      const headingOnPage = drawn.find((d) => d.page === cell.page && d.text === 'Name')!;
      expect(cell.y, row.name).toBeGreaterThanOrEqual(headingOnPage.y + headingOnPage.height);
      expect(cell.y + cell.height, row.name).toBeLessThanOrEqual(footerOnPage.y);
    }
  });

  it('wraps headings and title between words, without split words, blank or indented lines', async () => {
    // `_fragment` ist pdfkits Ausgabe einer einzelnen, bereits umbrochenen Zeile.
    const lines = vi.spyOn(PDFDocument.prototype as unknown as { _fragment: (line: string) => void }, '_fragment');
    const checkColumns = ['Abgeholt von Eltern', 'Allergie geprüft', 'Jacke dabei', 'Da'];

    await renderSummaryPdf(
      pdfInput({ rows: [], title: 'Anwesenheitsliste: Youngsters', logo: wideLogo(), design: { orientation: 'portrait', fontSize: 18, checkColumns } }),
    );

    const drawnLines = lines.mock.calls.map(([line]) => line);
    expect(drawnLines.filter((line) => /^\s/.test(line))).toEqual([]);
    const words = drawnLines.flatMap((line) => line.trim().split(/\s+/));
    expect(words).toEqual(expect.arrayContaining(['Anwesenheitsliste:', 'Abgeholt', 'Allergie', 'geprüft', 'dabei', 'Name', 'Gast']));
  });

  it('wraps a very long name and a 200 character footer without truncating or adding pages', async () => {
    const drawn = recordTexts();
    const name = 'Abcdefghi '.repeat(30);
    const footer = 'F'.repeat(200);
    const rows = [{ name, code: 'ZRYK', checkinTime: '10:01' }, ...manyRows(2)];

    const pdf = await renderSummaryPdf(pdfInput({ rows, design: { footer } }));

    expect(textsOf(drawn)).toContain(name);
    expect(textsOf(drawn)).toContain(footer);
    expect(countPages(pdf)).toBe(1);
  });

  it('shrinks a row that is taller than a page instead of splitting or truncating it', async () => {
    const drawn = recordTexts();
    const name = 'Abcdefghi '.repeat(600);

    const pdf = await renderSummaryPdf(pdfInput({ rows: [{ name, code: 'ZRYK', checkinTime: '10:01' }], design: { fontSize: 18 } }));

    const cell = drawn.find((d) => d.text === name)!;
    expect(countPages(pdf)).toBe(1);
    expect(cell.y + cell.height).toBeLessThanOrEqual(cell.pageHeight);
  });

  it('adds no pages for a footer made of many line breaks', async () => {
    const pdf = await renderSummaryPdf(pdfInput({ design: { footer: `a${'\n'.repeat(198)}b` } }));
    expect(countPages(pdf)).toBe(1);
  });

  it('prints without logo when the logo data is not an image', async () => {
    const pdf = await renderSummaryPdf(pdfInput({ logo: Buffer.from('kaputt') }));
    expect(countPages(pdf)).toBe(1);
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('prints without logo when a PNG has broken image data', async () => {
    const pdf = await renderSummaryPdf(pdfInput({ logo: pngWithBrokenImageData() }));
    expect(countPages(pdf)).toBe(1);
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('embeds a valid logo', async () => {
    const pdf = await renderSummaryPdf(pdfInput({ logo: wideLogo() }));
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  });

  it('says so when there are no check-ins', async () => {
    const drawn = recordTexts();
    const pdf = await renderSummaryPdf(pdfInput({ rows: [] }));
    expect(textsOf(drawn)).toContain('Keine Check-ins in diesem Zeitraum.');
    expect(countPages(pdf)).toBe(1);
  });
});
