import { useMemo, useRef, useState } from 'react';
import { Group, Layer, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Align, LabelElement, MediaType, Rotate, VariableDefs } from '../types.js';
import { VENDOR_DPI } from '../types.js';

/** Reiner Bildschirm-Massstab fürs interaktive Editieren, unabhängig von der Druck-DPI. */
export const SCREEN_PX_PER_MM = 4;
const DEFAULT_CONTINUOUS_HEIGHT_MM = 120;
/** Grobe Zeilenhöhe für die Klick-Trefferzone von Text — Konvas eigene Text-Metrik ist hier nicht nötig, siehe `computeBoxes`. */
const TEXT_LINE_HEIGHT_FACTOR = 1.2;

export function mmToScreenPx(mm: number): number {
  return mm * SCREEN_PX_PER_MM;
}

function screenPxToMm(px: number): number {
  return Math.round(px / SCREEN_PX_PER_MM);
}

/**
 * Zeigt Beispieldaten statt echter Personendaten — die pixel-genaue Vorschau
 * mit echten Testdaten liefert die `LivePreview`-Komponente (echter
 * Server-Renderer), siehe Plan "WYSIWYG-Vorschau ... muss den echten
 * Renderer aufrufen, nicht in JS nachbauen". Dieser Canvas dient nur der
 * Positionierung per Drag & Drop.
 */
function resolveDraftText(el: Extract<LabelElement, { type: 'text' | 'static' }>, variables: VariableDefs): string {
  if (el.type === 'static') return el.value;
  if (el.field === 'checkin.extra') {
    return variables.textFields.find((f) => f.path === 'checkin.extra')?.example ?? 'Weitere Felder';
  }
  const example = variables.textFields.find((f) => f.path === el.field)?.example ?? '';
  return `${el.prefix ?? ''}${example}`;
}

/** Lokale (zur Gruppe relative) x/width, damit Konvas Box-Alignment das canvas-artige Anker-Verhalten von `align` nachbildet. */
function textBoxProps(align: Align, boxWidth: number): { x: number; width: number } {
  if (align === 'left') return { x: 0, width: boxWidth };
  if (align === 'right') return { x: -boxWidth, width: boxWidth };
  return { x: -boxWidth / 2, width: boxWidth };
}

interface ElementBox {
  el: LabelElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bildet einen zum Anker relativen Punkt gemäss Drehung ab (im Uhrzeigersinn, wie Konvas `rotation`-Prop). */
function rotateLocal(lx: number, ly: number, rotate: Rotate | undefined): { x: number; y: number } {
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

/**
 * Absolute Bildschirm-Pixel-Trefferzone je Element — Basis für die eigene
 * Klick-/Drag-Erkennung (siehe `pickElementAt`/`handlePointerDown` unten).
 *
 * Bewusst NICHT über Konvas eingebaute Treffer-Erkennung gelöst: die
 * ermittelt per Definition, welche Form getroffen wurde, indem sie jede Form
 * unsichtbar in einer eigenen Farbe auf eine zweite Canvas zeichnet und die
 * Pixelfarbe an der Klickposition per `getImageData` ausliest (siehe
 * konva/lib/Layer.js `_getIntersection`). Canvas-Fingerprinting-Schutz
 * (uBlock/Brave Shields/"Canvas Blocker" u.ä.) verfälscht genau diese
 * Pixel-Auslese gezielt — mit dem Ergebnis, dass Konva nie eine Form trifft:
 * Klicks/Drags auf dem Editor-Canvas taten dann komplett nichts, ganz ohne
 * Fehler in der Konsole. Diese eigene, geometrische Prüfung ist von
 * Canvas-Pixel-Auslese unabhängig und funktioniert deshalb auch mit
 * aktiviertem Schutz.
 *
 * Berücksichtigt Drehung, indem die lokale (Anker-relative) Box in alle 4
 * Ecken zerlegt, jede Ecke gemäss `rotate` abgebildet und dann die
 * Bildschirm-achsenparallele Hülle gebildet wird — bei Vielfachen von 90°
 * ist das exakt (keine Näherung), weil die gedrehte Form selbst wieder
 * achsenparallel ist.
 */
function computeBoxes(elements: LabelElement[], widthPx: number, dpi: number): ElementBox[] {
  return elements.map((el) => {
    const anchorX = mmToScreenPx(el.xMm);
    const anchorY = mmToScreenPx(el.yMm);

    let localX = 0;
    let localY = 0;
    let width = 0;
    let height = 0;
    if (el.type === 'text' || el.type === 'static') {
      const box = textBoxProps(el.align, widthPx);
      const fontPx = (el.fontSize / dpi) * 25.4 * SCREEN_PX_PER_MM;
      localX = box.x;
      width = box.width;
      height = fontPx * TEXT_LINE_HEIGHT_FACTOR;
    } else if (el.type === 'logo') {
      width = height = mmToScreenPx(el.heightMm);
    } else if (el.type === 'qr') {
      width = height = mmToScreenPx(el.sizeMm);
    } else {
      width = mmToScreenPx(el.widthMm);
      height = Math.max(mmToScreenPx(el.thicknessMm), 8);
    }

    const corners = [
      rotateLocal(localX, localY, el.rotate),
      rotateLocal(localX + width, localY, el.rotate),
      rotateLocal(localX, localY + height, el.rotate),
      rotateLocal(localX + width, localY + height, el.rotate),
    ];
    const xs = corners.map((c) => anchorX + c.x);
    const ys = corners.map((c) => anchorY + c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { el, x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  });
}

/** Oberstes (zuletzt gezeichnetes) Element unter dem Punkt gewinnt, wie bei normalem DOM-Stacking. */
function pickElementAt(boxes: ElementBox[], x: number, y: number): LabelElement | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]!;
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return box.el;
  }
  return null;
}

interface Props {
  media: MediaType | null;
  elements: LabelElement[];
  selectedId: string | null;
  variables: VariableDefs;
  fontNameById: Record<number, string>;
  onSelect: (id: string | null) => void;
  onMove: (id: string, xMm: number, yMm: number) => void;
}

export function Canvas({ media, elements, selectedId, variables, fontNameById, onSelect, onMove }: Props) {
  const dpi = media ? VENDOR_DPI[media.vendor] : 300;
  const widthMm = media?.widthMm ?? 60;
  const heightMm = media?.heightMm ?? DEFAULT_CONTINUOUS_HEIGHT_MM;
  const widthPx = mmToScreenPx(widthMm);
  const heightPx = mmToScreenPx(heightMm);

  function fontSizeToScreenPx(printPx: number): number {
    return (printPx / dpi) * 25.4 * SCREEN_PX_PER_MM;
  }

  const boxes = useMemo(() => computeBoxes(elements, widthPx, dpi), [elements, widthPx, dpi]);

  const stageRef = useRef<Konva.Stage | null>(null);
  const dragRef = useRef<{ id: string; offsetXPx: number; offsetYPx: number } | null>(null);
  // Live-Position während des Ziehens, unquantisiert für flüssiges Gefühl — erst beim Loslassen auf ganze mm gerundet (siehe handlePointerUp).
  const [dragPreview, setDragPreview] = useState<{ id: string; xPx: number; yPx: number } | null>(null);

  function handlePointerDown() {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return;
    const hit = pickElementAt(boxes, pos.x, pos.y);
    onSelect(hit?.id ?? null);
    if (hit) {
      dragRef.current = { id: hit.id, offsetXPx: pos.x - mmToScreenPx(hit.xMm), offsetYPx: pos.y - mmToScreenPx(hit.yMm) };
    }
  }

  function handlePointerMove() {
    const drag = dragRef.current;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!drag || !pos) return;
    const xPx = Math.min(Math.max(0, pos.x - drag.offsetXPx), widthPx);
    const yPx = Math.min(Math.max(0, pos.y - drag.offsetYPx), heightPx);
    setDragPreview({ id: drag.id, xPx, yPx });
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setDragPreview((preview) => {
      if (preview && preview.id === drag.id) {
        onMove(drag.id, screenPxToMm(preview.xPx), screenPxToMm(preview.yPx));
      }
      return null;
    });
  }

  return (
    <div style={{ display: 'inline-block', boxShadow: '0 4px 16px rgba(28,27,25,0.14)' }}>
      <Stage
        ref={stageRef}
        width={widthPx}
        height={heightPx}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={widthPx} height={heightPx} fill="white" stroke="#e4e1da" />
          {elements.map((el) => {
            const isSelected = el.id === selectedId;
            const strokeColor = isSelected ? '#2b6e63' : '#c9c5ba';
            const isDragging = dragPreview?.id === el.id;
            const x = isDragging ? dragPreview.xPx : mmToScreenPx(el.xMm);
            const y = isDragging ? dragPreview.yPx : mmToScreenPx(el.yMm);

            const groupProps = { x, y, rotation: Number(el.rotate ?? '0') };

            if (el.type === 'text' || el.type === 'static') {
              const box = textBoxProps(el.align, widthPx);
              return (
                <Group key={el.id} {...groupProps}>
                  <Text
                    x={box.x}
                    y={0}
                    width={box.width}
                    align={el.align}
                    text={resolveDraftText(el, variables)}
                    fontSize={fontSizeToScreenPx(el.fontSize)}
                    fontStyle={el.bold ? 'bold' : 'normal'}
                    fontFamily={(el.fontId !== undefined && fontNameById[el.fontId]) || 'Work Sans'}
                    fill={isSelected ? '#2b6e63' : '#1c1b19'}
                  />
                </Group>
              );
            }
            if (el.type === 'logo') {
              const h = mmToScreenPx(el.heightMm);
              return (
                <Group key={el.id} {...groupProps}>
                  <Rect width={h} height={h} fill="#f2f1ec" stroke={strokeColor} dash={[4, 3]} />
                  <Text x={4} y={h / 2 - 7} width={h - 8} text="Logo" fontSize={11} fill="#6b6862" />
                </Group>
              );
            }
            if (el.type === 'qr') {
              const s = mmToScreenPx(el.sizeMm);
              return (
                <Group key={el.id} {...groupProps}>
                  <Rect width={s} height={s} fill="#f2f1ec" stroke={strokeColor} />
                  <Text x={0} y={s / 2 - 7} width={s} align="center" text="QR" fontSize={11} fill="#6b6862" />
                </Group>
              );
            }
            // line
            const w = mmToScreenPx(el.widthMm);
            const t = Math.max(1, mmToScreenPx(el.thicknessMm));
            return (
              <Group key={el.id} {...groupProps}>
                <Rect width={w} height={Math.max(t, 8)} fill="transparent" />
                <Rect y={Math.max(t, 8) / 2 - t / 2} width={w} height={t} fill={isSelected ? '#2b6e63' : '#1c1b19'} />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
