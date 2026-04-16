'use strict';

const { logger } = require('./logger');
const { isActiveNow } = require('./schedule');

/**
 * Polls ChurchTools for print jobs with schedule-aware adaptive intervals:
 *
 *  - Outside active hours  → no polling (sleeps until next window opens)
 *  - Inside active hours, no recent job  → POLL_IDLE_MS  (default 15 s)
 *  - Inside active hours, job seen recently → POLL_ACTIVE_MS (default 5 s)
 *    for POLL_ACTIVE_TTL_MS (default 5 min) after the last job
 */
class JobPoller {
  constructor(client, printerManager, config) {
    this.client  = client;
    this.printer = printerManager;
    this.config  = config;

    this._running          = false;
    this._timer            = null;
    this._consecutiveErrors = 0;
    this._totalPrinted     = 0;
    this._startTime        = null;

    // Timestamp of last received job (for active-mode TTL)
    this._lastJobAt = null;

    // Track logged state to avoid log spam
    this._lastLoggedMode = null;
  }

  // ── Public ────────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running  = true;
    this._startTime = Date.now();

    logger.info(`Testing TCP connection to printer ${this.config.PRINTER_HOST}:${this.config.PRINTER_PORT}...`);
    const reachable = await this.printer.testConnection();
    logger.info(reachable ? '✅ Printer reachable' : '⚠️  Printer not reachable – will retry on job');

    if (this.config.ACTIVE_TIMES) {
      logger.info(`Schedule active. Idle poll: ${this.config.POLL_IDLE_MS}ms, ` +
                  `active poll: ${this.config.POLL_ACTIVE_MS}ms for ${this.config.POLL_ACTIVE_TTL_MS / 1000}s after last job`);
    } else {
      logger.info('No ACTIVE_TIMES configured – polling always.');
    }

    this._scheduleNext(0);
  }

  async stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    logger.info(`Polling stopped. Total jobs printed: ${this._totalPrinted}`);
  }

  status() {
    return {
      running:          this._running,
      mode:             this._currentMode(),
      consecutiveErrors: this._consecutiveErrors,
      totalPrinted:     this._totalPrinted,
      uptimeSeconds:    this._startTime ? Math.floor((Date.now() - this._startTime) / 1000) : 0,
      lastJobAt:        this._lastJobAt ? new Date(this._lastJobAt).toISOString() : null,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

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

  /** Milliseconds until the next active window starts (≤ 60 s granularity). */
  _msUntilNextWindow() {
    // Check every 30 s when sleeping
    return 30_000;
  }

  async _poll() {
    if (!this._running) return;

    // ── Schedule gate ──────────────────────────────────────────────────────
    if (!isActiveNow(this.config.ACTIVE_TIMES)) {
      if (this._lastLoggedMode !== 'sleeping') {
        logger.info('💤 Outside active hours – polling paused');
        this._lastLoggedMode = 'sleeping';
      }
      this._scheduleNext(this._msUntilNextWindow());
      return;
    }

    // ── Determine interval for this cycle ──────────────────────────────────
    const inActiveTTL = this._isInActiveTTL();
    const interval    = inActiveTTL ? this.config.POLL_ACTIVE_MS : this.config.POLL_IDLE_MS;
    const mode        = inActiveTTL ? 'active' : 'idle';

    if (this._lastLoggedMode !== mode) {
      if (mode === 'active') {
        logger.info(`⚡ Switching to fast polling (${this.config.POLL_ACTIVE_MS}ms) – job activity detected`);
      } else {
        logger.info(`🕐 Switching to idle polling (${this.config.POLL_IDLE_MS}ms)`);
      }
      this._lastLoggedMode = mode;
    }

    // ── Actual API poll ───────────────────────────────────────────────────
    try {
      const result = await this.client.getNextPrinterJob(this.config.HOSTNAME);

      if (!result.success) throw new Error(result.message || 'API error');

      const jobData = result.data;

      if (!jobData || this._isEmpty(jobData)) {
        this._consecutiveErrors = 0;
        this._scheduleNext(interval);
        return;
      }

      // ── Job received ───────────────────────────────────────────────────
      logger.info('📄 Print job received:', JSON.stringify(jobData).slice(0, 120));
      await this.printer.printJob(jobData);

      this._totalPrinted++;
      this._consecutiveErrors = 0;
      this._lastJobAt = Date.now(); // reset active-mode TTL

      // Drain queue: re-poll almost immediately
      this._scheduleNext(200);

    } catch (err) {
      this._consecutiveErrors++;
      const backoff = this._backoffDelay();
      logger.error(`Poll error #${this._consecutiveErrors}: ${err.message}. Retry in ${backoff}ms`);

      if (this._consecutiveErrors >= this.config.MAX_ERRORS) {
        logger.error(`🔴 ${this.config.MAX_ERRORS} consecutive errors – pausing 60s`);
        this._consecutiveErrors = 0;
        this._scheduleNext(60_000);
      } else {
        this._scheduleNext(backoff);
      }
    }
  }

  _isEmpty(data) {
    if (data === null || data === undefined) return true;
    if (typeof data === 'object' && Object.keys(data).length === 0) return true;
    if (typeof data === 'string' && data.trim() === '') return true;
    if (Array.isArray(data) && data.length === 0) return true;
    return false;
  }

  _backoffDelay() {
    return Math.min(this.config.POLL_IDLE_MS * Math.pow(2, this._consecutiveErrors - 1), 30_000);
  }
}

module.exports = { JobPoller };
