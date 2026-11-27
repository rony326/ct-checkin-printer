/** Gestaltung der A4-Anwesenheitsliste je Sammel-Layout: Standards, Grenzen und tolerantes Auslesen. */
import { z } from 'zod';

export interface SummaryDesign {
  logoId: number | null;
  fontSize: number;
  orientation: 'portrait' | 'landscape';
  checkColumns: string[];
  guestColumn: { enabled: boolean; header: string; keyword: string };
  footer: string;
}

export const DEFAULT_SUMMARY_DESIGN: SummaryDesign = {
  logoId: null,
  fontSize: 11,
  orientation: 'landscape',
  checkColumns: ['Abgeholt', 'Da'],
  guestColumn: { enabled: true, header: 'Name Gast', keyword: 'Gast' },
  footer: '',
};

const LOGO_INVALID = 'Logo ist ungültig';
const logoId = z.number({ invalid_type_error: LOGO_INVALID }).int(LOGO_INVALID).positive(LOGO_INVALID).nullable();

const fontSize = z
  .number({ invalid_type_error: 'Schriftgrösse muss eine Zahl sein' })
  .min(8, 'Schriftgrösse muss mindestens 8 pt sein')
  .max(18, 'Schriftgrösse darf höchstens 18 pt sein');

const orientation = z.enum(['portrait', 'landscape'], {
  errorMap: () => ({ message: 'Ausrichtung muss Hoch- oder Querformat sein' }),
});

const checkColumn = z
  .string({ invalid_type_error: 'Abhak-Spalte muss ein Text sein' })
  .min(1, 'Abhak-Spalte braucht eine Überschrift')
  .max(20, 'Abhak-Spalte: Überschrift darf höchstens 20 Zeichen lang sein');
const checkColumns = z
  .array(checkColumn, { invalid_type_error: 'Abhak-Spalten müssen eine Liste sein' })
  .max(4, 'Abhak-Spalten: höchstens 4 möglich');

const guestFields = {
  enabled: z.boolean({ invalid_type_error: 'Gast-Spalte: an/aus ist ungültig' }),
  header: z
    .string({ invalid_type_error: 'Gast-Spalte: Überschrift muss ein Text sein' })
    .max(30, 'Gast-Spalte: Überschrift darf höchstens 30 Zeichen lang sein'),
  // Getrimmt, weil `isGuestName` das Erkennungswort wörtlich vergleicht.
  keyword: z
    .string({ invalid_type_error: 'Erkennungswort muss ein Text sein' })
    .trim()
    .min(1, 'Erkennungswort darf nicht leer sein')
    .max(30, 'Erkennungswort darf höchstens 30 Zeichen lang sein'),
};

const footer = z
  .string({ invalid_type_error: 'Fusszeile muss ein Text sein' })
  .max(200, 'Fusszeile darf höchstens 200 Zeichen lang sein');

/** Eingabeprüfung der API: alle Felder optional. Eine angegebene Gast-Spalte wird um die Standards ergänzt. */
export const summaryDesignSchema = z.object(
  {
    logoId: logoId.optional(),
    fontSize: fontSize.optional(),
    orientation: orientation.optional(),
    checkColumns: checkColumns.optional(),
    guestColumn: z
      .object(guestFields, { invalid_type_error: 'Gast-Spalte ist ungültig' })
      .partial()
      .transform((guest) => ({ ...DEFAULT_SUMMARY_DESIGN.guestColumn, ...guest }))
      .optional(),
    footer: footer.optional(),
  },
  { invalid_type_error: 'Design-Einstellungen sind ungültig' },
);

function valueOr<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Gespeicherte Einstellungen → vollständiges Design. Wirft nie: jedes ungültige oder fehlende Feld fällt auf den Standard. */
export function resolveSummaryDesign(stored: unknown): SummaryDesign {
  const design = asRecord(stored);
  const guest = asRecord(design.guestColumn);
  const defaults = DEFAULT_SUMMARY_DESIGN;
  return {
    logoId: valueOr(logoId, design.logoId, defaults.logoId),
    fontSize: valueOr(fontSize, design.fontSize, defaults.fontSize),
    orientation: valueOr(orientation, design.orientation, defaults.orientation),
    checkColumns: valueOr(checkColumns, design.checkColumns, [...defaults.checkColumns]),
    guestColumn: {
      enabled: valueOr(guestFields.enabled, guest.enabled, defaults.guestColumn.enabled),
      header: valueOr(guestFields.header, guest.header, defaults.guestColumn.header),
      keyword: valueOr(guestFields.keyword, guest.keyword, defaults.guestColumn.keyword),
    },
    footer: valueOr(footer, design.footer, defaults.footer),
  };
}
