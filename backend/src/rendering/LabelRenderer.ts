import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';
import type { LabelElement } from '../db/schema.js';
import type { MediaDefinition, RenderedBitmap } from '../adapters/printer/types.js';
import { resolveTextField, type RenderContext } from '../template/variables.js';
import { computeQrHash } from '../template/qrHash.js';
import { mmToPx } from './dimensions.js';

/**
 * Zeichnet ein Etikett aus positionierten Elementen (siehe LabelElement in
 * db/schema.ts) + aufgelöstem Variablen-Kontext in ein PNG-Bitmap. Läuft
 * identisch für die Editor-Live-Vorschau und den echten Druck (siehe Plan,
 * Abschnitt "Variablen-/Template-Engine").
 *
 * Positionierungsmodell: `xMm`/`yMm` sind der Anker-Punkt gemäss `align`
 * (bei Text via natives Canvas-`textAlign`, kein zusätzliches Breitenfeld
 * nötig) bzw. die obere linke Ecke (bei logo/qr/line). `fontSize` ist
 * bewusst ein Pixelwert bei der Ziel-DPI (wie in v1s label-layout.json),
 * keine mm-Grösse — DPI-unabhängige Etiketten waren kein Anforderungsziel.
 */

const LINE_HEIGHT_FACTOR = 1.3;
const DEFAULT_BOTTOM_MARGIN_MM = 2;
const MIN_CANVAS_HEIGHT_MM = 10;
const ROTATE_RADIANS: Record<'0' | '90' | '180' | '270', number> = { '0': 0, '90': Math.PI / 2, '180': Math.PI, '270': (3 * Math.PI) / 2 };
export const FALLBACK_REGULAR_FAMILY = 'CtCheckinFallback';
export const FALLBACK_BOLD_FAMILY = 'CtCheckinFallback-Bold';

/**
 * DejaVu Sans wird als Datei mitgeliefert (siehe assets/fonts/) statt auf
 * einen system-seitig installierten Font zu vertrauen — v1 brauchte dafür
 * noch ein manuelles `apt-get install fonts-dejavu` (siehe Repo-Root-README);
 * v2 funktioniert dadurch containerisiert ohne diesen Installationsschritt,
 * unabhängig davon, ob/welche Systemfonts im Image vorhanden sind. Gleicher
 * Font wie v1 → visuell konsistentes Druckbild zu bestehenden Etiketten.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let fallbackFontsRegistered = false;
export function ensureFallbackFontsRegistered(): void {
  if (fallbackFontsRegistered) return;
  fallbackFontsRegistered = true;
  GlobalFonts.registerFromPath(path.join(__dirname, '../../assets/fonts/DejaVuSans.ttf'), FALLBACK_REGULAR_FAMILY);
  GlobalFonts.registerFromPath(path.join(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'), FALLBACK_BOLD_FAMILY);
}

export interface RenderLabelOptions {
  dpi: number;
  /** logoId -> Bilddaten (PNG/JPG). LabelRenderer bleibt bewusst DB-/Dateisystem-unabhängig. */
  logos?: Record<number, Buffer>;
  /** fontId -> absoluter Dateipfad (.ttf/.otf). Ebenso DB-/Dateisystem-unabhängig. */
  fonts?: Record<number, string>;
  /** Nur für Endlosmedien (media.heightMm === null) relevant. */
  bottomMarginMm?: number;
}

const fontFamilyCache = new Map<string, string | null>();

/**
 * Registriert eine Custom-Font einmalig pro Pfad; bei fehlendem Pfad oder
 * Ladefehler automatischer Fallback auf die mitgelieferte DejaVu-Sans-Datei
 * — `bold` wählt dabei die Regular/Bold-Variante (siehe README
 * "Custom Font"). Eine erfolgreich geladene Custom-Font ignoriert `bold`
 * bewusst (1:1 v1-Verhalten: ein Block referenziert eine TTF-Datei, keine
 * separate Bold-Variante).
 */
function resolveFontFamily(fontPath: string | undefined, bold: boolean): { family: string; isCustom: boolean } {
  const fallback = () => {
    ensureFallbackFontsRegistered();
    return { family: bold ? FALLBACK_BOLD_FAMILY : FALLBACK_REGULAR_FAMILY, isCustom: false };
  };
  if (!fontPath) return fallback();

  if (!fontFamilyCache.has(fontPath)) {
    const alias = `custom-font-${fontFamilyCache.size}`;
    const key = GlobalFonts.registerFromPath(fontPath, alias);
    fontFamilyCache.set(fontPath, key ? alias : null);
  }
  const cached = fontFamilyCache.get(fontPath);
  return cached ? { family: cached, isCustom: true } : fallback();
}

/** Löst ein text/static-Element auf konkrete Textzeilen auf — von Höhenschätzung UND Zeichnen genutzt. */
function resolveLines(el: Extract<LabelElement, { type: 'text' | 'static' }>, ctx: RenderContext): string[] {
  if (el.type === 'static') return el.value.split('\n');

  const rawLines = resolveTextField(el.field, ctx);
  if (el.field === 'checkin.extra') return rawLines; // schon eigenständige Zeilen, kein Prefix
  return rawLines.length > 0 ? [`${el.prefix ?? ''}${rawLines[0]}`] : [];
}

function estimateElementHeightMm(el: LabelElement, ctx: RenderContext, dpi: number): number {
  switch (el.type) {
    case 'text':
    case 'static': {
      const lines = resolveLines(el, ctx);
      if (lines.length === 0) return 0;
      const lineHeightPx = el.fontSize * LINE_HEIGHT_FACTOR;
      return (lines.length * lineHeightPx * 25.4) / dpi;
    }
    case 'logo':
      return el.heightMm;
    case 'qr':
      return el.sizeMm;
    case 'line':
      return el.thicknessMm;
  }
}

function computeContentHeightMm(elements: LabelElement[], ctx: RenderContext, dpi: number, bottomMarginMm: number): number {
  let maxBottom = 0;
  for (const el of elements) {
    const bottom = el.yMm + estimateElementHeightMm(el, ctx, dpi);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom + bottomMarginMm;
}

function drawTextLines(
  canvasCtx: SKRSContext2D,
  lines: string[],
  el: { xMm: number; yMm: number; fontSize: number; bold: boolean; align: 'left' | 'center' | 'right'; fontId?: number; rotate?: '0' | '90' | '180' | '270' },
  dpi: number,
  fonts: Record<number, string>,
): void {
  if (lines.length === 0) return;
  const fontPath = el.fontId !== undefined ? fonts[el.fontId] : undefined;
  const { family, isCustom } = resolveFontFamily(fontPath, el.bold);
  // "bold "-Prefix nur bei einer Custom-Font nötig (versucht CSS-seitige
  // Synthese, falls die Datei keine eigene Bold-Variante enthält) — beim
  // Fallback ist die Bold-Variante bereits per eigener Familie (DejaVu Sans
  // Bold) gewählt, ein zusätzliches "bold " wäre redundant.
  canvasCtx.font = `${el.bold && isCustom ? 'bold ' : ''}${el.fontSize}px ${family}`;
  canvasCtx.textAlign = el.align;
  canvasCtx.textBaseline = 'top';
  canvasCtx.fillStyle = 'black';

  const xPx = mmToPx(el.xMm, dpi);
  const yPx = mmToPx(el.yMm, dpi);
  const lineHeightPx = el.fontSize * LINE_HEIGHT_FACTOR;
  // Der ganze mehrzeilige Block dreht sich als Einheit um den Anker der ersten Zeile, nicht jede Zeile für sich.
  withRotation(canvasCtx, xPx, yPx, el.rotate, () => {
    let lineYPx = yPx;
    for (const line of lines) {
      canvasCtx.fillText(line, xPx, lineYPx);
      lineYPx += lineHeightPx;
    }
  });
}

function resolveQrContent(el: Extract<LabelElement, { type: 'qr' }>, ctx: RenderContext): string | null {
  if (el.content === 'qr:personId') return ctx.person.id || null;
  // qr:hash — identisch zu v1: kein Hash (und damit kein QR-Block), wenn id oder code fehlen.
  if (!ctx.person.id || !ctx.checkin.code) return null;
  return computeQrHash(ctx.person.id, ctx.checkin.code, ctx.checkin.timestamp);
}

async function drawQr(canvasCtx: SKRSContext2D, el: Extract<LabelElement, { type: 'qr' }>, ctx: RenderContext, dpi: number): Promise<void> {
  const content = resolveQrContent(el, ctx);
  if (!content) return;

  const sizePx = mmToPx(el.sizeMm, dpi);
  const png = await QRCode.toBuffer(content, { type: 'png', margin: 0, width: sizePx, errorCorrectionLevel: 'M' });
  const img = await loadImage(png);
  const xPx = mmToPx(el.xMm, dpi);
  const yPx = mmToPx(el.yMm, dpi);
  withRotation(canvasCtx, xPx, yPx, el.rotate, () => canvasCtx.drawImage(img, xPx, yPx, sizePx, sizePx));
}

async function drawLogo(canvasCtx: SKRSContext2D, el: Extract<LabelElement, { type: 'logo' }>, logos: Record<number, Buffer>, dpi: number): Promise<void> {
  const bytes = logos[el.logoId];
  if (!bytes) return; // Logo nicht gefunden/nicht hochgeladen -> Block überspringen, wie v1 bei fehlender Datei

  const img = await loadImage(bytes);
  const heightPx = mmToPx(el.heightMm, dpi);
  const widthPx = Math.round(heightPx * (img.width / img.height));
  const xPx = mmToPx(el.xMm, dpi);
  const yPx = mmToPx(el.yMm, dpi);
  withRotation(canvasCtx, xPx, yPx, el.rotate, () => canvasCtx.drawImage(img, xPx, yPx, widthPx, heightPx));
}

function drawLine(canvasCtx: SKRSContext2D, el: Extract<LabelElement, { type: 'line' }>, dpi: number): void {
  canvasCtx.fillStyle = 'black';
  const xPx = mmToPx(el.xMm, dpi);
  const yPx = mmToPx(el.yMm, dpi);
  withRotation(canvasCtx, xPx, yPx, el.rotate, () =>
    canvasCtx.fillRect(xPx, yPx, mmToPx(el.widthMm, dpi), Math.max(1, mmToPx(el.thicknessMm, dpi))),
  );
}

/**
 * Dreht die Zeichnung eines Elements um seinen eigenen Anker-Punkt (`xMm`/`yMm` in Bildschirm-/Druck-Pixel).
 * Der Trick, um "um Punkt P drehen" statt "um den Ursprung drehen" zu erreichen: zum Anker verschieben, drehen,
 * um denselben Betrag zurückverschieben — danach zeichnet `draw()` mit exakt denselben absoluten Pixel-Koordinaten
 * wie ohne Rotation, landet aber gedreht auf dem Canvas. Editor-Canvas (Konva `rotation`-Prop) nutzt dieselbe
 * Dreh-Konvention (im Uhrzeigersinn), beide bauen auf der HTML5-Canvas-2D-API auf.
 */
function withRotation(canvasCtx: SKRSContext2D, anchorXPx: number, anchorYPx: number, rotate: '0' | '90' | '180' | '270' | undefined, draw: () => void): void {
  const radians = ROTATE_RADIANS[rotate ?? '0'];
  if (radians === 0) {
    draw();
    return;
  }
  canvasCtx.save();
  canvasCtx.translate(anchorXPx, anchorYPx);
  canvasCtx.rotate(radians);
  canvasCtx.translate(-anchorXPx, -anchorYPx);
  draw();
  canvasCtx.restore();
}

export async function renderLabel(
  elements: LabelElement[],
  media: MediaDefinition,
  context: RenderContext,
  options: RenderLabelOptions,
): Promise<RenderedBitmap> {
  const { dpi, logos = {}, fonts = {}, bottomMarginMm = DEFAULT_BOTTOM_MARGIN_MM } = options;

  const widthPx = mmToPx(media.widthMm, dpi);
  const heightMm = Math.max(media.heightMm ?? computeContentHeightMm(elements, context, dpi, bottomMarginMm), MIN_CANVAS_HEIGHT_MM);
  const heightPx = mmToPx(heightMm, dpi);

  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthPx, heightPx);

  for (const el of elements) {
    switch (el.type) {
      case 'text':
      case 'static':
        drawTextLines(ctx, resolveLines(el, context), el, dpi, fonts);
        break;
      case 'qr':
        await drawQr(ctx, el, context, dpi);
        break;
      case 'logo':
        await drawLogo(ctx, el, logos, dpi);
        break;
      case 'line':
        drawLine(ctx, el, dpi);
        break;
    }
  }

  return { data: canvas.toBuffer('image/png'), widthPx, heightPx };
}
