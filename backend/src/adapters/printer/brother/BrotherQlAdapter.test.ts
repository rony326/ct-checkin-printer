import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PrinterStatus } from '../types.js';
import { BrotherQlAdapter } from './BrotherQlAdapter.js';

/** Simuliert einen Brother-QL-Drucker: antwortet auf ESC i S mit einem festen 32-Byte-Statuspaket. */
function startFakePrinter(errorInfo1: number, errorInfo2: number): Promise<Server> {
  const packet = Buffer.alloc(32);
  packet[0] = 0x80;
  packet[1] = 0x20;
  packet[2] = 0x42;
  packet[8] = errorInfo1;
  packet[9] = errorInfo2;
  packet[10] = 62; // Medienbreite
  packet[11] = 0x0a; // Endlosband

  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.on('data', () => socket.write(packet));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('BrotherQlAdapter (gegen einen simulierten Drucker über echtes TCP)', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('liest ONLINE von einem fehlerfreien Drucker', async () => {
    server = await startFakePrinter(0, 0);
    const port = (server.address() as { port: number }).port;

    const adapter = new BrotherQlAdapter({ printerLabel: 'Test' });
    await adapter.connect({ host: '127.0.0.1', port, timeoutMs: 2000 });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.ONLINE);
    expect(status.source).toBe('print-channel');
  });

  it('liest PAPER_EMPTY von einem Drucker ohne Band', async () => {
    server = await startFakePrinter(0b00000001, 0);
    const port = (server.address() as { port: number }).port;

    const adapter = new BrotherQlAdapter({ printerLabel: 'Test' });
    await adapter.connect({ host: '127.0.0.1', port, timeoutMs: 2000 });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.PAPER_EMPTY);
  });

  it('erkennt das eingelegte Endlosband über detectMedia()', async () => {
    server = await startFakePrinter(0, 0);
    const port = (server.address() as { port: number }).port;

    const adapter = new BrotherQlAdapter({ printerLabel: 'Test' });
    await adapter.connect({ host: '127.0.0.1', port, timeoutMs: 2000 });

    const media = await adapter.detectMedia();
    expect(media?.id).toBe('62');
  });

  it('fällt bei nicht erreichbarem Druckkanal auf UNKNOWN zurück, wenn kein HTTP-Fallback greift', async () => {
    const adapter = new BrotherQlAdapter({ printerLabel: 'Test' });
    // Port, auf dem garantiert nichts lauscht.
    await adapter.connect({ host: '127.0.0.1', port: 1, timeoutMs: 300 });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.UNKNOWN);
  });
});
