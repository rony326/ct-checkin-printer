#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { ChurchToolsClient }    = require('./churchtools-client');
const { PrinterManager }       = require('./printer-manager');
const { JobPoller }            = require('./job-poller');
const { WebhookService }       = require('./webhook-service');
const { StatusWebhookService } = require('./status-webhook-service');
const { loadPrinters }         = require('./printers-config');
const { waitForPrinterReady }  = require('./printer-checker');
const { isActiveNow }          = require('./schedule');
const { logger }               = require('./logger');
const config                   = require('./config');

/**
 * Drucker-Check + Anmeldung bei CT.
 * - Kritische Fehler (Band leer, Deckel offen) → warten bis behoben + Webhook
 * - Warnungen → anmelden + Webhook
 * - Check deaktiviert → direkt anmelden
 */
async function checkAndActivatePrinter(client, statusWebhook, def, pollerConfig) {
  const { printerHost, printerPort, printerName, hostname,
          checkEnabled, checkRetryIntervalMs } = def;
  const tcpTimeoutMs = pollerConfig.PRINTER_TIMEOUT_MS || 5000;

  if (!checkEnabled) {
    logger.info(`⏭️  Drucker-Check deaktiviert für "${printerName}" — melde direkt an`);
  } else {
    logger.info(`🔍 Prüfe Drucker ${printerHost}:${printerPort}...`);

    // Warten bis Drucker erreichbar UND fehlerfrei
    const status = await waitForPrinterReady(printerHost, printerPort, checkRetryIntervalMs, tcpTimeoutMs);

    if (status.warnings.length > 0) {
      logger.warn(`⚠️  Drucker "${printerName}" Warnung: ${status.warnings.join(', ')}`);
      if (statusWebhook?.enabled) {
        statusWebhook.send('printer.warning', def, status);
      }
    } else {
      logger.info(`✅ Drucker "${printerName}" bereit`);
      if (status.raw) logger.debug(`Web-Status: ${JSON.stringify(status.raw)}`);
    }
  }

  // Drucker anmelden
  const r = await client.activatePrinter(hostname, printerName);
  if (r.success) {
    logger.info(`✅ "${printerName} (${hostname})" → ${printerHost}:${printerPort}`);
  } else {
    logger.error(`activatePrinter "${hostname}": ${r.message}`);
  }
}

async function main() {
  logger.info('🖨️  ChurchTools Check-In Printer Service');
  logger.info(`Config    : ${config.CONFIG_FILE}`);
  logger.info(`Label-Typ : ${config.LABEL_TYPE}`);
  logger.info(`Dry-Run   : ${config.DRY_RUN}`);

  // Drucker laden
  let printers;
  try {
    printers = loadPrinters(config.PRINTERS_RAW, config.ACTIVE_TIMES, config._parseSchedule);
  } catch (err) {
    logger.error('Drucker-Konfiguration Fehler:', err.message);
    process.exit(1);
  }

  logger.info(`${printers.length} Drucker geladen`);
  printers.forEach(p => {
    const schedule = p.activeTimesRaw !== null && p.activeTimesRaw !== undefined
      ? `Zeitfenster: ${p.activeTimesRaw || 'immer aktiv (drucker-spezifisch)'}`
      : config.ACTIVE_TIMES ? 'Zeitfenster: global' : 'Zeitfenster: immer aktiv';
    const check = p.checkEnabled ? 'Check: aktiv' : 'Check: deaktiviert';
    logger.info(`  • ${p.printerName} (${p.hostname}) → ${p.printerHost}:${p.printerPort} | ${schedule} | ${check}`);
  });

  // Login
  const client = new ChurchToolsClient(config.CT_BASE_URL, config.CT_USERNAME, config.CT_PASSWORD);
  try {
    await client.testLogin();
  } catch (err) {
    logger.error('Credentials ungültig — Abbruch');
    process.exit(1);
  }

  // Check-In Webhook (für Druckaufträge)
  const webhook = new WebhookService(config);
  if (webhook.enabled) {
    logger.info(`Webhook: ${webhook.targets.length} Ziel(e) aktiv`);
  } else {
    logger.info('Webhook: deaktiviert');
  }

  // Status-Webhook (für Drucker-Fehler/Warnungen)
  const statusWebhook = new StatusWebhookService(config);
  if (statusWebhook.enabled) {
    logger.info(`Status-Webhook: ${statusWebhook.targets.length} Ziel(e) aktiv`);
  } else {
    logger.info('Status-Webhook: deaktiviert');
  }

  // Poller pro Drucker
  const pollers = printers.map(p => {
    const manager = new PrinterManager(p.printerHost, p.printerPort, config);
    const pollerConfig = {
      ...config,
      HOSTNAME:               p.hostname,
      PRINTER_NAME:           p.printerName,
      PRINTER_HOST:           p.printerHost,
      PRINTER_PORT:           p.printerPort,
      ACTIVE_TIMES:           p.activeTimes,
      PRINTER_CHECK_ENABLED:  p.checkEnabled,
      PRINTER_CHECK_RETRY_MS: p.checkRetryIntervalMs,
      STATUS_WEBHOOK_ENABLED: p.statusWebhook,
      PRINT_QUEUE:            p.printQueue,
    };
    return { def: p, manager, poller: new JobPoller(client, manager, pollerConfig, webhook, statusWebhook) };
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

  // Drucker-Check + Anmeldung + Polling starten
  await Promise.all(pollers.map(async ({ def, poller }) => {
    if (isActiveNow(def.activeTimes)) {
      await client.ensureLogin();
      await checkAndActivatePrinter(client, statusWebhook, def, poller.config);
    } else {
      logger.info(`💤 "${def.printerName} (${def.hostname})" — ausserhalb Zeitfenster`);
    }
    await poller.start();
  }));

  logger.info('🔄 Alle Poller laufen');
}

main().catch(err => {
  logger.error('Unerwarteter Fehler:', err.message);
  process.exit(1);
});