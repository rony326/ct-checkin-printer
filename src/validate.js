'use strict';

/**
 * Validiert ein Boolean-Feld aus config.js strikt.
 *
 * config.js wird von Hand editiert — ein sehr naheliegender Fehler ist,
 * "true"/"false" als String (mit Anführungszeichen) statt als JS-Boolean
 * zu schreiben. Da jeder nicht-leere String truthy ist, würde z.B.
 * `enabled: "false"` sonst lautlos als aktiviert behandelt werden.
 * Deshalb hier hart fehlschlagen statt das falsch interpretierte Ergebnis
 * unbemerkt durchzureichen.
 *
 * @param {*} value          — Rohwert aus config.js
 * @param {string} label     — Feldname für die Fehlermeldung
 * @param {boolean} defaultValue — Wert falls value undefined/null ist
 */
function requireBoolean(value, label, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  throw new Error(
    `${label} muss ein Boolean sein (true/false ohne Anführungszeichen) — ` +
    `erhalten: ${JSON.stringify(value)} (Typ: ${typeof value})`
  );
}

module.exports = { requireBoolean };
