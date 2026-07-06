'use strict';

const { logger }                     = require('./logger');
const { isActiveNow, msUntilNextWindow } = require('./schedule');
const { waitForPrinterReady, checkPrinter } = require('./printer-checker');
const { PrintQueue }                 = require('./print-queue');

class JobPoller {
  constructor(client, printerManager, config, webhookService = null, statusWebhookService = null) {
    this.client        = client;
    this.printer       = printerManager;
    this.config        = config;
    this.webhook       = webhookService;
    this.statusWebhook = statusWebhookService;

    this._running           = false;
    this._timer             = null;
    this._consecutiveErrors = 0;
    this._totalPrinted      = 0;
    this._startTime         = null;
    this._lastJobAt         = null;
    this._lastMode          = null;

    // Retry-Queue
    this._queue        = new PrintQueue(config);
    this._queueTimer   = null;
    this._printerReady = true; // Annahme: bereit beim Start
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running   = true;
    this._startTime = Date.now();

    logger.info(`Drucker: ${this.config.HOSTNAME}`);
    if (this.config.ACTIVE_TIMES) {
      logger.info(`Zeitfenster aktiv — idle: ${this.config.POLL_IDLE_MS}ms, aktiv: ${this.config.POLL_ACTIVE_MS}ms`);
    } else {
      logger.info('Kein Zeitfenster — pollt immer');
    }

    this._scheduleNext(0);
  }

  async stop() {
    this._running = false;
    if (this._timer)      { clearTimeout(this._timer);      this._timer      = null; }
    if (this._queueTimer) { clearTimeout(this._queueTimer); this._queueTimer = null; }
    logger.info(`Poller gestoppt. Gedruckt: ${this._totalPrinted} | Queue: ${this._queue.size}`);
  }

  status() {
    return {
      running:           this._running,
      mode:              this._currentMode(),
      consecutiveErrors: this._consecutiveErrors,
      totalPrinted:      this._totalPrinted,
      printerReady:      this._printerReady,
      queue:             this._queue.status(),
      uptimeSeconds:     this._startTime ? Math.floor((Date.now() - this._startTime) / 1000) : 0,
      lastJobAt:         this._lastJobAt ? new Date(this._lastJobAt).toISOString() : null,
    };
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  _currentMode() {
    if (!isActiveNow(this.config.ACTIVE_TIMES)) return 'sleeping';
    if (this._isInActiveTTL())                  return 'active';
    return 'idle';
  }

  _isInActiveTTL() {
    if (!this._lastJobAt) return false;
    return (Date.now() - this._lastJobAt) < this.config.POLL_ACTIVE_TTL_MS;
  }

  _scheduleNext(delayMs) {
    if (!this._running) return;
    this._timer = setTimeout(() => this._poll(), delayMs);
  }

  _sleepUntilNextWindow() {
    const ms = msUntilNextWindow(this.config.ACTIVE_TIMES);
    if (ms === null || ms === Infinity) return 30_000;
    return Math.min(ms + 1000, 30_000);
  }

  async _poll() {
    if (!this._running) return;

    const mode = this._currentMode();

    if (mode !== this._lastMode) {
      await this._onModeChange(this._lastMode, mode);
      this._lastMode = mode;
    }

    if (mode === 'sleeping') {
      this._scheduleNext(this._sleepUntilNextWindow());
      return;
    }

    const interval = mode === 'active'
      ? this.config.POLL_ACTIVE_MS
      : this.config.POLL_IDLE_MS;

    try {
      const result = await this.client.getNextPrinterJob(this.config.HOSTNAME);
      if (!result.success) throw new Error(result.message || 'API error');

      const jobData = result.data;
      if (!jobData || this._isEmpty(jobData)) {
        this._consecutiveErrors = 0;
        this._scheduleNext(interval);
        return;
      }

      logger.info('📄 Druckauftrag empfangen');

      // Drucker-Status vor dem Druck prüfen
      await this._printWithQueueSupport(jobData);

      this._consecutiveErrors = 0;
      this._lastJobAt = Date.now();
      this._scheduleNext(200);

    } catch (err) {
      this._consecutiveErrors++;
      const backoff = this._backoffDelay();
      logger.error(`Poll-Fehler #${this._consecutiveErrors}: ${err.message}. Retry in ${backoff}ms`);

      if (this._consecutiveErrors >= this.config.MAX_ERRORS) {
        logger.error(`🔴 ${this.config.MAX_ERRORS} Fehler hintereinander — melde Drucker ab und starte neu`);
        try {
          await this.client.hidePrinter(this.config.HOSTNAME);
          logger.info(`Drucker abgemeldet: ${this.config.HOSTNAME}`);
        } catch (hideErr) {
          logger.error('Drucker-Abmeldung fehlgeschlagen:', hideErr.message);
        }
        process.exit(1);
      } else {
        this._scheduleNext(backoff);
      }
    }
  }

  // ── Druck mit Queue-Support ────────────────────────────────────────────────

  async _printWithQueueSupport(jobData) {
    const printerHost  = this.config.PRINTER_HOST;
    const printerPort  = this.config.PRINTER_PORT || 9100;
    const checkEnabled = this.config.PRINTER_CHECK_ENABLED !== false;
    const isRouting    = this.config.IS_ROUTING_MODE || false;

    // Drucker-Status vor dem Druck prüfen (Einzel-Modus)
    // Routing-Modus: Checks laufen beim Start und Zeitfenster-Wechsel
    if (checkEnabled && !isRouting && printerHost) {
      const status = await checkPrinter(printerHost, printerPort, this.config.PRINTER_TIMEOUT_MS || 5000);

      if (!status.reachable || status.errors.length > 0) {
        // Drucker nicht bereit — Jobs in Queue
        const jobs = Array.isArray(jobData) ? jobData : [jobData];
        const enriched = this.printer.enrichJobs(jobs.filter(j => j?.data?.trim()));

        for (const job of enriched) {
          const reason = !status.reachable
            ? 'Drucker nicht erreichbar'
            : status.errors.join(', ');
          this._queue.enqueue(job, reason, false);
        }

        if (this.statusWebhook?.enabled) {
          this.statusWebhook.send('printer.error', {
            printerName: this.config.PRINTER_NAME,
            hostname:    this.config.HOSTNAME,
            printerHost,
            printerPort,
          }, status);
        }

        this._printerReady = false;
        this._startQueueMonitor();
        return;
      }
    }

    // Drucker-Status vor dem Druck prüfen (Routing-Modus)
    // Prüft alle physischen Drucker die im Routing verwendet werden und meldet
    // Fehler per Status-Webhook. Druck wird trotzdem versucht — LabelRouter
    // druckt auf gesunde Drucker weiter und meldet nur die betroffenen Jobs
    // als fehlgeschlagen (landen unten in der Queue).
    if (checkEnabled && isRouting && typeof this.printer.getUniqueHosts === 'function') {
      const hosts = this.printer.getUniqueHosts();

      await Promise.all(hosts.map(async ({ host, port }) => {
        const status = await checkPrinter(host, port, this.config.PRINTER_TIMEOUT_MS || 5000);
        if (!status.reachable || status.errors.length > 0) {
          logger.warn(`Drucker ${host}:${port} nicht bereit: ${status.toString()}`);
          if (this.statusWebhook?.enabled) {
            this.statusWebhook.send('printer.error', {
              printerName: this.config.PRINTER_NAME,
              hostname:    this.config.HOSTNAME,
              printerHost: host,
              printerPort: port,
            }, status);
          }
        }
      }));
    }

    // Drucker bereit — drucken (Einzel oder Routing)
    const { enriched, failed } = await this.printer.printJobs
      ? await this.printer.printJobs(jobData)    // LabelRouter
      : await this.printer.printJob(jobData);     // PrinterManager
    this._totalPrinted += (enriched.length - failed.length);

    // Fehlgeschlagene Jobs in Queue
    for (const { job, reason, printError } of failed) {
      this._queue.enqueue(job, reason, printError);
    }

    if (failed.length > 0) {
      this._printerReady = false;
      this._startQueueMonitor();
    }

    // Check-In Webhook
    if (this.webhook?.enabled && enriched.length > 0) {
      const printerDef = {
        hostname:    this.config.HOSTNAME,
        printerName: this.config.PRINTER_NAME || this.config.HOSTNAME,
        printerHost: this.config.PRINTER_HOST || '',
      };
      this.webhook.send(enriched, printerDef).catch(err =>
        logger.error('Webhook fehlgeschlagen:', err.message)
      );
    }
  }

  // ── Queue Monitor ──────────────────────────────────────────────────────────

  _startQueueMonitor() {
    if (this._queueTimer) return; // Läuft bereits
    if (this._queue.isEmpty) return;

    const retryDelayMs = this.config.PRINT_QUEUE?.retryDelayMs
      || this.printer.queueConfig?.retryDelayMs
      || 30000;

    logger.info(`🔁 Queue-Monitor gestartet (prüft alle ${retryDelayMs / 1000}s)`);
    this._scheduleQueueCheck(retryDelayMs);
  }

  _scheduleQueueCheck(delayMs) {
    if (!this._running) return;
    this._queueTimer = setTimeout(() => this._checkQueueAndFlush(), delayMs);
  }

  async _checkQueueAndFlush() {
    this._queueTimer = null;
    if (!this._running || this._queue.isEmpty) {
      this._printerReady = true;
      return;
    }

    // Abgelaufene Jobs bereinigen
    this._queue.cleanup();
    if (this._queue.isEmpty) {
      logger.info('Queue: leer nach Bereinigung');
      this._printerReady = true;
      return;
    }

    const isRouting    = this.config.IS_ROUTING_MODE || false;
    const retryDelayMs = this.config.PRINT_QUEUE?.retryDelayMs
      || this.printer.queueConfig?.retryDelayMs
      || 30000;

    let status, printerHost, printerPort;

    if (isRouting && typeof this.printer.getUniqueHosts === 'function') {
      // Routing-Modus: PRINTER_HOST ist null (es gibt keinen einzelnen Drucker) —
      // alle physischen Drucker prüfen, die im Routing verwendet werden.
      const hosts   = this.printer.getUniqueHosts();
      const results = await Promise.all(hosts.map(async ({ host, port }) => ({
        host, port, status: await checkPrinter(host, port, this.config.PRINTER_TIMEOUT_MS || 5000),
      })));
      const notReady = results.find(r => !r.status.reachable || r.status.errors.length > 0);

      if (notReady) {
        logger.debug(`Queue-Monitor: Drucker ${notReady.host}:${notReady.port} noch nicht bereit (${notReady.status.toString()}) — retry in ${retryDelayMs / 1000}s`);
        this._scheduleQueueCheck(retryDelayMs);
        return;
      }

      status      = results[0].status;
      printerHost = null;
      printerPort = null;
    } else {
      printerHost = this.config.PRINTER_HOST;
      printerPort = this.config.PRINTER_PORT || 9100;
      status      = await checkPrinter(printerHost, printerPort, this.config.PRINTER_TIMEOUT_MS || 5000);

      if (!status.reachable || status.errors.length > 0) {
        logger.debug(`Queue-Monitor: Drucker noch nicht bereit (${status.toString()}) — retry in ${retryDelayMs / 1000}s`);
        this._scheduleQueueCheck(retryDelayMs);
        return;
      }
    }

    // Drucker wieder bereit — Queue leeren
    logger.info(`✅ Drucker wieder bereit — leere Queue (${this._queue.size} Job(s))`);
    this._printerReady = true;

    // Status-Webhook "printer.ready"
    if (this.statusWebhook?.enabled) {
      this.statusWebhook.send('printer.ready', {
        printerName: this.config.PRINTER_NAME,
        hostname:    this.config.HOSTNAME,
        printerHost,
        printerPort,
      }, status);
    }

    await this._queue.flush(
      job => this.printer.printSingleJob(job),
      job => {
        logger.warn(`Queue: Job ${job.id} verworfen — Status-Webhook`);
        if (this.statusWebhook?.enabled) {
          this.statusWebhook.send('printer.job_expired', {
            printerName: this.config.PRINTER_NAME,
            hostname:    this.config.HOSTNAME,
            printerHost,
            printerPort,
          }, { reachable: true, ok: true, errors: [], warnings: [], raw: null });
        }
      }
    );

    // Falls nach flush noch Jobs übrig → weiter monitoren
    if (!this._queue.isEmpty) {
      this._scheduleQueueCheck(retryDelayMs);
    }
  }

  // ── Zeitfenster-Wechsel ────────────────────────────────────────────────────

  async _onModeChange(prevMode, newMode) {
    const hostname    = this.config.HOSTNAME;
    const printerName = this.config.PRINTER_NAME || hostname;
    const printerHost = this.config.PRINTER_HOST;
    const printerPort = this.config.PRINTER_PORT || 9100;

    if (prevMode === 'sleeping' && newMode !== 'sleeping') {
      await this.client.ensureLogin();

      const checkEnabled = this.config.PRINTER_CHECK_ENABLED !== false;
      const isRouting    = this.config.IS_ROUTING_MODE || false;

      if (!checkEnabled) {
        logger.info(`⏭️  Drucker-Check deaktiviert für "${printerName}" — melde direkt an`);
      } else if (isRouting && typeof this.printer.getUniqueHosts === 'function') {
        const retryMs      = this.config.PRINTER_CHECK_RETRY_MS || 30000;
        const tcpTimeoutMs = this.config.PRINTER_TIMEOUT_MS     || 5000;
        const hosts        = this.printer.getUniqueHosts();

        logger.info(`🔍 Routing-Modus: prüfe ${hosts.length} Drucker für "${printerName}"...`);
        await Promise.all(hosts.map(async ({ host, port }) => {
          const status = await waitForPrinterReady(host, port, retryMs, tcpTimeoutMs);

          if (status.warnings.length > 0) {
            logger.warn(`⚠️  ${host}:${port} Warnung: ${status.warnings.join(', ')}`);
            if (this.statusWebhook?.enabled) {
              this.statusWebhook.send('printer.warning', { printerName, hostname, printerHost: host, printerPort: port }, status);
            }
          } else {
            logger.info(`✅ ${host}:${port} bereit`);
          }
        }));
      } else if (printerHost) {
        const retryMs      = this.config.PRINTER_CHECK_RETRY_MS || 30000;
        const tcpTimeoutMs = this.config.PRINTER_TIMEOUT_MS     || 5000;

        logger.info(`🔍 Prüfe Drucker ${printerHost}:${printerPort}...`);
        const status = await waitForPrinterReady(printerHost, printerPort, retryMs, tcpTimeoutMs);

        if (status.warnings.length > 0) {
          logger.warn(`⚠️  Drucker "${printerName}" Warnung: ${status.warnings.join(', ')}`);
          if (this.statusWebhook?.enabled) {
            this.statusWebhook.send('printer.warning', { printerName, hostname, printerHost, printerPort }, status);
          }
        } else {
          logger.info(`✅ Drucker "${printerName}" bereit`);
          if (status.raw) logger.debug(`Web-Status: ${JSON.stringify(status.raw)}`);
        }
      }

      logger.info(`🔔 Zeitfenster geöffnet — melde Drucker an: "${printerName}"`);
      const r = await this.client.activatePrinter(hostname, printerName);
      if (r.success) logger.info(`✅ Drucker angemeldet: "${printerName}"`);
      else           logger.error(`Drucker-Anmeldung fehlgeschlagen: ${r.message}`);
    }

    if (prevMode !== 'sleeping' && prevMode !== null && newMode === 'sleeping') {
      logger.info(`🔕 Zeitfenster geschlossen — melde Drucker ab: "${printerName}"`);
      const r = await this.client.hidePrinter(hostname);
      if (r.success) logger.info(`✅ Drucker abgemeldet: "${printerName}"`);
      else           logger.error(`Drucker-Abmeldung fehlgeschlagen: ${r.message}`);
      this.client.onWindowClose();
    }

    if (newMode === 'sleeping') {
      const ms   = msUntilNextWindow(this.config.ACTIVE_TIMES);
      const info = (ms && ms !== Infinity) ? ` — nächstes Fenster in ${Math.round(ms / 60000)}min` : '';
      logger.info(`💤 Ausserhalb Zeitfenster${info}`);
    } else if (prevMode === 'sleeping') {
      logger.info(`🕐 Idle-Polling gestartet (${this.config.POLL_IDLE_MS}ms)`);
    } else if (newMode === 'active' && prevMode === 'idle') {
      logger.info(`⚡ Aktives Polling (${this.config.POLL_ACTIVE_MS}ms)`);
    } else if (newMode === 'idle' && prevMode === 'active') {
      logger.info(`🕐 Zurück zu Idle-Polling (${this.config.POLL_IDLE_MS}ms)`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _isEmpty(data) {
    if (data === null || data === undefined) return true;
    if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) return true;
    if (typeof data === 'string' && data.trim() === '') return true;
    if (Array.isArray(data) && data.length === 0) return true;
    return false;
  }

  _backoffDelay() {
    return Math.min(this.config.POLL_IDLE_MS * Math.pow(2, this._consecutiveErrors - 1), 30_000);
  }
}

module.exports = { JobPoller };