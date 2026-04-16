#!/usr/bin/env node
'use strict';

const { ChurchToolsClient } = require('./churchtools-client');
const { PrinterManager }    = require('./printer-manager');
const { JobPoller }         = require('./job-poller');
const { loadPrinters }      = require('./printers-config');
const { logger }            = require('./logger');
const config                = require('./config');

async function main() {
  logger.info('🖨️  ChurchTools Check-In Printer Service');
  logger.info(`Label-Typ : ${config.LABEL_TYPE}`);
  logger.info(`Dry-Run   : ${config.DRY_RUN}`);

  // Drucker laden
  let printers;
  try {
    printers = loadPrinters(config.PRINTERS_FILE);
  } catch (err) {
    logger.error('printers.json Fehler:', err.message);
    process.exit(1);
  }
  logger.info(`${printers.length} Drucker geladen`);

  // Login
  const client = new ChurchToolsClient(config.CT_BASE_URL, config.CT_USERNAME, config.CT_PASSWORD);
  try {
    await client.login();
  } catch (err) {
    logger.error('Login fehlgeschlagen — Abbruch');
    process.exit(1);
  }

  // Poller pro Drucker
  const pollers = printers.map(p => {
    const manager = new PrinterManager(p.printerHost, p.printerPort, config);
    const pollerConfig = { ...config, HOSTNAME: p.hostname };
    return { def: p, manager, poller: new JobPoller(client, manager, pollerConfig) };
  });

  // Graceful Shutdown
  async function shutdown(signal) {
    logger.info(`${signal} — fahre herunter...`);
    await Promise.all(pollers.map(({ poller, def }) =>
      poller.stop().then(() => client.hidePrinter(def.hostname))
    ));
    logger.info('Alle Drucker abgemeldet.');
    process.exit(0);
  }
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Drucker aktivieren und Polling starten
  try {
    await Promise.all(pollers.map(async ({ def, poller }) => {
      const r = await client.activatePrinter(def.hostname, def.printerName);
      if (!r.success) throw new Error(`activatePrinter "${def.hostname}": ${r.message}`);
      logger.info(`✅ "${def.printerName}" (${def.hostname}) → ${def.printerHost}:${def.printerPort}`);
      await poller.start();
    }));
  } catch (err) {
    logger.error('Start fehlgeschlagen:', err.message);
    process.exit(1);
  }

  logger.info('🔄 Alle Poller laufen');
}

main();
