/** Aufbereitung der `print_log`-Zeilen für die Anwesenheitsliste (Checkout und Evakuierung): jede Person genau einmal. */
export interface CheckinLogRow {
  groupName: string | null;
  personName: string | null;
  code: string | null;
  printedAt: string;
}

export interface SummaryEntry {
  name: string;
  code: string;
  printedAt: string;
  isGuest: boolean;
}

const UNGROUPED_LABEL = 'Ohne Gruppe';

/** Gast = Name beginnt mit dem Erkennungswort (wörtlich, Gross-/Kleinschreibung egal), gefolgt von Leerzeichen oder Ziffer. */
export function isGuestName(name: string, keyword: string): boolean {
  const normalized = name.trim().toLowerCase();
  const prefix = keyword.toLowerCase();
  return normalized.startsWith(prefix) && /^[\s\d]/.test(normalized.slice(prefix.length));
}

function compareEntries(a: SummaryEntry, b: SummaryEntry): number {
  if (a.isGuest !== b.isGuest) return a.isGuest ? -1 : 1;
  return a.name.trim().localeCompare(b.name.trim(), 'de', { numeric: true });
}

/**
 * Gruppiert, fasst zusammen (Gruppe + Name + Code, früheste Uhrzeit gewinnt) und sortiert (Gäste zuerst, dann nach
 * Name). Zeilen ohne Name und ohne Code werden nie zusammengefasst, da sie sich keiner Person zuordnen lassen.
 * Getrimmt wird nur für den Vergleich, Name und Code bleiben unverändert. `printedAt` muss im SQLite-Format
 * vorliegen (als Zeichenkette zeitlich vergleichbar).
 */
export function groupSummaryRows(rows: CheckinLogRow[], guestKeyword: string): Map<string, SummaryEntry[]> {
  const groups = new Map<string, Map<string | number, SummaryEntry>>();

  rows.forEach((row, index) => {
    // Auch eine leere Gruppenangabe (`group=` ohne Wert) zählt als keine; sonst bleibt der Name unverändert.
    const groupName = row.groupName?.trim() ? row.groupName : UNGROUPED_LABEL;
    const name = row.personName ?? '';
    const code = row.code ?? '';
    // Der Zeilenindex (Zahl) kollidiert nie mit einem Textschlüssel.
    const key = name.trim() || code.trim() ? JSON.stringify([name.trim(), code.trim()]) : index;

    const entries = groups.get(groupName) ?? new Map<string | number, SummaryEntry>();
    groups.set(groupName, entries);
    const existing = entries.get(key);
    if (!existing || row.printedAt < existing.printedAt) {
      entries.set(key, { name, code, printedAt: row.printedAt, isGuest: isGuestName(name, guestKeyword) });
    }
  });

  return new Map([...groups].map(([groupName, entries]) => [groupName, [...entries.values()].sort(compareEntries)]));
}
