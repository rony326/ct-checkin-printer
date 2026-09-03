/**
 * Baut ZPL-Etiketten rein in TypeScript — kein Python im Zebra-Pfad (siehe
 * Plan, Abschnitt "Bewusste Technik-Entscheidung"). ZPL ist ein Text-/ASCII-
 * Protokoll, das Bitmap wird als `^GFA`-Graphic-Field (unkomprimiertes
 * ASCII-Hex) eingebettet.
 */

export interface MonochromeBitmap {
  widthPx: number;
  heightPx: number;
  /** Ein Byte pro Pixel, 0 = weiss, >0 = schwarz (z.B. aus einem geschwellten Graustufenbild). */
  pixels: Uint8Array;
}

/** Dreht ein Monochrom-Bitmap um 0/90/180/270°, im Uhrzeigersinn. */
export function rotateMonochromeBitmap(bitmap: MonochromeBitmap, rotate: '0' | '90' | '180' | '270'): MonochromeBitmap {
  const { widthPx: w, heightPx: h, pixels } = bitmap;
  if (rotate === '0') return bitmap;

  if (rotate === '180') {
    const out = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) out[pixels.length - 1 - i] = pixels[i]!;
    return { widthPx: w, heightPx: h, pixels: out };
  }

  // 90°/270°: Breite und Höhe tauschen.
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = pixels[y * w + x]!;
      let dx: number;
      let dy: number;
      if (rotate === '90') {
        dx = h - 1 - y;
        dy = x;
      } else {
        dx = y;
        dy = w - 1 - x;
      }
      out[dy * h + dx] = src;
    }
  }
  return { widthPx: h, heightPx: w, pixels: out };
}

/** Packt ein Monochrom-Bitmap MSB-first in Byte-Zeilen (1 Bit = 1 Pixel, 1 = schwarz). */
export function packToBits(bitmap: MonochromeBitmap): { bytesPerRow: number; data: Buffer } {
  const { widthPx, heightPx, pixels } = bitmap;
  const bytesPerRow = Math.ceil(widthPx / 8);
  const data = Buffer.alloc(bytesPerRow * heightPx);

  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (pixels[y * widthPx + x]) {
        const byteIndex = y * bytesPerRow + (x >> 3);
        const bitIndex = 7 - (x % 8);
        data[byteIndex]! |= 1 << bitIndex;
      }
    }
  }
  return { bytesPerRow, data };
}

export interface ZplLabelOptions {
  copies: number;
  rotate: '0' | '90' | '180' | '270';
}

/** Baut das vollständige ZPL-Kommando (^XA...^XZ) für ein gerendertes Etikett. */
export function buildZplLabel(bitmap: MonochromeBitmap, opts: ZplLabelOptions): string {
  const rotated = rotateMonochromeBitmap(bitmap, opts.rotate);
  const { bytesPerRow, data } = packToBits(rotated);
  const totalBytes = data.length;
  const hex = data.toString('hex').toUpperCase();

  return [
    '^XA',
    `^PW${rotated.widthPx}`,
    `^LL${rotated.heightPx}`,
    '^FO0,0',
    `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hex}`,
    `^PQ${opts.copies}`,
    '^XZ',
  ].join('\n');
}
