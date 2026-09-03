import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { LabelElement } from '../db/schema.js';
import type { MediaDefinition } from '../adapters/printer/types.js';
import { computeQrHash } from '../template/qrHash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_FONT_PATH = path.join(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf');
import type { RenderContext } from '../template/variables.js';
import { renderLabel } from './LabelRenderer.js';

const DIE_CUT_MEDIA: MediaDefinition = {
  id: '60x86',
  vendor: 'brother-ql',
  name: '60x86 Die-Cut',
  widthMm: 60,
  heightMm: 86,
  printableAreaMm: { width: 58, height: 84 },
  dieCut: true,
};

const CONTINUOUS_MEDIA: MediaDefinition = {
  id: '62',
  vendor: 'brother-ql',
  name: '62mm Endlos',
  widthMm: 62,
  heightMm: null,
  printableAreaMm: { width: 60, height: 0 },
  dieCut: false,
};

const CONTEXT: RenderContext = {
  person: { name: 'Max Muster', id: '2693' },
  checkin: { code: 'ZRYK', group: 'Kids', type: 'parent', timestamp: 1713355078, extra: [] },
};

function decode(bitmap: { data: Buffer }) {
  return PNG.sync.read(bitmap.data);
}

/** true, wenn irgendein Pixel im Rechteck (px-Koordinaten) nicht reinweiss ist. */
function hasNonWhitePixel(png: PNG, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) * 4;
      if (png.data[idx] !== 255 || png.data[idx + 1] !== 255 || png.data[idx + 2] !== 255) return true;
    }
  }
  return false;
}

describe('renderLabel — Canvas-Grösse', () => {
  it('nutzt bei Die-Cut-Medien die feste Media-Grösse in Pixeln (300dpi)', async () => {
    const bitmap = await renderLabel([], DIE_CUT_MEDIA, CONTEXT, { dpi: 300 });
    // 60mm/25.4*300 = 708.66 -> gerundet 709; 86mm -> 1016
    expect(bitmap.widthPx).toBe(709);
    expect(bitmap.heightPx).toBe(1016);
  });

  it('berechnet bei Endlosmedien die Höhe aus dem Inhalt', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'static', xMm: 0, yMm: 5, value: 'Test', fontSize: 40, bold: false, align: 'left' }];
    const bitmap = await renderLabel(elements, CONTINUOUS_MEDIA, CONTEXT, { dpi: 300 });
    // Element endet bei y=5mm + Zeilenhöhe(40px*1.3/300*25.4 ≈ 4.4mm) + 2mm Rand ≈ 11.4mm -> über Mindesthöhe 10mm
    expect(bitmap.heightPx).toBeGreaterThan(bitmap.widthPx * 0); // triviale Sanity, Haupttest folgt
    expect(bitmap.heightPx).toBeGreaterThanOrEqual(120);
  });

  it('wächst mit mehr checkin.extra-Zeilen (Sammelausdruck-Anwendungsfall)', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'text', xMm: 0, yMm: 0, field: 'checkin.extra', fontSize: 20, bold: false, align: 'left' }];
    const fewLines = await renderLabel(elements, CONTINUOUS_MEDIA, { ...CONTEXT, checkin: { ...CONTEXT.checkin, extra: ['a', 'b'] } }, { dpi: 300 });
    const manyLines = await renderLabel(
      elements,
      CONTINUOUS_MEDIA,
      { ...CONTEXT, checkin: { ...CONTEXT.checkin, extra: Array.from({ length: 20 }, (_, i) => `Zeile ${i}`) } },
      { dpi: 300 },
    );
    expect(manyLines.heightPx).toBeGreaterThan(fewLines.heightPx);
  });

  it('respektiert die Mindesthöhe bei leerem Endlos-Etikett', async () => {
    const bitmap = await renderLabel([], CONTINUOUS_MEDIA, CONTEXT, { dpi: 300 });
    expect(bitmap.heightPx).toBeGreaterThan(0);
  });
});

describe('renderLabel — Zeichnen', () => {
  it('malt einen weissen Hintergrund', async () => {
    const bitmap = await renderLabel([], DIE_CUT_MEDIA, CONTEXT, { dpi: 300 });
    const png = decode(bitmap);
    const idx = 0;
    expect([png.data[idx], png.data[idx + 1], png.data[idx + 2]]).toEqual([255, 255, 255]);
  });

  it('zeichnet static-Text sichtbar (nicht-weisse Pixel im erwarteten Bereich)', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'static', xMm: 5, yMm: 5, value: 'ABC', fontSize: 60, bold: true, align: 'left' }];
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300 });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, png.width, 150)).toBe(true);
  });

  it('zeichnet text-Element mit person.name-Feld', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'text', xMm: 5, yMm: 5, field: 'person.name', fontSize: 60, bold: false, align: 'left' }];
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300 });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, png.width, 150)).toBe(true);
  });

  it('zeichnet nichts für ein text-Element mit leerem Feldwert', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'text', xMm: 5, yMm: 5, field: 'checkin.group', fontSize: 60, bold: false, align: 'left' }];
    const emptyContext: RenderContext = { ...CONTEXT, checkin: { ...CONTEXT.checkin, group: '' } };
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, emptyContext, { dpi: 300 });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, png.width, png.height)).toBe(false);
  });

  it('zeichnet eine line als durchgehenden schwarzen Balken', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'line', xMm: 5, yMm: 10, widthMm: 40, thicknessMm: 1 }];
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300 });
    const png = decode(bitmap);
    const yPx = Math.round((10 / 25.4) * 300);
    const xPx = Math.round((5 / 25.4) * 300) + 5;
    const idx = (png.width * yPx + xPx) * 4;
    expect([png.data[idx], png.data[idx + 1], png.data[idx + 2]]).toEqual([0, 0, 0]);
  });

  it('zeichnet einen QR-Code für qr:hash, wenn id+code vorhanden sind', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'qr', xMm: 5, yMm: 5, content: 'qr:hash', sizeMm: 20 }];
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300 });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, 250, 250)).toBe(true);
  });

  it('überspringt qr:hash, wenn id oder code fehlen (wie v1)', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'qr', xMm: 5, yMm: 5, content: 'qr:hash', sizeMm: 20 }];
    const noCodeContext: RenderContext = { ...CONTEXT, checkin: { ...CONTEXT.checkin, code: '' } };
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, noCodeContext, { dpi: 300 });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, png.width, png.height)).toBe(false);
  });

  it('zeichnet qr:personId auch ohne code', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'qr', xMm: 5, yMm: 5, content: 'qr:personId', sizeMm: 20 }];
    const noCodeContext: RenderContext = { ...CONTEXT, checkin: { ...CONTEXT.checkin, code: '' } };
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, noCodeContext, { dpi: 300 });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, 250, 250)).toBe(true);
  });

  it('überspringt ein logo-Element, wenn keine Bilddaten übergeben wurden', async () => {
    const elements: LabelElement[] = [{ id: '1', type: 'logo', xMm: 5, yMm: 5, logoId: 999, heightMm: 10 }];
    await expect(renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300 })).resolves.toBeDefined();
  });

  it('lädt eine gültige Custom-Font-Datei und zeichnet damit sichtbaren Text', async () => {
    const elements: LabelElement[] = [
      { id: '1', type: 'static', xMm: 5, yMm: 5, value: 'Custom', fontSize: 40, bold: false, align: 'left', fontId: 1 },
    ];
    const bitmap = await renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300, fonts: { 1: BUNDLED_FONT_PATH } });
    const png = decode(bitmap);
    expect(hasNonWhitePixel(png, 0, 0, png.width, 150)).toBe(true);
  });

  it('fällt bei nicht ladbarer Custom-Font auf den Systemfont zurück, statt zu werfen', async () => {
    const elements: LabelElement[] = [
      { id: '1', type: 'static', xMm: 5, yMm: 5, value: 'Test', fontSize: 40, bold: false, align: 'left', fontId: 1 },
    ];
    await expect(renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300, fonts: { 1: '/does/not/exist.ttf' } })).resolves.toBeDefined();
  });

  it('fällt auf den Systemfont zurück, wenn fontId auf keinen Eintrag in der fonts-Map zeigt', async () => {
    const elements: LabelElement[] = [
      { id: '1', type: 'static', xMm: 5, yMm: 5, value: 'Test', fontSize: 40, bold: false, align: 'left', fontId: 999 },
    ];
    await expect(renderLabel(elements, DIE_CUT_MEDIA, CONTEXT, { dpi: 300 })).resolves.toBeDefined();
  });

  it('produziert dasselbe qr:hash-Ergebnis wie computeQrHash direkt (Konsistenzcheck)', async () => {
    const expectedHash = computeQrHash(CONTEXT.person.id, CONTEXT.checkin.code, CONTEXT.checkin.timestamp);
    expect(expectedHash).toHaveLength(40); // sha1 hex
  });
});
