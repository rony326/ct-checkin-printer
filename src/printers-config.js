'use strict';

/**
 * Lädt und validiert die Drucker-Liste aus config.json (via config.PRINTERS_RAW).
 *
 * Felder pro Eintrag:
 *   hostname     – Technischer Bezeichner / Raumnummer (z.B. "B2")
 *                  Wird von CT intern genutzt. Angezeigt als "Minis (B2)" in CT.
 *   printerName  – Anzeigename / Raumname (z.B. "Minis")
 *   printerHost  – IP-Adresse des Druckers
 *   printerPort  – TCP-Port (Standard: 9100)
 *   activeTimes  – Zeitfenster nur für diesen Drucker (optional)
 *                  Überschreibt globales polling.activeTimes
 *                  Leer/fehlt = globales Zeitfenster
 *                  null = immer aktiv (ignoriert globales Zeitfenster)
 */
function loadPrinters(raw, globalActiveTimes, parseSchedule) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('config.json: "printers" muss ein nicht-leeres Array sein');
  }

  const hostnames = new Set();

  return raw
    .filter(entry => !entry._comment) // Kommentar-Einträge überspringen
    .map((entry, i) => {
      const label = `printers[${i}]`;

      if (!entry.hostname    || typeof entry.hostname    !== 'string') throw new Error(`${label}: "hostname" fehlt`);
      if (!entry.printerName || typeof entry.printerName !== 'string') throw new Error(`${label}: "printerName" fehlt`);
      if (!entry.printerHost || typeof entry.printerHost !== 'string') throw new Error(`${label}: "printerHost" fehlt`);

      if (hostnames.has(entry.hostname)) {
        throw new Error(`${label}: hostname "${entry.hostname}" doppelt`);
      }
      hostnames.add(entry.hostname);

      // Zeitfenster: drucker-spezifisch überschreibt global
      let activeTimes = globalActiveTimes;
      if ('activeTimes' in entry) {
        if (entry.activeTimes === null) {
          activeTimes = null; // explizit immer aktiv
        } else if (entry.activeTimes === '' || entry.activeTimes === undefined) {
          activeTimes = globalActiveTimes; // auf global zurückfallen
        } else {
          activeTimes = parseSchedule(entry.activeTimes);
        }
      }

      return {
        hostname:       entry.hostname.trim(),
        printerName:    entry.printerName.trim(),
        printerHost:    entry.printerHost.trim(),
        printerPort:    typeof entry.printerPort === 'number' ? entry.printerPort : 9100,
        activeTimes,
        activeTimesRaw: entry.activeTimes ?? null,
      };
    });
}

module.exports = { loadPrinters };