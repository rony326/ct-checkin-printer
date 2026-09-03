import { BrotherQlAdapter } from './brother/BrotherQlAdapter.js';
import type { LabelPrinterAdapter } from './types.js';
import { ZebraZplAdapter } from './zebra/ZebraZplAdapter.js';

export type PrinterVendor = 'brother-ql' | 'zebra-zpl';

/**
 * Einziger Ort, an dem ein Drucker-Vendor auf seine Adapter-Klasse
 * abgebildet wird — ein neuer Druckertyp braucht nur einen weiteren
 * `case` hier, keine Änderung an Orchestrator/GUI (siehe Plan,
 * Anforderungsprinzip "isoliert ergänzbar").
 */
export function createLabelPrinterAdapter(vendor: PrinterVendor, opts: { printerLabel: string }): LabelPrinterAdapter {
  switch (vendor) {
    case 'brother-ql':
      return new BrotherQlAdapter(opts);
    case 'zebra-zpl':
      return new ZebraZplAdapter(opts);
  }
}
