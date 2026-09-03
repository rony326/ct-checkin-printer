'use strict';

const { requireBoolean } = require('./validate');

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

          let copies = 1;
          if (route.copies !== undefined && route.copies !== null && route.copies !== '') {
            const parsedCopies = Number(route.copies);
            if (!Number.isInteger(parsedCopies) || parsedCopies < 1) {
              throw new Error(
                `${label}.labels.${type}: "copies" muss eine positive ganze Zahl sein — ` +
                `erhalten: ${JSON.stringify(route.copies)}`
              );
            }
            copies = parsedCopies;
          }

          labelRoutes[type] = {
            printerHost: route.printerHost,
            printerPort: route.printerPort || 9100,
            labelType:   route.labelType   || '54',
            rotate:      String(route.rotate || '0'),
            enabled:     requireBoolean(route.enabled, `${label}.labels.${type}.enabled`, true),
            copies,
            also:        Array.isArray(route.also) ? route.also : [],
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
        checkEnabled:         requireBoolean(entry.checkEnabled, `${label}.checkEnabled`, true),
        checkRetryIntervalMs: entry.checkRetryIntervalMs ?? 30000,
        statusWebhook:        requireBoolean(entry.statusWebhook, `${label}.statusWebhook`, true),

        // Retry-Queue
        printQueue: {
          maxRetries:        entry.printQueue?.maxRetries        ?? 5,
          maxAgeMs:          entry.printQueue?.maxAgeMs          ?? 1800000,
          retryDelayMs:      entry.printQueue?.retryDelayMs      ?? 30000,
          retryOnPrintError: requireBoolean(entry.printQueue?.retryOnPrintError, `${label}.printQueue.retryOnPrintError`, true),
        },
      };
    });
}

module.exports = { loadPrinters };