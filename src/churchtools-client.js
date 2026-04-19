'use strict';

const { churchtoolsClient } = require('@churchtools/churchtools-client');
const tough      = require('tough-cookie');
const { logger } = require('./logger');

const SESSION_TTL_MS  = 23 * 60 * 60 * 1000; // 23h — CT-Session läuft nach 24h ab
const RENEWAL_RETRY_MS =  5 * 60 * 1000;      // 5min Retry bei fehlgeschlagenem Renewal

/**
 * ChurchToolsClient
 *
 * Login-Verhalten:
 *  - Dienststart: einmaliger Test-Login zur Credential-Prüfung
 *  - Zeitfenster öffnet: Login sicherstellen + Session-Renewal starten
 *  - Zeitfenster schliesst: Renewal pausieren
 *  - 401 Fehler: automatischer Re-Login
 */
class ChurchToolsClient {
  constructor(baseUrl, username, password) {
    this.baseUrl  = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;

    this._loggedIn     = false;
    this._renewalTimer = null;
    this._activePollers = 0; // Anzahl aktiver (nicht-schlafender) Poller

    this._cookieJar = new tough.CookieJar();
    this._setupInterceptors();
    churchtoolsClient.setBaseUrl(this.baseUrl);
  }

  // ── Interceptors ───────────────────────────────────────────────────────────

  _setupInterceptors() {
    const jar  = this._cookieJar;
    const base = this.baseUrl;
    const ax   = churchtoolsClient.ax;

    // Cookie mitsenden
    ax.interceptors.request.use(async config => {
      const url     = base + (config.url || '');
      const cookies = await jar.getCookies(url);
      if (cookies.length > 0) {
        config.headers        = config.headers || {};
        config.headers.Cookie = cookies.map(c => c.cookieString()).join('; ');
      }
      return config;
    });

    // Cookie speichern + 401 → Re-Login
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
            return ax(error.config); // Request wiederholen
          } catch (loginErr) {
            logger.error('Re-Login fehlgeschlagen:', loginErr.message);
          }
        }
        return Promise.reject(error);
      }
    );
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

  /**
   * Einmaliger Test-Login beim Dienststart — prüft Credentials.
   * Startet noch KEIN Session-Renewal.
   */
  async testLogin() {
    logger.info(`Teste Credentials: ${this.username}...`);
    try {
      await this._doLogin();
      logger.info('Credentials OK — Session-Renewal startet wenn Zeitfenster öffnet');
    } catch (err) {
      logger.error('Login fehlgeschlagen:', err.message);
      throw err;
    }
  }

  /**
   * Stellt sicher dass eine aktive Session besteht und startet Renewal.
   * Wird aufgerufen wenn ein Zeitfenster öffnet.
   */
  async ensureLogin() {
    this._activePollers++;
    if (this._activePollers === 1) {
      // Erster aktiver Poller — Session sicherstellen + Renewal starten
      if (!this._loggedIn) {
        logger.info('Zeitfenster geöffnet — stelle Session her...');
        await this._doLogin();
      }
      this._startRenewal();
    }
  }

  /**
   * Signalisiert dass ein Zeitfenster geschlossen wurde.
   * Wenn kein Drucker mehr aktiv ist, wird das Renewal pausiert.
   */
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
      this._startRenewal(); // Nächsten Renewal planen
    } catch (err) {
      logger.error('Session-Renewal fehlgeschlagen:', err.message);
      // In 5min nochmal versuchen
      this._renewalTimer = setTimeout(() => this._renew(), RENEWAL_RETRY_MS);
    }
  }

  // ── API ────────────────────────────────────────────────────────────────────

  async callOldApi(func, params, actionDescription) {
    try {
      logger.debug(`oldApi: func=${func}`, params);
      const data = await churchtoolsClient.oldApi('churchcheckin/ajax', func, params || {});
      return { success: true, data };
    } catch (err) {
      logger.error(`${func} fehlgeschlagen (${actionDescription}):`, err.message);
      return {
        success:    false,
        message:    err.message,
        statusCode: err.response?.status,
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