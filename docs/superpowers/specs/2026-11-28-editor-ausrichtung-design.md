# Etiketten-Editor: was man sieht, wird gedruckt, und es rastet ein

Stand: 2026-11-28 · Status: Entwurf, wartet auf Freigabe

## Wozu

Der Nutzer kann Elemente im Etiketten-Editor nicht genau ausgerichtet platzieren,
„es ist immer ein Versatz da“. Auf Nachfrage meint er **beides**:

1. Der Druck sieht anders aus als der Entwurf.
2. Im Editor selbst lässt sich nichts sauber mittig oder bündig setzen. Das
   1-mm-Raster ist zu fein, nach Augenmass geht es nicht.

Er wünscht sich einrastende Hilfslinien „wie in anderen Tools“, ein gröberes
Raster mit abschaltbarem Einrasten, Ausrichten-Knöpfe (links/mittig/rechts usw.)
und bei Endlosetiketten eine fix einstellbare Länge.

Im Code gefundene Ursachen für (1):

- **Falsche Fläche:** Der Editor (`frontend/src/editor/Canvas.tsx`) zeichnet die
  *nominale* Grösse (`widthMm`/`heightMm`). Der Renderer
  (`backend/src/rendering/LabelRenderer.ts`, `renderLabel`) nutzt bei Die-Cut
  die *druckbare* Fläche (`printableAreaMm`). Beispiel 52×29 Die-Cut: Editor
  52×29 mm, Druck 48,9×22,9 mm. „Senkrecht mittig“ landet gut 3 mm zu tief.
- **Falsche Länge bei Endlos:** Der Editor zeigt pauschal 120 mm, der Druck ist
  so lang wie der Inhalt (`computeContentHeightMm` + 2 mm Rand, min. 10 mm).
- **Falsche Schrift:** Der Editor zeichnet Standardtext in Work Sans, gedruckt
  wird DejaVu Sans (`FALLBACK_*_FONT_PATH`). Textbreiten weichen ab, das
  verschiebt zentrierten und rechtsbündigen Text.
- **Falscher Zeilenabstand:** Der Editor zeichnet mehrzeiligen Text mit Konvas
  Standard-`lineHeight` 1,0 (Trefferzone 1,2), der Renderer mit 1,3.

## Ziele

- Der Editor zeigt exakt die Fläche, Schrift und Zeilenabstände, die gedruckt
  werden. Eine Position im Editor ist die Position im Druck.
- Beim Ziehen rasten Elemente an sinnvollen Linien ein, sichtbar angezeigt.
- Ein Klick richtet das gewählte Element am Etikett aus.
- Endlosetiketten können pro Layout eine feste Länge haben.

## Nicht-Ziele

- Mehrfachauswahl und Ausrichten von Elementen *zueinander* per Knopf.
- Zoom im Editor (bleibt bei 4 px/mm).
- Hilfslinien beim Verschieben mit Pfeiltasten (die rasten nicht, sie
  verschieben um 1 bzw. 5 mm).
- Automatische Korrektur bestehender Layouts an die neue Fläche.
- Feste Länge für Die-Cut-Etiketten (deren Länge ist physisch vorgegeben).

## Anti-Ziele

- Entwurf und Druck weichen weiterhin sichtbar voneinander ab.
- Das Einrasten macht es unmöglich, etwas bewusst frei zu platzieren.
- Ziehen funktioniert mit Canvas-Blockern (uBlock, Brave) nicht mehr.
- Ein bestehendes Layout druckt nach dem Update anders als vorher.

## Ansätze

**Hilfslinien und Einrasten**

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | Selbst gebaut auf den vorhandenen, geometrisch berechneten Element-Kästen (`computeBoxes`); Hilfslinien als Konva-Formen. | Passt zur bestehenden eigenen Treffererkennung, robust gegen Canvas-Blocker, volle Kontrolle über das Verhalten. |
| B | Konvas eingebautes Drag & Drop mit Snapping. | Nutzt Konvas pixelbasierte Treffererkennung, die bewusst umgangen wurde (Canvas-Blocker → Ziehen tot). Scheidet aus. |
| C | Editor auf andere Bibliothek (z.B. Fabric.js) umbauen. | Grosser Umbau ohne Vorteil für dieses Ziel. |

**Feste Länge bei Endlos**

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | Einstellung pro Layout: „automatisch“ oder „fix … mm“. | Kind- und Eltern-Etikett können auf derselben Rolle verschieden lang sein. Braucht eine kleine Migration. |
| B | Eigene Medientypen „62 mm Endlos, 80 mm lang“. | Ohne Migration, aber Medienliste wächst und muss verwaltet werden. |

Der Nutzer hat jeweils A gewählt.

## Design

### 1. Editor zeigt die echte Druckfläche

- Die Editor-Fläche folgt **genau** der Regel in `renderLabel`:
  - Breite: Die-Cut → `printableWidthMm`, sonst `widthMm`.
  - Höhe: Die-Cut → `printableHeightMm`; Endlos mit fester Länge → diese
    Länge; Endlos automatisch → siehe unten.
- Endlos automatisch: Der Editor zeigt weiterhin eine lange Arbeitsfläche
  (120 mm) und zeichnet zusätzlich eine gestrichelte Linie „Etikett endet hier
  (automatisch)“ an der geschätzten Länge, berechnet wie
  `computeContentHeightMm` (unterstes Element + 2 mm, mindestens 10 mm).
  *(Builder-Entscheid, siehe unten.)*
- Die Regel wird an **einer** Stelle im Frontend implementiert (Hilfsfunktion
  `printAreaMm(media, lengthMm)`), damit Canvas, Raster, Hilfslinien,
  Ausrichten und Pfeiltasten-Grenzen dieselben Masse nutzen.

### 2. Gleiche Schrift und gleiche Zeilenabstände

- Der Server liefert die mitgelieferten DejaVu-Dateien aus (z.B.
  `GET /api/fonts/default/regular` und `/bold`, hinter `requireAuth`). Der
  Editor registriert sie als `@font-face` (wie heute schon die hochgeladenen
  Schriften in `useFontFaces`) und nutzt sie als Standard statt Work Sans; fett
  → Bold-Datei.
- Der Canvas wartet auf das Laden der Schriften (`document.fonts.load`) und
  zeichnet danach neu, sonst misst er mit der Ersatzschrift.
- Konva-Text bekommt `lineHeight` 1,3 wie der Renderer. Die Konstante wird im
  Frontend benannt und mit Verweis auf `LINE_HEIGHT_FACTOR` im Renderer
  kommentiert. Die Trefferzone nutzt denselben Wert.

### 3. Element-Kästen mit echten Massen

Hilfslinien und Ausrichten brauchen die tatsächliche Grösse jedes Elements.

- Text/fixer Text: Breite = längste Zeile, gemessen mit der Druckschrift
  (Canvas `measureText`, Schriftgrösse wie beim Zeichnen); Höhe = Zeilen ×
  Schriftgrösse × 1,3. Die Lage relativ zum Anker folgt `align` (links: Anker
  ist linke Kante, zentriert: Mitte, rechts: rechte Kante). Für Textfelder wird
  der Beispielwert gemessen (wie heute angezeigt).
- Logo, QR, Linie: wie heute aus `heightMm`, `sizeMm`, `widthMm`/`thicknessMm`.
  Logo-Breite: Seitenverhältnis des Bildes, wenn bekannt, sonst quadratisch wie
  heute.
- Drehung: achsenparallele Hülle wie heute in `computeBoxes`.
- Die Trefferzone für Text wird damit auch schmaler (bisher volle
  Etikettenbreite). Dünne Linien behalten die Mindesthöhe von 8 px.

### 4. Einrasten und Hilfslinien beim Ziehen

- Einrastziele, in dieser Reihenfolge der Priorität:
  1. Etikett: linker/rechter Rand, waagrechte Mitte; oberer/unterer Rand,
     senkrechte Mitte.
  2. Andere Elemente: deren linke/rechte Kante und Mitte, obere/untere Kante
     und Mitte.
  3. Rasterlinien (wenn Raster an).
- Verglichen werden jeweils linke Kante, Mitte und rechte Kante des gezogenen
  Elements (bzw. oben/Mitte/unten). X und Y rasten **unabhängig**.
- Fangbereich: 6 Bildschirm-Pixel (1,5 mm). Liegen mehrere Ziele im
  Fangbereich, gewinnt das nächste; bei Gleichstand die höhere Priorität.
- Während des Ziehens zeigt eine dünne Linie in Akzentfarbe über die ganze
  Etikettenhöhe bzw. -breite, woran gerade eingerastet wird. Linien
  verschwinden beim Loslassen.
- **Alt** gedrückt halten setzt das Einrasten für diesen Moment aus.
- Das Einrasten bewegt den *Anker* (`xMm`/`yMm`) so, dass die gewählte Kante
  bzw. Mitte genau auf dem Ziel liegt.
- Gespeicherte Positionen: eingerastet → exakter Wert, auf 0,1 mm gerundet;
  frei gezogen → auf 0,5 mm gerundet (statt heute ganze mm). Die
  X/Y-Eingabefelder bekommen `step="0.1"`.

### 5. Raster

- Kleine Leiste über dem Entwurf: Schalter „Raster“ (sichtbar ja/nein),
  Auswahl 2,5 / 5 / 10 mm (Standard 5 mm), Schalter „Einrasten“.
- Raster sichtbar: feine Linien in `--line`-Ton auf dem Etikett, Ursprung
  oben links der Druckfläche.
- „Einrasten“ schaltet Hilfslinien **und** Raster-Rasten gemeinsam ein/aus
  (ein Schalter, ein Begriff). Ist das Raster ausgeblendet, rastet nur an
  Etikett und Elementen.
- Die Einstellungen merkt sich der Browser (`localStorage`, Zugriffe in
  try/catch, Standard bei Fehlschlag). Sie sind Arbeitshilfe, keine Druckdaten.

### 6. Ausrichten-Knöpfe

- Im Eigenschaften-Panel unter dem Elementtitel zwei Gruppen à drei Knöpfe:
  waagrecht links / mittig / rechts, senkrecht oben / mittig / unten.
  Mit `aria-label` und Tooltip.
- Bezug ist immer die Druckfläche aus §1.
- Logo, QR, Linie: Anker so setzen, dass der Kasten (§3) bündig bzw. mittig
  liegt.
- Text und fixer Text, **waagrecht**: Ausrichtung *und* Anker werden gesetzt
  (links → `align: left`, x = 0; mittig → `align: center`, x = Breite/2;
  rechts → `align: right`, x = Breite). So bleibt ein Name auch bei anderer
  Länge zentriert bzw. bündig.
- Text, **senkrecht**: y aus der Texthöhe (§3); sie hängt nur von Zeilenzahl
  und Schriftgrösse ab, nicht vom Namen.
- Gedrehte Elemente: Ausrichten nutzt die Hülle. Für gedrehten Text wird
  `align` nicht verändert, nur der Anker verschoben.

### 7. Feste Länge bei Endlosetiketten

- Neue Spalte `label_layouts.length_mm` (real, nullable). `null` = automatisch
  (heutiges Verhalten). Drizzle-Migration.
- API: `lengthMm` in Create/Update/Preview-Schema, positiv, höchstens 1000 mm,
  `null` erlaubt. Nur bei Endlosmedien wirksam; bei Die-Cut wird der Wert
  ignoriert (nicht abgelehnt), damit ein Medienwechsel nichts kaputtmacht.
- Renderer: `RenderLabelOptions.lengthMm`. Bei Endlos gilt
  `lengthMm ?? computeContentHeightMm(...)` (Mindesthöhe bleibt). Inhalt, der
  darüber hinausragt, wird abgeschnitten.
- `PrintPipeline` und der Vorschau-Endpunkt reichen den Wert durch.
- Editor: Bei Endlosmedien im Kopf des Entwurfs „Länge: automatisch / fix [__]
  mm“. Fix → die Fläche ist genau so lang. Ragen Elemente über das Ende, zeigt
  der Editor einen Hinweis „Element ragt über das Etikett hinaus und wird
  abgeschnitten“. Gehört zum ungespeicherten Stand (Dirty-Anzeige).

### 8. Bestehende Layouts

- Am **Druck** ändert sich nichts: gleiche Positionen, gleiche Flächen, Länge
  bleibt automatisch.
- Im **Editor** sehen bestehende Die-Cut-Layouts nun die echte, kleinere
  Fläche. Elemente ausserhalb werden normal angezeigt, stehen aber über den
  Rand und erzeugen denselben Hinweis wie in §7. Keine automatische
  Verschiebung.

## Tests

- Renderer: feste Länge ergibt genau diese Bildhöhe; ohne Wert unverändert;
  bei Die-Cut ignoriert. Bestehende Renderer-Tests bleiben grün.
- API: Validierung von `lengthMm` (null, positiv, Grenze).
- Frontend-Logik als reine Funktionen testbar (`printAreaMm`, Einrast-Suche,
  Ausrichten-Berechnung). Für das Frontend existiert noch kein Test-Setup;
  Vitest wird ergänzt, nur für diese reinen Funktionen.
- Browserprüfung (Playwright, wie beim Design-Durchgang): Ziehen rastet an der
  Mitte ein und zeigt die Linie, Alt setzt aus, Ausrichten-Knöpfe, Raster
  umschalten, feste Länge ändert Vorschau-Höhe.

## Dem Builder überlassen

- Genaue Optik der Raster-Leiste und der Ausrichten-Symbole.
- Wie Element-Masse zwischen Canvas und Panel geteilt werden (gemeinsames
  Modul empfohlen).
- Ob die geschätzte „endet hier“-Linie bei automatischer Länge die
  Logo-Höhe aus dem Bild kennt oder wie der Renderer `heightMm` nutzt.
