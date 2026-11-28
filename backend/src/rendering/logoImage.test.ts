import { createCanvas, type Canvas } from '@napi-rs/canvas';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { decodeLogo } from './logoImage.js';

/** Linke Hälfte rot, rechte Hälfte weiss. */
function halfRed(width: number, height: number): Canvas {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#f00';
  context.fillRect(0, 0, width / 2, height);
  return canvas;
}
const jpegOf = (width = 80, height = 40) => halfRed(width, height).toBuffer('image/jpeg');
const pngOf = (width = 80, height = 40) => halfRed(width, height).toBuffer('image/png');

/** Setzt die EXIF-Angabe zur Drehung (APP1, big endian) direkt hinter den Dateianfang. */
function withOrientation(data: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from('4d4d002a000000080001011200030000000100000000000000000000', 'hex');
  tiff.writeUInt16BE(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, payload.length + 2]);
  return Buffer.concat([data.subarray(0, 2), head, payload, data.subarray(2)]);
}

function isRed(canvas: Canvas, x: number, y: number): boolean {
  const [r, g] = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return r! > 180 && g! < 80;
}

describe('decodeLogo', () => {
  it.each([
    ['PNG', pngOf],
    ['JPEG', jpegOf],
  ])('dekodiert ein gültiges %s', (_label, make) => {
    const logo = decodeLogo(make())!;
    expect([logo.width, logo.height]).toEqual([80, 40]);
    expect(isRed(logo, 10, 20)).toBe(true);
    expect(isRed(logo, 70, 20)).toBe(false);
  });

  // Dieselben Eingaben bringen den Bilddekoder von @napi-rs/canvas zum Absturz.
  it.each([
    ['leere Datei', () => Buffer.alloc(0)],
    ['Text', () => Buffer.from('kaputt')],
    ['WebP-Rumpf', () => Buffer.from('RIFFxxxxWEBP')],
    ['JPEG aus einem leeren Segment', () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])],
    ['JPEG, nach 100 Bytes abgeschnitten', () => jpegOf().subarray(0, 100)],
    ['JPEG, halb abgeschnitten', () => jpegOf().subarray(0, jpegOf().length / 2)],
    ['JPEG ohne die letzten Bytes', () => jpegOf().subarray(0, -10)],
    ['abgeschnittenes PNG', () => pngOf().subarray(0, 60)],
  ])('liefert null: %s', (_label, make) => {
    expect(decodeLogo(make())).toBeNull();
  });

  it('übersteht viele verfälschte JPEG-Köpfe ohne Absturz', { timeout: 30_000 }, () => {
    const original = jpegOf();
    const scanStart = original.indexOf(Buffer.from([0xff, 0xda]));
    let seed = 1;
    const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let i = 0; i < 300; i++) {
      const mutated = Buffer.from(original);
      for (let k = 0; k <= random(8); k++) mutated[2 + random(scanStart - 2)] = random(256);
      const logo = decodeLogo(mutated);
      if (logo) expect(logo.width).toBeGreaterThan(0);
    }
  });

  it('lehnt Bilder über 16 Megapixeln ab, ohne sie zu dekodieren', () => {
    const png = Buffer.from(pngOf());
    png.writeUInt32BE(20_000, 16);
    png.writeUInt32BE(20_000, 20);
    expect(decodeLogo(png)).toBeNull();
  });

  it('akzeptiert ein PNG mit angehängten Bytes nach dem Bildende', () => {
    expect(decodeLogo(Buffer.concat([pngOf(), Buffer.from('Anhang')]))?.width).toBe(80);
  });

  it('verkleinert sehr grosse Bilder auf höchstens 2000 Pixel Kantenlänge', () => {
    const logo = decodeLogo(pngOf(4000, 1000))!;
    expect([logo.width, logo.height]).toEqual([2000, 500]);
  });

  // Wo die rote Hälfte nach der Drehung liegt (EXIF-Werte 1 bis 8).
  it.each([
    [1, 80, 40, [10, 20]],
    [2, 80, 40, [70, 20]],
    [3, 80, 40, [70, 20]],
    [4, 80, 40, [10, 20]],
    [5, 40, 80, [20, 10]],
    [6, 40, 80, [20, 10]],
    [7, 40, 80, [20, 70]],
    [8, 40, 80, [20, 70]],
  ] as const)('wendet die EXIF-Drehung %i an', (orientation, width, height, [x, y]) => {
    const logo = decodeLogo(withOrientation(jpegOf(), orientation))!;
    expect([logo.width, logo.height]).toEqual([width, height]);
    expect(isRed(logo, x, y)).toBe(true);
    expect(isRed(logo, width - 1 - x, height - 1 - y)).toBe(false);
  });

  it('dekodiert ein Foto mit 12 Megapixeln', { timeout: 30_000 }, () => {
    const data = jpeg.encode({ width: 4000, height: 3000, data: Buffer.alloc(4000 * 3000 * 4, 200) }, 80).data;
    const logo = decodeLogo(data)!;
    expect([logo.width, logo.height]).toEqual([2000, 1500]);
  });
});
