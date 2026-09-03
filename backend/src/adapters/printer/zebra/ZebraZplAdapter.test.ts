import { createServer, type Server, type Socket } from 'node:net';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PrinterStatus } from '../types.js';
import { ZebraZplAdapter } from './ZebraZplAdapter.js';

function startFakePrinter(onData: (data: Buffer, socket: Socket) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.on('data', (data) => onData(data, socket));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function tinyPng(): Buffer {
  const png = new PNG({ width: 8, height: 2 });
  for (let i = 0; i < png.data.length; i += 4) {
    const black = i < 8 * 4; // erste Zeile schwarz, zweite weiss
    png.data[i] = png.data[i + 1] = png.data[i + 2] = black ? 0 : 255;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('ZebraZplAdapter (gegen einen simulierten Drucker über echtes TCP)', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('liest ONLINE aus einer sauberen ~HQES-Antwort', async () => {
    server = await startFakePrinter((data, socket) => {
      if (data.toString('ascii').includes('~HQES')) {
        socket.write('0,0,00000000,00000000,0,00000000,00000000\r\n');
      }
    });
    const port = (server.address() as { port: number }).port;

    const adapter = new ZebraZplAdapter({ printerLabel: 'Test' });
    await adapter.connect({ host: '127.0.0.1', port, timeoutMs: 2000 });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.ONLINE);
  });

  it('liest COVER_OPEN aus dem dokumentierten Beispiel', async () => {
    server = await startFakePrinter((data, socket) => {
      if (data.toString('ascii').includes('~HQES')) {
        socket.write('1,1,00000000,00000004,0,00000000,00000000\r\n');
      }
    });
    const port = (server.address() as { port: number }).port;

    const adapter = new ZebraZplAdapter({ printerLabel: 'Test' });
    await adapter.connect({ host: '127.0.0.1', port, timeoutMs: 2000 });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.COVER_OPEN);
  });

  it('sendet ein wohlgeformtes ZPL-Kommando beim Drucken', async () => {
    const received: string[] = [];
    server = await startFakePrinter((data) => {
      received.push(data.toString('ascii'));
    });
    const port = (server.address() as { port: number }).port;

    const adapter = new ZebraZplAdapter({ printerLabel: 'Test' });
    await adapter.connect({ host: '127.0.0.1', port, timeoutMs: 2000 });

    const media = adapter.listSupportedMedia()[0]!;
    const result = await adapter.printLabel({ data: tinyPng(), widthPx: 8, heightPx: 2 }, media, { copies: 3, rotate: '0' });

    expect(result.success).toBe(true);
    // kleine Wartezeit, da der TCP-Write asynchron beim Server ankommt
    await new Promise((r) => setTimeout(r, 50));
    expect(received.join('')).toContain('^XA');
    expect(received.join('')).toContain('^PQ3');
    expect(received.join('')).toContain('^GFA,2,2,1,FF00');
  });
});
