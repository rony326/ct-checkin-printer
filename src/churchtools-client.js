'use strict';

const { churchtoolsClient } = require('@churchtools/churchtools-client');
const tough  = require('tough-cookie');
const { logger } = require('./logger');

/**
 * ChurchToolsClient — nutzt den offiziellen @churchtools/churchtools-client.
 * Login via Username/Passwort mit automatischem Session-Cookie-Handling.
 */
class ChurchToolsClient {
  constructor(baseUrl, username, password) {
    this.baseUrl  = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this._cookieJar = new tough.CookieJar();
    this._setupCookieInterceptor();
    churchtoolsClient.setBaseUrl(this.baseUrl);
  }

  _setupCookieInterceptor() {
    const jar = this._cookieJar;
    const base = this.baseUrl;
    const ax = churchtoolsClient.ax;

    ax.interceptors.request.use(async (config) => {
      const url = base + (config.url || '');
      const cookies = await jar.getCookies(url);
      if (cookies.length > 0) {
        config.headers = config.headers || {};
        config.headers['Cookie'] = cookies.map(c => c.cookieString()).join('; ');
      }
      return config;
    });

    ax.interceptors.response.use(async (response) => {
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        const url = base + (response.config.url || '');
        for (const c of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
          await jar.setCookie(c, url).catch(() => {});
        }
      }
      return response;
    });
  }

  async login() {
    logger.info(`Login als ${this.username}...`);
    try {
      const result = await churchtoolsClient.post('/login', {
        username: this.username,
        password: this.password,
      });
      if (result?.status === 'success' || result?.personId) {
        logger.info(`✅ Login erfolgreich (personId: ${result.personId})`);
        return true;
      }
      throw new Error('Login-Antwort unerwartet: ' + JSON.stringify(result));
    } catch (err) {
      logger.error('Login fehlgeschlagen:', err.message);
      throw err;
    }
  }

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
