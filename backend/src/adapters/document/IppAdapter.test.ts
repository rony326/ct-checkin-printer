import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as ipp from 'ipp';
import { afterEach, describe, expect, it } from 'vitest';
import { PrinterStatus } from '../printer/types.js';
import { IppAdapter } from './IppAdapter.js';

let server: Server | undefined;

function startFakeIppPrinter(buildResponse: (requestBuffer: Buffer) => object): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const responseMsg = buildResponse(Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/ipp' });
        res.end(ipp.serialize(responseMsg));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port));
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

function okResponse(extra: object = {}) {
  return {
    version: '2.0',
    statusCode: 'successful-ok',
    id: 1,
    'operation-attributes-tag': { 'attributes-charset': 'utf-8', 'attributes-natural-language': 'en' },
    ...extra,
  };
}

describe('IppAdapter.printDocument', () => {
  it('sends the PDF as a Print-Job and reports success on "successful-ok"', async () => {
    let receivedContentType: string | undefined;
    const port = await startFakeIppPrinter(() => okResponse());
    server!.on('request', (req) => {
      receivedContentType = req.headers['content-type'];
    });

    const adapter = new IppAdapter();
    await adapter.connect({ host: '127.0.0.1', port, ippQueue: 'print' });

    const result = await adapter.printDocument(Buffer.from('%PDF-1.4 fake'), { copies: 1 });

    expect(result.success).toBe(true);
    expect(receivedContentType).toBe('application/ipp');
  });

  it('reports failure with the IPP status code when the printer rejects the job', async () => {
    const port = await startFakeIppPrinter(() => okResponse({ statusCode: 'client-error-document-format-not-supported' }));
    const adapter = new IppAdapter();
    await adapter.connect({ host: '127.0.0.1', port, ippQueue: 'print' });

    const result = await adapter.printDocument(Buffer.from('%PDF-1.4 fake'), {});

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('client-error-document-format-not-supported');
  });

  it('reports failure when the printer is unreachable', async () => {
    const adapter = new IppAdapter();
    await adapter.connect({ host: '127.0.0.1', port: 1, ippQueue: 'print' });

    const result = await adapter.printDocument(Buffer.from('%PDF-1.4 fake'), {});

    expect(result.success).toBe(false);
  });
});

describe('IppAdapter.getStatus', () => {
  it('maps printer-state "idle" with no reasons to ONLINE', async () => {
    const port = await startFakeIppPrinter(() =>
      okResponse({ 'printer-attributes-tag': { 'printer-state': 'idle', 'printer-state-reasons': ['none'] } }),
    );
    const adapter = new IppAdapter({ printerLabel: 'Büro' });
    await adapter.connect({ host: '127.0.0.1', port, ippQueue: 'print' });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.ONLINE);
  });

  it('maps "media-empty" to PAPER_EMPTY', async () => {
    const port = await startFakeIppPrinter(() =>
      okResponse({ 'printer-attributes-tag': { 'printer-state': 'stopped', 'printer-state-reasons': ['media-empty'] } }),
    );
    const adapter = new IppAdapter({ printerLabel: 'Büro' });
    await adapter.connect({ host: '127.0.0.1', port, ippQueue: 'print' });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.PAPER_EMPTY);
  });

  it('maps "cover-open"/"door-open" to COVER_OPEN', async () => {
    const port = await startFakeIppPrinter(() =>
      okResponse({ 'printer-attributes-tag': { 'printer-state': 'stopped', 'printer-state-reasons': ['door-open'] } }),
    );
    const adapter = new IppAdapter({ printerLabel: 'Büro' });
    await adapter.connect({ host: '127.0.0.1', port, ippQueue: 'print' });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.COVER_OPEN);
  });

  it('maps an unreachable printer to OFFLINE', async () => {
    const adapter = new IppAdapter({ printerLabel: 'Büro' });
    await adapter.connect({ host: '127.0.0.1', port: 1, ippQueue: 'print' });

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.OFFLINE);
  });
});
