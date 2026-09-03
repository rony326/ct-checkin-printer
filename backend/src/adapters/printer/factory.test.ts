import { describe, expect, it } from 'vitest';
import { BrotherQlAdapter } from './brother/BrotherQlAdapter.js';
import { createLabelPrinterAdapter } from './factory.js';
import { ZebraZplAdapter } from './zebra/ZebraZplAdapter.js';

describe('createLabelPrinterAdapter', () => {
  it('creates a BrotherQlAdapter for vendor "brother-ql"', () => {
    const adapter = createLabelPrinterAdapter('brother-ql', { printerLabel: 'Test' });
    expect(adapter).toBeInstanceOf(BrotherQlAdapter);
    expect(adapter.vendor).toBe('brother-ql');
  });

  it('creates a ZebraZplAdapter for vendor "zebra-zpl"', () => {
    const adapter = createLabelPrinterAdapter('zebra-zpl', { printerLabel: 'Test' });
    expect(adapter).toBeInstanceOf(ZebraZplAdapter);
    expect(adapter.vendor).toBe('zebra-zpl');
  });
});
