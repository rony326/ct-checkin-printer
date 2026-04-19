'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const crypto     = require('crypto');
const { logger } = require('./logger');

class PrinterManager {
  constructor(host, port, config = {}) {
    this.host         = host;
    this.port         = port;
    this.labelType    = config.LABEL_TYPE    || '54';
    this.dryRun       = config.DRY_RUN === 'true' || false;
    this.script       = path.resolve(__dirname, '..', 'print_label.py');
    this.layoutFile   = path.resolve(__dirname, '..', config.LAYOUT_FILE  || 'label-layout.json');
    this.mappingFile  = path.resolve(__dirname, '..', config.MAPPING_FILE || 'field-mapping.json');
    this.fieldMapping = config.FIELD_MAPPING || null; // aus config.json (überschreibt Datei)
  }

  generateQrHash(id, code, timestamp) {
    const input = String(id) + String(code) + String(timestamp);
    return crypto.createHash('sha1').update(input).digest('hex');
  }

  enrichJobs(jobs) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sep = this.fieldMapping?.separator || '=';

    return jobs.map(job => {
      const fields = {};
      (job.data || '').split('\n').forEach(line => {
        const idx = line.indexOf(sep);
        if (idx !== -1) {
          fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });

      const id      = fields.id   || '';
      const code    = fields.code || '';
      const qr_hash = (id && code)
        ? this.generateQrHash(id, code, timestamp)
        : null;

      return { ...job, unix_timestamp: timestamp, parsed_fields: fields, qr_hash };
    });
  }

  async printJob(jobData) {
    const jobs  = Array.isArray(jobData) ? jobData : [jobData];
    const valid = jobs.filter(j => j?.data?.trim());
    if (valid.length === 0) throw new Error('Keine druckbaren Daten im Job');

    const enriched = this.enrichJobs(valid);
    enriched.forEach(j => {
      if (j.qr_hash) logger.debug(`QR-Hash für ${j.parsed_fields.name || j.parsed_fields.id}: ${j.qr_hash}`);
    });

    logger.info(`Drucke ${enriched.length} Etikett(en) → ${this.host}:${this.port}`);
    await this._runPython(JSON.stringify(enriched));
    logger.info(`✅ ${enriched.length} Etikett(en) gedruckt`);

    return enriched;
  }

  _runPython(jsonInput) {
    return new Promise((resolve, reject) => {
      const args = [
        this.script,
        '--host',   this.host,
        '--port',   String(this.port),
        '--label',  this.labelType,
        '--layout', this.layoutFile,
      ];

      // Field-Mapping: inline JSON aus config.json hat Vorrang vor Datei
      if (this.fieldMapping) {
        args.push('--mapping-json', JSON.stringify(this.fieldMapping));
      } else {
        args.push('--mapping', this.mappingFile);
      }

      if (this.dryRun) args.push('--dry-run');

      logger.debug('Python:', args.slice(1).join(' '));

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

      proc.stdin.write(jsonInput);
      proc.stdin.end();
    });
  }

  async testConnection() {
    return new Promise(resolve => {
      const proc = spawn('python3', [this.script, '--help'], { stdio: 'pipe' });
      proc.on('close', code => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}

module.exports = { PrinterManager };