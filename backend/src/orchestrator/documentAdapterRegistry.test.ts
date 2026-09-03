import { describe, expect, it } from 'vitest';
import { IppAdapter } from '../adapters/document/IppAdapter.js';
import { DocumentAdapterRegistry } from './documentAdapterRegistry.js';

function docPrinter(overrides: Partial<Parameters<DocumentAdapterRegistry['getAdapter']>[0]> = {}) {
  return { id: 1, name: 'Büro', host: '10.0.0.50', port: 631, ippQueue: 'print', ...overrides };
}

describe('DocumentAdapterRegistry', () => {
  it('creates an IppAdapter and connects it', async () => {
    const registry = new DocumentAdapterRegistry();
    const adapter = await registry.getAdapter(docPrinter());
    expect(adapter).toBeInstanceOf(IppAdapter);
  });

  it('reuses the same adapter instance for repeated calls with the same connection details', async () => {
    const registry = new DocumentAdapterRegistry();
    const first = await registry.getAdapter(docPrinter());
    const second = await registry.getAdapter(docPrinter());
    expect(second).toBe(first);
  });

  it('creates a fresh adapter when the host changes', async () => {
    const registry = new DocumentAdapterRegistry();
    const first = await registry.getAdapter(docPrinter());
    const second = await registry.getAdapter(docPrinter({ host: '10.0.0.51' }));
    expect(second).not.toBe(first);
  });
});
