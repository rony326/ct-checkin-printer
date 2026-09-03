import { describe, expect, it } from 'vitest';
import { buildCheckinWebhookPayload, buildStatusWebhookPayload } from './payloads.js';
import { PrinterStatus } from '../adapters/printer/types.js';

describe('buildCheckinWebhookPayload', () => {
  it('includes the printer, parsed fields and the v1-compatible qr hash', () => {
    const printer = { hostname: 'B1', name: 'Empfang', host: '10.0.0.1' };
    const parsed = { name: 'Max Muster', id: '2693', code: 'ZRYK', group: 'Kids', type: 'parent', extra: [] };

    const payload = buildCheckinWebhookPayload(printer, parsed, 1735600000);

    expect(payload.event).toBe('checkin.printed');
    expect(payload.timestamp).toBe(1735600000);
    expect(payload.printer).toEqual(printer);
    expect(payload.label.label_type).toBe('parent');
    expect(payload.label.fields).toEqual(parsed);
    expect(payload.label.qr_hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('has a null qr_hash when id or code is missing, matching the renderer', () => {
    const printer = { hostname: 'B1', name: 'Empfang', host: '10.0.0.1' };
    const parsed = { name: 'Max', id: null, code: 'ZRYK', group: null, type: 'parent', extra: [] };

    const payload = buildCheckinWebhookPayload(printer, parsed, 1735600000);
    expect(payload.label.qr_hash).toBeNull();
  });
});

describe('buildStatusWebhookPayload', () => {
  it('carries the event name, printer identity and status result', () => {
    const printer = { hostname: 'B1', name: 'Empfang', host: '10.0.0.1', port: 9100 };
    const status = { status: PrinterStatus.PAPER_EMPTY, humanMessage: 'Kein Papier mehr', source: 'print-channel' as const, timestamp: new Date(0) };

    const payload = buildStatusWebhookPayload('printer.error', printer, status);

    expect(payload.event).toBe('printer.error');
    expect(payload.printer).toEqual(printer);
    expect(payload.status.status).toBe(PrinterStatus.PAPER_EMPTY);
    expect(payload.status.humanMessage).toBe('Kein Papier mehr');
  });
});
