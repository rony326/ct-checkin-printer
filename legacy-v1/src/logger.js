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
        const line = `[${new Date().toISOString()}] [INFO ] Log gelöscht: ${file}`;
        process.stdout.write(colorize('info', line, process.stdout) + '\n');
      }
    }
  } catch (err) {
    const line = `[${new Date().toISOString()}] [WARN ] Log-Cleanup Fehler: ${err.message}`;
    process.stderr.write(colorize('warn', line, process.stderr) + '\n');
  }
}

// ── Farbe (nur Konsole, TTY) ───────────────────────────────────────────────────
// Ersetzt die früher pro Meldung genutzten Emojis: die Zeile wird stattdessen
// je nach Level eingefärbt (grau/cyan/gelb/rot). Respektiert die NO_COLOR-
// Konvention (https://no-color.org) und schreibt Logfiles immer unfarbig,
// da rohe ANSI-Codes in Textdateien/Log-Viewern nur stören würden.

const ANSI = {
  debug: '\x1b[90m', // grau
  info:  '\x1b[36m', // cyan
  warn:  '\x1b[33m', // gelb
  error: '\x1b[31m', // rot
};
const ANSI_RESET = '\x1b[0m';

function supportsColor(stream) {
  return !!stream.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function colorize(level, text, stream) {
  if (!supportsColor(stream)) return text;
  const color = ANSI[level];
  return color ? `${color}${text}${ANSI_RESET}` : text;
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
  const line = `${prefix} ${message}`; // unfarbig — wird für die Logdatei verwendet

  // Konsole (eingefärbt, falls TTY)
  const consoleStream = (level === 'error' || level === 'warn') ? process.stderr : process.stdout;
  const consoleLine   = colorize(level, line, consoleStream);

  if (level === 'error') {
    console.error(consoleLine);
  } else if (level === 'warn') {
    console.warn(consoleLine);
  } else {
    console.log(consoleLine);
  }

  // Datei
  try {
    const fileStream = getLogStream();
    if (fileStream) fileStream.write(line + '\n');
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