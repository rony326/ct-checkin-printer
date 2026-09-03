import type { MediaDefinition } from '../types.js';

/**
 * Initiale, kleinere Referenzliste gängiger Zebra-Medienformate (siehe Plan,
 * Abschnitt "Medientyp-Referenzlisten") — erweiterbar über dieselbe Tabelle
 * (media_types-DB-Zeile), kein Codeumbau nötig. DPI-Annahme: 203dpi
 * (Standard bei den meisten Zebra-Desktop-/Industriedruckern; 300dpi-Modelle
 * können bei Bedarf als weitere Einträge ergänzt werden).
 */
export interface ZebraMediaSeed extends MediaDefinition {
  externalId: string;
}

function dieCut(externalId: string, widthMm: number, heightMm: number): ZebraMediaSeed {
  return {
    id: externalId,
    externalId,
    vendor: 'zebra-zpl',
    name: `${widthMm}×${heightMm} mm Die-Cut`,
    widthMm,
    heightMm,
    printableAreaMm: { width: widthMm - 2, height: heightMm - 2 },
    dieCut: true,
  };
}

function continuous(externalId: string, widthMm: number): ZebraMediaSeed {
  return {
    id: externalId,
    externalId,
    vendor: 'zebra-zpl',
    name: `${widthMm} mm Endlos`,
    widthMm,
    heightMm: null,
    printableAreaMm: { width: widthMm - 2, height: 0 },
    dieCut: false,
  };
}

export const ZEBRA_MEDIA: ZebraMediaSeed[] = [
  dieCut('57x32', 57, 32),
  dieCut('102x51', 102, 51),
  dieCut('102x152', 102, 152),
  continuous('57', 57),
  continuous('102', 102),
];
