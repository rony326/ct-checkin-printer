'use strict';

const { logger } = require('./logger');

/**
 * PrintQueue — verwaltet fehlgeschlagene Druckaufträge und wiederholt sie
 * sobald der Drucker wieder bereit ist.
 *
 * Konfiguration pro Drucker (config.js):
 *   printQueue: {
 *     maxRetries:        5,       // Max. Versuche bevor Job verworfen
 *     maxAgeMs:          1800000, // Max. Alter in ms (30min)
 *     retryDelayMs:      30000,   // Wartezeit zwischen Status-Checks
 *     retryOnPrintError: true,    // Auch bei Druckfehler während Druck in Queue
 *   }
 */
class PrintQueue {
  constructor(config = {}) {
    const q = config.printQueue || {};
    this.maxRetries        = q.maxRetries        ?? 5;
    this.maxAgeMs          = q.maxAgeMs          ?? 1800000;
    this.retryDelayMs      = q.retryDelayMs      ?? 30000;
    this.retryOnPrintError = q.retryOnPrintError !== false;

    this._queue   = [];   // Array von QueueEntry
    this._timer   = null;
    this._running = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Job in Queue aufnehmen.
   * @param {object} job         — angereicherter Job (enrichedJob)
   * @param {string} reason      — Grund für Fehlschlag
   * @param {boolean} printError — true wenn Fehler während des Drucks
   */
  enqueue(job, reason, printError = false) {
    if (printError && !this.retryOnPrintError) {
      logger.warn(`Queue: Job ${job.id} nicht aufgenommen (retryOnPrintError=false): ${reason}`);
      return false;
    }

    const existing = this._queue.find(e => e.job.id === job.id);
    if (existing) {
      logger.debug(`Queue: Job ${job.id} bereits in Queue`);
      return false;
    }

    const entry = {
      job,
      reason,
      printError,
      enqueuedAt: Date.now(),
      attempts:   0,
    };

    this._queue.push(entry);
    logger.warn(`Queue: Job ${job.id} aufgenommen (${reason}) | Queue-Grösse: ${this._queue.length}`);
    return true;
  }

  get size() {
    return this._queue.length;
  }

  get isEmpty() {
    return this._queue.length === 0;
  }

  /**
   * Alle Jobs in der Queue drucken.
   * Wird aufgerufen wenn Drucker wieder bereit ist.
   * @param {function} printFn — async (job) => void
   * @param {function} onExpired — async (job) => void (optional, bei verworfenen Jobs)
   */
  async flush(printFn, onExpired = null) {
    if (this.isEmpty) return;

    logger.info(`Queue: ${this._queue.length} Job(s) werden nachgedruckt...`);

    const toProcess = [...this._queue];
    this._queue = [];

    for (const entry of toProcess) {
      // Alter prüfen
      const age = Date.now() - entry.enqueuedAt;
      if (age > this.maxAgeMs) {
        logger.warn(`Queue: Job ${entry.job.id} verworfen (zu alt: ${Math.round(age / 60000)}min)`);
        if (onExpired) await onExpired(entry.job).catch(() => {});
        continue;
      }

      // Max. Versuche prüfen
      if (entry.attempts >= this.maxRetries) {
        logger.warn(`Queue: Job ${entry.job.id} verworfen (max. Versuche: ${entry.attempts})`);
        if (onExpired) await onExpired(entry.job).catch(() => {});
        continue;
      }

      entry.attempts++;

      try {
        logger.info(`Queue: Drucke Job ${entry.job.id} (Versuch ${entry.attempts}/${this.maxRetries})`);
        await printFn(entry.job);
        logger.info(`Queue: Job ${entry.job.id} erfolgreich nachgedruckt`);
      } catch (err) {
        logger.error(`Queue: Job ${entry.job.id} fehlgeschlagen: ${err.message}`);
        // Zurück in Queue
        this._queue.push(entry);
      }
    }

    if (!this.isEmpty) {
      logger.warn(`Queue: ${this._queue.length} Job(s) verbleiben in Queue`);
    }
  }

  /**
   * Abgelaufene und erschöpfte Jobs bereinigen ohne zu drucken.
   */
  cleanup() {
    const before = this._queue.length;
    this._queue = this._queue.filter(entry => {
      const age = Date.now() - entry.enqueuedAt;
      if (age > this.maxAgeMs) {
        logger.warn(`Queue: Job ${entry.job.id} bereinigt (zu alt)`);
        return false;
      }
      if (entry.attempts >= this.maxRetries) {
        logger.warn(`Queue: Job ${entry.job.id} bereinigt (max. Versuche)`);
        return false;
      }
      return true;
    });
    if (before !== this._queue.length) {
      logger.info(`Queue: ${before - this._queue.length} Job(s) bereinigt`);
    }
  }

  status() {
    return {
      size:    this._queue.length,
      entries: this._queue.map(e => ({
        jobId:      e.job.id,
        reason:     e.reason,
        attempts:   e.attempts,
        ageSeconds: Math.round((Date.now() - e.enqueuedAt) / 1000),
      })),
    };
  }
}

module.exports = { PrintQueue };
