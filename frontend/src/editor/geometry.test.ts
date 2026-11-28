import { describe, expect, it } from 'vitest';
import type { LabelElement, MediaType } from '../types.js';
import {
  AUTO_BOTTOM_MARGIN_MM,
  alignElement,
  DEFAULT_CONTINUOUS_HEIGHT_MM,
  LINE_HEIGHT_FACTOR,
  MAX_LENGTH_MM,
  MIN_LENGTH_MM,
  clampLengthMm,
  parseLengthInput,
  elementBoxMm,
  estimateContentLengthMm,
  overflowingElementIds,
  printAreaMm,
  dropAnchorMm,
  rotateLocal,
  SNAP_THRESHOLD_MM,
  DRAG_THRESHOLD_PX,
  exceedsDragThreshold,
  releaseAnchorMm,
  findSnap,
  roundMm,
  snapAnchor,
  snapTargets,
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
    expect(MAX_LENGTH_MM).toBe(1000);
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

  it('lässt die Arbeitsfläche mit längerem Inhalt mitwachsen (aufgerundet)', () => {
    expect(printAreaMm(continuousMedia, null, 150.2).heightMm).toBe(151);
    expect(printAreaMm(continuousMedia, null, 80).heightMm).toBe(120);
  });

  it('begrenzt die automatische Arbeitsfläche auf die längste Etikettenlänge', () => {
    expect(printAreaMm(continuousMedia, null, 999.2).heightMm).toBe(1000);
    expect(printAreaMm(continuousMedia, null, 10_022).heightMm).toBe(MAX_LENGTH_MM);
    expect(printAreaMm(continuousMedia, null, 1e12).heightMm).toBe(MAX_LENGTH_MM);
  });

  it('beachtet die Inhaltslänge weder bei fester Länge noch bei Die-Cut', () => {
    expect(printAreaMm(continuousMedia, 80, 150).heightMm).toBe(80);
    expect(printAreaMm(dieCutMedia, null, 150).heightMm).toBe(22.9);
  });
});

describe('parseLengthInput', () => {
  it('liest eine Zahl', () => {
    expect(parseLengthInput('80')).toBe(80);
    expect(parseLengthInput('80.5')).toBe(80.5);
    expect(parseLengthInput('4')).toBe(4);
  });

  it.each(['', '  ', 'abc', 'Infinity', 'NaN'])('liefert für „%s" null', (text) => {
    expect(parseLengthInput(text)).toBeNull();
  });
});

describe('clampLengthMm', () => {
  it('begrenzt auf 10 bis 1000 mm', () => {
    expect(clampLengthMm(-5)).toBe(10);
    expect(clampLengthMm(0)).toBe(10);
    expect(clampLengthMm(80.5)).toBe(80.5);
    expect(clampLengthMm(4000)).toBe(1000);
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

  it('Endlos automatisch: meldet, was über die längste Etikettenlänge hinausragt', () => {
    const capped = printAreaMm(continuousMedia, null, 10_022);
    expect(
      ids(
        [
          { x: 0, y: 995, width: 5, height: 5.04 },
          { x: 0, y: 995, width: 5, height: 5.06 },
          { x: 0, y: 10_000, width: 5, height: 5 },
        ],
        capped,
      ),
    ).toEqual(['e1', 'e2']);
  });

  it('Endlos mit fester Länge: Überstand unten wird gemeldet', () => {
    const fixed: PrintArea = { widthMm: 62, heightMm: 80, continuous: true, fixedLength: true };
    expect(ids([{ x: 0, y: 78, width: 5, height: 5 }], fixed)).toEqual(['e0']);
  });
});

describe('dropAnchorMm', () => {
  it('rundet auf 0,5 mm', () => {
    expect(dropAnchorMm(12.3, 48.9)).toBe(12.5);
    expect(dropAnchorMm(12.2, 48.9)).toBe(12);
  });

  it('bleibt nach dem Runden auf der Fläche', () => {
    expect(dropAnchorMm(48.9, 48.9)).toBe(48.9);
    expect(dropAnchorMm(48.8, 48.9)).toBe(48.9);
    expect(dropAnchorMm(-0.1, 48.9)).toBe(0);
  });
});

const SNAP_AREA: PrintArea = { widthMm: 50, heightMm: 30, continuous: false, fixedLength: false };

describe('snapTargets', () => {
  const values = (targets: ReturnType<typeof snapTargets>, axis: 'x' | 'y', priority: number) =>
    targets.filter((t) => t.axis === axis && t.priority === priority).map((t) => t.valueMm);

  it('liefert Ränder und Mitten des Etiketts', () => {
    const targets = snapTargets(SNAP_AREA, [], null);
    expect(values(targets, 'x', 1)).toEqual([0, 25, 50]);
    expect(values(targets, 'y', 1)).toEqual([0, 15, 30]);
    expect(targets).toHaveLength(6);
  });

  it('liefert Kanten und Mitten der anderen Elemente', () => {
    const targets = snapTargets(SNAP_AREA, [{ x: 2, y: 4, width: 6, height: 8 }], null);
    expect(values(targets, 'x', 2)).toEqual([2, 5, 8]);
    expect(values(targets, 'y', 2)).toEqual([4, 8, 12]);
  });

  it('erzeugt Rasterlinien von 0 bis zum Flächenrand', () => {
    const targets = snapTargets({ ...SNAP_AREA, widthMm: 12 }, [], 5);
    expect(values(targets, 'x', 3)).toEqual([0, 5, 10]);
    expect(values(targets, 'y', 3)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });

  it('Endlos automatisch: keine Ziele für Unterkante und senkrechte Mitte des Etiketts', () => {
    const targets = snapTargets({ widthMm: 62, heightMm: 120, continuous: true, fixedLength: false }, [], 10);
    expect(values(targets, 'y', 1)).toEqual([0]);
    expect(values(targets, 'x', 1)).toEqual([0, 31, 62]);
    expect(values(targets, 'y', 3)).toContain(120);
  });

  it('bleibt auch bei riesigem Inhalt überschaubar', () => {
    const area = printAreaMm(continuousMedia, null, 1e12);
    // Feinstes Raster: 0 bis 62 mm waagrecht, 0 bis 1000 mm senkrecht.
    expect(values(snapTargets(area, [], 2.5), 'y', 3)).toHaveLength(401);
  });

  it('Endlos mit fester Länge: Unterkante und Mitte sind Ziele', () => {
    const targets = snapTargets({ widthMm: 62, heightMm: 80, continuous: true, fixedLength: true }, [], null);
    expect(values(targets, 'y', 1)).toEqual([0, 40, 80]);
  });
});

describe('findSnap', () => {
  const labelTargets = snapTargets(SNAP_AREA, [], null);

  it('rastet die Mitte des Kastens auf die Etikettenmitte', () => {
    const snap = findSnap({ x: 23.2, y: 3, width: 4, height: 4 }, labelTargets, SNAP_THRESHOLD_MM);
    expect(snap.dxMm).toBeCloseTo(-0.2);
    expect(snap.guides).toContainEqual({ axis: 'x', valueMm: 25 });
  });

  it('rastet die linke Kante aufs Raster', () => {
    const snap = findSnap({ x: 9.6, y: 3, width: 3, height: 4 }, snapTargets(SNAP_AREA, [], 5), SNAP_THRESHOLD_MM);
    expect(snap.dxMm).toBeCloseTo(0.4);
    expect(snap.guides).toContainEqual({ axis: 'x', valueMm: 10 });
  });

  it('bei Gleichstand gewinnt die kleinere Priorität', () => {
    const targets = snapTargets(SNAP_AREA, [{ x: 25.3, y: 20, width: 12, height: 2 }], null);
    // Reihenfolge der Ziele darf keine Rolle spielen.
    for (const ordered of [targets, [...targets].reverse()]) {
      const snap = findSnap({ x: 23.15, y: 5, width: 4, height: 2 }, ordered, SNAP_THRESHOLD_MM);
      expect(snap.guides).toEqual([{ axis: 'x', valueMm: 25 }]);
      expect(snap.dxMm).toBeCloseTo(-0.15);
    }
  });

  it('der kleinere Abstand schlägt die kleinere Priorität', () => {
    const targets = snapTargets(SNAP_AREA, [{ x: 25.3, y: 20, width: 12, height: 2 }], null);
    const snap = findSnap({ x: 23.2, y: 5, width: 4, height: 2 }, targets, SNAP_THRESHOLD_MM);
    expect(snap.guides).toEqual([{ axis: 'x', valueMm: 25.3 }]);
  });

  it('ohne Ziel im Fangbereich passiert nichts', () => {
    const snap = findSnap({ x: 10, y: 5, width: 4, height: 4 }, labelTargets, SNAP_THRESHOLD_MM);
    expect(snap).toEqual({ dxMm: 0, dyMm: 0, guides: [] });
  });

  it('die Achsen rasten unabhängig', () => {
    const snap = findSnap({ x: 10, y: 0.5, width: 4, height: 4 }, labelTargets, SNAP_THRESHOLD_MM);
    expect(snap.dxMm).toBe(0);
    expect(snap.dyMm).toBeCloseTo(-0.5);
    expect(snap.guides).toEqual([{ axis: 'y', valueMm: 0 }]);
  });

  it('verträgt einen Kasten ohne Breite', () => {
    const snap = findSnap({ x: 24.5, y: 3, width: 0, height: 4 }, labelTargets, SNAP_THRESHOLD_MM);
    expect(snap.dxMm).toBeCloseTo(0.5);
    expect(Number.isNaN(snap.dyMm)).toBe(false);
  });
});

describe('roundMm', () => {
  it('rundet auf die Schrittweite ohne Gleitkomma-Reste', () => {
    expect(roundMm(12.345, 0.1)).toBe(12.3);
    expect(roundMm(12.3, 0.5)).toBe(12.5);
  });
});

describe('snapAnchor', () => {
  const targets = snapTargets(SNAP_AREA, [], null);

  it('rundet die eingerastete Achse auf 0,1 mm und lässt die freie unverändert', () => {
    // Anker in der Kastenmitte, wie bei zentriertem Text.
    const result = snapAnchor({ xMm: 24.37, yMm: 6.37 }, { x: 22.37, y: 6.37, width: 4, height: 4 }, targets, SNAP_AREA);
    expect(result).toEqual({ xMm: 25, yMm: 6.37, guides: [{ axis: 'x', valueMm: 25 }] });
  });

  it('verwirft ein Einrasten, das den Anker von der Fläche schieben würde', () => {
    // Anker links, Kasten läuft nach links (z. B. um 180° gedreht): rechte Kante auf 0 hiesse Anker < 0.
    const result = snapAnchor({ xMm: 0.2, yMm: 8 }, { x: -4, y: 8, width: 5, height: 2 }, targets, SNAP_AREA);
    expect(result).toEqual({ xMm: 0.2, yMm: 8, guides: [] });
  });

  it('begrenzt den eingerasteten Anker auf die Fläche', () => {
    const area: PrintArea = { ...SNAP_AREA, widthMm: 48.96 };
    const result = snapAnchor({ xMm: 48.5, yMm: 8 }, { x: 44.5, y: 8, width: 4, height: 2 }, snapTargets(area, [], null), area);
    expect(result.xMm).toBe(48.96);
  });
});

describe('exceedsDragThreshold', () => {
  const start = { x: 100, y: 50 };

  it('ignoriert Zittern unter 4 px, auch schräg', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    for (const pos of [start, { x: 101, y: 50 }, { x: 103.9, y: 50 }, { x: 100, y: 46.1 }, { x: 102.8, y: 52.8 }]) {
      expect(exceedsDragThreshold(start, pos)).toBe(false);
    }
  });

  it('beginnt das Ziehen ab 4 px Abstand in jede Richtung', () => {
    for (const pos of [{ x: 104, y: 50 }, { x: 96, y: 50 }, { x: 100, y: 54 }, { x: 103, y: 53 }]) {
      expect(exceedsDragThreshold(start, pos)).toBe(true);
    }
  });
});

describe('releaseAnchorMm', () => {
  it('rundet freie Achsen auf 0,5 mm und begrenzt sie auf die Fläche', () => {
    expect(releaseAnchorMm({ xMm: 12.3, yMm: 29.9, guides: [] }, SNAP_AREA)).toEqual({ xMm: 12.5, yMm: 30 });
  });

  it('behält eingerastete Achsen unverändert', () => {
    expect(releaseAnchorMm({ xMm: 9.4, yMm: 12.3, guides: [{ axis: 'x', valueMm: 25 }] }, SNAP_AREA)).toEqual({ xMm: 9.4, yMm: 12.5 });
    expect(releaseAnchorMm({ xMm: 12.3, yMm: 21.9, guides: [{ axis: 'y', valueMm: 22.9 }] }, SNAP_AREA)).toEqual({ xMm: 12.5, yMm: 21.9 });
  });
});

describe('alignElement', () => {
  const qr: LabelElement = { id: 'q', type: 'qr', xMm: 7, yMm: 3, content: 'qr:hash', sizeMm: 20 };
  const align = (el: LabelElement, cmd: Parameters<typeof alignElement>[1], area: PrintArea = SNAP_AREA) =>
    alignElement(el, cmd, area, elementBoxMm(el, ctx));

  it('richtet ein Element waagrecht aus und lässt Y unverändert', () => {
    expect(align(qr, 'left')).toEqual({ ...qr, xMm: 0 });
    expect(align(qr, 'hcenter')).toEqual({ ...qr, xMm: 15 });
    expect(align(qr, 'right')).toEqual({ ...qr, xMm: 30 });
  });

  it('richtet ein Element senkrecht aus und lässt X unverändert', () => {
    expect(align(qr, 'top')).toEqual({ ...qr, yMm: 0 });
    expect(align(qr, 'vcenter')).toEqual({ ...qr, yMm: 5 });
    expect(align(qr, 'bottom')).toEqual({ ...qr, yMm: 10 });
  });

  it('setzt bei ungedrehtem Text Ausrichtung und Anker', () => {
    const text = staticText('Hallo', { xMm: 7, align: 'right' });
    expect(align(text, 'left')).toEqual({ ...text, align: 'left', xMm: 0 });
    expect(align(text, 'hcenter')).toEqual({ ...text, align: 'center', xMm: 25 });
    expect(align({ ...text, rotate: '0' } as LabelElement, 'right')).toEqual({ ...text, rotate: '0', align: 'right', xMm: 50 });
  });

  it('setzt auch bei Variablenfeldern ohne Textbreite einen gültigen Anker', () => {
    const field: LabelElement = { id: 'v', type: 'text', xMm: 7, yMm: 4, field: 'person.name', fontSize: 40, bold: false, align: 'left' };
    const empty = { ...ctx, resolveText: () => '' };
    const box = elementBoxMm(field, empty);
    expect(alignElement(field, 'right', SNAP_AREA, box)).toEqual({ ...field, align: 'right', xMm: 50 });
    const rotated: LabelElement = { ...field, rotate: '90' };
    expect(alignElement(rotated, 'hcenter', SNAP_AREA, elementBoxMm(rotated, empty))).toEqual({ ...rotated, xMm: 27.2 });
  });

  it('zentriert Text senkrecht auf 0,1 mm gerundet', () => {
    const text = staticText('Hallo');
    expect(align(text, 'vcenter')).toEqual({ ...text, yMm: 11.7 });
  });

  it('verschiebt gedrehten Text nach seiner Hülle, ohne die Ausrichtung zu ändern', () => {
    const text = staticText('Hallo', { rotate: '90', align: 'left' });
    const result = align(text, 'hcenter');
    expect(result).toEqual({ ...text, xMm: 28.3 });
    const box = elementBoxMm(result, ctx);
    expect(Math.abs(box.x + box.width / 2 - 25)).toBeLessThanOrEqual(0.05);
  });

  it('richtet ein gedrehtes Element mit der Hülle am Rand aus', () => {
    const turned: LabelElement = { ...qr, rotate: '180' };
    expect(align(turned, 'left')).toEqual({ ...turned, xMm: 20 });
    expect(align(turned, 'bottom')).toEqual({ ...turned, yMm: 30 });
  });

  it('zentriert auch Elemente, die breiter als die Fläche sind', () => {
    expect(align({ ...qr, sizeMm: 60 }, 'hcenter')).toMatchObject({ xMm: -5 });
  });
});
