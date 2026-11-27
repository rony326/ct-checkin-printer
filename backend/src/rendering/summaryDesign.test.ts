import { describe, expect, it } from 'vitest';
import { DEFAULT_SUMMARY_DESIGN, resolveSummaryDesign, summaryDesignSchema } from './summaryDesign.js';

const STANDARD = {
  logoId: null,
  fontSize: 11,
  orientation: 'landscape',
  checkColumns: ['Abgeholt', 'Da'],
  guestColumn: { enabled: true, header: 'Name Gast', keyword: 'Gast' },
  footer: '',
};

describe('resolveSummaryDesign', () => {
  it('liefert ohne gespeicherte Einstellungen exakt die Standards', () => {
    expect(DEFAULT_SUMMARY_DESIGN).toStrictEqual(STANDARD);
    for (const stored of [null, undefined, 'quatsch', 42, []]) {
      expect(resolveSummaryDesign(stored)).toStrictEqual(STANDARD);
    }
  });

  it('ergänzt Teilangaben um die Standards', () => {
    expect(resolveSummaryDesign({ fontSize: 14 })).toStrictEqual({ ...STANDARD, fontSize: 14 });
    expect(resolveSummaryDesign({ guestColumn: { enabled: false } })).toStrictEqual({
      ...STANDARD,
      guestColumn: { ...STANDARD.guestColumn, enabled: false },
    });
  });

  it('übernimmt eine vollständige gültige Angabe', () => {
    const design = {
      logoId: 3,
      fontSize: 18,
      orientation: 'portrait',
      checkColumns: [],
      guestColumn: { enabled: false, header: 'Gast von', keyword: 'Besuch' },
      footer: 'Fusszeile',
    };
    expect(resolveSummaryDesign(design)).toStrictEqual(design);
  });

  it('ersetzt ungültige Felder einzeln durch den Standard', () => {
    expect(
      resolveSummaryDesign({
        logoId: 'abc',
        fontSize: 30,
        orientation: 'quer',
        checkColumns: ['ok', ''],
        guestColumn: { enabled: 'ja', header: 'x'.repeat(31), keyword: 'Besuch' },
        footer: 'bleibt',
      }),
    ).toStrictEqual({ ...STANDARD, guestColumn: { ...STANDARD.guestColumn, keyword: 'Besuch' }, footer: 'bleibt' });
    expect(resolveSummaryDesign({ guestColumn: 'quatsch' })).toStrictEqual(STANDARD);
  });

  it('trimmt das Erkennungswort und verwirft ein reines Leerzeichen-Wort', () => {
    expect(resolveSummaryDesign({ guestColumn: { keyword: '  Besuch ' } }).guestColumn.keyword).toBe('Besuch');
    expect(resolveSummaryDesign({ guestColumn: { keyword: '   ' } }).guestColumn.keyword).toBe('Gast');
  });

  it('gibt Kopien zurück, die die Standards nicht verändern', () => {
    const resolved = resolveSummaryDesign(null);
    resolved.checkColumns.push('Neu');
    resolved.guestColumn.enabled = false;
    expect(resolveSummaryDesign(null)).toStrictEqual(STANDARD);
  });
});

describe('summaryDesignSchema', () => {
  it.each([
    {},
    { fontSize: 8 },
    { fontSize: 18 },
    { logoId: null },
    { checkColumns: [] },
    { checkColumns: ['a', 'b', 'c', 'x'.repeat(20)] },
    { guestColumn: { header: 'x'.repeat(30), keyword: 'x'.repeat(30) } },
    { footer: 'x'.repeat(200) },
  ])('akzeptiert %j', (design) => {
    expect(summaryDesignSchema.safeParse(design).success).toBe(true);
  });

  it.each([
    ['Schrift zu klein', { fontSize: 7 }],
    ['Schrift zu gross', { fontSize: 19 }],
    ['fünf Abhak-Spalten', { checkColumns: ['a', 'b', 'c', 'd', 'e'] }],
    ['Spaltenüberschrift zu lang', { checkColumns: ['x'.repeat(21)] }],
    ['Spaltenüberschrift leer', { checkColumns: [''] }],
    ['Gast-Überschrift zu lang', { guestColumn: { header: 'x'.repeat(31) } }],
    ['Erkennungswort leer', { guestColumn: { keyword: '' } }],
    ['Erkennungswort nur Leerzeichen', { guestColumn: { keyword: '   ' } }],
    ['Erkennungswort zu lang', { guestColumn: { keyword: 'x'.repeat(31) } }],
    ['Fusszeile zu lang', { footer: 'x'.repeat(201) }],
    ['unbekannte Ausrichtung', { orientation: 'quer' }],
    ['Logo-ID als Text', { logoId: '1' }],
    ['Text statt Objekt', 'quatsch'],
    ['Gast-Spalte als Wahrheitswert', { guestColumn: true }],
  ])('lehnt mit deutscher Meldung ab: %s', (_label, design) => {
    const result = summaryDesignSchema.safeParse(design);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/^(Design|Logo|Schriftgrösse|Ausrichtung|Abhak-Spalte|Gast-Spalte|Erkennungswort|Fusszeile)/);
  });

  it('speichert das Erkennungswort getrimmt und die Gast-Spalte vollständig', () => {
    expect(summaryDesignSchema.parse({ guestColumn: { keyword: ' Besuch ' } })).toStrictEqual({
      guestColumn: { enabled: true, header: 'Name Gast', keyword: 'Besuch' },
    });
    expect(summaryDesignSchema.parse({ fontSize: 14 })).toStrictEqual({ fontSize: 14 });
  });
});
