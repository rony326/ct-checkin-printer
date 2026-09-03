/**
 * Adapter-Interfaces für Drucker. Zwei getrennte Familien, weil Verbindungsart
 * und Druckmodell grundverschieden sind (siehe Plan, Abschnitt "Drucker-Adapter-Layer"):
 * LabelPrinterAdapter (Rohbild-Raster über TCP, Etiketten) und
 * DocumentPrinterAdapter (IPP, echte Dokumente/PDF, nur für den Sammelausdruck).
 */

export enum PrinterStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  PAPER_EMPTY = 'PAPER_EMPTY',
  COVER_OPEN = 'COVER_OPEN',
  MEDIA_MISMATCH = 'MEDIA_MISMATCH',
  RIBBON_EMPTY = 'RIBBON_EMPTY',
  HEAD_ERROR = 'HEAD_ERROR',
  OVERHEATING = 'OVERHEATING',
  JOB_FAILED = 'JOB_FAILED',
  ERROR = 'ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface PrinterStatusResult {
  status: PrinterStatus;
  /** Laiengerechte Meldung, z.B. "Drucker „Empfang" hat kein Papier mehr". */
  humanMessage: string;
  source: 'print-channel' | 'http';
  raw?: unknown;
  timestamp: Date;
}

export interface MediaDefinition {
  id: string;
  vendor: 'brother-ql' | 'zebra-zpl';
  name: string;
  widthMm: number;
  /** null = Endlosmaterial */
  heightMm: number | null;
  printableAreaMm: { width: number; height: number };
  dieCut: boolean;
}

export interface PrinterConnectionConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

export interface PrintOptions {
  copies: number;
  rotate: '0' | '90' | '180' | '270';
  /** speichert das Etikett nur als PNG statt zu drucken (v1-Feature, siehe README "DRY_RUN"). */
  dryRun?: boolean;
}

export interface RenderedBitmap {
  /** 1-bit/Graustufen-Bilddaten, von LabelRenderer erzeugt (node-canvas), pixel-exakt für die Media-DPI. */
  data: Buffer;
  widthPx: number;
  heightPx: number;
}

export interface PrintResult {
  success: boolean;
  errorMessage?: string;
}

export interface LabelPrinterAdapter {
  readonly vendor: 'brother-ql' | 'zebra-zpl';
  connect(cfg: PrinterConnectionConfig): Promise<void>;
  printLabel(bitmap: RenderedBitmap, media: MediaDefinition, opts: PrintOptions): Promise<PrintResult>;
  /** Orchestriert die zweistufige Statusabfrage: primär Druckkanal, optional HTTP-Fallback. */
  getStatus(): Promise<PrinterStatusResult>;
  getStatusFromPrintChannel(): Promise<PrinterStatusResult | null>;
  getStatusFromHttp?(): Promise<PrinterStatusResult | null>;
  listSupportedMedia(): MediaDefinition[];
  detectMedia?(): Promise<MediaDefinition | null>;
}

/** Gemeinsame getStatus()-Orchestrierung für alle LabelPrinterAdapter-Implementierungen. */
export abstract class BaseLabelPrinterAdapter implements Omit<LabelPrinterAdapter, 'vendor'> {
  abstract connect(cfg: PrinterConnectionConfig): Promise<void>;
  abstract printLabel(bitmap: RenderedBitmap, media: MediaDefinition, opts: PrintOptions): Promise<PrintResult>;
  abstract getStatusFromPrintChannel(): Promise<PrinterStatusResult | null>;
  abstract listSupportedMedia(): MediaDefinition[];
  getStatusFromHttp?(): Promise<PrinterStatusResult | null>;
  detectMedia?(): Promise<MediaDefinition | null>;

  async getStatus(): Promise<PrinterStatusResult> {
    try {
      const primary = await this.getStatusFromPrintChannel();
      if (primary) return primary;
    } catch {
      // primäre Quelle nicht verwertbar — Fallback versuchen
    }
    if (this.getStatusFromHttp) {
      try {
        const fallback = await this.getStatusFromHttp();
        if (fallback) return fallback;
      } catch {
        // auch Fallback nicht verwertbar
      }
    }
    return {
      status: PrinterStatus.UNKNOWN,
      humanMessage: 'Druckerstatus konnte nicht ermittelt werden.',
      source: 'print-channel',
      timestamp: new Date(),
    };
  }
}

export interface DocumentPrinterConnectionConfig {
  host: string;
  port: number;
  ippQueue: string;
}

/** Zweite, unabhängige Adapter-Familie — ausschliesslich für den Sammelausdruck-Baustein. */
export interface DocumentPrinterAdapter {
  readonly protocol: 'ipp';
  connect(cfg: DocumentPrinterConnectionConfig): Promise<void>;
  printDocument(pdf: Buffer, opts: { copies?: number }): Promise<PrintResult>;
  getStatus(): Promise<PrinterStatusResult>;
}
