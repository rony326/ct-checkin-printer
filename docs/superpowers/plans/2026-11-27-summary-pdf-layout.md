# Anwesenheitsliste (vollständig und gestaltbar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die A4-Anwesenheitsliste zeigt jeden empfangenen Check-in genau einmal in einer sauberen, im GUI gestaltbaren Tabelle mit Vorschau.

**Architecture:** Die Pipeline schreibt für jeden empfangenen Check-in mindestens eine `print_log`-Zeile. Ein reines Datenmodul fasst die Zeilen zusammen und sortiert sie. Ein Design-Modul liefert Standards und Grenzen, `pdfkit` zeichnet die Seite, GUI und Vorschau-Route nutzen denselben Renderer.

**Tech Stack:** Fastify 5, Drizzle/SQLite, zod, pdfkit 0.20, Vitest, React/Vite.

**Spec:** `docs/superpowers/specs/2026-11-27-summary-pdf-layout-design.md`

## Global Constraints

- Keine neuen Abhängigkeiten.
- Zusammengefasst wird nach **Gruppe + Name + Code**, es gilt die früheste Uhrzeit. Zeilen ohne Name und ohne Code werden nie zusammengefasst.
- Sortierung je Gruppe: zuerst Gäste, dann alle anderen, nach Name (`localeCompare`, `'de'`, `numeric: true`).
- Gast = Name beginnt mit dem Erkennungswort (Standard `Gast`), gefolgt von Leerzeichen oder Ziffer, Gross-/Kleinschreibung egal. „Gastner“ ist kein Gast.
- Namen werden nie umformatiert und nie abgeschnitten.
- Standards: Logo keines, Schrift 11 pt (8–18), Querformat, Abhak-Spalten `Abgeholt`, `Da` (0–4, je max. 20 Zeichen), Gast-Spalte an, Überschrift `Name Gast` (max. 30), Erkennungswort `Gast` (1–30), Fusszeile leer (max. 200).
- Zeilen mindestens 8 mm hoch, nie über zwei Seiten geteilt. Kopf und Tabellenkopf auf jeder Seite, Zählwort `Personen`, Seitenzahl `Seite x/y` je Gruppe.
- Schrift im PDF: `backend/assets/fonts/DejaVuSans.ttf` und `DejaVuSans-Bold.ttf`.
- Migration rein additiv (`ALTER TABLE ... ADD`). Kommt eine CJS-Abhängigkeit oder ein neuer Import in `server.ts` dazu, echter Server-Start als Prüfung.
- GUI-Texte und Fehlermeldungen auf Deutsch.

## Review Focus

1. Beim Rendern oder Drucken eines Etiketts fliegt eine Exception: Die Person steht trotzdem auf der Liste (Test in Task 1).
2. Das Erkennungswort enthält Regex-Zeichen (`Gast (`, `G.`): kein Absturz, wörtlicher Vergleich (Task 2).
3. Logo-Datei fehlt oder ist kaputt: Die Liste druckt ohne Logo (Task 4).
4. Sehr langer Name oder 200-Zeichen-Fusszeile: Umbruch, nichts abgeschnitten, keine leeren Zusatzseiten (Task 4).
5. Der Browser blockiert das Vorschau-Fenster: Fenster synchron beim Klick öffnen, sonst Fehlermeldung (Task 6).

---

### Task 1: Pipeline protokolliert jeden empfangenen Check-in

**Files:**
- Modify: `backend/src/orchestrator/PrintPipeline.ts`
- Test: `backend/src/orchestrator/PrintPipeline.test.ts`

**Interfaces:**
- Produces: Garantie: Nach `processIncomingJob()` mit nicht-leeren Daten und bekanntem Hostnamen existiert mindestens eine `print_log`-Zeile mit `personName`, `code`, `groupName`.
- Intern: `attemptPrintLayout(layout, parsed, unixTimestampSeconds, fallbackPrinterId: number)`; `retryQueuedJob` übergibt `entry.printerId`.

- [ ] **Step 1: Failing Tests**
  - `logs a failed row when no layout matches the check-in type`: kein Layout → genau 1 Zeile, `status 'failed'`, `printerId` = erstes Gerät der Gruppe, `errorMessage` enthält `Kein Layout`, `personName` gesetzt.
  - `logs a failed row when the layout has no printer`: also[]-Layout mit `printerId: null` → zusätzliche `failed`-Zeile mit dem ersten Gerät.
  - `logs and queues the job when rendering or the adapter throws`: `getAdapter` wirft `new Error('boom')` → `processIncomingJob` löst auf (`queued: 1`), 1 `failed`-Zeile mit `boom`, 1 Queue-Eintrag.
- [ ] **Step 2:** `npm run test --workspace backend -- PrintPipeline` → neue Tests FAIL
- [ ] **Step 3:** Implementieren; try/catch um den gesamten Druckversuch in `attemptPrintLayout`, Ergebnis `{ success: false, errorMessage }` über `logAndReturn`.
- [ ] **Step 4:** `npm run test --workspace backend && npm run typecheck --workspace backend` → PASS
- [ ] **Step 5:** Commit `fix: jeder empfangene Check-in landet im print_log`

---

### Task 2: Zusammenfassen, Sortieren, Gäste erkennen

**Files:**
- Create: `backend/src/orchestrator/summaryData.ts`, `backend/src/orchestrator/summaryData.test.ts`
- Modify: `backend/src/orchestrator/SummaryReportService.ts` (`collectGroupedRows`)
- Modify: `backend/src/rendering/SummaryRenderer.ts` (`SummaryRow` bekommt `isGuest?: boolean`)
- Test: `backend/src/orchestrator/SummaryReportService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CheckinLogRow { groupName: string | null; personName: string | null; code: string | null; printedAt: string }
  export interface SummaryEntry { name: string; code: string; printedAt: string; isGuest: boolean }
  export function isGuestName(name: string, keyword: string): boolean;
  export function groupSummaryRows(rows: CheckinLogRow[], guestKeyword: string): Map<string, SummaryEntry[]>;
  ```
  Gruppe `null` → `Ohne Gruppe`. Name und Code werden nur für den Vergleich getrimmt.

- [ ] **Step 1: Failing Tests** in `summaryData.test.ts`:
  - gleiche Gruppe+Name+Code 3× → 1 Eintrag mit frühestem `printedAt` (Eingabe unsortiert)
  - gleicher Code, anderer Name → 2; gleicher Name, anderer Code → 2; gleicher Name+Code in zwei Gruppen → je 1
  - zwei Zeilen ohne Name und Code → 2
  - Reihenfolge `['Gast 2 Youngsters','Gast 10 Youngsters','Anna','Zoe']` aus gemischter Eingabe
  - `isGuestName`: `Gast 1` true, `gast2` true, `Gastner Max` false, `Gast` false, `Max Gast 1` false
  - `isGuestName('Gast ( 1', 'Gast (')` true; `isGuestName('GX 1', 'G.')` false
- [ ] **Step 2:** In `SummaryReportService.test.ts` den Gruppierungstest anpassen: die `failed`-Person erscheint jetzt; neuer Test: zwei Zeilen derselben Person → Adapter/Renderer bekommt eine (prüfbar über die Streifenhöhe oder `vi.spyOn` auf den Renderer).
- [ ] **Step 3:** `npm run test --workspace backend -- summaryData SummaryReportService` → FAIL
- [ ] **Step 4:** Implementieren. Der Service liest **alle** Status im Zeitraum, nutzt `groupSummaryRows(rows, 'Gast')` und formatiert die Zeit wie bisher. `empty` bleibt `grouped.size === 0`. Den Klassen- und `empty`-Kommentar an „alle empfangenen Check-ins“ anpassen.
- [ ] **Step 5:** `npm run test --workspace backend && npm run typecheck --workspace backend` → PASS
- [ ] **Step 6:** Commit `fix: Anwesenheitsliste zeigt jede Person genau einmal, Gäste zuerst`

---

### Task 3: Design-Einstellungen, Migration, API

**Files:**
- Create: `backend/src/rendering/summaryDesign.ts`, `backend/src/rendering/summaryDesign.test.ts`
- Modify: `backend/src/db/schema.ts`, `backend/src/api/summaryLayouts.ts`
- Create (generiert): `backend/migrations/0009_*.sql` samt Meta
- Test: `backend/src/db/migration.test.ts`, `backend/src/api/server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SummaryDesign {
    logoId: number | null;
    fontSize: number;
    orientation: 'portrait' | 'landscape';
    checkColumns: string[];
    guestColumn: { enabled: boolean; header: string; keyword: string };
    footer: string;
  }
  export const DEFAULT_SUMMARY_DESIGN: SummaryDesign;
  export const summaryDesignSchema; // zod, alle Felder optional, strikt in den Grenzen
  export function resolveSummaryDesign(stored: unknown): SummaryDesign; // wirft nie, ungültige/fehlende Felder → Standard
  ```
  DB: `designJson: text('design_json', { mode: 'json' }).$type<Partial<SummaryDesign>>()` (nullable). API-Feld `designJson` (nullable, optional) in Create und Update.

- [ ] **Step 1: Failing Tests**
  - `resolveSummaryDesign(null)` und `resolveSummaryDesign('quatsch')` → exakt die Standards aus Global Constraints
  - Teilangabe `{ fontSize: 14 }` → 14, Rest Standard; `{ guestColumn: { enabled: false } }` → übrige Gast-Felder Standard
  - Schema lehnt ab: fontSize 7 und 19; 5 Abhak-Spalten; Überschrift 21 Zeichen oder leer; keyword leer; footer 201 Zeichen
  - API: POST mit `designJson` → GET liefert es; PUT mit `fontSize: 30` → 400
  - Migration: bestehende Zeile hat `designJson === null`
- [ ] **Step 2:** `npm run test --workspace backend` → FAIL
- [ ] **Step 3:** Implementieren, `npm run db:generate`. SQL muss genau ein `ALTER TABLE ... ADD` sein. In `migration.test.ts` die Baseline-Filterliste um `0009_` ergänzen.
- [ ] **Step 4:** `npm run test --workspace backend && npm run typecheck --workspace backend` → PASS
- [ ] **Step 5:** Commit `feat: Design-Einstellungen pro Sammel-Layout`

---

### Task 4: PDF-Tabelle zeichnen und im Druck verwenden

**Files:**
- Modify: `backend/src/rendering/SummaryRenderer.ts` (`renderSummaryPdf` neu)
- Modify: `backend/src/orchestrator/SummaryReportService.ts`, `backend/src/orchestrator/PrintOrchestrator.ts`
- Test: `backend/src/rendering/SummaryRenderer.test.ts`, `SummaryReportService.test.ts`

**Interfaces:**
- Consumes: `groupSummaryRows`, `resolveSummaryDesign`, `loadLogoBuffers(db, dbPath, ids)` aus `orchestrator/renderAssets.ts`.
- Produces:
  ```ts
  export interface SummaryPdfInput {
    rows: SummaryRow[]; columns: SummaryColumn[]; title: string;
    design: SummaryDesign; logo?: Buffer; printedAt: Date;
  }
  export function renderSummaryPdf(input: SummaryPdfInput): Promise<Buffer>;
  ```
  `SummaryReportDeps` bekommt `dbPath: string` (Orchestrator übergibt `env.DB_PATH`).

Seite: Kopf (Logo links, Titel, rechts `dd.mm.yyyy, HH:MM`, darunter `{n} Personen`, bei 1 `1 Person`); Tabelle mit Abhak-Spalten (gezeichnete Kästchen), Datenspalten in `columns`-Reihenfolge, Gast-Spalte (Schreiblinie nur bei `isGuest`); Fusszeile links, `Seite x/y` rechts. Seitenzahlen über `bufferPages: true`; beim Schreiben unterhalb des Rands `doc.page.margins.bottom` vorübergehend auf 0, sonst legt pdfkit leere Seiten an.

- [ ] **Step 1: Failing Tests** (Seiten zählen über `/\/Type \/Page\b/g` im Buffer, gezeichnete Texte über `vi.spyOn(PDFDocument.prototype, 'text')`):
  - Querformat → MediaBox `[0 0 841.89 595.28]`; Hochformat → `[0 0 595.28 841.89]`
  - 3 Zeilen → 1 Seite; 80 Zeilen → mehrere Seiten, Titel und `Name` je Seite einmal gezeichnet, `Seite 1/N` … `Seite N/N`
  - `2 Personen`, `1 Person`; Abhak-Überschriften und `Name Gast` gezeichnet; bei ausgeschalteter Gast-Spalte nicht
  - Spaltenreihenfolge folgt `columns: [code, name]`
  - Logo `Buffer.from('kaputt')` → löst auf, 1 Seite; gültiges PNG → Buffer enthält `/Subtype /Image`
  - Name mit 300 Zeichen und Fusszeile mit 200 → vollständiger Name an `text` übergeben, 3 Zeilen ergeben 1 Seite
  - 0 Zeilen → `Keine Check-ins in diesem Zeitraum.`
  - Service: Layout mit `logoId`, dessen Datei fehlt → `ok: true`; Gast-Erkennungswort aus `designJson` bestimmt `isGuest`
- [ ] **Step 2:** `npm run test --workspace backend -- SummaryRenderer SummaryReportService` → FAIL
- [ ] **Step 3:** Implementieren. Zeilenhöhe = max(8 mm, `doc.heightOfString` je Zelle); vor jeder Zeile prüfen, ob sie noch passt. Abhak-Spalten schmal, Name und Gast-Spalte erhalten die Restbreite. Logo-Laden und `doc.image` in try/catch. Der Service reicht `design.guestColumn.keyword` an `groupSummaryRows`; der Etikettenstreifen ignoriert das übrige Design.
- [ ] **Step 4:** `npm run test --workspace backend && npm run typecheck --workspace backend` → PASS
- [ ] **Step 5:** Commit `feat: gestaltbare A4-Anwesenheitsliste als Tabelle`

---

### Task 5: Vorschau-Route

**Files:**
- Modify: `backend/src/api/summaryLayouts.ts`
- Test: `backend/src/api/server.test.ts`

**Interfaces:**
- Consumes: `renderSummaryPdf`, `summaryDesignSchema`, `resolveSummaryDesign`, `groupSummaryRows`, `loadLogoBuffers`.
- Produces: `POST /api/summary-layouts/preview` (Session), Body `{ titleTemplate?: string; columnsJson?: ('name'|'code'|'checkinTime')[]; designJson?: Partial<SummaryDesign> | null }` → `200 application/pdf`; `400 { error }`; `401`. Beispieldaten: Gruppe `Beispielgruppe`, 2 Gäste (`{keyword} 1 Beispielgruppe`, `{keyword} 2 Beispielgruppe`) und 40 weitere Personen. Es wird nie gedruckt.

- [ ] **Step 1: Failing Tests:** 401 ohne Cookie; 200 mit leerem Objekt, Body beginnt mit `%PDF`, mindestens 2 Seiten; Stub-Orchestrator wird nicht aufgerufen; unbekannte `logoId` → 200; `fontSize: 99` → 400
- [ ] **Step 2:** `npm run test --workspace backend -- server` → FAIL
- [ ] **Step 3:** Implementieren
- [ ] **Step 4:** Tests + Typecheck → PASS. Danach echter Start mit Wegwerf-DB (`tsx src/db/migrate.ts`, `tsx src/index.ts`) und einmal die Vorschau per curl abrufen.
- [ ] **Step 5:** Commit `feat: Vorschau der Anwesenheitsliste`

---

### Task 6: GUI-Einstellungen, Vorschau-Knopf, Doku

**Files:**
- Create: `frontend/src/pages/SummaryDesignFields.tsx`
- Modify: `frontend/src/pages/SummaryLayouts.tsx`, `frontend/src/types.ts`, `README.md` (Abschnitt „Gruppen-Sammelausdruck“)

**Interfaces:**
- Consumes: `designJson`, Vorschau-Route, `GET /api/logos`, `postForBlob` aus `api/client.ts`.
- Produces: `SummaryDesignFields({ value: SummaryDesign; onChange(next: SummaryDesign): void })`; `SummaryDesign` in `types.ts` wie im Backend, Standards als Konstante dort.

Inhalt (nur bei Ziel „A4-Drucker“): Logo-Auswahl (`– kein Logo –`), Schriftgrösse, Ausrichtung (`Querformat`/`Hochformat`), Abhak-Spalten (Textfelder mit „Hinzufügen“/„Entfernen“, max. 4), Gast-Spalte (an/aus, Überschrift, Erkennungswort), Fusszeile. Spalten Name/Code/Zeit erhalten Knöpfe „↑“/„↓“. Knopf „Vorschau“ schickt den ungespeicherten Formularstand.

- [ ] **Step 1:** Implementieren. Vorschau: `window.open('', '_blank')` synchron im Klick, dann Blob-URL zuweisen; `null` → „Vorschau blockiert – bitte Pop-ups erlauben.“; bei Fehler Fenster schliessen und Meldung zeigen. Leere Abhak-Überschriften vor dem Senden entfernen. Beim Bearbeiten fehlende Werte mit Standards füllen.
- [ ] **Step 2:** README: vollständige Liste (auch fehlgeschlagene Drucke, jede Person einmal), Gäste, Einstellungen, Vorschau. Den Satz „nur erfolgreich gedruckte Check-ins“ ersetzen.
- [ ] **Step 3:** `(cd frontend && npx tsc --noEmit) && npm run build && npm run test --workspace backend` → alles grün. Browser-Prüfung ist nicht möglich: im Bericht als offen nennen.
- [ ] **Step 4:** Commit `feat: Design der Anwesenheitsliste im GUI`
