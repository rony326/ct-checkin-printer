/**
 * Senkrechte Textlage wie im Server-Renderer. Der zeichnet mit
 * `textBaseline = 'top'`, und @napi-rs/canvas (Skia) legt die Grundlinie dann
 * um Ascent − Unterstreichungs-Position − Unterstreichungs-Dicke unter den
 * Anker. Browser deuten 'top' anders (Chrome: OS/2-Typo-Ascent), bei DejaVu
 * Sans rund 0,06 × Schriftgrösse höher. Der Editor liest die Werte deshalb
 * selbst aus der Schriftdatei und zeichnet ab der Grundlinie.
 */

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

    // Wie FreeType: hhea, bei fehlenden Werten OS/2.
    let ascender = view.getInt16(hhea.offset + 4);
    const os2 = tables.get('OS/2');
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
