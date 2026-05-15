#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { ChurchToolsClient }    = require('./churchtools-client');
const { PrinterManager }       = require('./printer-manager');
const { LabelRouter }          = require('./label-router');
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
 * Einzel-Modus: wartet bis der eine Drucker bereit ist.
 * Routing-Modus: wartet bis ALLE physischen Drucker bereit sind.
 */
async function checkAndActivatePrinter(client, statusWebhook, def, pollerConfig) {
  const { printerName, hostname, checkEnabled, checkRetryIntervalMs,
          isRoutingMode } = def;
  const tcpTimeoutMs = pollerConfig.PRINTER_TIMEOUT_MS || 5000;

  if (!checkEnabled) {
    logger.info(`⏭️  Drucker-Check deaktiviert für "${printerName}" — melde direkt an`);
  } else if (isRoutingMode) {
    // Routing-Modus: alle physischen Drucker prüfen
    const router = new LabelRouter(pollerConfig);
    const hosts  = router.getUniqueHosts();
    logger.info(`🔍 Routing-Modus: prüfe ${hosts.length} Drucker für "${printerName}"...`);

    // Alle parallel prüfen und warten
    await Promise.all(hosts.map(async ({ host, port }) => {
      let attempt = 0;
      while (true) {
        attempt++;
        const { waitForPrinterReady: wfr } = require('./printer-checker');
        const status = await wfr(host, port, checkRetryIntervalMs, tcpTimeoutMs);

        if (status.ok) {
          if (attempt > 1) logger.info(`✅ Drucker ${host}:${port} bereit`);
          if (status.warnings.length > 0) {
            logger.warn(`⚠️  ${host}:${port} Warnung: ${status.warnings.join(', ')}`);
            if (statusWebhook?.enabled) {
              statusWebhook.send('printer.warning', { printerName, hostname, printerHost: host, printerPort: port }, status);
            }
          } else {
            logger.info(`✅ ${host}:${port} bereit`);
          }
          break;
        }
      }
    }));

  } else {
    // Einzel-Modus: einen Drucker prüfen
    const { printerHost, printerPort } = def;
    logger.info(`🔍 Prüfe Drucker ${printerHost}:${printerPort}...`);
    const status = await waitForPrinterReady(printerHost, printerPort, checkRetryIntervalMs, tcpTimeoutMs);

    if (status.warnings.length > 0) {
      logger.warn(`⚠️  Drucker "${printerName}" Warnung: ${status.warnings.join(', ')}`);
      if (statusWebhook?.enabled) {
        statusWebhook.send('printer.warning', { printerName, hostname, printerHost: def.printerHost, printerPort: def.printerPort }, status);
      }
    } else {
      logger.info(`✅ Drucker "${printerName}" bereit`);
    }
  }

  // Drucker anmelden
  const r = await client.activatePrinter(hostname, printerName);
  if (r.success) {
    logger.info(`✅ "${printerName} (${hostname})" angemeldet`);
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
    const modus = p.isRoutingMode
      ? `Routing (${Object.keys(p.labelRoutes).join(', ')})`
      : `Einzel (${p.printerHost}:${p.printerPort})`;
    const check = p.checkEnabled ? 'Check: aktiv' : 'Check: deaktiviert';
    logger.info(`  • ${p.printerName} (${p.hostname}) | ${modus} | ${schedule} | ${check}`);
  });

  // Login
  const client = new ChurchToolsClient(config.CT_BASE_URL, config.CT_USERNAME, config.CT_PASSWORD);
  try {
    await client.testLogin();
  } catch (err) {
    logger.error('Credentials ungültig — Abbruch');
    process.exit(1);
  }

  // Webhooks
  const webhook       = new WebhookService(config);
  const statusWebhook = new StatusWebhookService(config);

  if (webhook.enabled)       logger.info(`Webhook: ${webhook.targets.length} Ziel(e) aktiv`);
  else                       logger.info('Webhook: deaktiviert');
  if (statusWebhook.enabled) logger.info(`Status-Webhook: ${statusWebhook.targets.length} Ziel(e) aktiv`);
  else                       logger.info('Status-Webhook: deaktiviert');

  // Poller pro Drucker
  const pollers = printers.map(p => {
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
      IS_ROUTING_MODE:        p.isRoutingMode,
      LABEL_ROUTES:           p.labelRoutes,
    };

    // Einzel-Modus: PrinterManager | Routing-Modus: LabelRouter
    const printer = p.isRoutingMode
      ? new LabelRouter(pollerConfig)
      : new PrinterManager(p.printerHost, p.printerPort, pollerConfig);

    return { def: p, printer, poller: new JobPoller(client, printer, pollerConfig, webhook, statusWebhook) };
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
  await Promise.all(pollers.map(async ({ def, printer, poller }) => {
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