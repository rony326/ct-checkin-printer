import type { MediaDefinition } from '../types.js';

/**
 * Referenzliste aller Brother-QL-Medientypen. 1:1 aus `brother_ql`s
 * `labels.py` (pklaus/brother_ql, https://github.com/pklaus/brother_ql/blob/master/brother_ql/labels.py)
 * übernommen — `externalId` ist der brother_ql-Identifier, den der
 * Raster-Helper (siehe `python/brother_raster_helper.py`) unverändert an
 * `brother_ql.conversion.convert(label=...)` weiterreicht. Nicht erfinden,
 * nicht umbenennen, sonst druckt der Helper aufs falsche Format.
 *
 * `dkPartNumber` ist eine best-effort Zuordnung zur Brother-DK-Rollen-
 * Produktnummer, nur zur Anzeige im GUI (damit Anwender:innen die passende
 * Rolle anhand der Verpackung finden) — im Zweifel gegen die tatsächliche
 * Verpackung prüfen und über die GUI korrigieren, das Drucken selbst hängt
 * nur an `externalId`/den mm-Massen.
 */
export interface BrotherMediaSeed extends MediaDefinition {
  externalId: string;
  dkPartNumber?: string;
}

const DPI = 300;
const pxToMm = (px: number) => Math.round((px / DPI) * 25.4 * 10) / 10;

function continuous(externalId: string, widthMm: number, printableWidthPx: number, dkPartNumber?: string): BrotherMediaSeed {
  return {
    id: externalId,
    externalId,
    vendor: 'brother-ql',
    name: `${widthMm} mm Endlos`,
    widthMm,
    heightMm: null,
    printableAreaMm: { width: pxToMm(printableWidthPx), height: 0 },
    dieCut: false,
    dkPartNumber,
  };
}

function dieCut(
  externalId: string,
  widthMm: number,
  heightMm: number,
  printableWidthPx: number,
  printableHeightPx: number,
  dkPartNumber?: string,
): BrotherMediaSeed {
  return {
    id: externalId,
    externalId,
    vendor: 'brother-ql',
    name: `${widthMm}×${heightMm} mm Die-Cut`,
    widthMm,
    heightMm,
    printableAreaMm: { width: pxToMm(printableWidthPx), height: pxToMm(printableHeightPx) },
    dieCut: true,
    dkPartNumber,
  };
}

function round(externalId: string, diameterMm: number, printablePx: number, dkPartNumber?: string): BrotherMediaSeed {
  return {
    id: externalId,
    externalId,
    vendor: 'brother-ql',
    name: `⌀${diameterMm} mm rund`,
    widthMm: diameterMm,
    heightMm: diameterMm,
    printableAreaMm: { width: pxToMm(printablePx), height: pxToMm(printablePx) },
    dieCut: true,
    dkPartNumber,
  };
}

export const BROTHER_MEDIA: BrotherMediaSeed[] = [
  // Endlosband
  continuous('12', 12, 106),
  continuous('29', 29, 306, 'DK-22210'),
  continuous('38', 38, 413, 'DK-22225'),
  continuous('50', 50, 554),
  continuous('54', 54, 590),
  continuous('62', 62, 696, 'DK-22205'),
  continuous('62red', 62, 696), // Schwarz/Rot/Weiss, nur QL-820NWB
  continuous('102', 102, 1164),
  continuous('103', 104, 1200),

  // Die-Cut (rechteckig)
  dieCut('17x54', 17, 54, 165, 566, 'DK-11204'),
  dieCut('17x87', 17, 87, 165, 956, 'DK-11203'),
  dieCut('23x23', 23, 23, 202, 202, 'DK-11221'),
  dieCut('29x42', 29, 42, 306, 425),
  dieCut('29x90', 29, 90, 306, 991, 'DK-11201'),
  dieCut('39x90', 39, 90, 413, 991, 'DK-11208'),
  dieCut('39x48', 39, 48, 425, 495, 'DK-11220'),
  dieCut('52x29', 52, 29, 578, 271),
  // 60x86 (DK-11234) in v1 gegen QL-820NWB getestet (siehe Repo-Root-README "Getestete Hardware")
  dieCut('60x86', 60, 87, 672, 954, 'DK-11234'),
  dieCut('62x29', 62, 29, 696, 271, 'DK-11209'),
  dieCut('62x100', 62, 100, 696, 1109),
  dieCut('102x51', 102, 51, 1164, 526, 'DK-11240'),
  dieCut('102x152', 102, 153, 1164, 1660, 'DK-11241'),
  dieCut('103x164', 104, 164, 1200, 1822, 'DK-11247'),

  // Die-Cut (rund)
  round('d12', 12, 94),
  round('d24', 24, 236, 'DK-11218'),
  round('d58', 58, 618),
];
