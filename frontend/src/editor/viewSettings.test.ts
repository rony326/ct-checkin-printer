import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseViewDeg, readViewDeg } from './viewSettings.js';

describe('parseViewDeg', () => {
  it('liefert ohne oder bei unbrauchbarem Eintrag 0°', () => {
    for (const raw of [null, '', 'abc', '45', '360', '"90"']) expect(parseViewDeg(raw)).toBe('0');
  });

  it('übernimmt gültige Winkel', () => {
    for (const deg of ['0', '90', '180', '270']) expect(parseViewDeg(deg)).toBe(deg);
  });
});

describe('readViewDeg', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('liest den Eintrag des Layouts', () => {
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => (key === 'ctp.editor.view.7' ? '270' : null) } });
    expect(readViewDeg('7')).toBe('270');
    expect(readViewDeg('8')).toBe('0');
  });

  it('liefert 0°, wenn der Speicher gesperrt ist', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('SecurityError');
      },
    });
    expect(readViewDeg('7')).toBe('0');
  });
});
