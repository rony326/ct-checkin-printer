'use strict';

const fs   = require('fs');
const path = require('path');
const { parseActiveTimes } = require('./schedule');

/**
 * Lädt und validiert printers.json.
 *
 * Felder pro Eintrag:
 *   hostname     – ChurchTools Standort-ID (Pflicht)
 *   printerName  – Anzeigename in ChurchTools (Pflicht)
 *   printerHost  – IP/Hostname des Druckers (Pflicht)
 *   printerPort  – TCP-Port, Standard: 9100 (optional)
 *   active_times – Zeitfenster nur für diesen Drucker (optional)
 *                  Überschreibt globales ACTIVE_TIMES aus .env
 *                  Format identisch zu ACTIVE_TIMES: "So:09:00-12:00 18:00-20:00"
 */
function loadPrinters(filePath, globalActiveTimes = null) {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`printers.json nicht gefunden: ${resolved}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`printers.json ungültig: ${err.message}`);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('printers.json muss ein nicht-leeres Array sein');
  }

  const hostnames = new Set();

  return raw.map((entry, i) => {
    const label = `printers.json[${i}]`;

    if (!entry.hostname    || typeof entry.hostname    !== 'string') throw new Error(`${label}: "hostname" fehlt`);
    if (!entry.printerName || typeof entry.printerName !== 'string') throw new Error(`${label}: "printerName" fehlt`);
    if (!entry.printerHost || typeof entry.printerHost !== 'string') throw new Error(`${label}: "printerHost" fehlt`);

    if (hostnames.has(entry.hostname)) {
      throw new Error(`${label}: hostname "${entry.hostname}" doppelt`);
    }
    hostnames.add(entry.hostname);

    // Zeitfenster: drucker-spezifisch überschreibt global
    let activeTimes = globalActiveTimes;
    if (entry.active_times !== undefined) {
      if (entry.active_times === null || entry.active_times === '') {
        activeTimes = null; // explizit immer aktiv
      } else {
        try {
          activeTimes = parseActiveTimes(entry.active_times);
        } catch (err) {
          throw new Error(`${label}: active_times ungültig — ${err.message}`);
        }
      }
    }

    return {
      hostname:    entry.hostname.trim(),
      printerName: entry.printerName.trim(),
      printerHost: entry.printerHost.trim(),
      printerPort: typeof entry.printerPort === 'number' ? entry.printerPort : 9100,
      activeTimes,          // geparstes Schedule-Objekt (oder null = immer aktiv)
      activeTimesRaw: entry.active_times ?? null,  // für Logging
    };
  });
}

module.exports = { loadPrinters };