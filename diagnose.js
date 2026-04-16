#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs  = require('fs');
const os  = require('os');
const { churchtoolsClient } = require('@churchtools/churchtools-client');
const tough = require('tough-cookie');

const CT_BASE_URL  = (process.env.CT_BASE_URL || '').replace(/\/$/, '');
const CT_USERNAME  = process.env.CT_USERNAME  || '';
const CT_PASSWORD  = process.env.CT_PASSWORD  || '';
const HOSTNAME     = process.env.HOSTNAME || os.hostname();
const PRINTER_NAME = process.env.PRINTER_NAME || 'Diagnose-Drucker';
const POLL_MS      = 3000;

if (!CT_BASE_URL || !CT_USERNAME || !CT_PASSWORD) {
  console.error('Fehler: CT_BASE_URL, CT_USERNAME und CT_PASSWORD in .env setzen.');
  process.exit(1);
}

console.log('\n============================================');
console.log('  ChurchTools Check-In -- Diagnose-Script');
console.log('============================================');
console.log('  URL      : ' + CT_BASE_URL);
console.log('  USER     : ' + CT_USERNAME);
console.log('  HOSTNAME : ' + HOSTNAME);
console.log('  DRUCKER  : ' + PRINTER_NAME);
console.log('============================================\n');

// Cookie-Jar in ax (interne Axios-Instanz) einhaengen
const cookieJar = new tough.CookieJar();
const ax = churchtoolsClient.ax;

ax.interceptors.request.use(async (config) => {
  const url = CT_BASE_URL + (config.url || '');
  const cookies = await cookieJar.getCookies(url);
  if (cookies.length > 0) {
    config.headers = config.headers || {};
    config.headers['Cookie'] = cookies.map(c => c.cookieString()).join('; ');
  }
  return config;
});

ax.interceptors.response.use(async (response) => {
  const setCookie = response.headers['set-cookie'];
  if (setCookie) {
    const url = CT_BASE_URL + (response.config.url || '');
    for (const c of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
      await cookieJar.setCookie(c, url).catch(() => {});
    }
  }
  return response;
});

churchtoolsClient.setBaseUrl(CT_BASE_URL);

async function callOldApi(func, params) {
  try {
    const data = await churchtoolsClient.oldApi('churchcheckin/ajax', func, params || {});
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      message: err.message,
      status:  err.response?.status,
      raw:     err.response?.data,
    };
  }
}

async function main() {

  // Login
  console.log('Login mit ' + CT_USERNAME + '...');
  try {
    const result = await churchtoolsClient.post('/login', {
      username: CT_USERNAME,
      password: CT_PASSWORD,
    });
    console.log('Login: ' + result.status + ' (personId: ' + result.personId + ')');
  } catch (err) {
    console.error('Login fehlgeschlagen: ' + err.message);
    if (err.response) console.error('HTTP ' + err.response.status + ': ' + JSON.stringify(err.response.data));
    process.exit(1);
  }

  // Cookies pruefen
  const cookies = await cookieJar.getCookies(CT_BASE_URL);
  console.log('Session-Cookies: ' + cookies.map(c => c.key).join(', ') || '(keine)');

  // Verifikation
  try {
    const whoami = await churchtoolsClient.get('/whoami');
    console.log('Eingeloggt als: ' + whoami.firstName + ' ' + whoami.lastName + ' (ID: ' + whoami.id + ')');
    if (whoami.id === -1) {
      console.error('Immer noch Anonymous.');
      process.exit(1);
    }
  } catch (err) {
    console.log('whoami Fehler: ' + err.message);
    process.exit(1);
  }

  // Drucker anmelden
  console.log('\nMelde Drucker an...');
  const activate = await callOldApi('activatePrinter', {
    ort:         HOSTNAME,
    bezeichnung: PRINTER_NAME,
  });

  console.log('\n-- activatePrinter --');
  console.log('  success : ' + activate.success);
  console.log('  data    : ' + JSON.stringify(activate.data));
  if (!activate.success) {
    console.log('  message : ' + activate.message);
    console.log('  status  : ' + activate.status);
    console.log('  raw     : ' + JSON.stringify(activate.raw));
    process.exit(1);
  }

  console.log('\nDrucker angemeldet!');
  console.log('--> Oeffne Check-In in ChurchTools');
  console.log('--> Drucker "' + PRINTER_NAME + '" oben rechts auswaehlen');
  console.log('--> Check-In durchfuehren\n');
  console.log('Warte auf Druckauftrag... (STRG+C zum Abbrechen)\n');

  let running = true;
  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    console.log('\n\nMelde Drucker ab...');
    const r = await callOldApi('hidePrinter', { ort: HOSTNAME });
    console.log('hidePrinter: ' + (r.success ? 'OK' : r.message));
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  let n = 0;
  while (running) {
    await new Promise(r => setTimeout(r, POLL_MS));
    if (!running) break;

    n++;
    process.stdout.write('\r  Poll #' + n + '...');

    const result = await callOldApi('getNextPrinterJob', { ort: HOSTNAME });

    if (!result.success) {
      console.log('\n  Fehler: ' + result.message + ' (HTTP ' + result.status + ')');
      continue;
    }

    const data = result.data;
    const empty = !data
      || data === ''
      || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)
      || (Array.isArray(data) && data.length === 0);

    if (empty) continue;

    console.log('\n\nDRUCKAUFTRAG EMPFANGEN!\n');

    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const dump = {
      timestamp:  new Date().toISOString(),
      hostname:   HOSTNAME,
      dataType:   typeof data,
      dataKeys:   (typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : null,
      dataLength: dataStr.length,
      fieldSizes: (typeof data === 'object' && !Array.isArray(data))
        ? Object.fromEntries(Object.entries(data).map(([k,v]) => [k, typeof v + ' / ' + JSON.stringify(v).length + ' chars']))
        : null,
      rawData: data,
    };

    console.log('Typ     : ' + dump.dataType);
    console.log('Keys    : ' + (dump.dataKeys ? dump.dataKeys.join(', ') : '—'));
    console.log('Groesse : ' + dump.dataLength + ' Zeichen');
    if (dump.fieldSizes) {
      console.log('\nFelder:');
      Object.entries(dump.fieldSizes).forEach(([k,v]) => console.log('  ' + k.padEnd(20) + ' : ' + v));
    }
    console.log('\nRohdaten (erste 1000 Zeichen):');
    console.log(dataStr.slice(0, 1000));
    if (dataStr.length > 1000) console.log('... (' + (dataStr.length - 1000) + ' weitere Zeichen)');

    fs.writeFileSync('job-dump.json', JSON.stringify(dump, null, 2), 'utf8');
    console.log('\nDump gespeichert: job-dump.json');
    console.log('Bitte Inhalt hier einfuegen!\n');

    await shutdown();
  }
}

main().catch(err => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
