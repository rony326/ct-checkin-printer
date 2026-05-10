'use strict';

const net        = require('net');
const { logger } = require('./logger');

// ESC/P Status-Request Kommando: 1B 69 53
const STATUS_REQUEST = Buffer.from([0x1B, 0x69, 0x53]);
const STATUS_BYTES   = 32;

// Status-Byte Offsets (aus Brother ESC/P Dokumentation)
const OFFSET_STATUS_TYPE  = 8;   // Status type
const OFFSET_ERROR_INFO_1 = 8;   // Error info 1
const OFFSET_ERROR_INFO_2 = 9;   // Error info 2
const OFFSET_MEDIA_TYPE   = 11;  // Media type
const OFFSET_PHASE        = 19;  // Phase type

// Status-Type Werte
const STATUS_TYPE = {
  REPLY:         0x00,
  ERROR:         0x01,
  END_OF_MEDIA:  0x04,
  CUTTER_JAM:    0x08,
  IN_USE:        0x20,
  TURNED_OFF:    0x40,
};

// Error-Bit Flags (Byte 8 + 9)
const ERROR_FLAGS = {
  NO_MEDIA:       { byte: 8, bit: 0x01, label: 'Kein Band eingelegt' },
  END_OF_MEDIA:   { byte: 8, bit: 0x02, label: 'Band leer' },
  CUTTER_JAM:     { byte: 8, bit: 0x04, label: 'Schneidwerk blockiert' },
  PRINTER_IN_USE: { byte: 8, bit: 0x10, label: 'Drucker wird bereits verwendet' },
  FAN_ERROR:      { byte: 9, bit: 0x04, label: 'Lüfterfehler' },
  COVER_OPEN:     { byte: 9, bit: 0x10, label: 'Deckel offen' },
};

/**
 * Ergebnis eines Drucker-Checks
 */
class PrinterStatus {
  constructor({ reachable, statusBytes, errors, warnings, raw }) {
    this.reachable    = reachable;        // TCP erreichbar
    this.statusBytes  = statusBytes;      // rohe 32 Bytes
    this.errors       = errors || [];     // kritische Fehler (Band leer, Stau)
    this.warnings     = warnings || [];   // Warnungen
    this.raw          = raw || null;      // rohe Status-Info
    this.ok           = reachable && errors.length === 0;
    this.timestamp    = new Date().toISOString();
  }

  toString() {
    if (!this.reachable) return 'Drucker nicht erreichbar (TCP)';
    if (this.errors.length > 0) return `Fehler: ${this.errors.join(', ')}`;
    if (this.warnings.length > 0) return `Warnung: ${this.warnings.join(', ')}`;
    return 'Bereit';
  }
}

// ── TCP-Ping ──────────────────────────────────────────────────────────────────

function tcpPing(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

// ── ESC/P Status-Request ──────────────────────────────────────────────────────

function requestStatus(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks = [];
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(new Error('Status-Request Timeout')));
    socket.on('error',   finish);

    socket.on('data', chunk => {
      chunks.push(chunk);
      const total = Buffer.concat(chunks);
      if (total.length >= STATUS_BYTES) {
        done = true;
        socket.destroy();
        resolve(total.slice(0, STATUS_BYTES));
      }
    });

    socket.on('close', () => {
      if (!done) {
        const buf = Buffer.concat(chunks);
        if (buf.length >= STATUS_BYTES) {
          done = true;
          resolve(buf.slice(0, STATUS_BYTES));
        } else {
          finish(new Error(`Nur ${buf.length} von ${STATUS_BYTES} Bytes empfangen`));
        }
      }
    });

    socket.connect(port, host, () => {
      socket.write(STATUS_REQUEST);
    });
  });
}

// ── Status-Bytes auswerten ────────────────────────────────────────────────────

function parseStatusBytes(bytes) {
  const errors   = [];
  const warnings = [];

  // Brother-Signatur prüfen (Byte 0 = 0x80, Byte 2 = 'B')
  if (bytes[0] !== 0x80 || bytes[2] !== 0x42) {
    warnings.push('Unbekanntes Gerät (kein Brother-Drucker?)');
    return { errors, warnings };
  }

  // Fehler-Flags auswerten
  for (const [, flag] of Object.entries(ERROR_FLAGS)) {
    const byteVal = bytes[flag.byte] || 0;
    if (byteVal & flag.bit) {
      // Band leer und kein Band = Fehler, Rest = Warnung
      if (flag.byte === 8 && (flag.bit === 0x01 || flag.bit === 0x02 || flag.bit === 0x04)) {
        errors.push(flag.label);
      } else {
        warnings.push(flag.label);
      }
    }
  }

  return { errors, warnings };
}

// ── Haupt-Check ───────────────────────────────────────────────────────────────

async function checkPrinter(host, port, timeoutMs = 5000) {
  // 1. TCP-Ping
  const reachable = await tcpPing(host, port, timeoutMs);
  if (!reachable) {
    return new PrinterStatus({ reachable: false });
  }

  // 2. ESC/P Status-Request
  try {
    const statusBytes = await requestStatus(host, port, timeoutMs);
    const { errors, warnings } = parseStatusBytes(statusBytes);

    return new PrinterStatus({
      reachable: true,
      statusBytes,
      errors,
      warnings,
      raw: {
        hex: statusBytes.toString('hex').match(/.{2}/g).join(' '),
        byte8: statusBytes[8],
        byte9: statusBytes[9],
      },
    });
  } catch (err) {
    // TCP erreichbar aber Status-Request fehlgeschlagen — trotzdem OK melden
    logger.debug(`ESC/P Status-Request fehlgeschlagen: ${err.message} — nehme an Drucker ist bereit`);
    return new PrinterStatus({
      reachable: true,
      warnings:  [`Status-Request fehlgeschlagen: ${err.message}`],
    });
  }
}

/**
 * Wartet bis der Drucker erreichbar ist.
 * Prüft alle retryIntervalMs, loggt Fortschritt.
 */
async function waitForPrinter(host, port, retryIntervalMs = 30000, timeoutMs = 5000) {
  let attempt = 0;
  while (true) {
    attempt++;
    const status = await checkPrinter(host, port, timeoutMs);

    if (status.reachable) {
      if (attempt > 1) {
        logger.info(`✅ Drucker ${host}:${port} wieder erreichbar (nach ${attempt} Versuchen)`);
      }
      return status;
    }

    logger.warn(`Drucker ${host}:${port} nicht erreichbar (Versuch ${attempt}) — retry in ${retryIntervalMs / 1000}s`);
    await new Promise(r => setTimeout(r, retryIntervalMs));
  }
}

module.exports = { checkPrinter, waitForPrinter, PrinterStatus };