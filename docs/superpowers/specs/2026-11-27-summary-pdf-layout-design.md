# Anwesenheitsliste: vollständig, eindeutig und gestaltbar

Stand: 2026-11-27 · Status: Entwurf, wartet auf Freigabe

## Wozu

Die Liste (Gruppen-Sammelausdruck, A4) wird auf Papier für den **Checkout** und
im Fall einer **Evakuierung** benutzt. Sie muss deshalb vollständig sein, jede
Person genau einmal zeigen und sich schnell abhaken lassen.

Heute gilt nach den ersten Tests:

- Personen stehen doppelt auf der Liste (vom Nutzer bestätigt): `print_log`
  hat eine Zeile **je Etikett**, und jede Zeile landet auf der Liste.
- Personen mit fehlgeschlagenem Etikettendruck fehlen (aus dem Code gelesen).
- Das PDF trennt Spalten nur mit Leerzeichen, sie stehen nicht untereinander.

## Ziele

- Jeder Check-in, den v2 empfangen hat, steht pro Gruppe genau einmal auf der
  Liste, unabhängig vom Erfolg des Etikettendrucks.
- Saubere Tabelle mit Abhak-Spalten und einer Schreibspalte für Gastnamen.
- Gestaltung pro Sammel-Layout im GUI, mit Vorschau ohne Papierverbrauch.

## Nicht-Ziele

- Freier Drag-&-Drop-Editor für die A4-Seite.
- Allergien oder weitere ChurchTools-Zusatzzeilen auf der Liste.
- Abgleich mit ChurchTools (`verify_against_ct`) oder Berücksichtigung von
  Checkouts: die Liste wird vor dem Checkout gedruckt.
- Gestaltung des Etikettenstreifens (er bekommt nur die Datenkorrektur).
- Umformatieren von Namen („Nachname, Vorname“): Namen erscheinen so, wie
  ChurchTools sie liefert.

## Anti-Ziele

- Eine eingecheckte Person fehlt auf der Liste.
- Zwei verschiedene Personen werden zu einer zusammengefasst.
- Ein Name wird abgeschnitten.

## Ansätze

| | Ansatz | Abwägung |
|---|---|---|
| **1 (gewählt)** | Vorhandenes `pdfkit` zeichnet Tabelle, Kästchen, Logo, Kopf- und Fusszeile. | Keine neue Abhängigkeit, leicht auf dem Pi, scharf. Gestaltung auf die vorgesehenen Einstellungen begrenzt. |
| 2 | HTML/CSS, per headless Chromium zu PDF. | Freiestes Design, aber hunderte MB im Image, viel Speicher und langsam auf dem Pi. |
| 3 | Seite als Bild rendern. | Unscharf, grosse Aufträge, kein Vorteil. |

Der Nutzer hat 1 gewählt.

## Design

### 1. Daten: vollständig und eindeutig

- Der Sammelausdruck liest aus `print_log` **alle** Zeilen im Zeitraum
  (`success` und `failed`).
- Damit wirklich jeder empfangene Check-in eine Zeile hat, schreibt die
  `PrintPipeline` auch dann eine `failed`-Zeile, wenn (a) für den Typ kein
  Layout existiert oder (b) das Layout keinen Drucker hat. Als `printer_id`
  dient dann das erste Gerät der empfangenden Druckergruppe.
- Zusammengefasst wird nach **Gruppe + Name + Code**. Es gilt die früheste
  Uhrzeit. Zeilen ohne Name und ohne Code werden nie zusammengefasst.
- Sortierung innerhalb der Gruppe: zuerst Gäste, dann alle anderen, jeweils
  nach Name (deutsche Sortierung, Zahlen numerisch: „Gast 2“ vor „Gast 10“).
- Gast = Name beginnt mit dem Erkennungswort (Standard `Gast`), gefolgt von
  Leerzeichen oder Ziffer, Gross-/Kleinschreibung egal. „Gastner“ ist kein Gast.
  Ist die Gast-Spalte ausgeschaltet, gilt die Gäste-zuerst-Regel trotzdem.
- Gilt für A4 und Etikettenstreifen.

### 2. Seite (A4)

```
[Logo]  Anwesenheitsliste: Youngsters          29.11.2026, 10:05
        12 Personen

 Abgeholt | Da | Name              | Code | Zeit  | Name Gast
----------+----+-------------------+------+-------+-----------------
    ☐     | ☐  | Gast 1 Youngsters | QX7P | 09:50 | ______________
    ☐     | ☐  | Muster, Erika     | AB12 | 09:41 |

 Fusszeile                                              Seite 1/1
```

- Jede Gruppe ist wie bisher ein eigener Druckauftrag, beginnt also auf einem
  neuen Blatt. Seitenzahlen zählen innerhalb der Gruppe.
- Kopf (Logo, Titel, Datum/Uhrzeit des Drucks, Anzahl) und Tabellenkopf
  wiederholen sich auf jeder Folgeseite. Die Anzahl ist die der ganzen Gruppe.
- Eine Zeile wird nie über zwei Seiten geteilt. Lange Texte brechen um, die
  Zeile wird höher.
- Zeilen sind mindestens 8 mm hoch (Platz zum Schreiben).
- Schrift: die mitgelieferten DejaVu-Fonts (`backend/assets/fonts`), damit
  Sonderzeichen in Namen stimmen.
- Die Schreiblinie in der Gast-Spalte erscheint nur bei Gästen.

### 3. Einstellungen

Neue Spalte `summary_layouts.design_json` (nullable, additive Migration).
Fehlende Werte werden mit Standards ergänzt, bestehende Layouts brauchen
nichts.

| Einstellung | Standard | Grenzen |
|---|---|---|
| Logo (aus den hochgeladenen Logos) | keines | gelöschtes Logo → ohne Logo drucken, kein Fehler |
| Schriftgrösse | 11 pt | 8–18 |
| Ausrichtung | Querformat | Hoch/Quer |
| Abhak-Spalten (Überschriften) | `Abgeholt`, `Da` | 0–4, je max. 20 Zeichen |
| Gast-Spalte an/aus | an | |
| Überschrift Gast-Spalte | `Name Gast` | max. 30 Zeichen |
| Gast-Erkennungswort | `Gast` | 1–30 Zeichen |
| Fusszeile | leer | max. 200 Zeichen |

Spaltenauswahl und -reihenfolge bleiben in `columnsJson` (Name, Code, Zeit);
das GUI bekommt Knöpfe zum Verschieben. Der Titel bleibt `titleTemplate`.
Reihenfolge auf der Seite: Abhak-Spalten, Datenspalten, Gast-Spalte.

Logo hochladen geschieht dort, wo es heute schon geht (PNG/JPEG); die
Sammelausdruck-Seite bietet nur die Auswahl.

### 4. Vorschau

- Neue Admin-Route `POST /api/summary-layouts/preview`: nimmt Titel, Spalten
  und Design aus dem (auch ungespeicherten) Formular und liefert ein PDF.
- Beispieldaten: Gruppe „Beispielgruppe“, so viele Personen, dass eine zweite
  Seite entsteht, darunter zwei Gäste.
- GUI-Knopf „Vorschau“ öffnet das PDF in einem neuen Tab. Es wird nichts
  gedruckt.
- Bei Ziel „Etikettendrucker“ werden Design-Felder und Vorschau ausgeblendet.

## Tests

- TDD im Backend: Zusammenfassen/Sortieren/Gasterkennung; `failed`-Zeilen auf
  der Liste; Pipeline protokolliert die beiden bisher stummen Fälle; Design-
  Standards und Grenzen; Vorschau-Route; Migration.
- PDF: Seitenanzahl bei vielen Zeilen, Ausrichtung, wiederholter Kopf und
  Textinhalt soweit prüfbar.
- Manuell durch den Nutzer: Vorschau ansehen, Probedruck.

## Dem Umsetzenden überlassen

Abstände, Linienstärken, Spaltenbreiten (Name und Gast-Spalte bekommen den
meisten Platz), genaue GUI-Anordnung im bestehenden Stil.

## Festlegungen von Claude (nicht ausdrücklich vom Nutzer)

- Vorschau-Knopf, Zusammenfass-Schlüssel, Aufnahme fehlgeschlagener Drucke,
  die Standardwerte und Grenzen, „Personen“ als Zählwort.
- Namen werden nicht umformatiert (die Skizze im Gespräch zeigte
  „Nachname, Vorname“ nur als Beispiel).
