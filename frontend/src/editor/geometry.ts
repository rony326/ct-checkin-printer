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

/**
 * Die-Cut: die bedruckbare Fläche. Endlos: nominale Breite (wie im Renderer)
 * und die feste Länge, ohne diese nur eine Arbeitsfläche.
 */
export function printAreaMm(media: MediaType, lengthMm: number | null): PrintArea {
  if (media.dieCut) {
    // Die-Cut-Medien haben immer eine Höhe; die Rückfälle bedienen nur den Typ.
    const heightMm = media.printableHeightMm ?? media.heightMm ?? DEFAULT_CONTINUOUS_HEIGHT_MM;
    return { widthMm: media.printableWidthMm, heightMm, continuous: false, fixedLength: false };
  }
  if (lengthMm === null) return { widthMm: media.widthMm, heightMm: DEFAULT_CONTINUOUS_HEIGHT_MM, continuous: true, fixedLength: false };
  // Der Renderer druckt nie kürzer als MIN_LENGTH_MM.
  return { widthMm: media.widthMm, heightMm: Math.max(lengthMm, MIN_LENGTH_MM), continuous: true, fixedLength: true };
}

/** Frei gezogene Anker landen auf diesem Raster. */
const DROP_STEP_MM = 0.5;

/** Anker nach dem Ziehen: auf 0,5 mm gerundet, danach auf `[0, maxMm]` begrenzt, damit er auf der Fläche bleibt. */
export function dropAnchorMm(valueMm: number, maxMm: number): number {
  const rounded = Math.round(valueMm / DROP_STEP_MM) * DROP_STEP_MM;
  return Math.min(Math.max(0, rounded), maxMm);
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
  // Bei automatischer Länge wächst das Etikett mit dem Inhalt: unten ragt nichts hinaus.
  const checkBottom = !area.continuous || area.fixedLength;
  return elements
    .filter((_, i) => {
      const box = boxes[i]!;
      return (
        box.x < -OVERFLOW_TOLERANCE_MM ||
        box.y < -OVERFLOW_TOLERANCE_MM ||
        box.x + box.width > area.widthMm + OVERFLOW_TOLERANCE_MM ||
        (checkBottom && box.y + box.height > area.heightMm + OVERFLOW_TOLERANCE_MM)
      );
    })
    .map((el) => el.id);
}
