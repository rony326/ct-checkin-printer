import { describe, expect, it } from 'vitest';
import { BrotherQlAdapter } from '../adapters/printer/brother/BrotherQlAdapter.js';
import { ZebraZplAdapter } from '../adapters/printer/zebra/ZebraZplAdapter.js';
import { AdapterRegistry } from './adapterRegistry.js';

function printer(overrides: Partial<Parameters<AdapterRegistry['getAdapter']>[0]> = {}) {
  return { id: 1, vendor: 'brother-ql' as const, name: 'Empfang', host: '10.0.0.1', port: 9100, ...overrides };
}

describe('AdapterRegistry', () => {
  it('creates the right adapter class for the vendor and connects it', async () => {
    const registry = new AdapterRegistry({ printerTimeoutMs: 5000 });
    const adapter = await registry.getAdapter(printer());
    expect(adapter).toBeInstanceOf(BrotherQlAdapter);
  });

  it('creates a ZebraZplAdapter for vendor "zebra-zpl"', async () => {
    const registry = new AdapterRegistry({ printerTimeoutMs: 5000 });
    const adapter = await registry.getAdapter(printer({ vendor: 'zebra-zpl' }));
    expect(adapter).toBeInstanceOf(ZebraZplAdapter);
  });

  it('reuses the same adapter instance for repeated calls with the same connection details', async () => {
    const registry = new AdapterRegistry({ printerTimeoutMs: 5000 });
    const first = await registry.getAdapter(printer());
    const second = await registry.getAdapter(printer());
    expect(second).toBe(first);
  });

  it('creates and connects a fresh adapter when the host changes', async () => {
    const registry = new AdapterRegistry({ printerTimeoutMs: 5000 });
    const first = await registry.getAdapter(printer());
    const second = await registry.getAdapter(printer({ host: '10.0.0.2' }));
    expect(second).not.toBe(first);
  });

  it('keeps separate adapters per printer id', async () => {
    const registry = new AdapterRegistry({ printerTimeoutMs: 5000 });
    const first = await registry.getAdapter(printer({ id: 1 }));
    const second = await registry.getAdapter(printer({ id: 2, host: '10.0.0.9' }));
    expect(second).not.toBe(first);
  });
});
