'use strict';

require('dotenv').config();
const { parseActiveTimes } = require('./schedule');

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Fehlende Umgebungsvariable: ${key}`);
  return val;
}

let activeTimes = null;
if (process.env.ACTIVE_TIMES) {
  try {
    activeTimes = parseActiveTimes(process.env.ACTIVE_TIMES);
  } catch (err) {
    throw new Error(`Ungültiges ACTIVE_TIMES Format: ${err.message}`);
  }
}

module.exports = {
  // ChurchTools
  CT_BASE_URL:        required('CT_BASE_URL'),
  CT_USERNAME:        required('CT_USERNAME'),
  CT_PASSWORD:        required('CT_PASSWORD'),

  // Drucker-Liste
  PRINTERS_FILE:      process.env.PRINTERS_FILE || './printers.json',
  PRINTER_TIMEOUT_MS: parseInt(process.env.PRINTER_TIMEOUT_MS || '5000', 10),
  LABEL_TYPE:         process.env.LABEL_TYPE || '54',
  DRY_RUN:            process.env.DRY_RUN || 'false',

  // Polling
  POLL_IDLE_MS:       parseInt(process.env.POLL_IDLE_MS       || '15000', 10),
  POLL_ACTIVE_MS:     parseInt(process.env.POLL_ACTIVE_MS     || '5000',  10),
  POLL_ACTIVE_TTL_MS: parseInt(process.env.POLL_ACTIVE_TTL_MS || '300000', 10),
  ACTIVE_TIMES:       activeTimes,

  // Fehlerbehandlung
  MAX_ERRORS:         parseInt(process.env.MAX_ERRORS || '10', 10),
};
