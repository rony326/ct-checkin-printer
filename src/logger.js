'use strict';

const fs   = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// ── Konfiguration ─────────────────────────────────────────────────────────────

function getMinLevel() {
  return LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;
}

function getLogDir() {
  return process.env.LOG_DIR || './logs';
}

function getRetentionDays() {
  return parseInt(process.env.LOG_RETENTION_DAYS || '14', 10);
}

function isFileLoggingEnabled() {
  return (process.env.LOG_TO_FILE || 'true') === 'true';
}

// ── Datei-Handle Cache ────────────────────────────────────────────────────────

let _currentDate   = null;
let _currentStream = null;

function getDateString(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getLogStream() {
  if (!isFileLoggingEnabled()) return null;

  const today = getDateString();

  // Neuer Tag → neuen Stream öffnen
  if (today !== _currentDate) {
    if (_currentStream) {
      _currentStream.end();
      _currentStream = null;
    }

    const dir = path.resolve(getLogDir());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${today}.log`);
    _currentStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    _currentDate   = today;

    // Alte Logs aufräumen (async, nicht blockierend)
    setImmediate(() => cleanOldLogs(dir));
  }

  return _currentStream;
}

// ── Retention ─────────────────────────────────────────────────────────────────

function cleanOldLogs(dir) {
  const retentionDays = getRetentionDays();
  if (retentionDays <= 0) return; // 0 = unbegrenzt

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = getDateString(cutoff);

    const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f));
    for (const file of files) {
      const dateStr = file.replace('.log', '');
      if (dateStr < cutoffStr) {
        fs.unlinkSync(path.join(dir, file));
        // Direkt in stdout schreiben um Rekursion zu vermeiden
        process.stdout.write(`[${new Date().toISOString()}] [INFO ] Log gelöscht: ${file}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`[${new Date().toISOString()}] [WARN ] Log-Cleanup Fehler: ${err.message}\n`);
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString();
}

function log(level, ...args) {
  if (LEVELS[level] < getMinLevel()) return;

  const prefix  = `[${ts()}] [${level.toUpperCase().padEnd(5)}]`;
  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  const line = `${prefix} ${message}`;

  // Konsole
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }

  // Datei
  try {
    const stream = getLogStream();
    if (stream) stream.write(line + '\n');
  } catch (err) {
    process.stderr.write(`Log-Write Fehler: ${err.message}\n`);
  }
}

const logger = {
  debug: (...a) => log('debug', ...a),
  info:  (...a) => log('info',  ...a),
  warn:  (...a) => log('warn',  ...a),
  error: (...a) => log('error', ...a),
};

module.exports = { logger };