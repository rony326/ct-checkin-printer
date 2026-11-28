import { describe, expect, it } from 'vitest';
import type { LabelElement, MediaType } from '../types.js';
import {
  AUTO_BOTTOM_MARGIN_MM,
  DEFAULT_CONTINUOUS_HEIGHT_MM,
  LINE_HEIGHT_FACTOR,
  MIN_LENGTH_MM,
  elementBoxMm,
  estimateContentLengthMm,
  overflowingElementIds,
  printAreaMm,
  rotateLocal,
  type BoxContext,
  type BoxMm,
  type PrintArea,
} from './geometry.js';

const DPI = 300;
const PRINT_PX_MM = 25.4 / DPI;

const ctx: BoxContext = {
  dpi: DPI,
  resolveText: (el) => (el.type === 'static' ? el.value : 'Muster'),
  fontFamily: () => 'ctp-default',
  measure: (text, fontSizePx) => text.length * fontSizePx * 0.5,
  logoAspect: (logoId) => (logoId === 1 ? 2 : undefined),
};

function staticText(value: string, extra: Partial<Extract<LabelElement, { type: 'static' }>> = {}): LabelElement {
  return { id: 't', type: 'static', xMm: 30, yMm: 4, value, fontSize: 60, bold: false, align: 'center', ...extra };
}

const dieCutMedia: MediaType = {
  id: 1,
  vendor: 'brother-ql',
  externalId: '52x29',
  name: '52 × 29 mm',
  widthMm: 52,
  heightMm: 29,
  printableWidthMm: 48.9,
  printableHeightMm: 22.9,
  dieCut: true,
};

const continuousMedia: MediaType = {
  id: 2,
  vendor: 'brother-ql',
  externalId: '62',
  name: '62 mm endlos',
  widthMm: 62,
  heightMm: null,
  printableWidthMm: 58.9,
  printableHeightMm: null,
  dieCut: false,
};

describe('Konstanten', () => {
  it('entsprechen dem Renderer', () => {
    expect(LINE_HEIGHT_FACTOR).toBe(1.3);
    expect(DEFAULT_CONTINUOUS_HEIGHT_MM).toBe(120);
    expect(AUTO_BOTTOM_MARGIN_MM).toBe(2);
    expect(MIN_LENGTH_MM).toBe(10);
  });
});

describe('printAreaMm', () => {
  it('nimmt bei Die-Cut die bedruckbare Fläche', () => {
    expect(printAreaMm(dieCutMedia, null)).toEqual({ widthMm: 48.9, heightMm: 22.9, continuous: false, fixedLength: false });
  });

  it('ignoriert bei Die-Cut eine feste Länge', () => {
    expect(printAreaMm(dieCutMedia, 80)).toEqual({ widthMm: 48.9, heightMm: 22.9, continuous: false, fixedLength: false });
  });

  it('nimmt bei Endlos ohne Länge die Arbeitsfläche', () => {
    expect(printAreaMm(continuousMedia, null)).toEqual({ widthMm: 62, heightMm: 120, continuous: true, fixedLength: false });
  });

  it('nimmt bei Endlos die feste Länge', () => {
    expect(printAreaMm(continuousMedia, 80)).toEqual({ widthMm: 62, heightMm: 80, continuous: true, fixedLength: true });
  });

  it('hebt eine zu kurze feste Länge auf die Mindestlänge an, wie der Renderer', () => {
    expect(printAreaMm(continuousMedia, 4)).toEqual({ widthMm: 62, heightMm: 10, continuous: true, fixedLength: true });
  });
});

describe('rotateLocal', () => {
  it('dreht im Uhrzeigersinn', () => {
    expect(rotateLocal(3, 2, undefined)).toEqual({ x: 3, y: 2 });
    expect(rotateLocal(3, 2, '90')).toEqual({ x: -2, y: 3 });
    expect(rotateLocal(3, 2, '180')).toEqual({ x: -3, y: -2 });
    expect(rotateLocal(3, 2, '270')).toEqual({ x: 2, y: -3 });
  });
});

describe('elementBoxMm', () => {
  const qr: LabelElement = { id: 'q', type: 'qr', xMm: 5, yMm: 5, content: 'qr:hash', sizeMm: 20 };

  it('QR: Quadrat ab dem Anker', () => {
    expect(elementBoxMm(qr, ctx)).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it('QR gedreht: Hülle um den Anker', () => {
    expect(elementBoxMm({ ...qr, rotate: '90' }, ctx)).toEqual({ x: -15, y: 5, width: 20, height: 20 });
  });

  it('Text zentriert: gemessene Breite, Anker in der Mitte', () => {
    const box = elementBoxMm(staticText('Hallo'), ctx);
    expect(box.width).toBeCloseTo(12.7, 2);
    expect(box.height).toBeCloseTo(6.604, 2);
    expect(box.x).toBeCloseTo(23.65, 2);
    expect(box.y).toBeCloseTo(4, 2);
  });

  it('Text links bzw. rechts: Anker am jeweiligen Rand', () => {
    expect(elementBoxMm(staticText('Hallo', { align: 'left' }), ctx).x).toBeCloseTo(30, 2);
    expect(elementBoxMm(staticText('Hallo', { align: 'right' }), ctx).x).toBeCloseTo(17.3, 2);
  });

  it('Text gedreht: Ausrichtung wirkt entlang der gedrehten Achse', () => {
    const box = elementBoxMm(staticText('Hallo', { rotate: '90' }), ctx);
    expect(box.x).toBeCloseTo(30 - 6.604, 2);
    expect(box.y).toBeCloseTo(4 - 6.35, 2);
    expect(box.width).toBeCloseTo(6.604, 2);
    expect(box.height).toBeCloseTo(12.7, 2);
  });

  it('mehrzeiliger Text: längste Zeile bestimmt die Breite', () => {
    const box = elementBoxMm(staticText('A\nBBBB'), ctx);
    expect(box.width).toBeCloseTo(4 * 60 * 0.5 * PRINT_PX_MM, 5);
    expect(box.height).toBeCloseTo(2 * 60 * 1.3 * PRINT_PX_MM, 5);
  });

  it('leerer Text: Breite 0, eine Zeile hoch, keine NaN', () => {
    const box = elementBoxMm(staticText(''), ctx);
    expect(box.width).toBe(0);
    expect(box.height).toBeCloseTo(6.604, 2);
    expect(Object.values(box).every(Number.isFinite)).toBe(true);
  });

  it('Variablentext: gibt Text, Grösse, Schnitt und Schrift an die Messung weiter', () => {
    const calls: unknown[][] = [];
    const el: LabelElement = { id: 'v', type: 'text', xMm: 0, yMm: 0, field: 'person.name', fontSize: 40, bold: true, align: 'left' };
    const box = elementBoxMm(el, {
      ...ctx,
      measure: (...args) => {
        calls.push(args);
        return 300;
      },
    });
    expect(calls).toEqual([['Muster', 40, true, 'ctp-default']]);
    expect(box.width).toBeCloseTo(25.4, 5);
  });

  it('Logo: Breite aus dem Seitenverhältnis', () => {
    const logo: LabelElement = { id: 'l', type: 'logo', xMm: 5, yMm: 5, logoId: 1, heightMm: 10 };
    expect(elementBoxMm(logo, ctx)).toEqual({ x: 5, y: 5, width: 20, height: 10 });
  });

  it('Logo ohne bekanntes Verhältnis: quadratisch', () => {
    const logo: LabelElement = { id: 'l', type: 'logo', xMm: 5, yMm: 5, logoId: 0, heightMm: 10 };
    expect(elementBoxMm(logo, ctx)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it('Linie: echte Dicke ab dem Anker nach unten', () => {
    const line: LabelElement = { id: 's', type: 'line', xMm: 5, yMm: 5, widthMm: 30, thicknessMm: 1 };
    expect(elementBoxMm(line, ctx)).toEqual({ x: 5, y: 5, width: 30, height: 1 });
  });

  it('Linie: mindestens 1 Druck-px dick', () => {
    const line: LabelElement = { id: 's', type: 'line', xMm: 5, yMm: 5, widthMm: 30, thicknessMm: 0.01 };
    expect(elementBoxMm(line, ctx).height).toBeCloseTo(PRINT_PX_MM, 6);
  });
});

describe('estimateContentLengthMm', () => {
  it('hat eine Mindestlänge', () => {
    expect(estimateContentLengthMm([])).toBe(10);
    expect(estimateContentLengthMm([{ x: 0, y: 0, width: 5, height: 3 }])).toBe(10);
  });

  it('nimmt die unterste Kante plus Rand', () => {
    expect(
      estimateContentLengthMm([
        { x: 0, y: 20, width: 5, height: 10 },
        { x: 0, y: 2, width: 5, height: 5 },
      ]),
    ).toBe(32);
  });
});

describe('overflowingElementIds', () => {
  const area: PrintArea = { widthMm: 48.9, heightMm: 22.9, continuous: false, fixedLength: false };

  function ids(boxes: BoxMm[], inArea: PrintArea = area): string[] {
    const elements: LabelElement[] = boxes.map((_, i) => ({ id: `e${i}`, type: 'line', xMm: 0, yMm: 0, widthMm: 1, thicknessMm: 1 }));
    return overflowingElementIds(elements, boxes, inArea);
  }

  it('meldet Überstand rechts, nicht aber bündige Elemente', () => {
    expect(
      ids([
        { x: 30, y: 0, width: 20, height: 5 },
        { x: 28.9, y: 0, width: 20, height: 5 },
      ]),
    ).toEqual(['e0']);
  });

  it('meldet Überstand links, oben und unten', () => {
    expect(
      ids([
        { x: -1, y: 0, width: 5, height: 5 },
        { x: 0, y: -1, width: 5, height: 5 },
        { x: 0, y: 20, width: 5, height: 5 },
        { x: 0, y: 0, width: 48.9, height: 22.9 },
      ]),
    ).toEqual(['e0', 'e1', 'e2']);
  });

  it('toleriert bis 0,05 mm', () => {
    expect(
      ids([
        { x: -0.04, y: -0.04, width: 48.98, height: 22.98 },
        { x: -0.06, y: 0, width: 5, height: 5 },
        { x: 0, y: 0, width: 48.96, height: 5 },
        { x: 0, y: 0, width: 5, height: 22.96 },
      ]),
    ).toEqual(['e1', 'e2', 'e3']);
  });

  it('Endlos automatisch: kein Überstand unten, seitlich und oben schon', () => {
    const auto: PrintArea = { widthMm: 62, heightMm: 120, continuous: true, fixedLength: false };
    expect(
      ids(
        [
          { x: 0, y: 130, width: 5, height: 5 },
          { x: 60, y: 130, width: 5, height: 5 },
          { x: 0, y: -1, width: 5, height: 5 },
        ],
        auto,
      ),
    ).toEqual(['e1', 'e2']);
  });

  it('Endlos mit fester Länge: Überstand unten wird gemeldet', () => {
    const fixed: PrintArea = { widthMm: 62, heightMm: 80, continuous: true, fixedLength: true };
    expect(ids([{ x: 0, y: 78, width: 5, height: 5 }], fixed)).toEqual(['e0']);
  });
});
