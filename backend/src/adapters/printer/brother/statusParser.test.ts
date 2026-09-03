import { describe, expect, it } from 'vitest';
import { PrinterStatus } from '../types.js';
import { detectMediaFromPacket, mapToPrinterStatus, parseStatusPacket } from './statusParser.js';

/** Baut ein synthetisches 32-Byte-Statuspaket mit gültigem Header. */
function buildPacket(opts: {
  errorInfo1?: number;
  errorInfo2?: number;
  mediaWidthMm?: number;
  mediaType?: number;
  mediaLengthMm?: number;
}): Buffer {
  const buf = Buffer.alloc(32);
  buf[0] = 0x80;
  buf[1] = 0x20;
  buf[2] = 0x42;
  buf[8] = opts.errorInfo1 ?? 0;
  buf[9] = opts.errorInfo2 ?? 0;
  buf[10] = opts.mediaWidthMm ?? 62;
  buf[11] = opts.mediaType ?? 0x0a;
  buf[17] = opts.mediaLengthMm ?? 0;
  return buf;
}

describe('parseStatusPacket', () => {
  it('parses a well-formed packet', () => {
    const packet = parseStatusPacket(buildPacket({ mediaWidthMm: 54 }));
    expect(packet.mediaWidthMm).toBe(54);
    expect(packet.mediaType).toBe(0x0a);
  });

  it('rejects a too-short buffer', () => {
    expect(() => parseStatusPacket(Buffer.alloc(10))).toThrow(/zu kurz/);
  });

  it('rejects a buffer with wrong header', () => {
    const buf = buildPacket({});
    buf[2] = 0x00;
    expect(() => parseStatusPacket(buf)).toThrow(/Header/);
  });
});

describe('mapToPrinterStatus', () => {
  it('maps a clean packet to ONLINE', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({})), 'Empfang');
    expect(result.status).toBe(PrinterStatus.ONLINE);
  });

  it('maps "no media" (error info 1 bit 0) to PAPER_EMPTY', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo1: 0b00000001 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.PAPER_EMPTY);
    expect(result.humanMessage).toContain('kein Etikettenband');
  });

  it('maps "end of media" (error info 1 bit 1) to PAPER_EMPTY', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo1: 0b00000010 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.PAPER_EMPTY);
  });

  it('maps "cover opened" (error info 2 bit 4) to COVER_OPEN', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo2: 0b00010000 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.COVER_OPEN);
  });

  it('maps "tape cutter jam" (error info 1 bit 2) to ERROR', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo1: 0b00000100 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.ERROR);
    expect(result.humanMessage).toContain('Schneidwerk');
  });

  it('maps "printer turned off" (error info 1 bit 5) to OFFLINE', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo1: 0b00100000 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.OFFLINE);
  });

  it('maps "fan doesn\'t work" (error info 1 bit 7) to OVERHEATING', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo1: 0b10000000 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.OVERHEATING);
  });

  it('maps "replace media" (error info 2 bit 0) to MEDIA_MISMATCH', () => {
    const result = mapToPrinterStatus(parseStatusPacket(buildPacket({ errorInfo2: 0b00000001 })), 'Empfang');
    expect(result.status).toBe(PrinterStatus.MEDIA_MISMATCH);
  });

  it('prioritizes OFFLINE over other simultaneous error bits', () => {
    const result = mapToPrinterStatus(
      parseStatusPacket(buildPacket({ errorInfo1: 0b00100001 /* off + no media */ })),
      'Empfang',
    );
    expect(result.status).toBe(PrinterStatus.OFFLINE);
  });
});

describe('detectMediaFromPacket', () => {
  const knownMedia = [
    { id: '62', vendor: 'brother-ql' as const, name: '62mm Endlos', widthMm: 62, heightMm: null, printableAreaMm: { width: 61, height: 0 }, dieCut: false },
    { id: '60x86', vendor: 'brother-ql' as const, name: '60x86 Die-Cut', widthMm: 60, heightMm: 86, printableAreaMm: { width: 59, height: 85 }, dieCut: true },
  ];

  it('matches continuous media by width', () => {
    const packet = parseStatusPacket(buildPacket({ mediaType: 0x0a, mediaWidthMm: 62 }));
    expect(detectMediaFromPacket(packet, knownMedia)?.id).toBe('62');
  });

  it('matches die-cut media by width+length', () => {
    const packet = parseStatusPacket(buildPacket({ mediaType: 0x0b, mediaWidthMm: 60, mediaLengthMm: 86 }));
    expect(detectMediaFromPacket(packet, knownMedia)?.id).toBe('60x86');
  });

  it('returns null when no media is loaded', () => {
    const packet = parseStatusPacket(buildPacket({ mediaType: 0x00 }));
    expect(detectMediaFromPacket(packet, knownMedia)).toBeNull();
  });

  it('returns null when width does not match any known medium', () => {
    const packet = parseStatusPacket(buildPacket({ mediaType: 0x0a, mediaWidthMm: 17 }));
    expect(detectMediaFromPacket(packet, knownMedia)).toBeNull();
  });
});
