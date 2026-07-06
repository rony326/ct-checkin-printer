'use strict';

/**
 * Löst eine Secret-Referenz auf. Unterstützt "env:VAR_NAME", damit echte
 * Secrets nicht im (git-versionierten) config.js stehen müssen, sondern in
 * der .env liegen können. Ein Literal-Wert wird unverändert zurückgegeben
 * (Rückwärtskompatibilität mit bestehenden config.js-Dateien).
 */
function resolveSecret(value) {
  if (typeof value !== 'string' || !value.startsWith('env:')) return value;

  const varName = value.slice(4).trim();
  const resolved = process.env[varName];
  if (!resolved) {
    throw new Error(`Secret-Referenz "${value}" verweist auf fehlende/leere Umgebungsvariable "${varName}"`);
  }
  return resolved;
}

module.exports = { resolveSecret };
