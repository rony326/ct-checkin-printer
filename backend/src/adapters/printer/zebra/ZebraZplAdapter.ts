import { writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import {
  BaseLabelPrinterAdapter,
  type MediaDefinition,
  type PrintOptions,
  type PrintResult,
  type PrinterConnectionConfig,
  type PrinterStatusResult,
  type RenderedBitmap,
} from '../types.js';
import { ZEBRA_MEDIA } from '../media/zebraMedia.js';
import { HQES_COMMAND, mapHqesToPrinterStatus, parseHqesResponse } from './statusParser.js';
import { buildZplLabel } from './zplBuilder.js';
import { pngToMonochrome } from './pngToMonochrome.js';

/** Sendet Daten über eine kurzlebige TCP-Verbindung und sammelt die Antwort (falls vorhanden) ein. */
function tcpRequest(host: string, port: number, payload: Buffer, timeoutMs: number, expectResponse: boolean): Promise<Buffer> {
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
      if (!expectResponse) resolve(response); // Fire-and-forget-Druckauftrag: Timeout beim Warten auf Antwort ist ok
      else reject(new Error('Zebra-Anfrage: Timeout'));
    });
    socket.once('error', (err) => {
      cleanup();
      reject(err);
    });
    socket.once('connect', () => {
      if (!expectResponse) {
        // Erst vollständig flushen (write-Callback), dann sauber schliessen —
        // ein sofortiges destroy() nach write() könnte gepufferte Bytes verwerfen.
        socket.end(payload, () => {
          cleanup();
          resolve(response);
        });
      } else {
        socket.write(payload);
      }
    });
    if (expectResponse) {
      socket.on('data', (chunk) => {
        response = Buffer.concat([response, chunk]);
        if (response.includes('\r') || response.includes('\n')) {
          cleanup();
          resolve(response);
        }
      });
    }
    socket.connect(port, host);
  });
}

export interface ZebraZplAdapterOptions {
  printerLabel: string;
}

export class ZebraZplAdapter extends BaseLabelPrinterAdapter {
  readonly vendor = 'zebra-zpl' as const;
  private host = '';
  private port = 9100;
  private timeoutMs = 5000;
  private readonly printerLabel: string;

  constructor(opts: ZebraZplAdapterOptions) {
    super();
    this.printerLabel = opts.printerLabel;
  }

  async connect(cfg: PrinterConnectionConfig): Promise<void> {
    this.host = cfg.host;
    this.port = cfg.port;
    this.timeoutMs = cfg.timeoutMs ?? 5000;
  }

  async getStatusFromPrintChannel(): Promise<PrinterStatusResult | null> {
    const raw = await tcpRequest(this.host, this.port, HQES_COMMAND, this.timeoutMs, true);
    const parsed = parseHqesResponse(raw.toString('ascii'));
    return mapHqesToPrinterStatus(parsed, this.printerLabel);
  }

  // Kein getStatusFromHttp: kein einheitliches HTTP-Statusformat über Zebra-Modelle
  // hinweg bestätigt (siehe Plan-Recherche) — laut Interface optional, bewusst
  // nicht implementiert statt spekulativ geraten.

  listSupportedMedia(): MediaDefinition[] {
    return ZEBRA_MEDIA;
  }

  // Kein detectMedia: ZPL bietet keine über alle Modelle hinweg zuverlässige
  // automatische Medienerkennung (siehe Plan) — Medium wird im GUI manuell gewählt.

  async printLabel(bitmap: RenderedBitmap, media: MediaDefinition, opts: PrintOptions): Promise<PrintResult> {
    try {
      if (opts.dryRun) {
        // Analog zum Brother-Helper (siehe brother_raster_helper.py --dry-run):
        // nur als PNG speichern, kein Netzwerkzugriff.
        await writeFile(`label_preview_${media.id}.png`, bitmap.data);
        return { success: true };
      }
      const mono = pngToMonochrome(bitmap.data);
      const zpl = buildZplLabel(mono, { copies: opts.copies, rotate: opts.rotate });
      await tcpRequest(this.host, this.port, Buffer.from(zpl, 'ascii'), this.timeoutMs, false);
      return { success: true };
    } catch (err) {
      return { success: false, errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }
}
