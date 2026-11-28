/**
 * Umrechnung zwischen Druck und gedrehter Ansicht des Etiketten-Editors.
 * Gespeichert wird immer in Druckkoordinaten; die Ansicht dreht Fläche und
 * Elemente im Uhrzeigersinn.
 */
import type { LabelElement, Rotate } from '../types.js';
import { rotateLocal, roundMm, type Edge, type PrintArea } from './geometry.js';

export type ViewDeg = Rotate;

/** Winkel bzw. Kanten in der Reihenfolge des Uhrzeigersinns. */
const DEGS: readonly ViewDeg[] = ['0', '90', '180', '270'];
const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];
/** Genauigkeit der umgerechneten Koordinaten. */
const COORD_STEP_MM = 0.001;

function quarterTurns(deg: Rotate | undefined): number {
  return DEGS.indexOf(deg ?? '0');
}

/** Winkel nach `turns` Vierteldrehungen (auch negativ) ab `deg`. */
function turned(deg: Rotate | undefined, turns: number): Rotate {
  return DEGS[(quarterTurns(deg) + turns + 4) % 4]!;
}

function isSideways(deg: ViewDeg): boolean {
  return deg === '90' || deg === '270';
}

export function stepDeg(deg: ViewDeg, direction: 1 | -1): ViewDeg {
  return turned(deg, direction);
}

/** Fläche, wie sie in der Ansicht liegt. */
export function rotateArea(area: PrintArea, deg: ViewDeg): PrintArea {
  const sideways = isSideways(deg);
  return {
    ...area,
    widthMm: sideways ? area.heightMm : area.widthMm,
    heightMm: sideways ? area.widthMm : area.heightMm,
    openEdge: area.openEdge && EDGES[(EDGES.indexOf(area.openEdge) + quarterTurns(deg)) % 4]!,
  };
}

/** Verschiebung, die die um den Nullpunkt gedrehte Druckfläche wieder auf `[0, Breite] × [0, Höhe]` legt. */
function viewOffset(printArea: PrintArea, deg: ViewDeg): { x: number; y: number } {
  const corner = rotateLocal(printArea.widthMm, printArea.heightMm, deg);
  return { x: Math.max(0, -corner.x), y: Math.max(0, -corner.y) };
}

/** Element mit Anker und Drehung, wie es in der Ansicht liegt. */
export function toView(el: LabelElement, printArea: PrintArea, deg: ViewDeg): LabelElement {
  if (deg === '0') return el;
  const offset = viewOffset(printArea, deg);
  const anchor = rotateLocal(el.xMm, el.yMm, deg);
  return {
    ...el,
    xMm: roundMm(anchor.x + offset.x, COORD_STEP_MM),
    yMm: roundMm(anchor.y + offset.y, COORD_STEP_MM),
    rotate: turned(el.rotate, quarterTurns(deg)),
  };
}

/** Kehrt `toView` um; `printArea` ist die ungedrehte Druckfläche. */
export function fromView(el: LabelElement, printArea: PrintArea, deg: ViewDeg): LabelElement {
  if (deg === '0') return el;
  const offset = viewOffset(printArea, deg);
  const back = turned('0', -quarterTurns(deg));
  const anchor = rotateLocal(el.xMm - offset.x, el.yMm - offset.y, back);
  return {
    ...el,
    xMm: roundMm(anchor.x, COORD_STEP_MM),
    yMm: roundMm(anchor.y, COORD_STEP_MM),
    rotate: turned(el.rotate, -quarterTurns(deg)),
  };
}

/** Lage der Linie «Etikett endet hier» (Druck-Y `lengthMm`) in der Ansicht. */
export function endLineMm(lengthMm: number, printArea: PrintArea, deg: ViewDeg): { axis: 'x' | 'y'; valueMm: number } {
  // Bei 90° und 180° zeigt die Länge nach links bzw. oben und zählt vom anderen Rand.
  const mirrored = deg === '90' || deg === '180';
  return { axis: isSideways(deg) ? 'x' : 'y', valueMm: mirrored ? printArea.heightMm - lengthMm : lengthMm };
}

/** Gleiche Felder mit gleichen Werten; eine fehlende Drehung zählt als 0°. */
function isSameElement(a: LabelElement, b: LabelElement): boolean {
  const left: Record<string, unknown> = { ...a, rotate: a.rotate ?? '0' };
  const right: Record<string, unknown> = { ...b, rotate: b.rotate ?? '0' };
  return Object.keys({ ...left, ...right }).every((key) => left[key] === right[key]);
}

/**
 * Übernimmt ein in der Ansicht geändertes Element in die Druck-Elemente; alle
 * anderen bleiben dieselben Objekte. Ohne Änderung kommt `elements` selbst
 * zurück. Nicht veränderte Koordinaten behalten ihren gespeicherten Wert (ohne
 * Rundung durch die Umrechnung), und ein fehlendes `rotate` bleibt bei 0° weg —
 * so gilt ein Layout nach dem Zurücksetzen nicht als geändert.
 * `printArea` muss die Fläche sein, mit der das Ansichtselement entstand.
 */
export function replaceFromView(elements: LabelElement[], changed: LabelElement, printArea: PrintArea, deg: ViewDeg): LabelElement[] {
  const original = elements.find((el) => el.id === changed.id);
  if (!original) return elements;
  const shown = toView(original, printArea, deg);
  if (isSameElement(changed, shown)) return elements;
  const converted = fromView(changed, printArea, deg);
  const untouched = fromView(shown, printArea, deg);
  const next: LabelElement = {
    ...converted,
    xMm: converted.xMm === untouched.xMm ? original.xMm : converted.xMm,
    yMm: converted.yMm === untouched.yMm ? original.yMm : converted.yMm,
  };
  if (original.rotate === undefined && next.rotate === '0') delete next.rotate;
  return elements.map((el) => (el === original ? next : el));
}
