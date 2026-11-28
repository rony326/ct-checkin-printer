import { describe, expect, it } from 'vitest';
import type { LabelElement, Rotate } from '../types.js';
import { elementBoxMm, type BoxContext, type BoxMm, type PrintArea } from './geometry.js';
import { endLineMm, fromView, rotateArea, stepDeg, toView, type ViewDeg } from './viewRotation.js';

const AREA: PrintArea = { widthMm: 50, heightMm: 30, continuous: false, fixedLength: false, openEdge: null };
const DEGS: ViewDeg[] = ['0', '90', '180', '270'];

const ctx: BoxContext = {
  dpi: 300,
  resolveText: (el) => (el.type === 'static' ? el.value : 'Muster'),
  fontFamily: () => 'ctp-default',
  measure: (text, fontSizePx) => text.length * fontSizePx * 0.5,
  logoAspect: () => 2,
};

const qr: LabelElement = { id: 'q', type: 'qr', xMm: 5, yMm: 4, content: 'qr:hash', sizeMm: 20 };

const ELEMENTS: LabelElement[] = [
  { id: 't', type: 'text', xMm: 5, yMm: 4, field: 'person.name', fontSize: 40, bold: true, align: 'right', fontId: 3, prefix: 'Name: ' },
  { id: 's', type: 'static', xMm: 5, yMm: 4, value: 'Hallo', fontSize: 60, bold: false, align: 'center' },
  { id: 'l', type: 'logo', xMm: 5, yMm: 4, logoId: 1, heightMm: 10 },
  qr,
  { id: 'n', type: 'line', xMm: 5, yMm: 4, widthMm: 30, thicknessMm: 1 },
];

/** Alle Elementtypen in allen Elementdrehungen am gegebenen Anker. */
function variants(xMm: number, yMm: number): LabelElement[] {
  return ELEMENTS.flatMap((el) => DEGS.map((rotate): LabelElement => ({ ...el, xMm, yMm, rotate })));
}

describe('toView', () => {
  it('dreht Anker und Element im Uhrzeigersinn', () => {
    expect(toView(qr, AREA, '90')).toEqual({ ...qr, xMm: 26, yMm: 5, rotate: '90' });
    expect(toView(qr, AREA, '180')).toEqual({ ...qr, xMm: 45, yMm: 26, rotate: '180' });
    expect(toView(qr, AREA, '270')).toEqual({ ...qr, xMm: 4, yMm: 45, rotate: '270' });
  });

  it('zählt die Drehung des Elements und der Ansicht zusammen', () => {
    expect(toView({ ...qr, rotate: '270' }, AREA, '90').rotate).toBe('0');
    expect(toView({ ...qr, rotate: '180' }, AREA, '270').rotate).toBe('90');
  });

  it('liefert bei 0° dasselbe Objekt', () => {
    expect(toView(qr, AREA, '0')).toBe(qr);
    expect(fromView(qr, AREA, '0')).toBe(qr);
  });

  it('hinterlässt keine Gleitkomma-Reste', () => {
    const area: PrintArea = { ...AREA, widthMm: 48.9, heightMm: 22.9 };
    expect(toView({ ...qr, xMm: 12.3, yMm: 7.2 }, area, '180')).toMatchObject({ xMm: 36.6, yMm: 15.7 });
    expect(fromView({ ...qr, xMm: 36.6, yMm: 15.7 }, area, '180')).toMatchObject({ xMm: 12.3, yMm: 7.2 });
  });
});

describe('fromView', () => {
  const areas: PrintArea[] = [AREA, { ...AREA, widthMm: 48.9, heightMm: 22.9 }];

  it.each(DEGS)('kehrt toView bei %s° verlustfrei um', (deg) => {
    for (const area of areas) {
      for (const el of variants(12.345, 7.001)) {
        const back = fromView(toView(el, area, deg), area, deg);
        expect(back).toEqual(el);
        expect(back.xMm).toBe(12.345);
        expect(back.yMm).toBe(7.001);
      }
    }
  });

  it.each(DEGS)('lässt ein Element ohne Drehung bei %s° ungedreht', (deg) => {
    for (const el of ELEMENTS) {
      const { rotate, ...rest } = fromView(toView(el, AREA, deg), AREA, deg);
      expect(rotate ?? '0').toBe('0');
      expect(rest).toEqual(el);
    }
  });
});

describe('Hülle in der Ansicht', () => {
  /** Hülle, mit der Fläche gedreht. */
  function rotateBox(box: BoxMm, area: PrintArea, deg: Rotate): BoxMm {
    const right = area.widthMm - box.x - box.width;
    const bottom = area.heightMm - box.y - box.height;
    switch (deg) {
      case '90':
        return { x: bottom, y: box.x, width: box.height, height: box.width };
      case '180':
        return { x: right, y: bottom, width: box.width, height: box.height };
      case '270':
        return { x: box.y, y: right, width: box.height, height: box.width };
      default:
        return box;
    }
  }

  it('dreht die Hülle eines QR-Codes mit der Fläche', () => {
    expect(elementBoxMm(toView(qr, AREA, '90'), ctx)).toEqual({ x: 6, y: 5, width: 20, height: 20 });
  });

  it.each(DEGS)('entspricht bei %s° für alle Elemente der gedrehten Druck-Hülle', (deg) => {
    for (const el of variants(12.345, 7.001)) {
      const actual = elementBoxMm(toView(el, AREA, deg), ctx);
      const expected = rotateBox(elementBoxMm(el, ctx), AREA, deg);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(actual[key]).toBeCloseTo(expected[key], 9);
    }
  });
});

describe('rotateArea', () => {
  const open: PrintArea = { widthMm: 50, heightMm: 120, continuous: true, fixedLength: false, openEdge: 'bottom' };

  it('tauscht Breite und Höhe bei 90° und 270°', () => {
    expect(rotateArea(AREA, '0')).toEqual(AREA);
    expect(rotateArea(AREA, '90')).toEqual({ ...AREA, widthMm: 30, heightMm: 50 });
    expect(rotateArea(AREA, '180')).toEqual(AREA);
    expect(rotateArea(AREA, '270')).toEqual({ ...AREA, widthMm: 30, heightMm: 50 });
  });

  it('dreht die offene Kante mit', () => {
    expect(DEGS.map((deg) => rotateArea(open, deg).openEdge)).toEqual(['bottom', 'left', 'top', 'right']);
  });

  it('lässt eine geschlossene Fläche geschlossen', () => {
    for (const deg of DEGS) expect(rotateArea(AREA, deg).openEdge).toBeNull();
  });
});

describe('endLineMm', () => {
  const open: PrintArea = { widthMm: 50, heightMm: 120, continuous: true, fixedLength: false, openEdge: 'bottom' };

  it('dreht die Endlinie mit der Fläche', () => {
    expect(endLineMm(40, open, '0')).toEqual({ axis: 'y', valueMm: 40 });
    expect(endLineMm(40, open, '90')).toEqual({ axis: 'x', valueMm: 80 });
    expect(endLineMm(40, open, '180')).toEqual({ axis: 'y', valueMm: 80 });
    expect(endLineMm(40, open, '270')).toEqual({ axis: 'x', valueMm: 40 });
  });
});

describe('stepDeg', () => {
  it('dreht in 90°-Schritten im Kreis', () => {
    expect(stepDeg('0', 1)).toBe('90');
    expect(stepDeg('0', -1)).toBe('270');
    expect(stepDeg('270', 1)).toBe('0');
    expect(stepDeg('180', -1)).toBe('90');
  });
});
