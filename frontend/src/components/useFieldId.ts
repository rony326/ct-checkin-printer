import { useId } from 'react';

/**
 * Eindeutige IDs, um `<label htmlFor>` mit seinem Eingabefeld zu verknüpfen —
 * auch wenn eine Komponente mehrfach gerendert wird (z.B. eine Karte pro Gerät).
 * Ohne Verknüpfung liest ein Screenreader das Feld namenlos vor, und ein Klick
 * aufs Label setzt den Cursor nicht ins Feld.
 */
export function useFieldId(): (name: string) => string {
  const base = useId();
  return (name) => `${base}${name}`;
}
