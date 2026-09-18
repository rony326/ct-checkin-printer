import { describe, expect, it } from 'vitest';
import { BaseLabelPrinterAdapter, PrinterStatus, type PrinterStatusResult } from './types.js';

function statusResult(source: 'print-channel' | 'http'): PrinterStatusResult {
  return { status: PrinterStatus.ONLINE, humanMessage: 'OK', source, timestamp: new Date() };
}

/** Minimale Testimplementierung — nur getStatus() (aus BaseLabelPrinterAdapter) wird geprüft. */
class TestAdapter extends BaseLabelPrinterAdapter {
  constructor(
    private readonly printChannel: () => Promise<PrinterStatusResult | null>,
    private readonly http?: () => Promise<PrinterStatusResult | null>,
  ) {
    super();
    if (http) this.getStatusFromHttp = http;
  }
  async connect(): Promise<void> {}
  async printLabel(): Promise<never> {
    throw new Error('nicht Teil dieses Tests');
  }
  async getStatusFromPrintChannel(): Promise<PrinterStatusResult | null> {
    return this.printChannel();
  }
  listSupportedMedia() {
    return [];
  }
}

describe('BaseLabelPrinterAdapter.getStatus() — Race auf die erste erfolgreiche Quelle', () => {
  it('wartet NICHT auf eine hängende Druckkanal-Quelle, wenn HTTP schneller erfolgreich antwortet (Produktionsbug: 5s Tax pro Checkin)', async () => {
    let releaseSlowPrintChannel!: () => void;
    const neverRespondsInTime = new Promise<PrinterStatusResult | null>((resolve) => {
      releaseSlowPrintChannel = () => resolve(statusResult('print-channel'));
    });

    const adapter = new TestAdapter(
      () => neverRespondsInTime,
      async () => statusResult('http'),
    );

    const status = await adapter.getStatus();
    expect(status.source).toBe('http');

    releaseSlowPrintChannel(); // aufräumen, damit die hängende Promise nicht offen bleibt
  });

  it('nutzt weiterhin den Druckkanal, wenn er erfolgreich UND nicht langsamer als HTTP ist', async () => {
    const adapter = new TestAdapter(
      async () => statusResult('print-channel'),
      () => new Promise(() => {}), // HTTP antwortet nie — darf das schnelle Ergebnis nicht verdrängen
    );

    const status = await adapter.getStatus();
    expect(status.source).toBe('print-channel');
  });

  it('ignoriert einen Fehlschlag einer Quelle und wartet auf die andere, statt sofort auf UNKNOWN zu gehen', async () => {
    const adapter = new TestAdapter(
      () => Promise.reject(new Error('Druckkanal nicht erreichbar')),
      async () => statusResult('http'),
    );

    const status = await adapter.getStatus();
    expect(status.source).toBe('http');
  });

  it('fällt auf UNKNOWN zurück, wenn ALLE Quellen scheitern', async () => {
    const adapter = new TestAdapter(
      () => Promise.reject(new Error('x')),
      async () => null,
    );

    const status = await adapter.getStatus();
    expect(status.status).toBe(PrinterStatus.UNKNOWN);
  });

  it('funktioniert auch ohne HTTP-Fallback (z.B. Zebra)', async () => {
    const adapter = new TestAdapter(async () => statusResult('print-channel'));
    const status = await adapter.getStatus();
    expect(status.source).toBe('print-channel');
  });
});
