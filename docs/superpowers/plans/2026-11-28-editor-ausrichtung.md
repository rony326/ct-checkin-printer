# Etiketten-Editor: Ausrichten, Einrasten, feste Länge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Etiketten-Editor zeigt exakt die Druckfläche, Schrift und Zeilenabstände des Drucks; Elemente rasten beim Ziehen an Hilfslinien und Raster ein, lassen sich per Knopf am Etikett ausrichten, und Endlosetiketten haben optional eine feste Länge.

**Architecture:** Alle Geometrie (Druckfläche, Element-Kästen, Einrasten, Ausrichten) lebt als reine, getestete Funktionen in `frontend/src/editor/geometry.ts`, in mm. Canvas, Panel und Editor-Seite nutzen nur diese Funktionen. Backend bekommt eine Spalte `label_layouts.length_mm`, eine Renderer-Option `lengthMm` und eine Route für die mitgelieferte Druckschrift.

**Tech Stack:** React 19 + react-konva (Frontend), Fastify + Drizzle/SQLite + node-canvas (Backend), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-editor-ausrichtung-design.md`

## Global Constraints

- Treffererkennung bleibt geometrisch (`listening={false}` auf dem Layer); kein Konva-Drag & Drop, keine Konva-`getIntersection` für Elemente.
- Zeilenabstand überall 1,3 (`LINE_HEIGHT_FACTOR` im Renderer).
- Bildschirm-Massstab bleibt `SCREEN_PX_PER_MM = 4`.
- Fangbereich 6 Bildschirm-px = **1,5 mm**.
- Rundung: eingerastet → 0,1 mm; frei gezogen → 0,5 mm.
- Raster-Grössen **2,5 / 5 / 10 mm**, Standard **5 mm**; ein Schalter „Einrasten“ für Hilfslinien und Raster.
- `lengthMm`: `null` = automatisch, sonst `> 0` und `≤ 1000`; bei Die-Cut ignoriert, nicht abgelehnt.
- Auto-Länge: unterstes Element + **2 mm**, mindestens **10 mm**. Editor-Arbeitsfläche bei Auto-Länge **120 mm**.
- Am Druck bestehender Layouts ändert sich nichts.
- Texte deutsch, Anrede „du“, Schweizer Schreibweise ohne ß wie im Rest des GUI.
- `localStorage`-Zugriffe in try/catch, bei Fehlschlag Standardwerte.

## Review Focus

1. **Bestehendes Die-Cut-Layout mit Elementen ausserhalb der neuen, kleineren Fläche** → Elemente bleiben wo sie sind, Hinweis erscheint, Druck unverändert. Test: `overflowingElementIds` (Task 3).
2. **Medium von Endlos auf Die-Cut gewechselt, `lengthMm` noch gesetzt** → Renderer ignoriert die Länge. Test in Task 1.
3. **Leerer Text / leerer fixer Text** → Kasten mit Breite 0 und Höhe einer Zeile, keine `NaN` beim Einrasten. Test in Task 3.
4. **Feste Länge kürzer als der Inhalt** → Bild genau so hoch, kein Fehler. Test in Task 1.
5. **`localStorage` leer, kaputt oder gesperrt** → Raster-Standardwerte. Test in Task 5 (`parseGridSettings`).

---

### Task 1: Feste Länge im Backend (Spalte, API, Renderer, Druck)

**Files:**
- Modify: `backend/src/db/schema.ts` (`labelLayouts`)
- Create: `backend/migrations/0010_*.sql` (per `npm run db:generate --workspace backend`)
- Modify: `backend/src/api/labelLayouts.ts` (`createLayoutSchema`, `previewSchema`, Preview-Route)
- Modify: `backend/src/rendering/LabelRenderer.ts` (`RenderLabelOptions`, `renderLabel`)
- Modify: `backend/src/orchestrator/PrintPipeline.ts:198`
- Test: `backend/src/rendering/LabelRenderer.test.ts`, `backend/src/api/server.test.ts`

**Interfaces:**
- Produces: Spalte `lengthMm: real('length_mm')` (nullable); API-Feld `lengthMm: number | null` auf Layout-GET/POST/PUT und `POST /api/label-layouts/preview`; `RenderLabelOptions.lengthMm?: number | null`.

- [ ] **Step 1: Failing Renderer-Tests** in `describe('renderLabel — Canvas-Grösse')`, mit den vorhandenen `CONTINUOUS_MEDIA`/`DIE_CUT_MEDIA`/`CONTEXT`:
  - `it('nutzt bei Endlosmedien eine feste Länge, wenn lengthMm gesetzt ist')`: `lengthMm: 80`, dpi 300 → `heightPx === mmToPx(80, 300)` (945).
  - `it('schneidet Inhalt ab, der über die feste Länge hinausragt')`: statischer Text bei `yMm: 70`, `lengthMm: 40` → `heightPx === mmToPx(40, 300)`, kein Fehler.
  - `it('ignoriert lengthMm bei Die-Cut-Medien')`: `DIE_CUT_MEDIA`, `lengthMm: 200` → Höhe wie ohne `lengthMm`.
  - `it('verhält sich ohne lengthMm wie bisher')`: `lengthMm: null` ergibt dieselbe Höhe wie Option weggelassen.
- [ ] **Step 2:** `npm test --workspace backend -- LabelRenderer` → die drei Längen-Tests FAIL.
- [ ] **Step 3:** `RenderLabelOptions.lengthMm?: number | null` ergänzen; in `renderLabel` bei Nicht-Die-Cut `media.heightMm ?? lengthMm ?? computeContentHeightMm(...)` innerhalb des bestehenden `Math.max(…, MIN_CANVAS_HEIGHT_MM)`.
- [ ] **Step 4:** Test erneut → PASS.
- [ ] **Step 5: Failing API-Tests** in `server.test.ts` (Muster wie Zeile 165–210):
  - Layout anlegen mit `lengthMm: 80` → GET liefert `lengthMm: 80`; PUT `lengthMm: null` → GET `null`.
  - POST mit `lengthMm: 0` und mit `lengthMm: 1001` → je 400.
  - Preview mit Endlosmedium und `lengthMm: 50` → PNG-Höhe (via `PNG.sync.read`) `=== mmToPx(50, dpi)`.
- [ ] **Step 6:** Test → FAIL.
- [ ] **Step 7:** Schema-Spalte ergänzen, `npm run db:generate --workspace backend` (erzeugt `0010_*.sql` mit `ALTER TABLE label_layouts ADD length_mm real`); in `createLayoutSchema` und `previewSchema` `lengthMm: z.number().positive().max(1000).nullable().optional()`; Preview-Route und `PrintPipeline` reichen `lengthMm` (Preview: `parsed.data.lengthMm`, Pipeline: `layout.lengthMm`) an `renderLabel` weiter.
- [ ] **Step 8:** `npm test --workspace backend` → alles PASS; `npm run typecheck --workspace backend` → sauber.
- [ ] **Step 9: Commit** `feat: feste Länge für Endlos-Etiketten im Backend`

### Task 2: Druckschrift und Logo-Dateien für den Editor ausliefern

**Files:**
- Modify: `backend/src/api/fonts.ts`, `backend/src/api/logos.ts`
- Test: `backend/src/api/server.test.ts`

**Interfaces:**
- Consumes: `FALLBACK_REGULAR_FONT_PATH`, `FALLBACK_BOLD_FONT_PATH` aus `backend/src/rendering/LabelRenderer.ts`; Speicherort der Logos wie im bestehenden Logo-Upload.
- Produces: `GET /api/fonts/default/:variant` (`regular` | `bold`), `Content-Type: font/ttf`; `GET /api/logos/:id/file` (Bilddatei mit passendem `Content-Type` `image/png` bzw. `image/jpeg`). Beide hinter `requireAuth`.

- [ ] **Step 1: Failing Tests**: mit Cookie `GET /api/fonts/default/regular` und `/bold` → 200, `content-type` beginnt mit `font/ttf`, `rawPayload.readUInt32BE(0) === 0x00010000`; ohne Cookie → 401; `/api/fonts/default/italic` → 404. Logo hochladen (Muster wie bestehender Logo-Upload-Test) → `GET /api/logos/:id/file` → 200, `content-type` `image/png`, Bytes identisch zum Upload; unbekannte ID → 404; ohne Cookie → 401.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Font-Route vor `/api/fonts/:id/file` registrieren, Datei per `readFile` senden; Logo-Route analog zu `/api/fonts/:id/file`.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `feat: Druckschrift und Logo-Dateien für den Editor abrufbar`

### Task 3: Geometrie-Modul im Frontend (Fläche, Kästen, Überstand)

**Files:**
- Modify: `frontend/package.json` (`"test": "vitest run"`, devDependency `vitest` in der Version des Backends)
- Modify: `package.json` (Root-`test`: Backend **und** Frontend ausführen)
- Modify: `frontend/src/types.ts` (`LabelLayout.lengthMm: number | null`)
- Create: `frontend/src/editor/geometry.ts`
- Test: `frontend/src/editor/geometry.test.ts`

**Interfaces:**
- Produces (alle in `geometry.ts`, Masse in mm):
  - `LINE_HEIGHT_FACTOR = 1.3`, `DEFAULT_CONTINUOUS_HEIGHT_MM = 120`, `AUTO_BOTTOM_MARGIN_MM = 2`, `MIN_LENGTH_MM = 10`
  - `interface PrintArea { widthMm: number; heightMm: number; continuous: boolean; fixedLength: boolean }`
  - `printAreaMm(media: MediaType, lengthMm: number | null): PrintArea` — Die-Cut: `printableWidthMm`×`printableHeightMm`; Endlos: `widthMm`×(`lengthMm ?? 120`).
  - `type MeasureText = (text: string, fontSizePx: number, bold: boolean, fontFamily: string) => number` (Breite in Druck-px)
  - `interface BoxMm { x: number; y: number; width: number; height: number }` (achsenparallele Hülle)
  - `interface BoxContext { dpi: number; resolveText(el: TextLikeElement): string; fontFamily(el: TextLikeElement): string; measure: MeasureText; logoAspect(logoId: number): number | undefined }` (Breite/Höhe; `undefined` → quadratisch) mit `TextLikeElement = Extract<LabelElement, { type: 'text' | 'static' }>`
  - `elementBoxMm(el: LabelElement, ctx: BoxContext): BoxMm`
  - `estimateContentLengthMm(boxes: BoxMm[]): number`
  - `overflowingElementIds(elements: LabelElement[], boxes: BoxMm[], area: PrintArea): string[]` (Toleranz 0,05 mm)

- [ ] **Step 1: Failing Tests** (Stub `measure = (t, size) => t.length * size * 0.5`, dpi 300):
  - `printAreaMm` 52×29 Die-Cut (`printableWidthMm: 48.9, printableHeightMm: 22.9, dieCut: true`) → `{ widthMm: 48.9, heightMm: 22.9, continuous: false, fixedLength: false }`.
  - Endlos 62 mm: `lengthMm: null` → 62×120, `fixedLength: false`; `lengthMm: 80` → 62×80, `fixedLength: true`.
  - QR `sizeMm: 20` bei 5/5 → `{ x: 5, y: 5, width: 20, height: 20 }`; mit `rotate: '90'` → `{ x: -15, y: 5, width: 20, height: 20 }`.
  - Statischer Text „Hallo“, `fontSize: 60`, `align: 'center'`, x 30, y 4 → `width ≈ 12.7`, `height ≈ 6.604`, `x ≈ 23.65` (`toBeCloseTo(…, 2)`).
  - Zweizeiliger Text „A\nBBBB“ → Breite der längeren Zeile, Höhe 2 × 60 × 1,3 px in mm.
  - Leerer fixer Text `value: ''` → `width === 0`, `height ≈ 6.604`, keine `NaN` (Review Focus 3).
  - Logo `heightMm: 10` mit `logoAspect → 2` → `width: 20, height: 10`; ohne bekanntes Verhältnis → 10×10.
  - Linie `widthMm: 30, thicknessMm: 1` bei 5/5 → `{ x: 5, y: 5, width: 30, height: 1 }` (echte Dicke ab Anker nach unten, wie `drawLine` im Renderer; Mindestdicke 1 Druck-px = 25,4/dpi mm).
  - `estimateContentLengthMm([])` → 10; mit unterster Kante 30 → 32.
  - `overflowingElementIds`: Element mit Kasten bis 50 mm auf 48,9-mm-Fläche → enthalten; Element exakt bündig (48,9) → nicht enthalten (Review Focus 1).
- [ ] **Step 2:** `npm test --workspace frontend` → FAIL (Modul fehlt).
- [ ] **Step 3:** `geometry.ts` implementieren. Text: Zeilen = `resolveText(el).split('\n')`, Breite = max `measure` der Zeilen in mm, Höhe = Zeilen × `fontSize` × 1,3 in mm; lokaler x-Versatz nach `align` (links 0, zentriert −w/2, rechts −w); Drehung wie heute `rotateLocal` + Hülle (Funktion aus `Canvas.tsx` hierher verschieben). Logo: `heightMm` × `heightMm · (logoAspect ?? 1)`. Linie: `widthMm` × max(`thicknessMm`, 25,4/dpi), ab Anker nach unten (keine Trefferzonen-Polsterung hier — die gehört in die Treffererkennung, Task 4).
- [ ] **Step 4:** Test → PASS; `npm run typecheck --workspace frontend` → sauber.
- [ ] **Step 5: Commit** `feat: Geometrie-Modul für den Etiketten-Editor`

### Task 4: Editor zeigt, was gedruckt wird

**Files:**
- Modify: `frontend/src/editor/Canvas.tsx`
- Modify: `frontend/src/pages/LayoutEditor.tsx`

**Interfaces:**
- Consumes: Task 2 (`/api/fonts/default/:variant`, `/api/logos/:id/file`), Task 3 (`printAreaMm`, `elementBoxMm`, `estimateContentLengthMm`, `overflowingElementIds`, `LINE_HEIGHT_FACTOR`).
- Produces: `Canvas`-Props `area: PrintArea`, `boxes: BoxMm[]` (statt `media`); Familien-Namen `'ctp-default'` und `'ctp-default-bold'`; in `LayoutEditor` `boxCtx: BoxContext` und `boxes: BoxMm[]` (per `useMemo`), die Task 5 und 6 weiterverwenden.

- [ ] **Step 1:** `useFontFaces` registriert zusätzlich `ctp-default` (regular) und `ctp-default-bold` (bold) aus Task 2 und erhöht nach `document.fonts.load` aller Familien einen Zähler `fontsVersion`; `measure` (Offscreen-Canvas, `ctx.font = \`${size}px "${family}"\``, `measureText().width`) wird bei Änderung von `fontsVersion` neu erzeugt.
- [ ] **Step 2:** Schriftwahl wie Renderer: eigene Schrift → `font-<id>` (fett per `fontStyle: 'bold'`); sonst `ctp-default` bzw. `ctp-default-bold` (ohne `fontStyle`). Konva-`Text` bekommt `lineHeight={LINE_HEIGHT_FACTOR}`.
- [ ] **Step 3:** `Canvas` zeichnet Fläche aus `area` (px = mm × 4), nutzt `boxes` (× 4) für Treffer und Drag-Grenzen; `computeBoxes`/`rotateLocal`/`textBoxProps`-Trefferlogik in `Canvas.tsx` entfällt bzw. nutzt Task 3. Drag-Grenzen: Anker in `[0, area.widthMm] × [0, area.heightMm]`. Frei gezogen auf 0,5 mm runden.
- [ ] **Step 3b:** Treffererkennung polstert Kästen, die niedriger oder schmaler als 2 mm sind, symmetrisch auf 2 mm (dünne Linien bleiben greifbar), ohne die Kästen selbst zu ändern. Linien werden ab Anker nach unten in echter Dicke gezeichnet (heute zentriert im 8-px-Band → bis ~1 mm Versatz). Logos: Bild über `/api/logos/:id/file` laden (`Konva.Image`), Seitenverhältnis aus `naturalWidth/naturalHeight` als `logoAspect` an `BoxContext`; bis zum Laden bzw. ohne Logo der bisherige Platzhalter.
- [ ] **Step 4:** Bei `area.continuous && !area.fixedLength` gestrichelte Linie bei `estimateContentLengthMm(boxes)` mit Beschriftung „Etikett endet hier (automatisch)“.
- [ ] **Step 5:** `LayoutEditor` zeigt über dem Entwurf `.error-text` „Ragt über das Etikett hinaus und wird abgeschnitten: …“ mit den Typ-Labels aus `overflowingElementIds`; Pfeiltasten-Grenzen aus `area`.
- [ ] **Step 6:** `npm run typecheck --workspace frontend` und `npm run build --workspace frontend` → sauber.
- [ ] **Step 7: Commit** `fix: Editor zeigt echte Druckfläche, Druckschrift und Zeilenabstand`

### Task 5: Einrasten, Hilfslinien und Raster

**Files:**
- Modify: `frontend/src/editor/geometry.ts`, `frontend/src/editor/geometry.test.ts`
- Create: `frontend/src/editor/gridSettings.ts`, `frontend/src/editor/gridSettings.test.ts`
- Create: `frontend/src/editor/GridControls.tsx`
- Modify: `frontend/src/editor/Canvas.tsx`, `frontend/src/pages/LayoutEditor.tsx`

**Interfaces:**
- Consumes: Task 3 (`BoxMm`, `PrintArea`), Task 4 (`boxes`).
- Produces:
  - `SNAP_THRESHOLD_MM = 1.5`
  - `interface SnapTarget { axis: 'x' | 'y'; valueMm: number; priority: 1 | 2 | 3 }` (1 Etikett, 2 andere Elemente, 3 Raster)
  - `snapTargets(area: PrintArea, others: BoxMm[], gridMm: number | null): SnapTarget[]`
  - `interface Guide { axis: 'x' | 'y'; valueMm: number }`
  - `findSnap(moving: BoxMm, targets: SnapTarget[], thresholdMm: number): { dxMm: number; dyMm: number; guides: Guide[] }`
  - `roundMm(value: number, step: number): number`
  - `gridSettings.ts`: `type GridMm = 2.5 | 5 | 10`, `interface GridSettings { showGrid: boolean; gridMm: GridMm; snap: boolean }`, `DEFAULT_GRID_SETTINGS = { showGrid: true, gridMm: 5, snap: true }`, `parseGridSettings(raw: string | null): GridSettings`, `useGridSettings(): [GridSettings, (next: GridSettings) => void]` (Schlüssel `ctp.editor.grid`)

- [ ] **Step 1: Failing Tests** in `geometry.test.ts` (Fläche 50×30):
  - Kasten `{ x: 23.2, y: 3, width: 4, height: 4 }` (Mitte 25,2) → `dxMm ≈ -0.2`, Guide `{ axis: 'x', valueMm: 25 }`.
  - Kasten mit linker Kante 9,6 und `gridMm: 5`, keine anderen Ziele näher → `dxMm ≈ 0.4` (Raster 10).
  - Gleichstand: Etikettenmitte 25 und anderes Element mit Kante 25,3, bewegte Mitte 25,15 → Guide-Wert 25 (Priorität 1).
  - Nichts im Fangbereich → `dxMm === 0`, `dyMm === 0`, `guides` leer.
  - X und Y rasten unabhängig: nur Y im Fangbereich → `dxMm === 0`, ein y-Guide.
  - Kasten mit Breite 0 → kein `NaN` (Review Focus 3).
  - `roundMm(12.345, 0.1) === 12.3`, `roundMm(12.3, 0.5) === 12.5`.
- [ ] **Step 2: Failing Tests** in `gridSettings.test.ts`: `parseGridSettings(null)`, `('kaputt')`, `('{"gridMm":7}')` → jeweils Standard bzw. `gridMm: 5`; gültiges JSON wird übernommen (Review Focus 5).
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Funktionen implementieren. `findSnap`: je Achse Kanten (Anfang, Mitte, Ende) des Kastens gegen alle Ziele dieser Achse; kleinster Abstand ≤ Schwelle gewinnt, bei Gleichstand kleinere `priority`. `snapTargets` erzeugt Rasterlinien von 0 bis Flächenrand in `gridMm`-Schritten.
- [ ] **Step 5:** Tests → PASS.
- [ ] **Step 6:** `Canvas`: beim Ziehen Roh-Anker → Kasten verschieben → `findSnap` (wenn `snap` an und `event.altKey` falsch; Ziele ohne das gezogene Element; Raster nur wenn `showGrid`) → Anker korrigieren, eingerastete Achse auf 0,1 mm, freie auf 0,5 mm runden. Guides als Konva-`Line` in `var(--accent)`-Farbe über die ganze Fläche, nur während des Ziehens. Raster als feine Linien (Farbe `#e4e1da`), wenn `showGrid`.
- [ ] **Step 7:** `GridControls` (Leiste über dem Entwurf): Checkbox „Raster“, Select 2,5/5/10 mm, Checkbox „Einrasten“, Hinweis „Alt gedrückt = frei“. Labels per `useFieldId`.
- [ ] **Step 8:** Typecheck und Build → sauber.
- [ ] **Step 9: Commit** `feat: Einrasten mit Hilfslinien und umschaltbarem Raster`

### Task 6: Ausrichten-Knöpfe

**Files:**
- Modify: `frontend/src/editor/geometry.ts`, `frontend/src/editor/geometry.test.ts`
- Modify: `frontend/src/editor/PropertiesPanel.tsx`, `frontend/src/pages/LayoutEditor.tsx`

**Interfaces:**
- Consumes: Task 3 (`elementBoxMm`, `PrintArea`, `BoxMm`), Task 4 (`boxes`).
- Produces: `type AlignCommand = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'`; `alignElement(el: LabelElement, cmd: AlignCommand, area: PrintArea, box: BoxMm): LabelElement`; `PropertiesPanel`-Props `onAlign(cmd: AlignCommand)`.

- [ ] **Step 1: Failing Tests** (Fläche 50×30):
  - QR 20 mm: `hcenter` → `xMm: 15`; `right` → `xMm: 30`; `bottom` → `yMm: 10`; `top` → `yMm: 0`.
  - Ungedrehter Text: `hcenter` → `align: 'center'`, `xMm: 25`; `left` → `align: 'left'`, `xMm: 0`; `right` → `align: 'right'`, `xMm: 50`.
  - Text „Hallo“ (Höhe 6,604): `vcenter` → `yMm: 11.7`.
  - Gedrehter Text (`rotate: '90'`) `hcenter` → `align` unverändert, Hülle mittig.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** `alignElement` implementieren: Text ungedreht + waagrechter Befehl → `align` und Anker setzen; sonst Anker um Differenz zwischen Hülle und Ziel verschieben; Ergebnis auf 0,1 mm runden.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** `PropertiesPanel` unter dem Titel zwei `.btn-row`-Gruppen à drei Knöpfe mit `aria-label` und `title` („Links ausrichten“, „Waagrecht zentrieren“, „Rechts ausrichten“, „Oben ausrichten“, „Senkrecht zentrieren“, „Unten ausrichten“); X/Y-Felder `step="0.1"`. `LayoutEditor` verdrahtet `onAlign` mit `boxes` des gewählten Elements.
- [ ] **Step 6:** Typecheck und Build → sauber.
- [ ] **Step 7: Commit** `feat: Elemente per Knopf am Etikett ausrichten`

### Task 7: Länge im Editor einstellen

**Files:**
- Modify: `frontend/src/pages/LayoutEditor.tsx`

**Interfaces:**
- Consumes: Task 1 (API-Feld `lengthMm`), Task 3 (`printAreaMm`, `estimateContentLengthMm`).

- [ ] **Step 1:** State `lengthMm: number | null` aus dem geladenen Layout; Teil von `snapshotOf` (Dirty-Anzeige); beim Speichern im PUT; in der Vorschau-Anfrage mitsenden; `area = printAreaMm(media, lengthMm)`.
- [ ] **Step 2:** Nur bei Endlosmedien über dem Entwurf: Radios „Länge automatisch“ / „Feste Länge“ + Zahlenfeld (mm, `min 10`, `max 1000`, `step 1`). Umschalten auf fest setzt `Math.ceil(estimateContentLengthMm(boxes))`.
- [ ] **Step 3:** Typecheck, Build, `npm test` (Root, beide Workspaces) → sauber.
- [ ] **Step 4: Commit** `feat: feste Länge für Endlos-Etiketten im Editor einstellen`

### Task 8: Abnahme im echten Browser

**Files:** keine im Repo (Skript im Scratchpad, Muster wie `ui-check.mjs` aus dem Design-Durchgang).

- [ ] **Step 1:** Backend live booten (frische DB, Migration 0010 läuft beim Start) und Vite starten.
- [ ] **Step 2:** Playwright-Prüfungen: Element ziehen → rastet an der waagrechten Mitte ein, Guide sichtbar während des Ziehens, weg danach; mit Alt → kein Einrasten; „Waagrecht zentrieren“ setzt bei Text `align: center` und x = halbe Breite; Raster 10 mm rastet auf 10er; Einrasten aus → frei (0,5 mm); Die-Cut 52×29 zeigt eine Fläche von 48,9×22,9 mm (Canvas ≈ 196×92 px, ±1 px); dünne Linie im Editor und im Vorschau-Bild auf gleicher Höhe; Logo im Editor als echtes Bild; Endlos mit fester Länge 50 mm → Canvas 200 px hoch und Vorschau-Bild entsprechend; Überstand-Hinweis bei Element ausserhalb; keine Konsolenfehler; Dark Mode und 390 px Breite ohne horizontales Scrollen.
- [ ] **Step 3:** Screenshots ansehen (Raster, Guides, Ausrichten-Knöpfe, Längen-Steuerung).
- [ ] **Step 4:** Alle Prüfungen grün → Ergebnis berichten; sonst zurück in die betroffene Task.
