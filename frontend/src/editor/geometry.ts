/**
 * Geometrie des Etiketten-Editors: bedruckbare Fläche, Element-Kästen und
 * Überstand, alles in mm. Massgeblich für die Grössen ist der Server-Renderer
 * (backend/src/rendering/LabelRenderer.ts) — Änderungen dort hier nachziehen.
 */
import type { Align, LabelElement, MediaType, Rotate } from '../types.js';

/** Zeilenhöhe als Vielfaches der Schriftgrösse. */
export const LINE_HEIGHT_FACTOR = 1.3;
/** Höhe der Arbeitsfläche bei Endlosmaterial ohne feste Länge. */
export const DEFAULT_CONTINUOUS_HEIGHT_MM = 120;
/** Rand unter dem untersten Element bei automatischer Länge. */
export const AUTO_BOTTOM_MARGIN_MM = 2;
/** Kürzestes Endlos-Etikett. */
export const MIN_LENGTH_MM = 10;
/** Längstes Endlos-Etikett, fest oder automatisch (wie `MAX_CONTINUOUS_LENGTH_MM` im Renderer). */
export const MAX_LENGTH_MM = 1000;
/** Bis zu diesem Mass gilt ein Überstand als Rundungsrauschen. */
const OVERFLOW_TOLERANCE_MM = 0.05;
const MM_PER_INCH = 25.4;

export interface PrintArea {
  widthMm: number;
  heightMm: number;
  continuous: boolean;
  fixedLength: boolean;
}

/** Liefert die Textbreite in Druck-px. */
export type MeasureText = (text: string, fontSizePx: number, bold: boolean, fontFamily: string) => number;

/** Achsenparallele Hülle eines (gegebenenfalls gedrehten) Elements. */
export interface BoxMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextLikeElement = Extract<LabelElement, { type: 'text' | 'static' }>;

export interface BoxContext {
  dpi: number;
  resolveText(el: TextLikeElement): string;
  fontFamily(el: TextLikeElement): string;
  measure: MeasureText;
  /** Seitenverhältnis Breite/Höhe; `undefined` → quadratisch. */
  logoAspect(logoId: number): number | undefined;
}

/** Begrenzt eine feste Länge auf den erlaubten Bereich. */
export function clampLengthMm(lengthMm: number): number {
  return Math.min(Math.max(lengthMm, MIN_LENGTH_MM), MAX_LENGTH_MM);
}

/** Inhalt des Längen-Felds als Zahl; `null`, solange er leer oder keine Zahl ist. */
export function parseLengthInput(text: string): number | null {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
}

/**
 * Die-Cut: die bedruckbare Fläche. Endlos: nominale Breite (wie im Renderer)
 * und die feste Länge, ohne diese nur eine Arbeitsfläche, die mit dem Inhalt
 * (`contentLengthMm`) bis höchstens `MAX_LENGTH_MM` mitwächst.
 */
export function printAreaMm(media: MediaType, lengthMm: number | null, contentLengthMm = 0): PrintArea {
  if (media.dieCut) {
    // Die-Cut-Medien haben immer eine Höhe; die Rückfälle bedienen nur den Typ.
    const heightMm = media.printableHeightMm ?? media.heightMm ?? DEFAULT_CONTINUOUS_HEIGHT_MM;
    return { widthMm: media.printableWidthMm, heightMm, continuous: false, fixedLength: false };
  }
  if (lengthMm === null) {
    // Gedeckelt, weil ein vertippter Y-Wert sonst einen Canvas erzeugt, an dem der Browser scheitert.
    const heightMm = Math.min(Math.max(DEFAULT_CONTINUOUS_HEIGHT_MM, Math.ceil(contentLengthMm)), MAX_LENGTH_MM);
    return { widthMm: media.widthMm, heightMm, continuous: true, fixedLength: false };
  }
  // Der Renderer druckt nie kürzer als MIN_LENGTH_MM.
  return { widthMm: media.widthMm, heightMm: Math.max(lengthMm, MIN_LENGTH_MM), continuous: true, fixedLength: true };
}

/** Frei gezogene Anker landen auf diesem Raster. */
const DROP_STEP_MM = 0.5;
/** Feinere Rundung der eingerasteten Achse, damit die Kante auf dem Ziel bleibt. */
const SNAP_STEP_MM = 0.1;

export function roundMm(value: number, step: number): number {
  // `toFixed` entfernt Gleitkomma-Reste wie 12.300000000000002.
  return Number((Math.round(value / step) * step).toFixed(6));
}

/** Anker nach dem Ziehen: auf `stepMm` gerundet, danach auf `[0, maxMm]` begrenzt, damit er auf der Fläche bleibt. */
export function dropAnchorMm(valueMm: number, maxMm: number, stepMm: number = DROP_STEP_MM): number {
  return Math.min(Math.max(0, roundMm(valueMm, stepMm)), maxMm);
}

/** Grösster Abstand, aus dem eine Kante oder Mitte auf ein Ziel springt. */
export const SNAP_THRESHOLD_MM = 1.5;
/** Abstände, die sich weniger unterscheiden, gelten als gleich (Gleitkomma). */
const SNAP_TIE_MM = 0.001;

export type Axis = 'x' | 'y';

export interface SnapTarget {
  axis: Axis;
  valueMm: number;
  /** 1 Etikett, 2 andere Elemente, 3 Raster — bei gleichem Abstand gewinnt die kleinere Zahl. */
  priority: 1 | 2 | 3;
}

export interface Guide {
  axis: Axis;
  valueMm: number;
}

/** Positionen der Rasterlinien von 0 bis zum Flächenrand. */
export function gridLinesMm(maxMm: number, gridMm: number): number[] {
  return Array.from({ length: Math.floor(maxMm / gridMm + 1e-9) + 1 }, (_, i) => i * gridMm);
}

/** Anfang, Mitte und Ende einer Strecke. */
function edges(startMm: number, sizeMm: number): number[] {
  return [startMm, startMm + sizeMm / 2, startMm + sizeMm];
}

/** Alle Ziele zum Einrasten; `gridMm: null` → ohne Raster. */
export function snapTargets(area: PrintArea, others: BoxMm[], gridMm: number | null): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const add = (axis: Axis, priority: SnapTarget['priority'], values: number[]) => {
    for (const valueMm of values) targets.push({ axis, valueMm, priority });
  };
  add('x', 1, edges(0, area.widthMm));
  // Bei automatischer Länge ist die Höhe nur Arbeitsfläche: Mitte und Unterkante gibt es im Druck nicht.
  add('y', 1, area.continuous && !area.fixedLength ? [0] : edges(0, area.heightMm));
  for (const box of others) {
    add('x', 2, edges(box.x, box.width));
    add('y', 2, edges(box.y, box.height));
  }
  if (gridMm !== null) {
    add('x', 3, gridLinesMm(area.widthMm, gridMm));
    add('y', 3, gridLinesMm(area.heightMm, gridMm));
  }
  return targets;
}

/** Nächstes Ziel einer Achse für Anfang, Mitte oder Ende des Kastens. */
function snapAxis(axis: Axis, positions: number[], targets: SnapTarget[], thresholdMm: number) {
  const candidates = targets
    .filter((target) => target.axis === axis)
    .flatMap((target) => positions.map((position) => ({ target, deltaMm: target.valueMm - position })))
    .filter((c) => Math.abs(c.deltaMm) <= thresholdMm);
  const nearest = Math.min(...candidates.map((c) => Math.abs(c.deltaMm)));
  return candidates
    .filter((c) => Math.abs(c.deltaMm) - nearest < SNAP_TIE_MM)
    .sort((a, b) => a.target.priority - b.target.priority || Math.abs(a.deltaMm) - Math.abs(b.deltaMm))[0];
}

/** Verschiebung, mit der der Kasten je Achse auf dem nächsten Ziel landet, samt Hilfslinien dazu. */
export function findSnap(moving: BoxMm, targets: SnapTarget[], thresholdMm: number): { dxMm: number; dyMm: number; guides: Guide[] } {
  const x = snapAxis('x', edges(moving.x, moving.width), targets, thresholdMm);
  const y = snapAxis('y', edges(moving.y, moving.height), targets, thresholdMm);
  const guides = [x, y].flatMap((c) => (c ? [{ axis: c.target.axis, valueMm: c.target.valueMm }] : []));
  return { dxMm: x?.deltaMm ?? 0, dyMm: y?.deltaMm ?? 0, guides };
}

/**
 * Wendet das Einrasten auf den Anker eines gezogenen Elements an (`moving` ist
 * sein Kasten an dieser Stelle). Eingerastete Achsen sind auf 0,1 mm gerundet,
 * freie bleiben unverändert. Müsste der Anker dafür die Fläche verlassen, wird
 * auf dieser Achse nicht eingerastet.
 */
export function snapAnchor(
  anchor: { xMm: number; yMm: number },
  moving: BoxMm,
  targets: SnapTarget[],
  area: PrintArea,
): { xMm: number; yMm: number; guides: Guide[] } {
  const snap = findSnap(moving, targets, SNAP_THRESHOLD_MM);
  const result = { xMm: anchor.xMm, yMm: anchor.yMm, guides: [] as Guide[] };
  for (const guide of snap.guides) {
    const key = guide.axis === 'x' ? 'xMm' : 'yMm';
    const maxMm = guide.axis === 'x' ? area.widthMm : area.heightMm;
    const snapped = anchor[key] + (guide.axis === 'x' ? snap.dxMm : snap.dyMm);
    if (snapped < -SNAP_STEP_MM / 2 || snapped > maxMm + SNAP_STEP_MM / 2) continue;
    result[key] = dropAnchorMm(snapped, maxMm, SNAP_STEP_MM);
    result.guides.push(guide);
  }
  return result;
}

/** Ab diesem Abstand zum Greifpunkt gilt eine Zeigerbewegung als Ziehen, darunter als Zittern beim Klicken. */
export const DRAG_THRESHOLD_PX = 4;

export function exceedsDragThreshold(start: { x: number; y: number }, current: { x: number; y: number }): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PX;
}

/** Anker beim Loslassen: eingerastete Achsen (siehe `snapAnchor`) bleiben, freie landen auf 0,5 mm. */
export function releaseAnchorMm(preview: { xMm: number; yMm: number; guides: Guide[] }, area: PrintArea): { xMm: number; yMm: number } {
  const snapped = (axis: Axis) => preview.guides.some((guide) => guide.axis === axis);
  return {
    xMm: snapped('x') ? preview.xMm : dropAnchorMm(preview.xMm, area.widthMm),
    yMm: snapped('y') ? preview.yMm : dropAnchorMm(preview.yMm, area.heightMm),
  };
}

/** Bildet einen zum Anker relativen Punkt gemäss Drehung ab (im Uhrzeigersinn, wie Konvas `rotation`-Prop). */
export function rotateLocal(lx: number, ly: number, rotate: Rotate | undefined): { x: number; y: number } {
  switch (rotate) {
    case '90':
      return { x: -ly, y: lx };
    case '180':
      return { x: -lx, y: -ly };
    case '270':
      return { x: ly, y: -lx };
    default:
      return { x: lx, y: ly };
  }
}

/** Waagrechter Beginn des Textblocks relativ zum Anker, wie `textAlign` im Renderer. */
function alignOffset(align: Align, width: number): number {
  if (align === 'left') return 0;
  if (align === 'right') return -width;
  return -width / 2;
}

/** Ungedrehte Ausdehnung relativ zum Anker. */
function localBoxMm(el: LabelElement, ctx: BoxContext): BoxMm {
  const printPxToMm = (px: number) => (px * MM_PER_INCH) / ctx.dpi;
  switch (el.type) {
    case 'text':
    case 'static': {
      const lines = ctx.resolveText(el).split('\n');
      const family = ctx.fontFamily(el);
      const width = printPxToMm(Math.max(...lines.map((line) => ctx.measure(line, el.fontSize, el.bold, family))));
      const height = printPxToMm(lines.length * el.fontSize * LINE_HEIGHT_FACTOR);
      return { x: alignOffset(el.align, width), y: 0, width, height };
    }
    case 'logo':
      return { x: 0, y: 0, width: el.heightMm * (ctx.logoAspect(el.logoId) ?? 1), height: el.heightMm };
    case 'qr':
      return { x: 0, y: 0, width: el.sizeMm, height: el.sizeMm };
    case 'line':
      // Der Renderer zeichnet mindestens 1 Druck-px.
      return { x: 0, y: 0, width: el.widthMm, height: Math.max(el.thicknessMm, printPxToMm(1)) };
  }
}

/** Kasten eines Elements in Etiketten-Koordinaten; die Drehung erfolgt um den Anker (`xMm`/`yMm`). */
export function elementBoxMm(el: LabelElement, ctx: BoxContext): BoxMm {
  const local = localBoxMm(el, ctx);
  // Bei Vielfachen von 90° genügen zwei gegenüberliegende Ecken für die exakte Hülle.
  const a = rotateLocal(local.x, local.y, el.rotate);
  const b = rotateLocal(local.x + local.width, local.y + local.height, el.rotate);
  const sideways = el.rotate === '90' || el.rotate === '270';
  return {
    x: el.xMm + Math.min(a.x, b.x),
    y: el.yMm + Math.min(a.y, b.y),
    // Direkt aus der lokalen Grösse, damit keine Rundungsfehler durch die Anker-Addition entstehen.
    width: sideways ? local.height : local.width,
    height: sideways ? local.width : local.height,
  };
}

export type AlignCommand = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Achse eines Befehls und Lage auf der Fläche: 0 Anfang, 0.5 Mitte, 1 Ende. */
const ALIGN_COMMANDS: Record<AlignCommand, { axis: Axis; fraction: number }> = {
  left: { axis: 'x', fraction: 0 },
  hcenter: { axis: 'x', fraction: 0.5 },
  right: { axis: 'x', fraction: 1 },
  top: { axis: 'y', fraction: 0 },
  vcenter: { axis: 'y', fraction: 0.5 },
  bottom: { axis: 'y', fraction: 1 },
};

const TEXT_ALIGN_BY_FRACTION: Record<number, Align> = { 0: 'left', 0.5: 'center', 1: 'right' };

/**
 * Richtet ein Element an der Fläche aus; `box` ist sein Kasten (`elementBoxMm`).
 * Ungedrehter Text erhält waagrecht die passende `align` samt Anker, damit er
 * auch mit anderer Textlänge (Variablen) ausgerichtet bleibt. Sonst wandert der
 * Anker, bis die Hülle am Ziel liegt. Bei automatischer Länge sind `vcenter` und
 * `bottom` sinnlos, weil die Höhe nur Arbeitsfläche ist.
 */
export function alignElement(el: LabelElement, cmd: AlignCommand, area: PrintArea, box: BoxMm): LabelElement {
  const { axis, fraction } = ALIGN_COMMANDS[cmd];
  if (axis === 'x') {
    if ((el.type === 'text' || el.type === 'static') && (el.rotate ?? '0') === '0') {
      return { ...el, align: TEXT_ALIGN_BY_FRACTION[fraction]!, xMm: roundMm(area.widthMm * fraction, SNAP_STEP_MM) };
    }
    return { ...el, xMm: roundMm(el.xMm + (area.widthMm - box.width) * fraction - box.x, SNAP_STEP_MM) };
  }
  return { ...el, yMm: roundMm(el.yMm + (area.heightMm - box.height) * fraction - box.y, SNAP_STEP_MM) };
}

/**
 * Länge eines Endlos-Etiketts ohne feste Länge. Der Renderer ignoriert dabei
 * die Drehung, deshalb übergibt der Aufrufer ungedrehte Kästen.
 */
export function estimateContentLengthMm(boxes: BoxMm[]): number {
  const maxBottom = Math.max(0, ...boxes.map((box) => box.y + box.height));
  return Math.max(maxBottom + AUTO_BOTTOM_MARGIN_MM, MIN_LENGTH_MM);
}

/** IDs der Elemente, die über die Fläche hinausragen. `boxes[i]` gehört zu `elements[i]`. */
export function overflowingElementIds(elements: LabelElement[], boxes: BoxMm[], area: PrintArea): string[] {
  // Bei automatischer Länge wächst das Etikett mit dem Inhalt: unten ragt erst hinaus, was über die längste Länge geht.
  const maxBottomMm = area.continuous && !area.fixedLength ? MAX_LENGTH_MM : area.heightMm;
  return elements
    .filter((_, i) => {
      const box = boxes[i]!;
      return (
        box.x < -OVERFLOW_TOLERANCE_MM ||
        box.y < -OVERFLOW_TOLERANCE_MM ||
        box.x + box.width > area.widthMm + OVERFLOW_TOLERANCE_MM ||
        box.y + box.height > maxBottomMm + OVERFLOW_TOLERANCE_MM
      );
    })
    .map((el) => el.id);
}
