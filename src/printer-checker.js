'use strict';

const net        = require('net');
const http       = require('http');
const { logger } = require('./logger');

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
  return str
    .replace(/&#32;/g,  ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function parseWebStatus(html) {
  const errors   = [];
  const warnings = [];
  const info     = {};

  // Device Status (CSS-Klasse: moniOk / moniError / moniWarning)
  const statusMatch = html.match(/class="moni\s+(\w+)"[^>]*>([^<]+)</);
  if (statusMatch) {
    const cssClass   = statusMatch[1];
    const statusText = decodeHtml(statusMatch[2]);
    info.deviceStatus = statusText;

    if (cssClass === 'moniError' || statusText.toUpperCase().includes('ERROR')) {
      errors.push(`Gerätestatus: ${statusText}`);
    } else if (cssClass === 'moniWarning') {
      warnings.push(`Gerätestatus: ${statusText}`);
    }
  }

  // Media Status — exakter Vergleich nach HTML-Decode
  const mediaMatch = html.match(/Media&#32;Status<\/dt><dd>([^<]+)/);
  if (mediaMatch) {
    const mediaStatus = decodeHtml(mediaMatch[1]);
    info.mediaStatus = mediaStatus;
    // Nur exakt 'Empty' ist ein Fehler — 'Not Empty' ist ok
    if (mediaStatus === 'Empty') {
      errors.push('Band leer');
    }
  }

  // Media Type
  const typeMatch = html.match(/Media&#32;Type<\/dt><dd>([^<]+)/);
  if (typeMatch) info.mediaType = decodeHtml(typeMatch[1]);

  // Emulation
  const emuMatch = html.match(/Emulation<\/dt><dd>([^<]+)/);
  if (emuMatch) info.emulation = decodeHtml(emuMatch[1]);

  // Weitere Fehler-Keywords (im gesamten HTML)
  const htmlUpper = html.toUpperCase();
  if (htmlUpper.includes('COVER OPEN'))    errors.push('Deckel offen');
  if (htmlUpper.includes('NO MEDIA'))      errors.push('Kein Band eingelegt');
  if (htmlUpper.includes('CUTTER JAM'))    errors.push('Schneidwerk blockiert');
  if (htmlUpper.includes('END OF MEDIA'))  errors.push('Band leer (Ende)');

  return { errors, warnings, info };
}

async function checkPrinter(host, port, timeoutMs = 5000) {
  const reachable = await tcpPing(host, port, timeoutMs);
  if (!reachable) return new PrinterStatus({ reachable: false });

  try {
    const html = await fetchWebStatus(host, timeoutMs);
    const { errors, warnings, info } = parseWebStatus(html);
    logger.debug(`Web-Status ${host}: ${JSON.stringify(info)}`);
    return new PrinterStatus({ reachable: true, errors, warnings, raw: info });
  } catch (err) {
    logger.debug(`Web-Status fehlgeschlagen (${host}): ${err.message} — nehme an Drucker ist bereit`);
    return new PrinterStatus({ reachable: true, errors: [], warnings: [] });
  }
}

async function waitForPrinter(host, port, retryIntervalMs = 30000, timeoutMs = 5000) {
  let attempt = 0;
  while (true) {
    attempt++;
    const status = await checkPrinter(host, port, timeoutMs);
    if (status.reachable) {
      if (attempt > 1) logger.info(`✅ Drucker ${host}:${port} wieder erreichbar (nach ${attempt} Versuchen)`);
      return status;
    }
    logger.warn(`Drucker ${host}:${port} nicht erreichbar (Versuch ${attempt}) — retry in ${retryIntervalMs / 1000}s`);
    await new Promise(r => setTimeout(r, retryIntervalMs));
  }
}

module.exports = { checkPrinter, waitForPrinter, PrinterStatus };