import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { pngToMonochrome } from './pngToMonochrome.js';

function makePng(pixels: Array<{ r: number; g: number; b: number; a: number }>, width: number): Buffer {
  const png = new PNG({ width, height: Math.ceil(pixels.length / width) });
  pixels.forEach((p, i) => {
    const offset = i * 4;
    png.data[offset] = p.r;
    png.data[offset + 1] = p.g;
    png.data[offset + 2] = p.b;
    png.data[offset + 3] = p.a;
  });
  return PNG.sync.write(png);
}

describe('pngToMonochrome', () => {
  it('maps a dark opaque pixel to black (255)', () => {
    const bitmap = pngToMonochrome(makePng([{ r: 0, g: 0, b: 0, a: 255 }], 1));
    expect(bitmap.pixels[0]).toBe(255);
  });

  it('maps a light opaque pixel to white (0)', () => {
    const bitmap = pngToMonochrome(makePng([{ r: 255, g: 255, b: 255, a: 255 }], 1));
    expect(bitmap.pixels[0]).toBe(0);
  });

  it('treats a fully transparent dark pixel as white, not black', () => {
    const bitmap = pngToMonochrome(makePng([{ r: 0, g: 0, b: 0, a: 0 }], 1));
    expect(bitmap.pixels[0]).toBe(0);
  });

  it('respects a custom threshold', () => {
    const midGray = { r: 100, g: 100, b: 100, a: 255 };
    expect(pngToMonochrome(makePng([midGray], 1), 50).pixels[0]).toBe(0); // 100 >= 50 -> weiss
    expect(pngToMonochrome(makePng([midGray], 1), 150).pixels[0]).toBe(255); // 100 < 150 -> schwarz
  });

  it('preserves width/height from the decoded PNG', () => {
    const bitmap = pngToMonochrome(makePng([{ r: 0, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }], 2));
    expect(bitmap.widthPx).toBe(2);
    expect(bitmap.heightPx).toBe(1);
    expect(bitmap.pixels).toHaveLength(2);
  });
});
