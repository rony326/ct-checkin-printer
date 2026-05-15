'use strict';

const { spawn }        = require('child_process');
const path             = require('path');
const crypto           = require('crypto');
const { logger }       = require('./logger');
const { checkPrinter } = require('./printer-checker');

/**
 * LabelRouter — verwaltet das Routing von Etiketten auf physische Drucker.
 *
 * Routing-Modus wird aktiviert wenn ein Drucker-Eintrag `labels{}` statt
 * `printerHost` direkt enthält.
 *
 * Konfiguration in config.js:
 *   {
 *     hostname: 'B2',
 *     printerName: 'Minis',
 *     labels: {
 *       parent: {
 *         printerHost: '192.168.1.50',
 *         printerPort: 9100,
 *         labelType:   '54',
 *         layoutFile:  './layout-parent.json',
 *         rotate:      '0',      // '0' | '90' | '180' | '270'
 *         enabled:     true,
 *         copies:      1,
 *       },
 *       child: {
 *         printerHost: '192.168.1.51',
 *         printerPort: 9100,
 *         labelType:   '60x86',
 *         layoutFile:  './layout-child.json',
 *         rotate:      '0',
 *         enabled:     true,
 *         copies:      1,
 *       },
 *     },
 *   }
 */
class LabelRouter {
  constructor(config = {}) {
    this.labels      = config.LABEL_ROUTES || {};   // type → route config
    this.fieldMapping = config.FIELD_MAPPING || null;
    this.dryRun      = config.DRY_RUN === 'true' || false;
    this.script      = path.resolve(__dirname, '..', 'print_label.py');
    this.mappingFile = path.resolve(__dirname, '..', config.MAPPING_FILE || 'field-mapping.json');
    this.layoutFile  = path.resolve(__dirname, '..', config.LAYOUT_FILE  || 'label-layout.json');
  }

  // ── QR-Hash ───────────────────────────────────────────────────────────────

  _generateQrHash(id, code, timestamp) {
    return crypto.createHash('sha1').update(String(id) + String(code) + String(timestamp)).digest('hex');
  }

  // ── Jobs anreichern ───────────────────────────────────────────────────────

  _enrichJob(job) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sep       = this.fieldMapping?.separator || '=';
    const fields    = {};

    (job.data || '').split('\n').forEach(line => {
      const idx = line.indexOf(sep);
      if (idx !== -1) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });

    const id      = fields.id   || '';
    const code    = fields.code || '';
    const qr_hash = (id && code) ? this._generateQrHash(id, code, timestamp) : null;

    return { ...job, unix_timestamp: timestamp, parsed_fields: fields, qr_hash };
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  /**
   * Gibt alle physischen Drucker-Hosts zurück die im Routing verwendet werden.
   * Dedupliziert — gleicher Host kann für mehrere Label-Typen verwendet werden.
   */
  getUniqueHosts() {
    const seen = new Set();
    const hosts = [];
    for (const [type, route] of Object.entries(this.labels)) {
      if (!route.enabled) continue;
      const key = `${route.printerHost}:${route.printerPort || 9100}`;
      if (!seen.has(key)) {
        seen.add(key);
        hosts.push({ host: route.printerHost, port: route.printerPort || 9100, type });
      }
    }
    return hosts;
  }

  /**
   * Gibt die Route für einen bestimmten Label-Typ zurück.
   * null wenn nicht konfiguriert oder deaktiviert.
   */
  getRoute(labelType) {
    const route = this.labels[labelType];
    if (!route || !route.enabled) return null;
    return route;
  }

  // ── Druck ─────────────────────────────────────────────────────────────────

  /**
   * Verarbeitet einen Array von CT-Jobs und routet jeden auf den richtigen Drucker.
   * Gibt { enriched, failed } zurück.
   *
   * Jobs mit gleichem Drucker werden sequenziell gedruckt,
   * Jobs auf verschiedenen Druckern parallel.
   */
  async printJobs(jobs) {
    const validJobs = (Array.isArray(jobs) ? jobs : [jobs]).filter(j => j?.data?.trim());
    if (validJobs.length === 0) throw new Error('Keine druckbaren Daten');

    const enriched = validJobs.map(j => this._enrichJob(j));
    const failed   = [];

    // Jobs nach Drucker gruppieren
    const byHost = new Map(); // "host:port" → [{enrichedJob, route, copies}]

    for (const job of enriched) {
      const labelType = job.parsed_fields?.type || 'unknown';
      const route     = this.getRoute(labelType);

      if (!route) {
        logger.warn(`Kein Route für Label-Typ "${labelType}" — Job ${job.id} übersprungen`);
        continue;
      }

      const hostKey = `${route.printerHost}:${route.printerPort || 9100}`;
      if (!byHost.has(hostKey)) byHost.set(hostKey, []);
      byHost.get(hostKey).push({ job, route });
    }

    // Alle Drucker parallel bedienen
    await Promise.all(
      Array.from(byHost.entries()).map(async ([hostKey, items]) => {
        for (const { job, route } of items) {
          const copies = route.copies || 1;
          for (let c = 1; c <= copies; c++) {
            if (copies > 1) logger.info(`Drucke Kopie ${c}/${copies} für Job ${job.id}`);
            try {
              await this._printSingle(job, route);
            } catch (err) {
              logger.error(`Druckfehler Job ${job.id} auf ${hostKey}: ${err.message}`);
              failed.push({ job, reason: err.message, printError: true });
            }
          }
        }
      })
    );

    return { enriched, failed };
  }

  /**
   * Druckt einen einzelnen Job auf einen Drucker (für Queue-Retry).
   */
  async printSingleJob(job) {
    const labelType = job.parsed_fields?.type || 'unknown';
    const route     = this.getRoute(labelType);
    if (!route) throw new Error(`Keine Route für Label-Typ "${labelType}"`);
    await this._printSingle(job, route);
  }

  async _printSingle(job, route) {
    // Layout kommt immer aus der globalen label-layout.json
    // Der Etikettentyp (parent/child/leader etc.) wird als Key verwendet
    const layoutFile = path.resolve(this.layoutFile || './label-layout.json');
    const args = [
      this.script,
      '--host',   route.printerHost,
      '--port',   String(route.printerPort || 9100),
      '--label',  route.labelType || '54',
      '--layout', layoutFile,
      '--rotate', route.rotate || '0',
    ];

    if (this.fieldMapping) {
      args.push('--mapping-json', JSON.stringify(this.fieldMapping));
    } else {
      args.push('--mapping', this.mappingFile);
    }

    if (this.dryRun) args.push('--dry-run');

    logger.info(`Routing: Job ${job.id} (${job.parsed_fields?.type}) → ${route.printerHost}:${route.printerPort || 9100} (${route.labelType || '54'})`);
    logger.debug('Python:', args.slice(1).join(' '));

    return new Promise((resolve, reject) => {
      const proc = spawn('python3', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';

      proc.stderr.on('data', d => {
        const line = d.toString().trim();
        if (line) { stderr += line + '\n'; logger.debug('[py] ' + line); }
      });
      proc.stdout.on('data', d => logger.debug('[py-out] ' + d.toString().trim()));
      proc.on('error', err => reject(new Error('Python-Start: ' + err.message)));
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('print_label.py exit ' + code + ':\n' + stderr));
      });

      proc.stdin.write(JSON.stringify([job]));
      proc.stdin.end();
    });
  }

  // ── Drucker-Check (Routing-Modus) ─────────────────────────────────────────

  /**
   * Prüft alle physischen Drucker dieses Standorts.
   * Im Routing-Modus müssen ALLE bereit sein bevor angemeldet wird.
   */
  async checkAllPrinters(timeoutMs = 5000) {
    const hosts  = this.getUniqueHosts();
    const results = await Promise.all(
      hosts.map(async ({ host, port }) => {
        const status = await checkPrinter(host, port, timeoutMs);
        return { host, port, status };
      })
    );
    return results;
  }
}

module.exports = { LabelRouter };