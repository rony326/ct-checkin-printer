'use strict';

const { logger } = require('./logger');
const { isActiveNow, msUntilNextWindow } = require('./schedule');

class JobPoller {
  constructor(client, printerManager, config, webhookService = null) {
    this.client   = client;
    this.printer  = printerManager;
    this.config   = config;
    this.webhook  = webhookService;

    this._running           = false;
    this._timer             = null;
    this._consecutiveErrors = 0;
    this._totalPrinted      = 0;
    this._startTime         = null;
    this._lastJobAt         = null;
    this._lastMode          = null;
  }

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
    if (this.webhook?.enabled) {
      logger.info(`Webhook aktiv: ${this.config.WEBHOOK_URL} | blockierend: ${this.config.WEBHOOK_BLOCK_PRINT}`);
    }

    this._scheduleNext(0);
  }

  async stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    logger.info(`Poller gestoppt. Gedruckt: ${this._totalPrinted}`);
  }

  status() {
    return {
      running:           this._running,
      mode:              this._currentMode(),
      consecutiveErrors: this._consecutiveErrors,
      totalPrinted:      this._totalPrinted,
      uptimeSeconds:     this._startTime ? Math.floor((Date.now() - this._startTime) / 1000) : 0,
      lastJobAt:         this._lastJobAt ? new Date(this._lastJobAt).toISOString() : null,
    };
  }

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

    // ── Zeitfenster-Wechsel ───────────────────────────────────────────────────
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

    // ── API-Abfrage ───────────────────────────────────────────────────────────
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

      // Drucken — gibt angereicherte Jobs zurück
      const enrichedJobs = await this.printer.printJob(jobData);

      this._totalPrinted++;
      this._consecutiveErrors = 0;
      this._lastJobAt = Date.now();

      // ── Webhook senden ────────────────────────────────────────────────────
      if (this.webhook?.enabled && enrichedJobs) {
        const printerDef = {
          hostname:     this.config.HOSTNAME,
          printerName:  this.config.PRINTER_NAME || this.config.HOSTNAME,
          printerHost:  this.config.PRINTER_HOST || '',
        };
        try {
          await this.webhook.send(enrichedJobs, printerDef);
        } catch (err) {
          logger.error('Webhook fehlgeschlagen:', err.message);
          // Druck war bereits erfolgreich — nur loggen
        }
      }

      this._scheduleNext(200);

    } catch (err) {
      this._consecutiveErrors++;
      const backoff = this._backoffDelay();
      logger.error(`Poll-Fehler #${this._consecutiveErrors}: ${err.message}. Retry in ${backoff}ms`);

      if (this._consecutiveErrors >= this.config.MAX_ERRORS) {
        logger.error(`🔴 ${this.config.MAX_ERRORS} Fehler — 60s Pause`);
        this._consecutiveErrors = 0;
        this._scheduleNext(60_000);
      } else {
        this._scheduleNext(backoff);
      }
    }
  }

  async _onModeChange(prevMode, newMode) {
    const hostname    = this.config.HOSTNAME;
    const printerName = this.config.PRINTER_NAME || hostname;

    if (prevMode === 'sleeping' && newMode !== 'sleeping') {
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
