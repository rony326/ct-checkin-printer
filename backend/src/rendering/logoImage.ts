import { createHash } from 'node:crypto';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Einzige Stelle, die hochgeladene Bilddateien dekodiert — für Upload-Prüfung, Etikett und Anwesenheitsliste.
 *
 * Der Dekoder von `@napi-rs/canvas` (`loadImage`) beendet den ganzen Prozess mit einem Segfault, wenn eine Datei
 * defekt ist; das lässt sich nicht abfangen. Fremde Bytes gehen deshalb nur an Dekoder in reinem JavaScript, und
 * `@napi-rs/canvas` bekommt ausschliesslich fertige Pixel.
 */

/** Grössere Bilder bräuchten beim Dekodieren Hunderte MB Arbeitsspeicher (Raspberry Pi). */
export const MAX_LOGO_PIXELS = 16_000_000;
/** Für Etikett (62 mm bei 300 dpi sind rund 730 Pixel) und A4 mehr als genug. */
const MAX_LOGO_EDGE = 2000;
/** Das Etikett lädt das Logo bei jedem Check-in neu, das Dekodieren soll sich nicht wiederholen. */
const CACHE_SIZE = 8;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_SCAN = Buffer.from([0xff, 0xda]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

const cache = new Map<string, Canvas | null>();

/** Dekodiert PNG oder JPEG zu einem aufrecht gedrehten Canvas; `null`, wenn die Datei nicht lesbar oder zu gross ist. */
export function decodeLogo(bytes: Buffer): Canvas | null {
  const key = createHash('sha1').update(bytes).digest('hex');
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let result: Canvas | null = null;
  try {
    if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) result = toCanvas(decodePng(bytes), 1);
    else if (bytes.subarray(0, 3).equals(JPEG_START)) result = toCanvas(decodeJpeg(bytes), jpegOrientation(bytes));
  } catch {
    result = null;
  }

  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

function decodePng(bytes: Buffer): Pixels | null {
  // Breite und Höhe stehen im Bildkopf (IHDR), also vor dem Dekodieren prüfbar.
  if (bytes.length < 24 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > MAX_LOGO_PIXELS) return null;
  return PNG.sync.read(cutAfterEnd(bytes));
}

/** Manche Programme hängen Bytes hinter das Bildende (IEND), woran `pngjs` sonst scheitert. */
function cutAfterEnd(bytes: Buffer): Buffer {
  for (let pos = PNG_SIGNATURE.length; pos + 12 <= bytes.length; ) {
    const end = pos + 12 + bytes.readUInt32BE(pos);
    if (bytes.toString('latin1', pos + 4, pos + 8) === 'IEND') return bytes.subarray(0, end);
    pos = end;
  }
  return bytes;
}

function decodeJpeg(bytes: Buffer): Pixels | null {
  // Ohne Endmarke nach den letzten Bilddaten ist die Datei abgeschnitten.
  if (bytes.lastIndexOf(JPEG_END) < bytes.lastIndexOf(JPEG_SCAN)) return null;
  return jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
    maxResolutionInMP: MAX_LOGO_PIXELS / 1_000_000,
    maxMemoryUsageInMB: 512,
  });
}

/** EXIF-Angabe zur Drehung (1 bis 8); Handyfotos liegen sonst quer. Unlesbare Angaben zählen als „nicht gedreht“. */
function jpegOrientation(bytes: Buffer): number {
  try {
    for (let pos = 2; pos + 4 <= bytes.length && bytes[pos] === 0xff && bytes[pos + 1] !== 0xda; ) {
      const length = bytes.readUInt16BE(pos + 2);
      if (bytes[pos + 1] === 0xe1 && bytes.toString('latin1', pos + 4, pos + 10) === 'Exif\0\0') {
        const tiff = bytes.subarray(pos + 10, pos + 2 + length);
        const little = tiff.toString('latin1', 0, 2) === 'II';
        const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
        const directory = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
        for (let i = 0; i < u16(directory); i++) {
          const entry = directory + 2 + i * 12;
          if (u16(entry) !== 0x0112) continue;
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
        return 1;
      }
      pos += 2 + length;
    }
  } catch {
    return 1;
  }
  return 1;
}

function toCanvas(pixels: Pixels | null, orientation: number): Canvas | null {
  if (!pixels || pixels.width < 1 || pixels.height < 1) return null;
  const source = createCanvas(pixels.width, pixels.height);
  const sourceContext = source.getContext('2d');
  const imageData = sourceContext.createImageData(pixels.width, pixels.height);
  imageData.data.set(pixels.data);
  sourceContext.putImageData(imageData, 0, 0);

  const scale = Math.min(1, MAX_LOGO_EDGE / Math.max(pixels.width, pixels.height));
  const width = Math.max(1, Math.round(pixels.width * scale));
  const height = Math.max(1, Math.round(pixels.height * scale));
  const turned = orientation > 4; // um 90 Grad gedreht: Breite und Höhe tauschen
  const canvas = createCanvas(turned ? height : width, turned ? width : height);
  const context = canvas.getContext('2d');
  // Je EXIF-Wert die Abbildung vom gespeicherten auf das aufrechte Bild.
  const transforms: [number, number, number, number, number, number][] = [
    [1, 0, 0, 1, 0, 0],
    [-1, 0, 0, 1, width, 0],
    [-1, 0, 0, -1, width, height],
    [1, 0, 0, -1, 0, height],
    [0, 1, 1, 0, 0, 0],
    [0, 1, -1, 0, height, 0],
    [0, -1, -1, 0, height, width],
    [0, -1, 1, 0, 0, width],
  ];
  context.setTransform(...transforms[orientation - 1]!);
  context.drawImage(source, 0, 0, width, height);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
