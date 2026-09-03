import { describe, expect, it } from 'vitest';
import { buildZplLabel, packToBits, rotateMonochromeBitmap, type MonochromeBitmap } from './zplBuilder.js';

/** 8x2-Bitmap: obere Zeile komplett schwarz, untere Zeile komplett weiss. */
function stripedBitmap(): MonochromeBitmap {
  const pixels = new Uint8Array(8 * 2);
  pixels.fill(255, 0, 8); // Zeile 0 = schwarz
  pixels.fill(0, 8, 16); // Zeile 1 = weiss
  return { widthPx: 8, heightPx: 2, pixels };
}

describe('packToBits', () => {
  it('packs a fully-black row as 0xFF and a fully-white row as 0x00', () => {
    const { bytesPerRow, data } = packToBits(stripedBitmap());
    expect(bytesPerRow).toBe(1);
    expect(data).toEqual(Buffer.from([0xff, 0x00]));
  });

  it('pads a non-byte-aligned width to full bytes', () => {
    // 3px breit, alle schwarz -> oberste 3 Bits gesetzt, Rest 0 -> 0b11100000 = 0xE0
    const bitmap: MonochromeBitmap = { widthPx: 3, heightPx: 1, pixels: new Uint8Array([255, 255, 255]) };
    const { bytesPerRow, data } = packToBits(bitmap);
    expect(bytesPerRow).toBe(1);
    expect(data).toEqual(Buffer.from([0b11100000]));
  });

  it('sets the correct single bit for one black pixel among white ones', () => {
    const pixels = new Uint8Array(8).fill(0);
    pixels[2] = 255; // drittes Pixel von links schwarz
    const { data } = packToBits({ widthPx: 8, heightPx: 1, pixels });
    // Pixel-Index 2 -> Bit 5 (7 - 2) -> 0b00100000 = 0x20
    expect(data).toEqual(Buffer.from([0x20]));
  });
});

describe('rotateMonochromeBitmap', () => {
  it('leaves the bitmap unchanged for rotate=0', () => {
    const bitmap = stripedBitmap();
    expect(rotateMonochromeBitmap(bitmap, '0')).toBe(bitmap);
  });

  it('reverses the pixel order for rotate=180', () => {
    const pixels = new Uint8Array([1, 0, 0, 0]);
    const rotated = rotateMonochromeBitmap({ widthPx: 2, heightPx: 2, pixels }, '180');
    expect(Array.from(rotated.pixels)).toEqual([0, 0, 0, 1]);
  });

  it('swaps width/height for rotate=90 and rotate=270', () => {
    const bitmap: MonochromeBitmap = { widthPx: 4, heightPx: 2, pixels: new Uint8Array(8) };
    expect(rotateMonochromeBitmap(bitmap, '90')).toMatchObject({ widthPx: 2, heightPx: 4 });
    expect(rotateMonochromeBitmap(bitmap, '270')).toMatchObject({ widthPx: 2, heightPx: 4 });
  });

  it('rotates a single top-left black pixel to the top-right for a 90° clockwise rotation', () => {
    // 2x2, oben-links schwarz. 90° im Uhrzeigersinn -> oben-links wandert nach oben-rechts.
    const pixels = new Uint8Array([1, 0, 0, 0]);
    const rotated = rotateMonochromeBitmap({ widthPx: 2, heightPx: 2, pixels }, '90');
    // rotated[dy*h + dx] mit dx=h-1-y=1, dy=x=0 -> Index 0*2+1=1
    expect(Array.from(rotated.pixels)).toEqual([0, 1, 0, 0]);
  });
});

describe('buildZplLabel', () => {
  it('produces a well-formed ^XA...^XZ command containing the packed hex data', () => {
    const zpl = buildZplLabel(stripedBitmap(), { copies: 2, rotate: '0' });
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^PW8');
    expect(zpl).toContain('^LL2');
    expect(zpl).toContain('^GFA,2,2,1,FF00');
    expect(zpl).toContain('^PQ2');
    expect(zpl.trim().endsWith('^XZ')).toBe(true);
  });
});
