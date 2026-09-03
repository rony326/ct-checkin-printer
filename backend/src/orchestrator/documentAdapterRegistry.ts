import { IppAdapter } from '../adapters/document/IppAdapter.js';
import type { DocumentPrinterAdapter } from '../adapters/printer/types.js';

export interface DocumentAdapterRegistryPrinter {
  id: number;
  name: string;
  host: string;
  port: number;
  ippQueue: string;
}

interface CacheEntry {
  adapter: DocumentPrinterAdapter;
  host: string;
  port: number;
  ippQueue: string;
}

/** Analog zu `AdapterRegistry`, aber für `DocumentPrinterAdapter` (IPP) — ausschliesslich für den Sammelausdruck. */
export class DocumentAdapterRegistry {
  private readonly cache = new Map<number, CacheEntry>();

  async getAdapter(printer: DocumentAdapterRegistryPrinter): Promise<DocumentPrinterAdapter> {
    const cached = this.cache.get(printer.id);
    if (cached && cached.host === printer.host && cached.port === printer.port && cached.ippQueue === printer.ippQueue) {
      return cached.adapter;
    }

    const adapter = new IppAdapter({ printerLabel: printer.name });
    await adapter.connect({ host: printer.host, port: printer.port, ippQueue: printer.ippQueue });
    this.cache.set(printer.id, { adapter, host: printer.host, port: printer.port, ippQueue: printer.ippQueue });
    return adapter;
  }
}
