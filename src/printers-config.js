'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Loads and validates printers.json.
 * Returns an array of printer definitions.
 *
 * Each entry must have:
 *   hostname    – ChurchTools Standort-ID (string, unique)
 *   printerName – Anzeigename in ChurchTools (string)
 *   printerHost – IP oder Hostname des Druckers (string)
 *   printerPort – TCP-Port, default 9100 (number, optional)
 */
function loadPrinters(filePath) {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`printers.json not found at: ${resolved}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse printers.json: ${err.message}`);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('printers.json must be a non-empty array');
  }

  const hostnames = new Set();

  return raw.map((entry, i) => {
    const label = `printers.json[${i}]`;

    if (!entry.hostname    || typeof entry.hostname    !== 'string') throw new Error(`${label}: "hostname" is required`);
    if (!entry.printerName || typeof entry.printerName !== 'string') throw new Error(`${label}: "printerName" is required`);
    if (!entry.printerHost || typeof entry.printerHost !== 'string') throw new Error(`${label}: "printerHost" is required`);

    if (hostnames.has(entry.hostname)) {
      throw new Error(`${label}: duplicate hostname "${entry.hostname}"`);
    }
    hostnames.add(entry.hostname);

    return {
      hostname:    entry.hostname.trim(),
      printerName: entry.printerName.trim(),
      printerHost: entry.printerHost.trim(),
      printerPort: typeof entry.printerPort === 'number' ? entry.printerPort : 9100,
    };
  });
}

module.exports = { loadPrinters };
