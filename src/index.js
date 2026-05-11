#!/usr/bin/env node
'use strict';

// dotenv als erstes laden — damit LOG_LEVEL beim ersten logger-Aufruf bereits gesetzt ist
require('dotenv').config();

const { ChurchToolsClient } = require('./churchtools-client');
const { PrinterManager }    = require('./printer-manager');
const { JobPoller }         = require('./job-poller');
const { WebhookService }    = require('./webhook-service');
const { loadPrinters }      = require('./printers-config');
const { waitForPrinter }    = require('./printer-checker');
const { isActiveNow }       = require('./schedule');
const { logger }            = require('./logger');
const config                = require('./config');

/**
 * Führt den Drucker-Check durch und meldet den Drucker bei CT an.
 * Wird beim Start (wenn Zeitfenster offen) und bei Zeitfenster-Wechsel verwendet.
 */
async function checkAndActivatePrinter(client, webhook, def, pollerConfig) {
  const { printerHost, printerPort, printerName, hostname,
          checkRetryIntervalMs, statusWebhook } = def;
  const tcpTimeoutMs = pollerConfig.PRINTER_TIMEOUT_MS || 5000;

  // 1. TCP-Ping + ESC/P Status — warten bis erreichbar
  logger.info(`🔍 Prüfe Drucker ${printerHost}:${printerPort}...`);
  const status = await waitForPrinter(printerHost, printerPort, checkRetryIntervalMs, tcpTimeoutMs);

  // 2. Status auswerten
  if (status.errors.length > 0) {
    logger.error(`⚠️  Drucker "${printerName}" meldet Fehler: ${status.errors.join(', ')}`);
    if (statusWebhook && webhook?.enabled) {
      _fireStatusWebhook(webhook, printerName, hostname, printerHost, printerPort, status);
    }
  } else if (status.warnings.length > 0) {
    logger.warn(`⚠️  Drucker "${printerName}" Warnung: ${status.warnings.join(', ')}`);
    if (statusWebhook && webhook?.enabled) {
      _fireStatusWebhook(webhook, printerName, hostname, printerHost, printerPort, status);
    }
  } else {
    logger.info(`✅ Drucker "${printerName}" bereit`);
    if (status.raw) logger.debug(`Status Bytes: ${status.raw.hex}`);
  }

  // 3. Drucker anmelden (auch bei Fehler-Status — warnen aber nicht blockieren)
  const r = await client.activatePrinter(hostname, printerName);
  if (r.success) {
    logger.info(`✅ "${printerName} (${hostname})" → ${printerHost}:${printerPort}`);
  } else {
    logger.error(`activatePrinter "${hostname}": ${r.message}`);
  }
}

function _fireStatusWebhook(webhook, printerName, hostname, printerHost, printerPort, status) {
  const payload = {
    event:     'printer.status',
    timestamp: Math.floor(Date.now() / 1000),
    printer:   { name: printerName, hostname, host: printerHost, port: printerPort },
    status:    { reachable: status.reachable, ok: status.ok,
                 errors: status.errors, warnings: status.warnings },
  };
  webhook._sendToAllTargets(payload).catch(err =>
    logger.error('Status-Webhook fehlgeschlagen:', err.message)
  );
}

async function main() {
  logger.info('🖨️  ChurchTools Check-In Printer Service');
  logger.info(`Config    : ${config.CONFIG_FILE}`);
  logger.info(`Label-Typ : ${config.LABEL_TYPE}`);
  logger.info(`Dry-Run   : ${config.DRY_RUN}`);

  // Drucker laden
  let printers;
  try {
    printers = loadPrinters(
      config.PRINTERS_RAW,
      config.ACTIVE_TIMES,
      config._parseSchedule
    );
  } catch (err) {
    logger.error('Drucker-Konfiguration Fehler:', err.message);
    process.exit(1);
  }

  logger.info(`${printers.length} Drucker geladen`);
  printers.forEach(p => {
    const schedule = p.activeTimesRaw !== null && p.activeTimesRaw !== undefined
      ? `Zeitfenster: ${p.activeTimesRaw || 'immer aktiv (drucker-spezifisch)'}`
      : config.ACTIVE_TIMES
        ? 'Zeitfenster: global'
        : 'Zeitfenster: immer aktiv';
    logger.info(`  • ${p.printerName} (${p.hostname}) → ${p.printerHost}:${p.printerPort} | ${schedule}`);
  });

  // Test-Login
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
    logger.info(`Webhook: ${webhook.targets.length} Ziel(e) aktiv | blockierend: ${config.WEBHOOK_BLOCK_PRINT}`);
  } else {
    logger.info('Webhook: deaktiviert');
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
      PRINTER_CHECK_RETRY_MS: p.checkRetryIntervalMs,
      STATUS_WEBHOOK_ENABLED: p.statusWebhook,
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

  // Drucker-Check + Anmeldung + Polling starten
  await Promise.all(pollers.map(async ({ def, poller }) => {
    if (isActiveNow(def.activeTimes)) {
      await client.ensureLogin();
      // Drucker-Check VOR activatePrinter — wartet bis Drucker erreichbar
      await checkAndActivatePrinter(client, webhook, def, poller.config);
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