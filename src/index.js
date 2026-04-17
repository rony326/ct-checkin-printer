#!/usr/bin/env node
'use strict';

const { ChurchToolsClient } = require('./churchtools-client');
const { PrinterManager }    = require('./printer-manager');
const { JobPoller }         = require('./job-poller');
const { WebhookService }    = require('./webhook-service');
const { loadPrinters }      = require('./printers-config');
const { isActiveNow }       = require('./schedule');
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

  // Webhook
  const webhook = new WebhookService(config);
  if (webhook.enabled) {
    logger.info(`Webhook: ${config.WEBHOOK_URL} | Retries: ${config.WEBHOOK_RETRY} | blockierend: ${config.WEBHOOK_BLOCK_PRINT}`);
  } else {
    logger.info('Webhook: deaktiviert (WEBHOOK_URL nicht gesetzt)');
  }

  // Poller pro Drucker
  const pollers = printers.map(p => {
    const manager = new PrinterManager(p.printerHost, p.printerPort, config);
    const pollerConfig = {
      ...config,
      HOSTNAME:     p.hostname,
      PRINTER_NAME: p.printerName,
      PRINTER_HOST: p.printerHost,
    };
    return { def: p, manager, poller: new JobPoller(client, manager, pollerConfig, webhook) };
  });

  // Graceful Shutdown
  async function shutdown(signal) {
    logger.info(`${signal} — fahre herunter...`);
    await Promise.all(pollers.map(async ({ poller, def }) => {
      await poller.stop();
      if (isActiveNow(config.ACTIVE_TIMES)) {
        await client.hidePrinter(def.hostname);
        logger.info(`Drucker abgemeldet: ${def.hostname}`);
      }
    }));
    logger.info('Fertig.');
    process.exit(0);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Drucker aktivieren und Polling starten
  const activeNow = isActiveNow(config.ACTIVE_TIMES);

  await Promise.all(pollers.map(async ({ def, poller }) => {
    if (activeNow) {
      const r = await client.activatePrinter(def.hostname, def.printerName);
      if (!r.success) logger.error(`activatePrinter "${def.hostname}": ${r.message}`);
      else            logger.info(`✅ "${def.printerName}" (${def.hostname}) → ${def.printerHost}:${def.printerPort}`);
    } else {
      logger.info(`💤 "${def.printerName}" — ausserhalb Zeitfenster, noch nicht angemeldet`);
    }
    await poller.start();
  }));

  logger.info('🔄 Alle Poller laufen');
}

main().catch(err => {
  logger.error('Unerwarteter Fehler:', err.message);
  process.exit(1);
});
