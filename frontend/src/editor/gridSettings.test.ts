import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_SETTINGS, parseGridSettings } from './gridSettings.js';

describe('parseGridSettings', () => {
  it('liefert ohne oder bei kaputtem Eintrag den Standard', () => {
    expect(DEFAULT_GRID_SETTINGS).toEqual({ showGrid: true, gridMm: 5, snap: true });
    for (const raw of [null, '', 'kaputt', 'null', '5', '[]', '"x"']) {
      expect(parseGridSettings(raw)).toEqual(DEFAULT_GRID_SETTINGS);
    }
  });

  it('ersetzt ungültige Werte einzeln', () => {
    expect(parseGridSettings('{"gridMm":7}').gridMm).toBe(5);
    expect(parseGridSettings('{"showGrid":false,"gridMm":"10","snap":1}')).toEqual({ showGrid: false, gridMm: 5, snap: true });
  });

  it('übernimmt gültiges JSON', () => {
    for (const gridMm of [2.5, 5, 10]) {
      const settings = { showGrid: false, gridMm, snap: false };
      expect(parseGridSettings(JSON.stringify(settings))).toEqual(settings);
    }
  });
});
