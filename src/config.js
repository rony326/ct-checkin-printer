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
  CT_BASE_URL:   required('CT_BASE_URL'),
  CT_USERNAME:   required('CT_USERNAME'),
  CT_PASSWORD:   required('CT_PASSWORD'),

  // Drucker & Layout
  PRINTERS_FILE:      process.env.PRINTERS_FILE  || './printers.json',
  PRINTER_TIMEOUT_MS: parseInt(process.env.PRINTER_TIMEOUT_MS || '5000', 10),
  LABEL_TYPE:         process.env.LABEL_TYPE     || '54',
  LAYOUT_FILE:        process.env.LAYOUT_FILE    || 'label-layout.json',
  MAPPING_FILE:       process.env.MAPPING_FILE   || 'field-mapping.json',
  DRY_RUN:            process.env.DRY_RUN        || 'false',

  // Polling
  POLL_IDLE_MS:       parseInt(process.env.POLL_IDLE_MS       || '15000', 10),
  POLL_ACTIVE_MS:     parseInt(process.env.POLL_ACTIVE_MS     || '5000',  10),
  POLL_ACTIVE_TTL_MS: parseInt(process.env.POLL_ACTIVE_TTL_MS || '300000', 10),
  ACTIVE_TIMES:       activeTimes,

  // Webhook
  WEBHOOKS_FILE:       process.env.WEBHOOKS_FILE        || './webhooks.json',
  WEBHOOKS_ENABLED:    process.env.WEBHOOKS_ENABLED     || 'true',
  WEBHOOK_RETRY:       process.env.WEBHOOK_RETRY        || '3',
  WEBHOOK_RETRY_MS:    process.env.WEBHOOK_RETRY_MS     || '2000',
  WEBHOOK_BLOCK_PRINT: process.env.WEBHOOK_BLOCK_PRINT  || 'false',

  // Logging & Logfiles
  LOG_TO_FILE:        process.env.LOG_TO_FILE         || 'true',
  LOG_DIR:            process.env.LOG_DIR              || './logs',
  LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS  || '14',

  // Fehlerbehandlung
  MAX_ERRORS:         parseInt(process.env.MAX_ERRORS || '10', 10),
};