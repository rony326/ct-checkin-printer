'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const { logger } = require('./logger');

/**
 * PrinterManager — übergibt Jobs an print_label.py (Python).
 * Das Python-Script rendert Text → PNG → Brother Raster → TCP.
 */
class PrinterManager {
  constructor(host, port, config = {}) {
    this.host      = host;
    this.port      = port;
    this.labelType = config.LABEL_TYPE || '54';
    this.dryRun    = config.DRY_RUN === 'true' || false;
    this.script    = path.resolve(__dirname, '..', 'print_label.py');
  }

  /**
   * Druckt einen oder mehrere Jobs (Array oder einzelnes Objekt).
   * CT liefert ein Array — wir senden alles auf einmal ans Python-Script.
   */
  async printJob(jobData) {
    const jobs = Array.isArray(jobData) ? jobData : [jobData];

    const validJobs = jobs.filter(j => j?.data?.trim());
    if (validJobs.length === 0) {
      throw new Error('Keine druckbaren Daten im Job');
    }

    logger.info(`Drucke ${validJobs.length} Etikett(en) auf ${this.host}:${this.port}`);
    validJobs.forEach((j, i) => {
      logger.debug(`  Etikett ${i+1}: ${j.data?.slice(0, 60).replace(/\n/g, ' ↵ ')}...`);
    });

    await this._runPython(JSON.stringify(validJobs));
    logger.info(`✅ ${validJobs.length} Etikett(en) gedruckt`);
  }

  _runPython(jsonInput) {
    return new Promise((resolve, reject) => {
      const args = [
        this.script,
        '--host',  this.host,
        '--port',  String(this.port),
        '--label', this.labelType,
      ];
      if (this.dryRun) args.push('--dry-run');

      logger.debug('Python-Aufruf:', args.join(' '));

      const proc = spawn('python3', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', d => {
        const line = d.toString().trim();
        if (line) {
          stderr += line + '\n';
          logger.debug('[python] ' + line);
        }
      });
      proc.stdout.on('data', d => logger.debug('[python-out] ' + d.toString().trim()));

      proc.on('error', err => reject(new Error('Python-Start fehlgeschlagen: ' + err.message)));
      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('print_label.py Fehler (exit ' + code + '):\n' + stderr));
        }
      });

      proc.stdin.write(jsonInput);
      proc.stdin.end();
    });
  }

  /** Einfacher Verbindungstest: prüft ob python3 und print_label.py vorhanden */
  async testConnection() {
    return new Promise((resolve) => {
      const proc = spawn('python3', [this.script, '--help'], { stdio: 'pipe' });
      proc.on('close', code => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}

module.exports = { PrinterManager };
