import { Group, Layer, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Align, LabelElement, MediaType, VariableDefs } from '../types.js';
import { VENDOR_DPI } from '../types.js';

/** Reiner Bildschirm-Massstab fürs interaktive Editieren, unabhängig von der Druck-DPI. */
export const SCREEN_PX_PER_MM = 4;
const DEFAULT_CONTINUOUS_HEIGHT_MM = 120;

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

  function dragBoundFunc(pos: { x: number; y: number }) {
    return { x: Math.max(0, mmToScreenPx(screenPxToMm(pos.x))), y: Math.max(0, mmToScreenPx(screenPxToMm(pos.y))) };
  }

  return (
    <div style={{ display: 'inline-block', boxShadow: '0 4px 16px rgba(28,27,25,0.14)' }}>
      <Stage
        width={widthPx}
        height={heightPx}
        onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.target === e.target.getStage()) onSelect(null);
        }}
      >
        <Layer>
          <Rect x={0} y={0} width={widthPx} height={heightPx} fill="white" stroke="#e4e1da" />
          {elements.map((el) => {
            const isSelected = el.id === selectedId;
            const strokeColor = isSelected ? '#2b6e63' : '#c9c5ba';

            const groupProps = {
              x: mmToScreenPx(el.xMm),
              y: mmToScreenPx(el.yMm),
              draggable: true,
              onClick: () => onSelect(el.id),
              onTap: () => onSelect(el.id),
              dragBoundFunc,
              onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                onMove(el.id, screenPxToMm(e.target.x()), screenPxToMm(e.target.y()));
              },
            };

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
                  <Text x={4} y={h / 2 - 7} width={h - 8} text="Logo" fontSize={11} fill="#6b6862" listening={false} />
                </Group>
              );
            }
            if (el.type === 'qr') {
              const s = mmToScreenPx(el.sizeMm);
              return (
                <Group key={el.id} {...groupProps}>
                  <Rect width={s} height={s} fill="#f2f1ec" stroke={strokeColor} />
                  <Text x={0} y={s / 2 - 7} width={s} align="center" text="QR" fontSize={11} fill="#6b6862" listening={false} />
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
