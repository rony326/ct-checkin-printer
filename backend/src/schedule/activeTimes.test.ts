import { describe, expect, it } from 'vitest';
import { isActiveNow, msUntilNextWindow, msUntilWindowEnd, parseActiveTimes } from './activeTimes.js';

describe('parseActiveTimes', () => {
  it('returns null for empty/null/undefined input', () => {
    expect(parseActiveTimes('')).toBeNull();
    expect(parseActiveTimes('   ')).toBeNull();
    expect(parseActiveTimes(null)).toBeNull();
    expect(parseActiveTimes(undefined)).toBeNull();
  });

  it('parses a single day with one window', () => {
    const schedule = parseActiveTimes('So:09:00-12:00');
    expect(schedule).toEqual({ 0: [{ startH: 9, startM: 0, endH: 12, endM: 0 }] });
  });

  it('parses multiple space-separated windows for one day', () => {
    const schedule = parseActiveTimes('So:09:00-12:00 18:00-20:00');
    expect(schedule![0]).toHaveLength(2);
    expect(schedule![0]![1]).toEqual({ startH: 18, startM: 0, endH: 20, endM: 0 });
  });

  it('parses a day range', () => {
    const schedule = parseActiveTimes('Mo-Fr:08:00-17:00');
    expect(Object.keys(schedule!).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses multiple comma-separated entries', () => {
    const schedule = parseActiveTimes('Mo-Fr:08:00-17:00,So:09:00-12:00');
    expect(schedule![1]).toBeDefined();
    expect(schedule![0]).toBeDefined();
  });

  it('accepts both German and English day abbreviations', () => {
    expect(parseActiveTimes('Di:09:00-10:00')![2]).toBeDefined();
    expect(parseActiveTimes('Tu:09:00-10:00')![2]).toBeDefined();
  });

  it('throws on an unknown day name', () => {
    expect(() => parseActiveTimes('Xx:09:00-10:00')).toThrow(/Wochentag/);
  });

  it('throws on a malformed time window', () => {
    expect(() => parseActiveTimes('Mo:9-10')).toThrow(/Ungültiges Zeitfenster/);
  });

  it('throws on an out-of-range hour or minute', () => {
    expect(() => parseActiveTimes('Mo:25:00-10:00')).toThrow(/Uhrzeit/);
    expect(() => parseActiveTimes('Mo:09:70-10:00')).toThrow(/Uhrzeit/);
  });

  it('throws on an entry without a colon', () => {
    expect(() => parseActiveTimes('MoFr0800')).toThrow(/Tag:HH:MM-HH:MM/);
  });
});

describe('isActiveNow', () => {
  it('is always true for a null schedule', () => {
    expect(isActiveNow(null)).toBe(true);
  });

  it('is true inside a configured window', () => {
    const schedule = parseActiveTimes('Mo-So:00:00-23:59');
    expect(isActiveNow(schedule, new Date('2026-01-05T10:00:00'))).toBe(true); // Montag
  });

  it('is false outside the configured window', () => {
    const schedule = parseActiveTimes('So:09:00-12:00');
    expect(isActiveNow(schedule, new Date('2026-01-05T10:00:00'))).toBe(false); // Montag, nur So konfiguriert
  });

  it('treats the end time as exclusive', () => {
    const schedule = parseActiveTimes('Mo:09:00-10:00');
    expect(isActiveNow(schedule, new Date('2026-01-05T10:00:00'))).toBe(false);
    expect(isActiveNow(schedule, new Date('2026-01-05T09:59:00'))).toBe(true);
  });
});

describe('msUntilNextWindow', () => {
  it('returns null for a null schedule', () => {
    expect(msUntilNextWindow(null)).toBeNull();
  });

  it('returns 0 exactly at the window start', () => {
    const schedule = parseActiveTimes('Mo:09:00-10:00');
    expect(msUntilNextWindow(schedule, new Date('2026-01-05T09:00:00'))).toBe(0);
  });

  it('returns the ms until later today', () => {
    const schedule = parseActiveTimes('Mo:09:00-10:00');
    const ms = msUntilNextWindow(schedule, new Date('2026-01-05T08:00:00'));
    expect(ms).toBe(60 * 60_000);
  });

  it('returns the ms until a future day when today has no window left', () => {
    const schedule = parseActiveTimes('Mi:09:00-10:00');
    const ms = msUntilNextWindow(schedule, new Date('2026-01-05T08:00:00')); // Montag 08:00 -> Mittwoch 09:00 = 49h
    expect(ms).toBe(49 * 60 * 60_000);
  });
});

describe('msUntilWindowEnd', () => {
  it('returns null outside any window', () => {
    const schedule = parseActiveTimes('Mo:09:00-10:00');
    expect(msUntilWindowEnd(schedule, new Date('2026-01-05T11:00:00'))).toBeNull();
  });

  it('returns the ms remaining inside an active window', () => {
    const schedule = parseActiveTimes('Mo:09:00-10:00');
    expect(msUntilWindowEnd(schedule, new Date('2026-01-05T09:30:00'))).toBe(30 * 60_000);
  });
});
