# Etiketten-Editor: Ansicht drehen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entwurf und Vorschau lassen sich in 90°-Schritten drehen und aufrecht bearbeiten, ohne dass sich gespeicherte Werte oder der Druck ändern.

**Architecture:** Gespeichert wird weiter in Druckkoordinaten. Ein reines Modul `viewRotation.ts` rechnet Elemente und Fläche in die Ansicht um; Canvas, Einrasten, Pfeiltasten, Ausrichten und Panel arbeiten auf den Ansichtswerten, jede Änderung wird sofort zurückgerechnet. Längenschätzung und Überstand-Prüfung bleiben im Druckraum.

**Tech Stack:** React 19, react-konva, Vitest. Nur `frontend/`.

**Spec:** `docs/superpowers/specs/2026-11-28-editor-ansicht-drehen-design.md`

## Global Constraints

- Keine Änderung an Backend, API, Datenbank, Renderer oder Druck.
- Standard-Winkel `'0'`; bei `'0'` verhält sich der Editor exakt wie heute.
- 90° im Uhrzeigersinn bei Druckfläche B×H: Anker `(x, y) → (H − y, x)`, Elementdrehung `+90°`, Ansichtsfläche H×B; 180°: `(B − x, H − y)`; 270°: `(y, B − x)`.
- Hin und zurück verlustfrei auf 0,001 mm.
- Drehen der Ansicht allein ändert `elements` nicht und markiert nichts als „Nicht gespeichert“.
- Winkel pro Layout in `localStorage`, Schlüssel `ctp.editor.view.<layoutId>`, Zugriffe in try/catch, sonst `'0'`.
- Treffererkennung bleibt geometrisch (`listening={false}`).
- Deutsche Texte, Schweizer Schreibweise ohne ß.

## Review Focus

1. **Layout bei 90° öffnen, ein Feld ändern, speichern** → nur dieses Feld ändert sich, alle anderen Elemente bleiben byte-gleich. Test in Task 2, Browser Task 3.
2. **Endlos automatisch bei 90°/180°, unterstes Element weiter nach unten schieben** → Arbeitslänge wächst, die Druckwerte der übrigen Elemente bleiben. Browser Task 3.
3. **Kaputter oder gesperrter `localStorage`** → Ansicht 0°. Test in Task 2.
4. **Breites Medium gedreht** → ganze Fläche per Scrollen erreichbar, kein Seiten-Scroll bei 390 px. Browser Task 3.
5. **Schrift-/Logo-Upload bei gedrehter Ansicht** → Element behält Lage und Drehung. Browser Task 3.

---

### Task 1: Umrechnung zwischen Druck und Ansicht

**Files:**
- Create: `frontend/src/editor/viewRotation.ts`, `frontend/src/editor/viewRotation.test.ts`
- Modify: `frontend/src/editor/geometry.ts` (`PrintArea`, `printAreaMm`, `snapTargets`, `overflowingElementIds`)
- Modify: `frontend/src/editor/geometry.test.ts`, `frontend/src/pages/LayoutEditor.tsx` (`FALLBACK_AREA`)

**Interfaces:**
- Produces (geometry.ts): `type Edge = 'top' | 'right' | 'bottom' | 'left'`; `PrintArea.openEdge: Edge | null` — `printAreaMm` setzt `'bottom'` bei Endlos ohne feste Länge, sonst `null`. `snapTargets` lässt für die offene Kante deren Kante und die Mitte dieser Achse weg; `overflowingElementIds` entscheidet anhand `openEdge === 'bottom'` (Aufruf bleibt im Druckraum).
- Produces (viewRotation.ts):
  - `type ViewDeg = Rotate`
  - `rotateArea(area: PrintArea, deg: ViewDeg): PrintArea` (Breite/Höhe bei 90/270 getauscht; `openEdge` `'bottom'` → `'left'` / `'top'` / `'right'` für 90/180/270)
  - `toView(el: LabelElement, printArea: PrintArea, deg: ViewDeg): LabelElement`
  - `fromView(el: LabelElement, printArea: PrintArea, deg: ViewDeg): LabelElement` (zweites Argument ist die **Druck**fläche)
  - `endLineMm(lengthMm: number, printArea: PrintArea, deg: ViewDeg): { axis: 'x' | 'y'; valueMm: number }`
  - `stepDeg(deg: ViewDeg, direction: 1 | -1): ViewDeg`
- Bei `deg === '0'` geben `toView`/`fromView` dasselbe Objekt zurück.

- [ ] **Step 1: Failing Tests** (`viewRotation.test.ts`, Fläche 50×30, `openEdge: null`):
  - `toView` eines Elements bei `(5, 4)` ohne `rotate`: `'90'` → `(26, 5, rotate '90')`; `'180'` → `(45, 26, '180')`; `'270'` → `(4, 45, '270')`.
  - Element mit `rotate: '270'` bei Ansicht `'90'` → `rotate: '0'`.
  - Für alle vier Winkel, alle fünf Elementtypen, alle vier Elementdrehungen, Anker `(12.345, 7.001)`: `fromView(toView(el))` hat dieselben `xMm`/`yMm` (exakt gleich) und dieselbe Drehung; übrige Felder unverändert; `align` bleibt.
  - Hülle: `elementBoxMm(toView(el))` entspricht der um die Fläche gedrehten Hülle von `elementBoxMm(el)` (QR 20 mm bei `(5, 4)`, `'90'` → `{ x: 6, y: 5, width: 20, height: 20 }`).
  - `rotateArea`: `'90'` → 30×50; `openEdge 'bottom'` → `'left'`, `'180'` → `'top'`, `'270'` → `'right'`; `null` bleibt `null`.
  - `endLineMm(40, {50×120 offen}, …)`: `'0'` → `{y, 40}`, `'90'` → `{x, 80}`, `'180'` → `{y, 80}`, `'270'` → `{x, 40}`.
  - `stepDeg('0', -1) === '270'`, `stepDeg('270', 1) === '0'`.
- [ ] **Step 2: Failing Tests** (`geometry.test.ts`): bestehende Flächen-Literale um `openEdge` ergänzen; neu: `snapTargets` bei `openEdge: 'left'`, Fläche 120×50 → x-Ziele der Priorität 1 nur `[120]`; `'top'` → y nur `[height]`; `'right'` → x nur `[0]`.
- [ ] **Step 3:** `npm test --workspace frontend` → FAIL.
- [ ] **Step 4:** Implementieren. Koordinaten nach jeder Umrechnung mit `roundMm(v, 0.001)`. `fromView` rechnet den Anker mit der Umkehrabbildung (90: `(vy, H − vx)`; 180: `(B − vx, H − vy)`; 270: `(B − vy, vx)`) und zieht den Winkel von der Drehung ab. In `snapTargets` die vorhandene doppelte x-Etikett-Zeile entfernen.
- [ ] **Step 5:** Tests und `npm run typecheck --workspace frontend` → sauber.
- [ ] **Step 6: Commit** `feat: Umrechnung zwischen Druck und gedrehter Ansicht`

### Task 2: Gedrehte Ansicht im Editor

**Files:**
- Create: `frontend/src/editor/viewSettings.ts`, `frontend/src/editor/viewSettings.test.ts`, `frontend/src/editor/RotatedImage.tsx`, `frontend/src/editor/ViewControls.tsx`
- Modify: `frontend/src/pages/LayoutEditor.tsx`, `frontend/src/editor/Canvas.tsx`, `frontend/src/editor/PropertiesPanel.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces: `parseViewDeg(raw: string | null): ViewDeg`; `useViewDeg(layoutId: string | undefined): [ViewDeg, (next: ViewDeg) => void]` (liest bei ID-Wechsel neu); `RotatedImage({ src: string; deg: ViewDeg; alt: string })`; `ViewControls({ deg, onChange })`; `Canvas`-Prop `endLine: { axis: 'x' | 'y'; valueMm: number } | null` statt `autoLengthMm`; `PropertiesPanel`-Prop `openEdge: Edge | null` statt `autoLength`.

- [ ] **Step 1: Failing Tests** (`viewSettings.test.ts`): `parseViewDeg(null)`, `('abc')`, `('45')` → `'0'`; `('270')` → `'270'`.
- [ ] **Step 2:** Test → FAIL; implementieren (Muster wie `gridSettings.ts`) → PASS.
- [ ] **Step 3:** `LayoutEditor`: `viewArea`, `viewElements`, `viewBoxes` per `useMemo`. `Canvas` und `PropertiesPanel` erhalten die Ansichtswerte; `onMove`, `onChange`, `onAlign` und Pfeiltasten arbeiten auf dem Ansichtselement und speichern `fromView(…)` — nur das betroffene Element wird ersetzt. `addElement` wendet `fromView` auf das Standardelement an. Uploads, Längenschätzung, Überstand, Speichern, Vorschau-Anfrage und Ebenenliste bleiben im Druckraum.
- [ ] **Step 4:** `Canvas`: Endlinie aus `endLine` senkrecht oder waagrecht zeichnen; Beschriftung wie heute auf dem Canvas nur im Fall `axis 'y'` mit offener Unterkante und Platz, sonst als Zeile darunter.
- [ ] **Step 5:** `AlignButtons`: gesperrt je `openEdge` — `bottom`: Unten, Senkrecht mittig; `top`: Oben, Senkrecht mittig; `left`: Links, Waagrecht mittig; `right`: Rechts, Waagrecht mittig; vorhandener Hinweistext.
- [ ] **Step 6:** `ViewControls` (`.stage-controls`): Text „Ansicht drehen“, Knöpfe ↺ („Ansicht gegen den Uhrzeigersinn drehen“) und ↻ („Ansicht im Uhrzeigersinn drehen“) mit `aria-label`/`title`, Anzeige „0°“. `RotatedImage` zeichnet das geladene Vorschaubild gedreht auf ein `<canvas className="paper">` (Masse bei 90/270 getauscht, `max-width: min(320px, 100%)`, `role="img"`), damit nichts überlappt.
- [ ] **Step 7:** `npm run test` (Root), Typecheck, Build → sauber.
- [ ] **Step 8: Commit** `feat: Etiketten-Ansicht im Editor drehbar`

### Task 3: Abnahme im echten Browser

**Files:** keine im Repo (Skripte im Scratchpad, Muster `ui-check.mjs`).

- [ ] **Step 1:** Backend mit frischer DB und Vite starten; Layout mit Die-Cut-Medium, Elemente mit `rotate: '270'` anlegen.
- [ ] **Step 2:** Prüfen: bei 90° erscheinen sie aufrecht; Drehen allein → kein „Nicht gespeichert“; ziehen nach rechts erhöht Ansichts-X und ändert die Druckwerte passend; Pfeiltasten und alle sechs Ausrichten-Knöpfe wirken in Bildschirmrichtung; neues Element aufrecht bei 5/5; nach Speichern sind unberührte Elemente byte-gleich; Winkel übersteht Neuladen, anderes Layout startet bei 0°; Endlos automatisch bei 90° und 180° (Endlinie, gesperrte Knöpfe, Arbeitslänge wächst); Vorschaubild gedreht, Masse getauscht; Schrift-Upload behält Lage; 390 px ohne Seiten-Scroll; keine Konsolenfehler.
- [ ] **Step 3:** Screenshots ansehen. Alles grün → berichten; sonst zurück in die betroffene Task.
