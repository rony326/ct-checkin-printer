import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BaseLabelPrinterAdapter,
  type MediaDefinition,
  type PrintOptions,
  type PrintResult,
  type PrinterConnectionConfig,
  type PrinterStatusResult,
  type RenderedBitmap,
} from '../types.js';
import { BROTHER_MEDIA } from '../media/brotherMedia.js';
import { detectMediaFromPacket, mapToPrinterStatus, parseStatusPacket, REQUEST_STATUS_COMMAND, STATUS_PACKET_LENGTH } from './statusParser.js';
import { getStatusFromBrotherHttp } from './httpStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RASTER_HELPER = path.join(__dirname, '../../../../python/brother_raster_helper.py');

/** Fragt das 32-Byte-Statuspaket über eine eigene, kurzlebige TCP-Verbindung ab (ESC i S). */
function queryStatusPacket(host: string, port: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = Buffer.alloc(0);

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => {
      cleanup();
      reject(new Error('Status-Anfrage: Timeout'));
    });
    socket.once('error', (err) => {
      cleanup();
      reject(err);
    });
    socket.once('connect', () => {
      socket.write(REQUEST_STATUS_COMMAND);
    });
    socket.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length >= STATUS_PACKET_LENGTH) {
        cleanup();
        resolve(response.subarray(0, STATUS_PACKET_LENGTH));
      }
    });
    socket.connect(port, host);
  });
}

export interface BrotherQlAdapterOptions {
  printerLabel: string;
  pythonBin?: string;
  rasterHelperPath?: string;
}

export class BrotherQlAdapter extends BaseLabelPrinterAdapter {
  readonly vendor = 'brother-ql' as const;
  private host = '';
  private port = 9100;
  private timeoutMs = 5000;
  private readonly printerLabel: string;
  private readonly pythonBin: string;
  private readonly rasterHelperPath: string;

  constructor(opts: BrotherQlAdapterOptions) {
    super();
    this.printerLabel = opts.printerLabel;
    this.pythonBin = opts.pythonBin ?? 'python3';
    this.rasterHelperPath = opts.rasterHelperPath ?? DEFAULT_RASTER_HELPER;
  }

  async connect(cfg: PrinterConnectionConfig): Promise<void> {
    this.host = cfg.host;
    this.port = cfg.port;
    this.timeoutMs = cfg.timeoutMs ?? 5000;
  }

  async getStatusFromPrintChannel(): Promise<PrinterStatusResult | null> {
    const raw = await queryStatusPacket(this.host, this.port, this.timeoutMs);
    const packet = parseStatusPacket(raw);
    return mapToPrinterStatus(packet, this.printerLabel);
  }

  async getStatusFromHttp(): Promise<PrinterStatusResult | null> {
    return getStatusFromBrotherHttp(this.host, this.printerLabel, this.timeoutMs);
  }

  listSupportedMedia(): MediaDefinition[] {
    return BROTHER_MEDIA;
  }

  async detectMedia(): Promise<MediaDefinition | null> {
    const raw = await queryStatusPacket(this.host, this.port, this.timeoutMs);
    const packet = parseStatusPacket(raw);
    return detectMediaFromPacket(packet, this.listSupportedMedia());
  }

  async printLabel(bitmap: RenderedBitmap, media: MediaDefinition, opts: PrintOptions): Promise<PrintResult> {
    for (let copy = 1; copy <= opts.copies; copy++) {
      const result = await this.printOnce(bitmap, media, opts);
      if (!result.success) return result;
    }
    return { success: true };
  }

  private printOnce(bitmap: RenderedBitmap, media: MediaDefinition, opts: PrintOptions): Promise<PrintResult> {
    return new Promise((resolve) => {
      const args = [
        this.rasterHelperPath,
        '--host', this.host,
        '--port', String(this.port),
        '--label', media.id,
        '--rotate', opts.rotate,
      ];
      if (opts.dryRun) args.push('--dry-run');

      const child = spawn(this.pythonBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => resolve({ success: false, errorMessage: err.message }));
      child.on('close', (code) => {
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, errorMessage: stderr.trim() || `brother_raster_helper.py beendet mit Code ${code}` });
      });

      child.stdin.write(JSON.stringify({ pngBase64: bitmap.data.toString('base64') }));
      child.stdin.end();
    });
  }
}
