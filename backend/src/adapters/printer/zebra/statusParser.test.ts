import { describe, expect, it } from 'vitest';
import { PrinterStatus } from '../types.js';
import { mapHqesToPrinterStatus, parseHqesResponse } from './statusParser.js';

describe('parseHqesResponse', () => {
  it('parses the documented example response (head/cover open)', () => {
    const status = parseHqesResponse('1,1,00000000,00000004,0,00000000,00000000');
    expect(status).toEqual({ paused: true, errorFlag: true, errorGroup1: 0x04, warningFlag: false, warningGroup1: 0 });
  });

  it('parses a clean/ready response', () => {
    const status = parseHqesResponse('0,0,00000000,00000000,0,00000000,00000000');
    expect(status.errorFlag).toBe(false);
    expect(status.paused).toBe(false);
  });

  it('throws on a malformed response', () => {
    expect(() => parseHqesResponse('not,enough,fields')).toThrow(/Unerwartetes/);
  });
});

describe('mapHqesToPrinterStatus', () => {
  it('maps the documented head/cover-open example to COVER_OPEN', () => {
    const status = parseHqesResponse('1,1,00000000,00000004,0,00000000,00000000');
    expect(mapHqesToPrinterStatus(status, 'Test').status).toBe(PrinterStatus.COVER_OPEN);
  });

  it('maps media-out (bit0) to PAPER_EMPTY', () => {
    const status = parseHqesResponse('0,1,00000000,00000001,0,00000000,00000000');
    expect(mapHqesToPrinterStatus(status, 'Test').status).toBe(PrinterStatus.PAPER_EMPTY);
  });

  it('maps ribbon-out (bit1) to RIBBON_EMPTY', () => {
    const status = parseHqesResponse('0,1,00000000,00000002,0,00000000,00000000');
    expect(mapHqesToPrinterStatus(status, 'Test').status).toBe(PrinterStatus.RIBBON_EMPTY);
  });

  it('maps cutter fault (bit3) to ERROR', () => {
    const status = parseHqesResponse('0,1,00000000,00000008,0,00000000,00000000');
    expect(mapHqesToPrinterStatus(status, 'Test').status).toBe(PrinterStatus.ERROR);
  });

  it('maps a clean response to ONLINE', () => {
    const status = parseHqesResponse('0,0,00000000,00000000,0,00000000,00000000');
    expect(mapHqesToPrinterStatus(status, 'Test').status).toBe(PrinterStatus.ONLINE);
  });

  it('maps pause-without-error to ERROR (needs attention)', () => {
    const status = parseHqesResponse('1,0,00000000,00000000,0,00000000,00000000');
    expect(mapHqesToPrinterStatus(status, 'Test').status).toBe(PrinterStatus.ERROR);
    expect(mapHqesToPrinterStatus(status, 'Test').humanMessage).toContain('pausiert');
  });

  it('maps a warning-only response to ONLINE with a warning message', () => {
    const status = parseHqesResponse('0,0,00000000,00000000,1,00000000,00000001');
    const result = mapHqesToPrinterStatus(status, 'Test');
    expect(result.status).toBe(PrinterStatus.ONLINE);
    expect(result.humanMessage).toContain('Warnung');
  });
});
