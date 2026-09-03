import { describe, expect, it } from 'vitest';
import { resolvePrinterSchedule } from './printerSchedule.js';

describe('resolvePrinterSchedule', () => {
  it('returns null (always active) for mode "always" even if activeTimesDefault is set', () => {
    const schedule = resolvePrinterSchedule(
      { activeTimesMode: 'always', activeTimesExpr: null },
      'Mo-Fr:08:00-17:00',
    );
    expect(schedule).toBeNull();
  });

  it('parses the global default for mode "inherit"', () => {
    const schedule = resolvePrinterSchedule(
      { activeTimesMode: 'inherit', activeTimesExpr: null },
      'So:09:00-12:00',
    );
    expect(schedule).toEqual({ 0: [{ startH: 9, startM: 0, endH: 12, endM: 0 }] });
  });

  it('is always active when mode is "inherit" and there is no global default', () => {
    expect(resolvePrinterSchedule({ activeTimesMode: 'inherit', activeTimesExpr: null }, null)).toBeNull();
  });

  it('parses the printer-specific expression for mode "custom"', () => {
    const schedule = resolvePrinterSchedule(
      { activeTimesMode: 'custom', activeTimesExpr: 'Sa:10:00-11:00' },
      'Mo-Fr:08:00-17:00',
    );
    expect(schedule).toEqual({ 6: [{ startH: 10, startM: 0, endH: 11, endM: 0 }] });
  });

  it('throws with a helpful message for an invalid custom expression', () => {
    expect(() => resolvePrinterSchedule({ activeTimesMode: 'custom', activeTimesExpr: 'garbage' }, null)).toThrow();
  });
});
