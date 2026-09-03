import ippModule from 'ipp';
import type { PrinterStateReasons } from 'ipp';
import type { DocumentPrinterAdapter, DocumentPrinterConnectionConfig, PrintResult, PrinterStatusResult } from '../printer/types.js';
import { PrinterStatus } from '../printer/types.js';

// Named-Import ("import { Printer } from 'ipp'") funktioniert im Typecheck
// und unter Vitest (Vite löst CJS-Named-Exports synthetisch auf), aber nicht
// unter echtem Node-ESM: `ipp` ist ein reines CJS-Paket, dessen
// `module.exports`-Objekt Node's cjs-module-lexer nicht zuverlässig in
// benannte Exports zerlegen kann — nur `default` (das komplette
// module.exports-Objekt) ist zuverlässig da. Exakt derselbe Stolperstein wie
// bei `@churchtools/churchtools-client`, siehe ChurchToolsOldApiClient.ts;
// hier erst beim echten Server-Start aufgefallen ("SyntaxError: The
// requested module 'ipp' does not provide an export named 'Printer'"), nicht
// im Testlauf.
const { Printer: IppPrinter } = ippModule;
type IppPrinter = InstanceType<typeof ippModule.Printer>;

export interface IppAdapterOptions {
  printerLabel?: string;
}

/**
 * `DocumentPrinterAdapter`-Implementierung für A4/Büro-Netzwerkdrucker über
 * IPP (siehe Plan, Drucker-Adapter-Layer) — ausschliesslich für den
 * Gruppen-Sammelausdruck (Bauschritt 10), kein Bezug zum
 * `LabelPrinterAdapter`-Pfad. Nutzt das `ipp`-npm-Paket 1:1 (reines
 * HTTP-POST-basiertes Protokoll, kein eigener Rohbild-Kanal nötig).
 */
export class IppAdapter implements DocumentPrinterAdapter {
  readonly protocol = 'ipp' as const;
  private printer: IppPrinter | null = null;
  private readonly printerLabel: string;

  constructor(opts: IppAdapterOptions = {}) {
    this.printerLabel = opts.printerLabel ?? 'Netzwerkdrucker';
  }

  async connect(cfg: DocumentPrinterConnectionConfig): Promise<void> {
    this.printer = new IppPrinter(`http://${cfg.host}:${cfg.port}/${cfg.ippQueue}`);
  }

  async printDocument(pdf: Buffer, opts: { copies?: number }): Promise<PrintResult> {
    const printer = this.requirePrinter();
    return new Promise((resolve) => {
      printer.execute(
        'Print-Job',
        {
          'operation-attributes-tag': {
            'requesting-user-name': 'ct-checkin-printer',
            'job-name': 'Sammelausdruck',
            'document-format': 'application/pdf',
          },
          'job-attributes-tag': opts.copies && opts.copies > 1 ? { copies: opts.copies } : undefined,
          data: pdf,
        },
        (err, res) => {
          if (err) return resolve({ success: false, errorMessage: err.message });
          if (res.statusCode.startsWith('successful')) return resolve({ success: true });
          resolve({ success: false, errorMessage: `IPP-Fehler: ${res.statusCode}` });
        },
      );
    });
  }

  async getStatus(): Promise<PrinterStatusResult> {
    const printer = this.requirePrinter();
    return new Promise((resolve) => {
      printer.execute(
        'Get-Printer-Attributes',
        { 'operation-attributes-tag': { 'requesting-user-name': 'ct-checkin-printer' } },
        (err, res) => {
          if (err) {
            resolve({
              status: PrinterStatus.OFFLINE,
              humanMessage: `Drucker „${this.printerLabel}" ist nicht erreichbar: ${err.message}`,
              source: 'http',
              timestamp: new Date(),
            });
            return;
          }
          resolve(this.mapStatus(res));
        },
      );
    });
  }

  private mapStatus(res: { statusCode: string; 'printer-attributes-tag'?: object }): PrinterStatusResult {
    const attrs = (res['printer-attributes-tag'] ?? {}) as {
      'printer-state'?: 'idle' | 'processing' | 'stopped';
      'printer-state-reasons'?: PrinterStateReasons[];
    };
    // Die `ipp`-Bibliothek liefert ein mehrwertiges Attribut mit genau einem
    // Wert als nackten String statt als Array-mit-einem-Element zurück —
    // beide Formen hier normalisieren, statt uns auf eines zu verlassen.
    const reasonsRaw = attrs['printer-state-reasons'];
    const reasons = Array.isArray(reasonsRaw) ? reasonsRaw : reasonsRaw ? [reasonsRaw] : [];
    const has = (needle: string) => reasons.some((r) => r.includes(needle));

    const result = (status: PrinterStatus, humanMessage: string): PrinterStatusResult => ({
      status,
      humanMessage,
      source: 'http',
      raw: res,
      timestamp: new Date(),
    });

    if (!res.statusCode.startsWith('successful')) {
      return result(PrinterStatus.ERROR, `Drucker „${this.printerLabel}": IPP-Fehler (${res.statusCode}).`);
    }
    if (has('media-empty')) return result(PrinterStatus.PAPER_EMPTY, `Drucker „${this.printerLabel}" hat kein Papier mehr.`);
    if (has('cover-open') || has('door-open')) return result(PrinterStatus.COVER_OPEN, `Drucker „${this.printerLabel}": Abdeckung ist offen.`);
    if (has('toner-empty') || has('marker-supply-empty')) return result(PrinterStatus.ERROR, `Drucker „${this.printerLabel}" hat kein Toner/Verbrauchsmaterial mehr.`);
    if (attrs['printer-state'] === 'stopped') return result(PrinterStatus.ERROR, `Drucker „${this.printerLabel}" ist gestoppt.`);
    return result(PrinterStatus.ONLINE, `Drucker „${this.printerLabel}" ist bereit.`);
  }

  private requirePrinter(): IppPrinter {
    if (!this.printer) throw new Error('IppAdapter: connect() wurde nicht aufgerufen');
    return this.printer;
  }
}
