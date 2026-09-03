/**
 * Vereinheitlichte Feldparsing-Logik für den rohen CT-Check-in-Text
 * (`key=value`-Zeilen). Ersetzt v1s drei leicht unterschiedliche
 * Implementierungen (Python `parse_ct_text`, sowie je eine separate in
 * PrinterManager und LabelRouter) durch eine einzige — inklusive `extra[]`,
 * das in v1s JS-Varianten verloren ging (nur die Python-Variante sammelte
 * nicht zugeordnete Zeilen), siehe Plan Abschnitt "Bewusste Abweichungen von v1".
 */

export interface ParsedCheckinData {
  name: string | null;
  id: string | null;
  code: string | null;
  group: string | null;
  type: string | null;
  /** Nicht zugeordnete Zeilen (unbekannter Key oder ganz ohne Separator) — z.B. für künftige CT-Felder ohne Codeänderung. */
  extra: string[];
}

const KNOWN_FIELDS = ['name', 'id', 'code', 'group', 'type'] as const;
type KnownField = (typeof KNOWN_FIELDS)[number];

function isKnownField(key: string): key is KnownField {
  return (KNOWN_FIELDS as readonly string[]).includes(key);
}

export function parseCheckinData(raw: string, separator = '='): ParsedCheckinData {
  const result: ParsedCheckinData = { name: null, id: null, code: null, group: null, type: null, extra: [] };

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const sepIndex = line.indexOf(separator);
    if (sepIndex === -1) {
      result.extra.push(line);
      continue;
    }

    const key = line.slice(0, sepIndex).trim();
    const value = line.slice(sepIndex + separator.length).trim();

    if (isKnownField(key)) {
      result[key] = value;
    } else {
      result.extra.push(line);
    }
  }

  return result;
}
