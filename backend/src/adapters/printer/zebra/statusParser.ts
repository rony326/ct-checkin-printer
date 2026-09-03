import { PrinterStatus, type PrinterStatusResult } from '../types.js';

/**
 * `~HQES` (Host Query Error Status) über den TCP-Druckkanal (Port 9100).
 * Antwortformat (per Recherche gegen Zebras ZPL-II-Befehlsreferenz und
 * öffentliche Beispiele, siehe Plan "Zebra ZPL Status"):
 *   pause,error_flag,error_group2(hex),error_group1(hex),warning_flag,warning_group2(hex),warning_group1(hex)
 * Beispiel (Deckel/Kopf offen): "1,1,00000000,00000004,0,00000000,00000000"
 * Bits in error_group1 (unteres Nibble, verifiziert gegen mehrere öffentliche
 * ~HQES-Parser-Implementierungen): bit0=Media leer, bit1=Ribbon leer,
 * bit2=Kopf/Deckel offen, bit3=Cutter-Fehler.
 */
export const HQES_COMMAND = Buffer.from('~HQES');

export interface ZebraHqesStatus {
  paused: boolean;
  errorFlag: boolean;
  errorGroup1: number;
  warningFlag: boolean;
  warningGroup1: number;
}

export function parseHqesResponse(raw: string): ZebraHqesStatus {
  const fields = raw.trim().split(',');
  if (fields.length < 7) {
    throw new Error(`Unerwartetes ~HQES-Antwortformat (${fields.length} statt 7 Felder): ${raw}`);
  }
  return {
    paused: fields[0] === '1',
    errorFlag: fields[1] === '1',
    errorGroup1: parseInt(fields[3]!, 16),
    warningFlag: fields[4] === '1',
    warningGroup1: parseInt(fields[6]!, 16),
  };
}

const ERROR_GROUP1_BITS = {
  MEDIA_OUT: 1 << 0,
  RIBBON_OUT: 1 << 1,
  HEAD_OPEN: 1 << 2,
  CUTTER_FAULT: 1 << 3,
};

export function mapHqesToPrinterStatus(status: ZebraHqesStatus, printerLabel: string): PrinterStatusResult {
  const result = (s: PrinterStatus, humanMessage: string): PrinterStatusResult => ({
    status: s,
    humanMessage,
    source: 'print-channel',
    raw: status,
    timestamp: new Date(),
  });

  if (status.errorFlag) {
    const g1 = status.errorGroup1;
    if (g1 & ERROR_GROUP1_BITS.MEDIA_OUT) return result(PrinterStatus.PAPER_EMPTY, `Drucker „${printerLabel}" hat kein Etikettenmaterial mehr.`);
    if (g1 & ERROR_GROUP1_BITS.RIBBON_OUT) return result(PrinterStatus.RIBBON_EMPTY, `Drucker „${printerLabel}" hat kein Farbband mehr.`);
    if (g1 & ERROR_GROUP1_BITS.HEAD_OPEN) return result(PrinterStatus.COVER_OPEN, `Drucker „${printerLabel}": Druckkopf/Deckel ist offen.`);
    if (g1 & ERROR_GROUP1_BITS.CUTTER_FAULT) return result(PrinterStatus.ERROR, `Drucker „${printerLabel}": Schneidwerk-Fehler.`);
    return result(PrinterStatus.ERROR, `Drucker „${printerLabel}": Fehler gemeldet (error_group1: 0x${g1.toString(16)}).`);
  }

  if (status.paused) {
    return result(PrinterStatus.ERROR, `Drucker „${printerLabel}" ist pausiert — bitte am Gerät prüfen.`);
  }

  if (status.warningFlag) {
    return result(PrinterStatus.ONLINE, `Drucker „${printerLabel}": Warnung (warning_group1: 0x${status.warningGroup1.toString(16)}).`);
  }

  return result(PrinterStatus.ONLINE, `Drucker „${printerLabel}" ist bereit.`);
}
