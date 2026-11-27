import { describe, expect, it } from 'vitest';
import { groupSummaryRows, isGuestName, type CheckinLogRow } from './summaryData.js';

function logRow(overrides: Partial<CheckinLogRow> = {}): CheckinLogRow {
  return { groupName: 'Kids', personName: 'Max Muster', code: 'ZRYK', printedAt: '2026-11-27 09:00:00', ...overrides };
}

function entriesOf(rows: CheckinLogRow[], groupName = 'Kids') {
  return groupSummaryRows(rows, 'Gast').get(groupName) ?? [];
}

describe('groupSummaryRows — Zusammenfassen', () => {
  it('lists the same person once per group with the earliest time, whatever the input order', () => {
    const entries = entriesOf([
      logRow({ printedAt: '2026-11-27 09:30:00' }),
      logRow({ printedAt: '2026-11-27 08:55:00' }),
      logRow({ printedAt: '2026-11-27 10:10:00' }),
    ]);

    expect(entries).toEqual([{ name: 'Max Muster', code: 'ZRYK', printedAt: '2026-11-27 08:55:00', isGuest: false }]);
  });

  it('keeps two different names with the same code apart', () => {
    expect(entriesOf([logRow(), logRow({ personName: 'Erika Muster' })])).toHaveLength(2);
  });

  it('keeps the same name with two different codes apart', () => {
    expect(entriesOf([logRow(), logRow({ code: 'AB12' })])).toHaveLength(2);
  });

  it('lists the same name and code once in each of two groups', () => {
    const grouped = groupSummaryRows([logRow(), logRow({ groupName: 'Teens' })], 'Gast');

    expect(grouped.get('Kids')).toHaveLength(1);
    expect(grouped.get('Teens')).toHaveLength(1);
  });

  it('never merges rows that have neither name nor code', () => {
    expect(entriesOf([logRow({ personName: null, code: null }), logRow({ personName: null, code: null })])).toHaveLength(2);
    expect(entriesOf([logRow({ personName: '  ', code: '' }), logRow({ personName: '  ', code: '' })])).toHaveLength(2);
  });

  it('ignores surrounding whitespace when comparing but leaves name and code untouched', () => {
    const entries = entriesOf([
      logRow({ personName: 'Max Muster', code: 'ZRYK', printedAt: '2026-11-27 09:30:00' }),
      logRow({ personName: ' Max Muster ', code: 'ZRYK ', printedAt: '2026-11-27 08:55:00' }),
    ]);

    expect(entries).toEqual([{ name: ' Max Muster ', code: 'ZRYK ', printedAt: '2026-11-27 08:55:00', isGuest: false }]);
  });

  it('collects rows without a group under "Ohne Gruppe"', () => {
    const grouped = groupSummaryRows([logRow({ groupName: null })], 'Gast');

    expect([...grouped.keys()]).toEqual(['Ohne Gruppe']);
  });

  it('returns no groups for no rows', () => {
    expect(groupSummaryRows([], 'Gast').size).toBe(0);
  });
});

describe('groupSummaryRows — Sortierung', () => {
  it('sorts guests first, then everyone else, each by name with numbers compared numerically', () => {
    const entries = entriesOf(
      ['Zoe', 'Gast 10 Youngsters', 'Anna', 'Gast 2 Youngsters'].map((personName, index) => logRow({ personName, code: `C${index}` })),
    );

    expect(entries.map((e) => e.name)).toEqual(['Gast 2 Youngsters', 'Gast 10 Youngsters', 'Anna', 'Zoe']);
    expect(entries.map((e) => e.isGuest)).toEqual([true, true, false, false]);
  });

  it('sorts names the German way (umlauts next to their base letter)', () => {
    const entries = entriesOf(['Zoe', 'Özil', 'Otto'].map((personName) => logRow({ personName })));

    expect(entries.map((e) => e.name)).toEqual(['Otto', 'Özil', 'Zoe']);
  });

  it('uses the given keyword to recognise guests', () => {
    const entries = groupSummaryRows([logRow({ personName: 'Anna' }), logRow({ personName: 'Besuch 1' })], 'Besuch').get('Kids');

    expect(entries?.map((e) => [e.name, e.isGuest])).toEqual([
      ['Besuch 1', true],
      ['Anna', false],
    ]);
  });
});

describe('isGuestName', () => {
  it.each([
    ['Gast 1', true],
    ['gast2', true],
    [' Gast 1 ', true],
    ['Gastner Max', false],
    ['Gast', false],
    ['Max Gast 1', false],
  ])('recognises %j as guest: %s', (name, expected) => {
    expect(isGuestName(name, 'Gast')).toBe(expected);
  });

  it('compares the keyword literally, regex characters included', () => {
    expect(isGuestName('Gast ( 1', 'Gast (')).toBe(true);
    expect(isGuestName('GX 1', 'G.')).toBe(false);
  });
});
