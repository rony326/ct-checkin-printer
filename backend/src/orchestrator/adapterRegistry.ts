import { createLabelPrinterAdapter, type PrinterVendor } from '../adapters/printer/factory.js';
import type { LabelPrinterAdapter } from '../adapters/printer/types.js';

export interface AdapterRegistryPrinter {
  id: number;
  vendor: PrinterVendor;
  name: string;
  host: string;
  port: number;
}

interface CacheEntry {
  adapter: LabelPrinterAdapter;
  host: string;
  port: number;
}

/**
 * Hält je Drucker genau eine verbundene Adapter-Instanz vor (Poller und
 * Queue-Monitor greifen sonst mehrfach parallel auf denselben physischen
 * Drucker zu) und baut sie neu auf, wenn sich Host/Port geändert haben.
 */
export class AdapterRegistry {
  private readonly cache = new Map<number, CacheEntry>();

  constructor(private readonly opts: { printerTimeoutMs: number }) {}

  async getAdapter(printer: AdapterRegistryPrinter): Promise<LabelPrinterAdapter> {
    const cached = this.cache.get(printer.id);
    if (cached && cached.host === printer.host && cached.port === printer.port) {
      return cached.adapter;
    }

    const adapter = createLabelPrinterAdapter(printer.vendor, { printerLabel: printer.name });
    await adapter.connect({ host: printer.host, port: printer.port, timeoutMs: this.opts.printerTimeoutMs });
    this.cache.set(printer.id, { adapter, host: printer.host, port: printer.port });
    return adapter;
  }
}
