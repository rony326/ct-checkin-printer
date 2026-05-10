'use strict';

const { churchtoolsClient } = require('@churchtools/churchtools-client');
const tough      = require('tough-cookie');
const { logger } = require('./logger');

const SESSION_TTL_MS   = 23 * 60 * 60 * 1000;
const RENEWAL_RETRY_MS =  5 * 60 * 1000;

class ChurchToolsClient {
  constructor(baseUrl, username, password) {
    this.baseUrl  = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;

    this._loggedIn      = false;
    this._renewalTimer  = null;
    this._activePollers = 0;

    this._cookieJar = new tough.CookieJar();
    this._setupInterceptors();
    churchtoolsClient.setBaseUrl(this.baseUrl);
  }

  // ── Interceptors ───────────────────────────────────────────────────────────

  _setupInterceptors() {
    const jar  = this._cookieJar;
    const base = this.baseUrl;
    const ax   = churchtoolsClient.ax;

    ax.interceptors.request.use(async config => {
      const url     = base + (config.url || '');
      const cookies = await jar.getCookies(url);
      if (cookies.length > 0) {
        config.headers        = config.headers || {};
        config.headers.Cookie = cookies.map(c => c.cookieString()).join('; ');
      }
      return config;
    });

    ax.interceptors.response.use(
      async response => {
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          const url = base + (response.config.url || '');
          for (const c of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
            await jar.setCookie(c, url).catch(() => {});
          }
        }
        return response;
      },
      async error => {
        if (error.response?.status === 401 && this._loggedIn) {
          logger.warn('401 Unauthorized — versuche Re-Login...');
          try {
            await this._doLogin();
            return ax(error.config);
          } catch (loginErr) {
            logger.error('Re-Login fehlgeschlagen:', this._extractMessage(loginErr));
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // ── Fehler-Nachricht extrahieren ───────────────────────────────────────────

  /**
   * Extrahiert eine lesbare Fehlermeldung aus beliebigen Error-Objekten.
   * Der churchtoolsClient wirft manchmal Strings, Objekte oder Errors.
   */
  _extractMessage(err) {
    if (!err) return 'Unbekannter Fehler';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    // Axios-Fehler: response.data kann die CT-Fehlermeldung enthalten
    if (err.response?.data?.message) return err.response.data.message;
    if (err.response?.data?.translatedMessage) return err.response.data.translatedMessage;
    if (err.response?.status) return `HTTP ${err.response.status}`;
    // Fallback: gesamtes Objekt serialisieren
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  _extractStatusCode(err) {
    return err?.response?.status ?? err?.status ?? null;
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async _doLogin() {
    const result = await churchtoolsClient.post('/login', {
      username: this.username,
      password: this.password,
    });
    if (result?.status === 'success' || result?.personId) {
      this._loggedIn = true;
      logger.info(`✅ Login erfolgreich (personId: ${result.personId})`);
      return true;
    }
    throw new Error('Login-Antwort unerwartet: ' + JSON.stringify(result));
  }

  async testLogin() {
    logger.info(`Teste Credentials: ${this.username}...`);
    try {
      await this._doLogin();
      logger.info('Credentials OK — Session-Renewal startet wenn Zeitfenster öffnet');
    } catch (err) {
      logger.error('Login fehlgeschlagen:', this._extractMessage(err));
      throw err;
    }
  }

  async ensureLogin() {
    this._activePollers++;
    if (this._activePollers === 1) {
      if (!this._loggedIn) {
        logger.info('Zeitfenster geöffnet — stelle Session her...');
        await this._doLogin();
      }
      this._startRenewal();
    }
  }

  onWindowClose() {
    this._activePollers = Math.max(0, this._activePollers - 1);
    if (this._activePollers === 0) {
      logger.info('Alle Zeitfenster geschlossen — Session-Renewal pausiert');
      this._stopRenewal();
    }
  }

  // ── Session Renewal ────────────────────────────────────────────────────────

  _startRenewal() {
    this._stopRenewal();
    logger.debug(`Session-Renewal geplant in ${SESSION_TTL_MS / 3600000}h`);
    this._renewalTimer = setTimeout(() => this._renew(), SESSION_TTL_MS);
  }

  _stopRenewal() {
    if (this._renewalTimer) {
      clearTimeout(this._renewalTimer);
      this._renewalTimer = null;
    }
  }

  async _renew() {
    logger.info('🔄 Session-Renewal (23h)...');
    try {
      await this._doLogin();
      this._startRenewal();
    } catch (err) {
      logger.error('Session-Renewal fehlgeschlagen:', this._extractMessage(err));
      this._renewalTimer = setTimeout(() => this._renew(), RENEWAL_RETRY_MS);
    }
  }

  // ── API ────────────────────────────────────────────────────────────────────

  async callOldApi(func, params, actionDescription) {
    try {
      logger.debug(`oldApi: func=${func}`, JSON.stringify(params));
      const data = await churchtoolsClient.oldApi('churchcheckin/ajax', func, params || {});
      return { success: true, data };
    } catch (err) {
      const message    = this._extractMessage(err);
      const statusCode = this._extractStatusCode(err);

      // Vollständigen Fehler im Debug loggen für bessere Diagnose
      logger.debug(`${func} Fehler-Detail:`, JSON.stringify({
        message,
        statusCode,
        responseData: err?.response?.data,
        errType: typeof err,
        errKeys: err && typeof err === 'object' ? Object.keys(err) : null,
      }));

      logger.error(`${func} fehlgeschlagen (${actionDescription}): ${message}${statusCode ? ` [HTTP ${statusCode}]` : ''}`);

      return {
        success:    false,
        message,
        statusCode,
      };
    }
  }

  async getNextPrinterJob(hostname) {
    return this.callOldApi('getNextPrinterJob', { ort: hostname }, 'beim Abrufen des Druckauftrags');
  }

  async activatePrinter(hostname, printerName) {
    return this.callOldApi('activatePrinter', { ort: hostname, bezeichnung: printerName }, 'beim Aktivieren des Druckers');
  }

  async hidePrinter(hostname) {
    return this.callOldApi('hidePrinter', { ort: hostname }, 'beim Entfernen des Druckers');
  }
}

module.exports = { ChurchToolsClient };