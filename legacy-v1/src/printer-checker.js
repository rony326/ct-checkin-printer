'use strict';

const net        = require('net');
const http       = require('http');
const { logger } = require('./logger');

// ── PrinterStatus ─────────────────────────────────────────────────────────────

class PrinterStatus {
  constructor({ reachable, errors, warnings, raw } = {}) {
    this.reachable   = !!reachable;
    this.errors      = Array.isArray(errors)   ? errors   : [];
    this.warnings    = Array.isArray(warnings) ? warnings : [];
    this.raw         = raw || null;
    this.ok          = this.reachable && this.errors.length === 0;
    this.timestamp   = new Date().toISOString();
  }

  toString() {
    if (!this.reachable)           return 'Drucker nicht erreichbar (TCP)';
    if (this.errors.length > 0)   return `Fehler: ${this.errors.join(', ')}`;
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

// ── Brother Web-Status ────────────────────────────────────────────────────────

function fetchWebStatus(host, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port: 80, path: '/general/status.html', method: 'GET', timeout: timeoutMs },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Web-Status Timeout')); });
    req.end();
  });
}

function decodeHtml(str) {
  // &amp; muss als letztes ersetzt werden, sonst werden bereits ersetzte
  // Entities (z.B. aus "&amp;lt;") von den folgenden .replace()-Aufrufen
  // fälschlicherweise nochmals dekodiert (Double-Unescaping, CodeQL #16).
  return str
    .replace(/&#32;/g,  ' ')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g,  '&')
    .trim();
}

function parseWebStatus(html) {
  const errors   = [];
  const warnings = [];
  const info     = {};

  // Device Status (CSS-Klasse: moniOk / moniError / moniWarning)
  // Tracking um Doppelmeldungen zu vermeiden
  const deviceErrors = new Set();

  const statusMatch = html.match(/class="moni\s+(\w+)"[^>]*>([^<]+)</);
  if (statusMatch) {
    const cssClass   = statusMatch[1];
    const statusText = decodeHtml(statusMatch[2]).trim();
    info.deviceStatus = statusText;

    if (cssClass === 'moniError') {
      // Spezifische Fehler aus deviceStatus extrahieren statt generisch zu melden
      const upper = statusText.toUpperCase();
      if (upper.includes('COVER OPEN'))   { deviceErrors.add('COVER OPEN'); }
      else if (upper.includes('NO MEDIA')) { deviceErrors.add('NO MEDIA'); }
      else if (upper.includes('END OF MEDIA') || upper.includes('END OF TAPE')) { deviceErrors.add('END OF MEDIA'); }
      else if (upper.includes('CUTTER JAM')) { deviceErrors.add('CUTTER JAM'); }
      else if (upper !== 'READY') {
        // Unbekannter Fehler — direkt als Fehlermeldung
        errors.push(`Gerätestatus: ${statusText}`);
        deviceErrors.add('GENERIC');
      }
    } else if (cssClass === 'moniWarning') {
      warnings.push(`Gerätestatus: ${statusText}`);
    }
  }

  // Media Status — exakter Vergleich nach HTML-Decode
  const mediaMatch = html.match(/Media&#32;Status<\/dt><dd>([^<]+)/);
  if (mediaMatch) {
    const mediaStatus = decodeHtml(mediaMatch[1]);
    info.mediaStatus = mediaStatus;
    if (mediaStatus === 'Empty') {
      deviceErrors.add('END OF MEDIA');
    }
  }

  // Media Type
  const typeMatch = html.match(/Media&#32;Type<\/dt><dd>([^<]+)/);
  if (typeMatch) info.mediaType = decodeHtml(typeMatch[1]);

  // Emulation
  const emuMatch = html.match(/Emulation<\/dt><dd>([^<]+)/);
  if (emuMatch) info.emulation = decodeHtml(emuMatch[1]);

  // Keyword-Scan als Fallback (nur wenn noch nicht via deviceStatus erkannt)
  const htmlUpper = html.toUpperCase();
  if (!deviceErrors.has('COVER OPEN')   && htmlUpper.includes('COVER OPEN'))   deviceErrors.add('COVER OPEN');
  if (!deviceErrors.has('NO MEDIA')     && htmlUpper.includes('NO MEDIA'))     deviceErrors.add('NO MEDIA');
  if (!deviceErrors.has('CUTTER JAM')   && htmlUpper.includes('CUTTER JAM'))   deviceErrors.add('CUTTER JAM');
  if (!deviceErrors.has('END OF MEDIA') && htmlUpper.includes('END OF MEDIA')) deviceErrors.add('END OF MEDIA');

  // Fehler aus Set in lesbares Array umwandeln
  const errorLabels = {
    'COVER OPEN':   'Deckel offen',
    'NO MEDIA':     'Kein Band eingelegt',
    'END OF MEDIA': 'Band leer',
    'CUTTER JAM':   'Schneidwerk blockiert',
  };
  for (const [key, label] of Object.entries(errorLabels)) {
    if (deviceErrors.has(key)) errors.push(label);
  }

  return { errors, warnings, info };
}

// ── Haupt-Check ───────────────────────────────────────────────────────────────

// Fehlererkennung (COVER OPEN, NO MEDIA etc.) basiert auf englischen Text-
// Strings im Brother-Webstatus. Steht die Weboberfläche des Druckers auf
// einer anderen Sprache, findet parseWebStatus() keines der erwarteten
// Felder — dann einmalig pro Drucker warnen statt fälschlich "bereit" zu
// meldet, ohne dass das je auffällt (siehe Issue #22).
const _languageWarnedHosts = new Set();

async function checkPrinter(host, port, timeoutMs = 5000) {
  const reachable = await tcpPing(host, port, timeoutMs);
  if (!reachable) return new PrinterStatus({ reachable: false });

  try {
    const html = await fetchWebStatus(host, timeoutMs);
    const { errors, warnings, info } = parseWebStatus(html);

    if (Object.keys(info).length === 0 && !_languageWarnedHosts.has(host)) {
      _languageWarnedHosts.add(host);
      logger.warn(
        `Drucker-Status von ${host} konnte nicht ausgewertet werden. ` +
        `Vermutlich ist die Web-Oberfläche des Druckers nicht auf Englisch gestellt — ` +
        `die automatische Fehlererkennung (Band leer, Deckel offen etc.) funktioniert dann ` +
        `nicht zuverlässig. Bitte Sprache im Drucker-Webinterface auf Englisch stellen.`
      );
    }

    logger.debug(`Web-Status ${host}: ${JSON.stringify(info)}`);
    return new PrinterStatus({ reachable: true, errors, warnings, raw: info });
  } catch (err) {
    logger.debug(`Web-Status fehlgeschlagen (${host}): ${err.message} — nehme an Drucker ist bereit`);
    return new PrinterStatus({ reachable: true, errors: [], warnings: [] });
  }
}

// ── Warten bis TCP erreichbar ─────────────────────────────────────────────────

async function waitForPrinter(host, port, retryIntervalMs = 30000, timeoutMs = 5000) {
  let attempt = 0;
  while (true) {
    attempt++;
    const status = await checkPrinter(host, port, timeoutMs);
    if (status.reachable) {
      if (attempt > 1) logger.info(`Drucker ${host}:${port} wieder erreichbar (nach ${attempt} Versuchen)`);
      return status;
    }
    logger.warn(`Drucker ${host}:${port} nicht erreichbar (Versuch ${attempt}) — retry in ${retryIntervalMs / 1000}s`);
    await new Promise(r => setTimeout(r, retryIntervalMs));
  }
}

// ── Warten bis Drucker bereit (kein Fehler) ───────────────────────────────────

async function waitForPrinterReady(host, port, retryIntervalMs = 30000, timeoutMs = 5000) {
  let attempt = 0;
  while (true) {
    attempt++;
    const status = await checkPrinter(host, port, timeoutMs);

    if (!status.reachable) {
      logger.warn(`Drucker ${host}:${port} nicht erreichbar (Versuch ${attempt}) — retry in ${retryIntervalMs / 1000}s`);
    } else if (status.errors.length > 0) {
      logger.warn(`Drucker ${host}:${port} nicht bereit: ${status.errors.join(', ')} (Versuch ${attempt}) — retry in ${retryIntervalMs / 1000}s`);
    } else {
      if (attempt > 1) logger.info(`Drucker ${host}:${port} wieder bereit (nach ${attempt} Versuchen)`);
      return status;
    }

    await new Promise(r => setTimeout(r, retryIntervalMs));
  }
}

module.exports = { checkPrinter, waitForPrinter, waitForPrinterReady, PrinterStatus };