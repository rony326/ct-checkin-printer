/**
 * Senkrechte Textlage wie im Server-Renderer. Der zeichnet mit
 * `textBaseline = 'top'`, und @napi-rs/canvas (Skia) legt die Grundlinie dann
 * um Ascent − Unterstreichungs-Position − Unterstreichungs-Dicke unter den
 * Anker. Browser deuten 'top' anders (Chrome: OS/2-Typo-Ascent), bei DejaVu
 * Sans rund 0,06 × Schriftgrösse höher. Der Editor liest die Werte deshalb
 * selbst aus der Schriftdatei und zeichnet ab der Grundlinie.
 */

import type { TextLikeElement } from './geometry.js';

/** Familien der mitgelieferten Druckschrift (DejaVu Sans), siehe `useFontFaces` im LayoutEditor. */
export const DEFAULT_FONT_FAMILY = 'ctp-default';
export const DEFAULT_BOLD_FONT_FAMILY = 'ctp-default-bold';

/**
 * Schriftwahl wie im Renderer: die eigene Schrift, falls sie geladen werden
 * konnte, sonst die mitgelieferte Druckschrift in Regular bzw. Bold.
 */
export function editorFontFamily(el: TextLikeElement, loadedFamilies: ReadonlySet<string>): string {
  if (el.fontId !== undefined && loadedFamilies.has(`font-${el.fontId}`)) return `font-${el.fontId}`;
  return el.bold ? DEFAULT_BOLD_FONT_FAMILY : DEFAULT_FONT_FAMILY;
}

interface TableRecord {
  offset: number;
  length: number;
}

function readTables(view: DataView): Map<string, TableRecord> {
  const tables = new Map<string, TableRecord>();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(record), view.getUint8(record + 1), view.getUint8(record + 2), view.getUint8(record + 3));
    tables.set(tag, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) });
  }
  return tables;
}

/**
 * Abstand vom Anker zur Grundlinie als Anteil der Schriftgrösse, für eine
 * TrueType-/OpenType-Datei; `null`, wenn die Datei nicht lesbar ist.
 */
export function topBaselineRatio(buffer: ArrayBuffer): number | null {
  try {
    const view = new DataView(buffer);
    const tables = readTables(view);
    const head = tables.get('head');
    const hhea = tables.get('hhea');
    if (!head || !hhea) return null;
    const unitsPerEm = view.getUint16(head.offset + 18);
    if (unitsPerEm === 0) return null;

    // Wie FreeType: mit USE_TYPO_METRICS (fsSelection Bit 7) der Typo-Ascent,
    // sonst hhea und bei fehlenden Werten OS/2.
    const os2 = tables.get('OS/2');
    const useTypoMetrics = os2 !== undefined && (view.getUint16(os2.offset + 62) & 0x80) !== 0;
    let ascender = useTypoMetrics ? view.getInt16(os2.offset + 68) : view.getInt16(hhea.offset + 4);
    if (ascender === 0 && os2) {
      ascender = view.getInt16(os2.offset + 68) || view.getUint16(os2.offset + 74);
    }

    let underlinePosition = 0;
    let underlineThickness = 0;
    const post = tables.get('post');
    if (post) {
      underlinePosition = view.getInt16(post.offset + 8);
      underlineThickness = view.getInt16(post.offset + 10);
    }
    // `underlinePosition` ist negativ, wenn die Unterstreichung unter der Grundlinie liegt.
    return (ascender + underlinePosition - underlineThickness) / unitsPerEm;
  } catch {
    return null;
  }
}
