import { PNG } from 'pngjs';
import type { MonochromeBitmap } from './zplBuilder.js';

/**
 * Dekodiert ein vom LabelRenderer erzeugtes PNG (Graustufen oder RGBA) und
 * schwellt es auf 1-bit Schwarz/Weiss — Zebra/ZPL braucht kein PNG-Rendering,
 * nur die gepackten Bits (siehe zplBuilder.ts).
 */
export function pngToMonochrome(png: Buffer, threshold = 128): MonochromeBitmap {
  const decoded = PNG.sync.read(png);
  const pixels = new Uint8Array(decoded.width * decoded.height);

  for (let i = 0; i < decoded.width * decoded.height; i++) {
    const offset = i * 4; // pngjs dekodiert immer nach RGBA
    const r = decoded.data[offset]!;
    const g = decoded.data[offset + 1]!;
    const b = decoded.data[offset + 2]!;
    const alpha = decoded.data[offset + 3]!;
    const luminance = (r + g + b) / 3;
    // Transparente Pixel gelten als weiss (kein Druck), sonst nach Helligkeit schwellen.
    pixels[i] = alpha > 0 && luminance < threshold ? 255 : 0;
  }

  return { widthPx: decoded.width, heightPx: decoded.height, pixels };
}
