'use strict';

const https      = require('https');
const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const { logger } = require('./logger');

/**
 * WebhookService — sendet den angereicherten Job-Payload an eine oder
 * mehrere konfigurierbare URLs.
 *
 * Konfiguration:
 *   webhooks.json  — Liste der Webhook-Ziele (extern, pro Eintrag konfigurierbar)
 *   .env:
 *     WEBHOOKS_FILE        = ./webhooks.json   (Pfad zur Konfigurationsdatei)
 *     WEBHOOKS_ENABLED     = true              (globaler Schalter)
 *     WEBHOOK_RETRY        = 3                 (globaler Default)
 *     WEBHOOK_RETRY_MS     = 2000
 *     WEBHOOK_BLOCK_PRINT  = false
 */
class WebhookService {
  constructor(config = {}) {
    this.globalEnabled  = (config.WEBHOOKS_ENABLED  || 'true') === 'true';
    this.blockPrint     = (config.WEBHOOK_BLOCK_PRINT || 'false') === 'true';
    this.defaultRetry   = parseInt(config.WEBHOOK_RETRY    || '3',    10);
    this.defaultRetryMs = parseInt(config.WEBHOOK_RETRY_MS || '2000', 10);

    this.targets = this.globalEnabled
      ? this._loadTargets(config.WEBHOOKS_FILE || './webhooks.json')
      : [];

    this.enabled = this.targets.length > 0;
  }

  _loadTargets(filePath) {
    const resolved = path.resolve(filePath);

    if (!fs.existsSync(resolved)) {
      logger.debug(`webhooks.json nicht gefunden: ${resolved} — Webhook deaktiviert`);
      return [];
    }

    let list;
    try {
      list = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (err) {
      logger.error(`webhooks.json ungültig: ${err.message}`);
      return [];
    }

    if (!Array.isArray(list)) {
      logger.error('webhooks.json muss ein Array sein');
      return [];
    }

    const active = list.filter(t => t.url && t.enabled !== false);

    if (active.length === 0) {
      logger.info('Webhook: keine aktiven Einträge in webhooks.json');
      return [];
    }

    logger.info(`Webhook: ${active.length} Ziel(e) geladen aus ${resolved}`);

    return active.map(t => ({
      url:     t.url,
      method:  (t.method  || 'POST').toUpperCase(),
      secret:  t.secret   || null,
      retry:   parseInt(t.retry    ?? this.defaultRetry,   10),
      retryMs: parseInt(t.retry_ms ?? this.defaultRetryMs, 10),
      name:    t.name || t.url,
    }));
  }

  buildPayload(enrichedJobs, printerDef) {
    return {
      event:     'checkin.printed',
      timestamp: enrichedJobs[0]?.unix_timestamp || Math.floor(Date.now() / 1000),
      printer: {
        hostname: printerDef.hostname,
        name:     printerDef.printerName,
        host:     printerDef.printerHost,
      },
      labels: enrichedJobs.map(job => ({
        ct_job_id:      job.id,
        label_type:     job.parsed_fields?.type || 'unknown',
        unix_timestamp: job.unix_timestamp,
        qr_hash:        job.qr_hash,
        fields:         job.parsed_fields || {},
      })),
    };
  }

  async send(enrichedJobs, printerDef) {
    if (!this.enabled) return;

    const payload = this.buildPayload(enrichedJobs, printerDef);

    const sends = this.targets.map(target =>
      this._sendToTarget(target, payload)
        .catch(err => logger.error(`Webhook "${target.name}" endgültig fehlgeschlagen: ${err.message}`))
    );

    if (this.blockPrint) {
      await Promise.all(sends);
    }
    // non-blocking: Promises laufen im Hintergrund
  }

  async _sendToTarget(target, payload) {
    const body = JSON.stringify(payload);
    let lastError;

    for (let attempt = 1; attempt <= target.retry; attempt++) {
      try {
        const statusCode = await this._post(target, body);

        if (statusCode >= 200 && statusCode < 300) {
          logger.info(`✅ Webhook "${target.name}" gesendet (HTTP ${statusCode})`);
          return;
        }

        lastError = new Error(`HTTP ${statusCode}`);
        logger.warn(`Webhook "${target.name}" Versuch ${attempt}/${target.retry}: HTTP ${statusCode}`);

      } catch (err) {
        lastError = err;
        logger.warn(`Webhook "${target.name}" Versuch ${attempt}/${target.retry}: ${err.message}`);
      }

      if (attempt < target.retry) {
        await this._sleep(target.retryMs);
      }
    }

    throw new Error(`Nach ${target.retry} Versuchen: ${lastError?.message}`);
  }

  _post(target, body) {
    return new Promise((resolve, reject) => {
      const url     = new URL(target.url);
      const headers = {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'churchtools-checkin-printer/1.0',
      };
      if (target.secret) {
        headers['Authorization'] = `Bearer ${target.secret}`;
      }

      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(url, { method: target.method, headers }, res => {
        res.resume();
        resolve(res.statusCode);
      });

      req.on('error', reject);
      req.setTimeout(10_000, () => req.destroy(new Error('Timeout (10s)')));
      req.write(body);
      req.end();
    });
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { WebhookService };
