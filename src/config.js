'use strict';

require('dotenv').config();
const path = require('path');
const { parseActiveTimes } = require('./schedule');

// ── .env (Secrets + Umgebung) ──────────────────────────────────────────────

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Fehlende Umgebungsvariable: ${key}`);
  return val;
}

// ── config.js laden ────────────────────────────────────────────────────────

const CONFIG_FILE = path.resolve(process.env.CONFIG_FILE || './config.js');

let cfg;
try {
  cfg = require(CONFIG_FILE);
} catch (err) {
  throw new Error(`config.js konnte nicht geladen werden (${CONFIG_FILE}): ${err.message}`);
}

// ── Zeitfenster parsen ─────────────────────────────────────────────────────

function parseSchedule(raw) {
  if (!raw || raw.trim() === '') return null;
  try {
    return parseActiveTimes(raw);
  } catch (err) {
    throw new Error(`Ungültiges Zeitfenster-Format "${raw}": ${err.message}`);
  }
}

// ── Export ─────────────────────────────────────────────────────────────────

module.exports = {
  // Secrets aus .env
  CT_BASE_URL:  required('CT_BASE_URL'),
  CT_USERNAME:  required('CT_USERNAME'),
  CT_PASSWORD:  required('CT_PASSWORD'),

  // Umgebung aus .env
  DRY_RUN:     process.env.DRY_RUN     || 'false',
  LOG_LEVEL:   process.env.LOG_LEVEL   || 'info',
  LOG_TO_FILE: process.env.LOG_TO_FILE || 'true',
  CONFIG_FILE: process.env.CONFIG_FILE || './config.js',

  // Polling (aus config.js)
  POLL_IDLE_MS:       cfg.polling?.idleMs      ?? 15000,
  POLL_ACTIVE_MS:     cfg.polling?.activeMs    ?? 5000,
  POLL_ACTIVE_TTL_MS: cfg.polling?.activeTtlMs ?? 300000,
  ACTIVE_TIMES:       parseSchedule(cfg.polling?.activeTimes),
  MAX_ERRORS:         cfg.polling?.maxErrors   ?? 10,

  // Drucker & Layout (aus config.js)
  LABEL_TYPE:         cfg.printer?.labelType  || '54',
  LAYOUT_FILE:        cfg.printer?.layoutFile || './label-layout.json',
  PRINTER_TIMEOUT_MS: cfg.printer?.timeoutMs  ?? 5000,

  // Field-Mapping (aus config.js)
  FIELD_MAPPING: cfg.fieldMapping || null,

  // Logging (aus config.js)
  LOG_DIR:            cfg.logging?.dir           || './logs',
  LOG_RETENTION_DAYS: cfg.logging?.retentionDays ?? 14,

  // Drucker-Liste (aus config.js)
  PRINTERS_RAW: cfg.printers || [],

  // Webhooks (aus config.js)
  WEBHOOKS_RAW:        cfg.webhooks            || [],
  WEBHOOK_BLOCK_PRINT: cfg.webhookOptions?.blockPrint ? 'true' : 'false',

  // Interne Hilfsfunktion
  _parseSchedule: parseSchedule,
};