import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { MediaDefinition } from '../adapters/printer/types.js';
import { renderSummaryLabelStrip, renderSummaryPdf, type SummaryColumn, type SummaryRow } from './SummaryRenderer.js';

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

describe('renderSummaryPdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const pdf = await renderSummaryPdf(ROWS, COLUMNS, 'Kids');
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('produces a valid PDF even with no rows', async () => {
    const pdf = await renderSummaryPdf([], COLUMNS, 'Kids');
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
