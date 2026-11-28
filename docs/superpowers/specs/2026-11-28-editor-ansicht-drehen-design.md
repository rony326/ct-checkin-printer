# Etiketten-Editor: Ansicht drehen

Stand: 2026-11-28 · Status: Entwurf, wartet auf Freigabe

## Wozu

Der Nutzer druckt Etiketten, deren Inhalt um 90° gedreht ist. Dafür stellt er
heute jedes Element einzeln auf 90° und bearbeitet das Etikett seitwärts. Er
will es im Editor drehen und aufrecht lesbar bearbeiten. Einzelne Elemente
sollen sich weiterhin separat drehen lassen. v2 geht in der Woche ab
2026-11-30 in Betrieb.

## Ziele

- Entwurf und echte Vorschau lassen sich in 90°-Schritten drehen.
- In der gedrehten Ansicht verhält sich alles so, wie man es sieht.
- Einzelne Elemente bleiben separat drehbar.

## Nicht-Ziele

- Änderungen am Druck, am Renderer, an der API oder an der Datenbank.
- Die ungenutzte Spalte `label_layouts.rotate` (Drehung beim Druck).
- Mehrere Elemente gemeinsam drehen.

## Anti-Ziele

- Das Drehen der Ansicht ändert gespeicherte Werte oder markiert das Layout als
  „Nicht gespeichert“.
- Nach Drehen, Verschieben und Zurückdrehen sind Werte verrutscht.
- Bestehende Layouts drucken anders.

## Ansätze

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | Nur die Ansicht drehen. Gespeichert wird weiter in Druckkoordinaten. | Druckweg und bestehende Layouts unberührt. Der Editor muss zwischen Ansicht und Druck umrechnen. |
| B | Aufrecht entwerfen, ganzes Etikett erst beim Druck drehen. | Ändert Druckweg und bestehende Layouts, riskant kurz vor der Inbetriebnahme. |

Der Nutzer hat A gewählt.

## Design

### Umrechnung

Reine, getestete Funktionen rechnen Elemente und Druckfläche zwischen Druck und
Ansicht um. Für 90° im Uhrzeigersinn bei Druckfläche B×H: Anker
`(x, y) → (H − y, x)`, Elementdrehung `+90°`, Ansichtsfläche H×B; 180° und 270°
entsprechend. Hin und zurück ergibt exakt die Ausgangswerte (auf 0,001 mm).
Canvas, Einrasten, Raster, Pfeiltasten, Ausrichten und Eigenschaften-Panel
arbeiten auf den Ansichtswerten; gespeichert, an die Vorschau gesendet und
gedruckt werden die Druckwerte.

### Bedienung

- Über dem Entwurf: „Ansicht drehen“ mit zwei Knöpfen (↺ / ↻) und Anzeige des
  Winkels. Standard 0°.
- Die echte Vorschau wird im selben Winkel angezeigt, ohne Platz zu
  überlappen.
- Der Browser merkt sich den Winkel **pro Layout** (`localStorage`, Zugriffe in
  try/catch, sonst 0°).
- X/Y zeigen die Ankerposition **in der Ansicht**.
- „Drehung“ eines Elements zeigt, wie es **in der Ansicht** steht („Normal
  (0°)“ = aufrecht lesbar). Gespeichert wird der Druckwert.
- Neue Elemente erscheinen in der Ansicht aufrecht bei 5/5 mm von oben links.
- Das Raster beginnt oben links in der Ansicht.
- „Links“, „Oben“ usw. beziehen sich auf den Bildschirm. Das Feld
  „Ausrichtung“ (links/zentriert/rechts) bleibt wie bisher bezogen auf die
  Leserichtung des Texts.

### Endlosetiketten

- Die Länge bleibt die Druck-Y-Richtung. In der gedrehten Ansicht liegt sie
  entsprechend waagrecht oder gespiegelt; „Etikettenlänge (mm)“ bleibt gleich.
- Bei automatischer Länge gibt es zum offenen Ende hin keine Einrastziele, keine
  Überstand-Warnung (bis 1000 mm) und gesperrte Ausrichten-Knöpfe – und zwar in
  der Richtung, in der das offene Ende in der Ansicht liegt. Die Linie „Etikett
  endet hier“ dreht mit.
- Liegt das offene Ende in der Ansicht links oder oben (der Druckanfang ist dann
  rechts bzw. unten), rechnet die Ansicht mit der angezeigten Arbeitslänge;
  verschiebt sich diese, bleiben die Druckwerte unverändert.

## Tests

- Umrechnung: alle vier Winkel, alle Elementtypen, mit Elementdrehung; hin und
  zurück verlustfrei.
- Ausrichten, Einrasten und Überstand in gedrehter Ansicht.
- Browserprüfung: bei 90° ziehen, Pfeiltasten, Ausrichten, neues Element,
  Speichern; gespeicherte Werte und Druckvorschau stimmen; Drehen allein
  markiert nichts als geändert; Winkel übersteht Neuladen.

## Entscheide, die nicht vom Nutzer stammen

X/Y und „Drehung“ in Ansichtswerten, Merken pro Layout im Browser,
Raster-Ursprung oben links in der Ansicht.
