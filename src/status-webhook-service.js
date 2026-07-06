'use strict';

const https           = require('https');
const http            = require('http');
const fs              = require('fs');
const path            = require('path');
const { logger }      = require('./logger');
const { resolveSecret } = require('./secrets');
const { requireBoolean } = require('./validate');

/**
 * StatusWebhookService — separater Webhook nur für Drucker-Status-Events.
 *
 * Konfiguration in config.js:
 *   statusWebhooks: [
 *     {
 *       name:    'Alert',
 *       url:     'https://meinserver.ch/printer/alert',
 *       method:  'POST',       // POST oder PUT
 *       secret:  'env:STATUS_WEBHOOK_SECRET', // Bearer-Token, aus .env (optional)
 *       retry:   3,            // Anzahl Versuche
 *       retryMs: 2000,         // Wartezeit zwischen Versuchen
 *       enabled: true,
 *     }
 *   ]
 *
 * Events:
 *   printer.error        — kritischer Fehler (Deckel offen, Band leer etc.)
 *   printer.warning      — Warnung
 *   printer.ready        — Drucker wieder bereit (nach Fehler)
 *   printer.job_expired  — Job aus Retry-Queue verworfen (maxRetries/maxAgeMs erreicht)
 *   printer.fatal        — MAX_ERRORS erreicht, Poller pausiert und erholt sich automatisch
 */
class StatusWebhookService {
  constructor(config = {}) {
    this.defaultRetry   = parseInt(config.WEBHOOK_RETRY    || '3',    10);
    this.defaultRetryMs = parseInt(config.WEBHOOK_RETRY_MS || '2000', 10);
    this.targets        = this._loadTargets(config.STATUS_WEBHOOKS_RAW || []);
    this.enabled        = this.targets.length > 0;
  }

  _loadTargets(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const withoutComments = raw.filter(t => !t._comment);
    const active = withoutComments.filter(t => {
      const enabled = requireBoolean(t.enabled, `statusWebhooks["${t.name || t.url}"].enabled`, true);
      return t.url && enabled;
    });
    if (active.length === 0) return [];

    logger.info(`Status-Webhook: ${active.length} Ziel(e) aktiv`);

    return active.map(t => ({
      url:     t.url,
      method:  (t.method  || 'POST').toUpperCase(),
      secret:  resolveSecret(t.secret) || null,
      retry:   parseInt(t.retry   ?? this.defaultRetry,   10),
      retryMs: parseInt(t.retryMs ?? t.retry_ms ?? this.defaultRetryMs, 10),
      name:    t.name || t.url,
    }));
  }

  /**
   * Sendet ein Drucker-Status-Event an alle konfigurierten Ziele.
   */
  async send(event, printerDef, status) {
    if (!this.enabled) return;

    const payload = {
      event,     // 'printer.error' | 'printer.warning' | 'printer.ready'
      timestamp: Math.floor(Date.now() / 1000),
      printer: {
        name:     printerDef.printerName,
        hostname: printerDef.hostname,
        host:     printerDef.printerHost,
        port:     printerDef.printerPort,
      },
      status: {
        reachable: status.reachable,
        ok:        status.ok,
        errors:    status.errors,
        warnings:  status.warnings,
        raw:       status.raw,
      },
    };

    // Fire & forget — blockiert nicht
    Promise.all(
      this.targets.map(target =>
        this._sendToTarget(target, payload)
          .catch(err => logger.error(`Status-Webhook "${target.name}" fehlgeschlagen: ${err.message}`))
      )
    );
  }

  async _sendToTarget(target, payload) {
    const body = JSON.stringify(payload);
    let lastError;

    for (let attempt = 1; attempt <= target.retry; attempt++) {
      try {
        const statusCode = await this._post(target, body);
        if (statusCode >= 200 && statusCode < 300) {
          logger.info(`Status-Webhook "${target.name}" gesendet (HTTP ${statusCode})`);
          return;
        }
        lastError = new Error(`HTTP ${statusCode}`);
        logger.warn(`Status-Webhook "${target.name}" Versuch ${attempt}/${target.retry}: HTTP ${statusCode}`);
      } catch (err) {
        lastError = err;
        logger.warn(`Status-Webhook "${target.name}" Versuch ${attempt}/${target.retry}: ${err.message}`);
      }
      if (attempt < target.retry) await this._sleep(target.retryMs);
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
      if (target.secret) headers['Authorization'] = `Bearer ${target.secret}`;

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

module.exports = { StatusWebhookService };