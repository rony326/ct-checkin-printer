'use strict';

/**
 * Lädt und validiert die Drucker-Liste aus config.js.
 *
 * Zwei Modi pro Eintrag:
 *
 * Einzel-Modus (printerHost direkt):
 *   { hostname, printerName, printerHost, printerPort, ... }
 *
 * Routing-Modus (labels{}):
 *   { hostname, printerName, labels: { parent: {...}, child: {...} } }
 */
function loadPrinters(raw, globalActiveTimes, parseSchedule) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('config.js: "printers" muss ein nicht-leeres Array sein');
  }

  const hostnames = new Set();

  return raw
    .filter(entry => !entry._comment)
    .map((entry, i) => {
      const label = `printers[${i}]`;

      if (!entry.hostname    || typeof entry.hostname    !== 'string') throw new Error(`${label}: "hostname" fehlt`);
      if (!entry.printerName || typeof entry.printerName !== 'string') throw new Error(`${label}: "printerName" fehlt`);
      if (hostnames.has(entry.hostname)) throw new Error(`${label}: hostname "${entry.hostname}" doppelt`);
      hostnames.add(entry.hostname);

      // Zeitfenster
      let activeTimes = globalActiveTimes;
      if ('activeTimes' in entry) {
        if (entry.activeTimes === null) {
          activeTimes = null;
        } else if (!entry.activeTimes) {
          activeTimes = globalActiveTimes;
        } else {
          activeTimes = parseSchedule(entry.activeTimes);
        }
      }

      // Modus erkennen
      const isRoutingMode = !!entry.labels && typeof entry.labels === 'object';

      if (!isRoutingMode && !entry.printerHost) {
        throw new Error(`${label}: "printerHost" fehlt (oder "labels" für Routing-Modus)`);
      }

      // Routing-Modus: Labels validieren und normalisieren
      let labelRoutes = null;
      if (isRoutingMode) {
        labelRoutes = {};
        for (const [type, route] of Object.entries(entry.labels)) {
          if (!route.printerHost) throw new Error(`${label}.labels.${type}: "printerHost" fehlt`);
          labelRoutes[type] = {
            printerHost: route.printerHost,
            printerPort: route.printerPort || 9100,
            labelType:   route.labelType   || '54',
            rotate:      String(route.rotate || '0'),
            enabled:     route.enabled !== false,
            copies:      Math.max(1, parseInt(route.copies || 1, 10)),
          };
        }
      }

      return {
        hostname:    entry.hostname.trim(),
        printerName: entry.printerName.trim(),
        activeTimes,
        activeTimesRaw: entry.activeTimes ?? null,

        // Modus
        isRoutingMode,

        // Einzel-Modus Felder
        printerHost: entry.printerHost || null,
        printerPort: typeof entry.printerPort === 'number' ? entry.printerPort : 9100,

        // Routing-Modus Felder
        labelRoutes,

        // Drucker-Check
        checkEnabled:         entry.checkEnabled !== false,
        checkRetryIntervalMs: entry.checkRetryIntervalMs ?? 30000,
        statusWebhook:        entry.statusWebhook !== false,

        // Retry-Queue
        printQueue: {
          maxRetries:        entry.printQueue?.maxRetries        ?? 5,
          maxAgeMs:          entry.printQueue?.maxAgeMs          ?? 1800000,
          retryDelayMs:      entry.printQueue?.retryDelayMs      ?? 30000,
          retryOnPrintError: entry.printQueue?.retryOnPrintError !== false,
        },
      };
    });
}

module.exports = { loadPrinters };