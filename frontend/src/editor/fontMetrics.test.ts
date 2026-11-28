import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { editorFontFamily, topBaselineRatio } from './fontMetrics.js';
import type { LabelElement } from '../types.js';

function fontFile(name: string): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(new URL(`../../../backend/assets/fonts/${name}`, import.meta.url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Minimale sfnt-Datei mit `head`, `hhea` und `post`. */
function sfnt(tables: Record<string, Array<[offset: number, value: number]>>, tableSize = 32): ArrayBuffer {
  const tags = Object.keys(tables);
  const headerSize = 12 + tags.length * 16;
  const view = new DataView(new ArrayBuffer(headerSize + tags.length * tableSize));
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tags.length);
  tags.forEach((tag, i) => {
    const record = 12 + i * 16;
    const offset = headerSize + i * tableSize;
    for (let c = 0; c < 4; c++) view.setUint8(record + c, tag.charCodeAt(c));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, tableSize);
    for (const [at, value] of tables[tag]!) view.setInt16(offset + at, value);
  });
  return view.buffer;
}

describe('topBaselineRatio', () => {
  it('liefert für DejaVu Sans den Wert, den der Renderer (Skia) misst', () => {
    // Gemessen mit @napi-rs/canvas: textBaseline 'top' legt die Grundlinie 820,8 px unter den Anker (1000 px Schrift).
    expect(topBaselineRatio(fontFile('DejaVuSans.ttf'))).toBeCloseTo(0.8208, 3);
    expect(topBaselineRatio(fontFile('DejaVuSans-Bold.ttf'))).toBeCloseTo(0.8208, 3);
  });

  it('rechnet Ascent minus Unterstreichungs-Position und -Dicke', () => {
    const buffer = sfnt({ head: [[18, 1000]], hhea: [[4, 900]], post: [[8, -100], [10, 50]] });
    expect(topBaselineRatio(buffer)).toBeCloseTo(0.75);
  });

  it('nimmt bei USE_TYPO_METRICS den Typo-Ascent statt hhea, wie FreeType', () => {
    const tables = { head: [[18, 1000]], hhea: [[4, 900]], post: [[8, -100], [10, 50]] } as Record<string, Array<[number, number]>>;
    const withTypo = sfnt({ ...tables, 'OS/2': [[62, 0x80], [68, 800]] }, 96);
    expect(topBaselineRatio(withTypo)).toBeCloseTo(0.65);
    const withoutFlag = sfnt({ ...tables, 'OS/2': [[62, 0x40], [68, 800]] }, 96);
    expect(topBaselineRatio(withoutFlag)).toBeCloseTo(0.75);
  });

  it('lässt fehlende Unterstreichungs-Angaben weg', () => {
    const buffer = sfnt({ head: [[18, 1000]], hhea: [[4, 900]] });
    expect(topBaselineRatio(buffer)).toBeCloseTo(0.9);
  });

  it('gibt bei unlesbaren Daten null zurück', () => {
    expect(topBaselineRatio(new ArrayBuffer(8))).toBeNull();
    expect(topBaselineRatio(sfnt({ head: [[18, 1000]] }))).toBeNull();
  });
});

describe('editorFontFamily', () => {
  const text = (extra: Partial<Extract<LabelElement, { type: 'static' }>>) =>
    ({ id: 't', type: 'static', xMm: 0, yMm: 0, value: 'x', fontSize: 40, bold: false, align: 'left', ...extra }) as Extract<LabelElement, { type: 'static' }>;

  it('nimmt die eigene Schrift, wenn sie geladen ist', () => {
    expect(editorFontFamily(text({ fontId: 3, bold: true }), new Set(['font-3']))).toBe('font-3');
  });

  it('fällt wie der Renderer auf die Druckschrift zurück, wenn die eigene Schrift fehlt', () => {
    expect(editorFontFamily(text({ fontId: 3 }), new Set(['font-4']))).toBe('ctp-default');
    expect(editorFontFamily(text({ fontId: 3, bold: true }), new Set())).toBe('ctp-default-bold');
  });

  it('nimmt ohne eigene Schrift die Druckschrift in Regular bzw. Bold', () => {
    expect(editorFontFamily(text({}), new Set())).toBe('ctp-default');
    expect(editorFontFamily(text({ bold: true }), new Set())).toBe('ctp-default-bold');
  });
});
