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

  // Drucker laden (globale ACTIVE_TIMES als Fallback)
  let printers;
  try {
    printers = loadPrinters(config.PRINTERS_FILE, config.ACTIVE_TIMES);
  } catch (err) {
    logger.error('printers.json Fehler:', err.message);
    process.exit(1);
  }

  logger.info(`${printers.length} Drucker geladen`);
  printers.forEach(p => {
    const schedule = p.activeTimesRaw
      ? `Zeitfenster: ${p.activeTimesRaw}`
      : config.ACTIVE_TIMES
        ? `Zeitfenster: global (${process.env.ACTIVE_TIMES})`
        : 'Zeitfenster: immer aktiv';
    logger.info(`  • ${p.printerName} (${p.hostname}) → ${p.printerHost}:${p.printerPort} | ${schedule}`);
  });

  // Einmaliger Test-Login beim Start zur Credential-Prüfung
  const client = new ChurchToolsClient(config.CT_BASE_URL, config.CT_USERNAME, config.CT_PASSWORD);
  try {
    await client.testLogin();
  } catch (err) {
    logger.error('Credentials ungültig — Abbruch');
    process.exit(1);
  }

  // Webhook
  const webhook = new WebhookService(config);
  if (webhook.enabled) {
    logger.info(`Webhook: ${webhook.targets.length} Ziel(e) aktiv`);
  } else {
    logger.info('Webhook: deaktiviert');
  }

  // Poller pro Drucker — jeder mit eigenem activeTimes
  const pollers = printers.map(p => {
    const manager = new PrinterManager(p.printerHost, p.printerPort, config);
    const pollerConfig = {
      ...config,
      HOSTNAME:     p.hostname,
      PRINTER_NAME: p.printerName,
      PRINTER_HOST: p.printerHost,
      ACTIVE_TIMES: p.activeTimes,  // drucker-spezifisch (oder global als Fallback)
    };
    return { def: p, manager, poller: new JobPoller(client, manager, pollerConfig, webhook) };
  });

  // Graceful Shutdown
  async function shutdown(signal) {
    logger.info(`${signal} — fahre herunter...`);
    await Promise.all(pollers.map(async ({ poller, def }) => {
      await poller.stop();
      if (isActiveNow(def.activeTimes)) {
        await client.hidePrinter(def.hostname);
        logger.info(`Drucker abgemeldet: ${def.hostname}`);
      }
    }));
    logger.info('Fertig.');
    process.exit(0);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Drucker aktivieren wenn Zeitfenster gerade offen, dann Polling starten
  await Promise.all(pollers.map(async ({ def, poller }) => {
    if (isActiveNow(def.activeTimes)) {
      await client.ensureLogin();
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