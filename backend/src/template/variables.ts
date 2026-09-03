import type { ParsedCheckinData } from './parseCheckinData.js';

/**
 * Kontext, gegen den Variablen in einem Etiketten-Layout aufgelöst werden —
 * einmal pro Job/Person gebaut (siehe buildRenderContext.ts), dann für alle
 * Elemente eines Layouts wiederverwendet.
 *
 * Feldnamen korrigiert gegenüber dem ursprünglichen Architektur-Plan: v1s
 * ChurchTools-Check-in-Payload liefert nur ein einzelnes `name`-Feld (keine
 * getrennten Vor-/Nachnamen) — `person.firstname`/`person.lastname` aus dem
 * Plan-Entwurf gab es in v1 nie und würden nicht befüllt werden können.
 */
export interface RenderContext {
  person: { name: string; id: string };
  checkin: { code: string; group: string; type: string; timestamp: number; extra: string[] };
}

export function buildRenderContext(parsed: ParsedCheckinData, unixTimestampSeconds: number): RenderContext {
  return {
    person: { name: parsed.name ?? '', id: parsed.id ?? '' },
    checkin: {
      code: parsed.code ?? '',
      group: parsed.group ?? '',
      type: parsed.type ?? '',
      timestamp: unixTimestampSeconds,
      extra: parsed.extra,
    },
  };
}

/** Beispieldaten für die Editor-Live-Vorschau (siehe Plan: "Live-Vorschau ... inkl. Beispieldaten für Variablen"). */
export function buildMockRenderContext(): RenderContext {
  return {
    person: { name: 'Max Muster', id: '2693' },
    checkin: { code: 'ZRYK', group: 'Kids', type: 'parent', timestamp: Math.floor(Date.now() / 1000), extra: ['Allergie: Erdnuss'] },
  };
}

/** Textfelder, die ein `text`-Element im Editor referenzieren kann. */
export type TextFieldPath = 'person.name' | 'person.id' | 'checkin.code' | 'checkin.group' | 'checkin.type' | 'checkin.extra';

/** QR-Inhalte, die ein `qr`-Element referenzieren kann (siehe Plan, Abschnitt "Variablen-/Template-Engine"). */
export type QrContentPath = 'qr:hash' | 'qr:personId';

/**
 * Löst ein Textfeld zu einer oder mehreren Zeilen auf. Nur `checkin.extra`
 * liefert potenziell mehrere Zeilen (analog zu v1s Python-Rendering, das
 * jede extra-Zeile einzeln zeichnete); alle anderen Felder liefern höchstens
 * eine Zeile (leer, wenn der Wert fehlt).
 */
export function resolveTextField(field: TextFieldPath, ctx: RenderContext): string[] {
  switch (field) {
    case 'person.name':
      return ctx.person.name ? [ctx.person.name] : [];
    case 'person.id':
      return ctx.person.id ? [ctx.person.id] : [];
    case 'checkin.code':
      return ctx.checkin.code ? [ctx.checkin.code] : [];
    case 'checkin.group':
      return ctx.checkin.group ? [ctx.checkin.group] : [];
    case 'checkin.type':
      return ctx.checkin.type ? [ctx.checkin.type] : [];
    case 'checkin.extra':
      return ctx.checkin.extra;
  }
}

/** Für den GUI-Variablen-Picker (Abschnitt 4 im Anforderungsprompt: "Variablen sollen im GUI auswählbar sein"). */
export const TEXT_FIELD_DEFINITIONS: Array<{ path: TextFieldPath; label: string; example: string }> = [
  { path: 'person.name', label: 'Name', example: 'Max Muster' },
  { path: 'person.id', label: 'Personen-ID', example: '2693' },
  { path: 'checkin.code', label: 'Abholcode', example: 'ZRYK' },
  { path: 'checkin.group', label: 'Gruppe', example: 'Kids' },
  { path: 'checkin.type', label: 'Etikettentyp', example: 'parent' },
  { path: 'checkin.extra', label: 'Weitere CT-Felder (unzugeordnet)', example: 'Allergie: Erdnuss' },
];

export const QR_CONTENT_DEFINITIONS: Array<{ path: QrContentPath; label: string }> = [
  { path: 'qr:hash', label: 'Sicherheits-/Abhol-Hash' },
  { path: 'qr:personId', label: 'Personen-ID' },
];
