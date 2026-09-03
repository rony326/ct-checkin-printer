import { PrinterStatus, type MediaDefinition, type PrinterStatusResult } from '../types.js';

/** ESC i S — fordert das 32-Byte-Statuspaket über den Druckkanal (Port 9100) an. */
export const REQUEST_STATUS_COMMAND = Buffer.from([0x1b, 0x69, 0x53]);

export const STATUS_PACKET_LENGTH = 32;

/**
 * Byte-Layout des 32-Byte-Statuspakets. Verifiziert gegen `brother_ql`s
 * `reader.py` (pklaus/brother_ql, https://github.com/pklaus/brother_ql/blob/master/brother_ql/reader.py) —
 * nicht aus dem Gedächtnis geraten, sondern gegen die Quelle abgeglichen.
 */
const OFFSET = {
  HEADER: 0, // erwartet: 0x80 0x20 0x42 ('B')
  ERROR_INFO_1: 8,
  ERROR_INFO_2: 9,
  MEDIA_WIDTH_MM: 10,
  MEDIA_TYPE: 11,
  MEDIA_LENGTH_MM: 17,
  STATUS_TYPE: 18,
  PHASE_TYPE: 19,
} as const;

const MEDIA_TYPE = {
  NO_MEDIA: 0x00,
  CONTINUOUS: 0x0a,
  DIE_CUT: 0x0b,
} as const;

export interface BrotherStatusPacket {
  errorInfo1: number;
  errorInfo2: number;
  mediaWidthMm: number;
  mediaType: number;
  mediaLengthMm: number;
  statusType: number;
  phaseType: number;
}

export function parseStatusPacket(buf: Buffer): BrotherStatusPacket {
  if (buf.length < STATUS_PACKET_LENGTH) {
    throw new Error(`Statuspaket zu kurz: ${buf.length} von erwarteten ${STATUS_PACKET_LENGTH} Bytes`);
  }
  if (buf[OFFSET.HEADER] !== 0x80 || buf[OFFSET.HEADER + 1] !== 0x20 || buf[OFFSET.HEADER + 2] !== 0x42) {
    throw new Error('Ungültiger Statuspaket-Header — keine Brother-QL-Antwort erkannt');
  }
  return {
    errorInfo1: buf[OFFSET.ERROR_INFO_1]!,
    errorInfo2: buf[OFFSET.ERROR_INFO_2]!,
    mediaWidthMm: buf[OFFSET.MEDIA_WIDTH_MM]!,
    mediaType: buf[OFFSET.MEDIA_TYPE]!,
    mediaLengthMm: buf[OFFSET.MEDIA_LENGTH_MM]!,
    statusType: buf[OFFSET.STATUS_TYPE]!,
    phaseType: buf[OFFSET.PHASE_TYPE]!,
  };
}

/** Bit-Reihenfolge exakt aus brother_ql RESP_ERROR_INFORMATION_1_DEF/_2_DEF übernommen. */
const ERROR1_BITS = {
  NO_MEDIA: 1 << 0,
  END_OF_MEDIA: 1 << 1,
  CUTTER_JAM: 1 << 2,
  MAIN_UNIT_IN_USE: 1 << 4,
  PRINTER_TURNED_OFF: 1 << 5,
  FAN_ERROR: 1 << 7,
};

const ERROR2_BITS = {
  REPLACE_MEDIA: 1 << 0,
  BUFFER_FULL: 1 << 1,
  TRANSMISSION_ERROR: 1 << 2,
  COVER_OPENED: 1 << 4,
  CANNOT_FEED: 1 << 6,
  SYSTEM_ERROR: 1 << 7,
};

export function mapToPrinterStatus(packet: BrotherStatusPacket, printerLabel: string): PrinterStatusResult {
  const { errorInfo1: e1, errorInfo2: e2 } = packet;

  const result = (status: PrinterStatus, humanMessage: string): PrinterStatusResult => ({
    status,
    humanMessage,
    source: 'print-channel',
    raw: packet,
    timestamp: new Date(),
  });

  if (e1 & ERROR1_BITS.PRINTER_TURNED_OFF) {
    return result(PrinterStatus.OFFLINE, `Drucker „${printerLabel}" ist ausgeschaltet.`);
  }
  if (e2 & ERROR2_BITS.COVER_OPENED) {
    return result(PrinterStatus.COVER_OPEN, `Drucker „${printerLabel}": Deckel ist offen.`);
  }
  if (e1 & ERROR1_BITS.NO_MEDIA || e1 & ERROR1_BITS.END_OF_MEDIA || e2 & ERROR2_BITS.CANNOT_FEED) {
    return result(PrinterStatus.PAPER_EMPTY, `Drucker „${printerLabel}" hat kein Etikettenband mehr.`);
  }
  if (e2 & ERROR2_BITS.REPLACE_MEDIA) {
    return result(PrinterStatus.MEDIA_MISMATCH, `Drucker „${printerLabel}": falsches oder nicht erkanntes Etikettenmedium eingelegt.`);
  }
  if (e1 & ERROR1_BITS.CUTTER_JAM) {
    return result(PrinterStatus.ERROR, `Drucker „${printerLabel}": Schneidwerk blockiert.`);
  }
  if (e1 & ERROR1_BITS.FAN_ERROR) {
    return result(PrinterStatus.OVERHEATING, `Drucker „${printerLabel}": Lüfter defekt.`);
  }
  if (e2 & ERROR2_BITS.TRANSMISSION_ERROR || e2 & ERROR2_BITS.BUFFER_FULL || e2 & ERROR2_BITS.SYSTEM_ERROR) {
    return result(PrinterStatus.ERROR, `Drucker „${printerLabel}": interner Fehler (Status-Byte 2: 0x${e2.toString(16)}).`);
  }
  // e1-Bit "Main unit in use" ist kein Fehler, sondern zeigt einen laufenden Druck an — kein Sonderstatus nötig.
  return result(PrinterStatus.ONLINE, `Drucker „${printerLabel}" ist bereit.`);
}

/** Ordnet Medienbreite/-typ/-länge aus dem Statuspaket der Referenzliste zu, sofern eindeutig. */
export function detectMediaFromPacket(packet: BrotherStatusPacket, knownMedia: MediaDefinition[]): MediaDefinition | null {
  if (packet.mediaType === MEDIA_TYPE.NO_MEDIA) return null;

  if (packet.mediaType === MEDIA_TYPE.CONTINUOUS) {
    return knownMedia.find((m) => !m.dieCut && m.widthMm === packet.mediaWidthMm) ?? null;
  }
  if (packet.mediaType === MEDIA_TYPE.DIE_CUT) {
    return (
      knownMedia.find(
        (m) => m.dieCut && m.widthMm === packet.mediaWidthMm && m.heightMm === packet.mediaLengthMm,
      ) ?? null
    );
  }
  return null;
}
