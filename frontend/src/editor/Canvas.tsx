import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { LabelElement } from '../types.js';
import { DEFAULT_BOLD_FONT_FAMILY, DEFAULT_FONT_FAMILY } from './fontMetrics.js';
import { LINE_HEIGHT_FACTOR, dropAnchorMm, type BoxContext, type BoxMm, type PrintArea, type TextLikeElement } from './geometry.js';

/** Reiner Bildschirm-Massstab fürs interaktive Editieren, unabhängig von der Druck-DPI. */
export const SCREEN_PX_PER_MM = 4;
/** Kleinere Kästen werden für die Treffererkennung auf dieses Mass gepolstert, damit dünne Linien greifbar bleiben. */
const MIN_HIT_SIZE_MM = 2;

export function mmToScreenPx(mm: number): number {
  return mm * SCREEN_PX_PER_MM;
}

function screenPxToMm(px: number): number {
  return px / SCREEN_PX_PER_MM;
}

/**
 * CSS-Schriftangabe wie im Renderer: Die mitgelieferte Druckschrift hat eine
 * eigene Bold-Familie, nur bei eigenen Schriften wird „bold" vorangestellt.
 */
export function cssFont(sizePx: number, bold: boolean, family: string): string {
  const isDefault = family === DEFAULT_FONT_FAMILY || family === DEFAULT_BOLD_FONT_FAMILY;
  return `${bold && !isDefault ? 'bold ' : ''}${sizePx}px "${family}"`;
}

/** Trefferkasten in Bildschirm-px; zu dünne Kästen werden symmetrisch auf `MIN_HIT_SIZE_MM` gepolstert. */
function hitRectPx(box: BoxMm): BoxMm {
  const padX = Math.max(0, MIN_HIT_SIZE_MM - box.width) / 2;
  const padY = Math.max(0, MIN_HIT_SIZE_MM - box.height) / 2;
  return {
    x: mmToScreenPx(box.x - padX),
    y: mmToScreenPx(box.y - padY),
    width: mmToScreenPx(box.width + 2 * padX),
    height: mmToScreenPx(box.height + 2 * padY),
  };
}

/**
 * Oberstes (zuletzt gezeichnetes) Element unter dem Punkt gewinnt, wie bei normalem DOM-Stacking.
 *
 * Bewusst NICHT über Konvas eingebaute Treffer-Erkennung gelöst: die
 * ermittelt per Definition, welche Form getroffen wurde, indem sie jede Form
 * unsichtbar in einer eigenen Farbe auf eine zweite Canvas zeichnet und die
 * Pixelfarbe an der Klickposition per `getImageData` ausliest (siehe
 * konva/lib/Layer.js `_getIntersection`). Canvas-Fingerprinting-Schutz
 * (uBlock/Brave Shields/"Canvas Blocker" u.ä.) verfälscht genau diese
 * Pixel-Auslese gezielt — mit dem Ergebnis, dass Konva nie eine Form trifft:
 * Klicks/Drags auf dem Editor-Canvas taten dann komplett nichts, ganz ohne
 * Fehler in der Konsole. Diese eigene, geometrische Prüfung über die Kästen
 * aus `geometry.ts` ist von Canvas-Pixel-Auslese unabhängig und funktioniert
 * deshalb auch mit aktiviertem Schutz.
 */
function pickElementAt(elements: LabelElement[], boxes: BoxMm[], x: number, y: number): LabelElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const box = boxes[i];
    if (!box) continue;
    const hit = hitRectPx(box);
    if (x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height) return elements[i]!;
  }
  return null;
}

/**
 * Text wie im Renderer: Anker oben, `textAlign` gemäss `align`, jede weitere
 * Zeile `fontSize × LINE_HEIGHT_FACTOR` tiefer. Konvas `Text` zentriert die
 * Glyphen stattdessen in der Zeilenhöhe und stünde damit sichtbar tiefer als
 * im Druck; ein eigenes `'top'` deutet der Browser anders als der Renderer
 * (siehe fontMetrics.ts). Deshalb ab der Grundlinie, deren Lage aus der
 * Schriftdatei stammt — solange sie fehlt, mit der Browser-Deutung von 'top'.
 */
function DraftText({ el, ctx, fill, baselineRatio }: { el: TextLikeElement; ctx: BoxContext; fill: string; baselineRatio: number | undefined }) {
  const lines = ctx.resolveText(el).split('\n');
  const sizePx = mmToScreenPx((el.fontSize * 25.4) / ctx.dpi);
  const font = cssFont(sizePx, el.bold, ctx.fontFamily(el));
  const firstLineY = baselineRatio === undefined ? 0 : baselineRatio * sizePx;
  return (
    <Shape
      sceneFunc={(context) => {
        context.setAttr('font', font);
        context.setAttr('textAlign', el.align);
        context.setAttr('textBaseline', baselineRatio === undefined ? 'top' : 'alphabetic');
        context.setAttr('fillStyle', fill);
        lines.forEach((line, i) => context.fillText(line, 0, firstLineY + i * sizePx * LINE_HEIGHT_FACTOR));
      }}
    />
  );
}

interface Props {
  area: PrintArea;
  /** `boxes[i]` gehört zu `elements[i]`, in mm (siehe `elementBoxMm`). */
  boxes: BoxMm[];
  elements: LabelElement[];
  boxCtx: BoxContext;
  /** Geladene Logo-Bilder je logoId; fehlt eines, erscheint ein Platzhalter. */
  logoImages: Record<number, HTMLImageElement>;
  /** Automatische Etikettenlänge bei Endlos ohne feste Länge, sonst `null`. */
  autoLengthMm: number | null;
  /** Anker→Grundlinie je Schriftfamilie als Anteil der Schriftgrösse. */
  baselineRatios: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, xMm: number, yMm: number) => void;
}

export function Canvas({ area, boxes, elements, boxCtx, logoImages, autoLengthMm, baselineRatios, selectedId, onSelect, onMove: onMoveElement }: Props) {
  const widthPx = mmToScreenPx(area.widthMm);
  const heightPx = mmToScreenPx(area.heightMm);

  const stageRef = useRef<Konva.Stage | null>(null);
  // Live-Position während des Ziehens, unquantisiert für flüssiges Gefühl — erst beim Loslassen gerundet (siehe finishDrag).
  const [dragPreview, setDragPreview] = useState<{ id: string; xPx: number; yPx: number } | null>(null);
  const previewRef = useRef<{ id: string; xPx: number; yPx: number } | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => () => detachRef.current?.(), []);

  function setCursor(cursor: string) {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = cursor;
  }

  /**
   * Nach dem Greifen wird der Zeiger auf `window` verfolgt (wie Pointer-Capture):
   * Das Element bleibt am Finger bzw. an der Maus, auch wenn sie kurz über den
   * Etikettenrand hinausfährt — vorher brach der Drag dort einfach ab.
   */
  function handlePointerDown() {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!stage || !pos) return;
    const hit = pickElementAt(elements, boxes, pos.x, pos.y);
    onSelect(hit?.id ?? null);
    if (!hit) return;

    // Greif-Versatz merken, damit das Element nicht zum Zeiger springt.
    const offsetXPx = pos.x - mmToScreenPx(hit.xMm);
    const offsetYPx = pos.y - mmToScreenPx(hit.yMm);
    const id = hit.id;
    setCursor('grabbing');

    const onMove = (event: PointerEvent) => {
      const rect = stage.container().getBoundingClientRect();
      // Der Anker bleibt auf der Fläche.
      const xPx = Math.min(Math.max(0, event.clientX - rect.left - offsetXPx), widthPx);
      const yPx = Math.min(Math.max(0, event.clientY - rect.top - offsetYPx), heightPx);
      previewRef.current = { id, xPx, yPx };
      setDragPreview(previewRef.current);
    };
    const finishDrag = () => {
      detach();
      const preview = previewRef.current;
      previewRef.current = null;
      setDragPreview(null);
      setCursor('grab');
      if (preview) {
        onMoveElement(preview.id, dropAnchorMm(screenPxToMm(preview.xPx), area.widthMm), dropAnchorMm(screenPxToMm(preview.yPx), area.heightMm));
      }
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      detachRef.current = null;
    };
    detachRef.current?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    detachRef.current = detach;
  }

  /** Cursor zeigt schon vor dem Klick, was greifbar ist. */
  function handleHover() {
    if (detachRef.current) return;
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    setCursor(pickElementAt(elements, boxes, pos.x, pos.y) ? 'grab' : 'default');
  }

  const autoLengthPx = autoLengthMm !== null ? mmToScreenPx(autoLengthMm) : null;

  return (
    <div className="paper">
      <Stage ref={stageRef} width={Math.ceil(widthPx)} height={Math.ceil(heightPx)} onPointerDown={handlePointerDown} onPointerMove={handleHover}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={widthPx} height={heightPx} fill="white" stroke="#e4e1da" />
          {elements.map((el) => {
            const isSelected = el.id === selectedId;
            const strokeColor = isSelected ? '#2b6e63' : '#c9c5ba';
            const inkColor = isSelected ? '#2b6e63' : '#1c1b19';
            const isDragging = dragPreview?.id === el.id;
            const x = isDragging ? dragPreview.xPx : mmToScreenPx(el.xMm);
            const y = isDragging ? dragPreview.yPx : mmToScreenPx(el.yMm);

            // Leicht transparent, solange es „in der Hand" liegt.
            const groupProps = { x, y, rotation: Number(el.rotate ?? '0'), opacity: isDragging ? 0.75 : 1 };

            if (el.type === 'text' || el.type === 'static') {
              return (
                <Group key={el.id} {...groupProps}>
                  <DraftText el={el} ctx={boxCtx} fill={inkColor} baselineRatio={baselineRatios[boxCtx.fontFamily(el)]} />
                </Group>
              );
            }
            if (el.type === 'logo') {
              const h = mmToScreenPx(el.heightMm);
              const image = logoImages[el.logoId];
              if (image) {
                const w = h * (image.naturalWidth / image.naturalHeight);
                return (
                  <Group key={el.id} {...groupProps}>
                    <KonvaImage image={image} width={w} height={h} />
                    {isSelected && <Rect width={w} height={h} stroke={strokeColor} dash={[4, 3]} />}
                  </Group>
                );
              }
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
            // Linie: wie im Renderer ab dem Anker nach unten, mindestens 1 Druck-px dick.
            return (
              <Group key={el.id} {...groupProps}>
                <Rect
                  width={mmToScreenPx(el.widthMm)}
                  height={mmToScreenPx(Math.max(el.thicknessMm, 25.4 / boxCtx.dpi))}
                  fill={inkColor}
                />
              </Group>
            );
          })}
          {autoLengthPx !== null && autoLengthPx <= heightPx && (
            <Group y={autoLengthPx}>
              <Line points={[0, 0, widthPx, 0]} stroke="#b0573c" strokeWidth={1} dash={[6, 4]} />
              <Text x={4} y={3} text="Etikett endet hier (automatisch)" fontSize={10} fill="#b0573c" />
            </Group>
          )}
        </Layer>
      </Stage>
    </div>
  );
}
