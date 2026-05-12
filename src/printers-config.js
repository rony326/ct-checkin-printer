'use strict';

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
      if (!entry.printerHost || typeof entry.printerHost !== 'string') throw new Error(`${label}: "printerHost" fehlt`);

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

      return {
        hostname:              entry.hostname.trim(),
        printerName:           entry.printerName.trim(),
        printerHost:           entry.printerHost.trim(),
        printerPort:           typeof entry.printerPort === 'number' ? entry.printerPort : 9100,
        activeTimes,
        activeTimesRaw:        entry.activeTimes ?? null,
        // Drucker-Check Einstellungen
        checkEnabled:          entry.checkEnabled !== false,
        checkRetryIntervalMs:  entry.checkRetryIntervalMs ?? 30000,
        statusWebhook:         entry.statusWebhook !== false,

        // Retry-Queue Einstellungen
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