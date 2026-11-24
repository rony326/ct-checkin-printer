# Sammelausdruck per Hardware-Taster (Raspberry Pi)

Stand: 2026-11-24 · Status: Entwurf, wartet auf Freigabe

## Wozu

Ablauf vor Ort, ein Check-in pro Tag:

1. Check-in läuft über ChurchTools, v2 druckt die Etiketten.
2. Die verantwortliche Person schliesst den Check-in in ChurchTools.
3. Danach drückt sie einen **physischen Taster**, und die Anwesenheitsliste
   (Gruppen-Sammelausdruck) kommt aus dem A4-Drucker.

Die Person hat **keinen Netzwerkzugang** zum Dienst und kein Admin-Login.
v2 soll dafür auf einem **Raspberry Pi 4** laufen, der vor Ort steht. Am Pi
gibt es zwei Taster:

- **Taster 1 „Liste drucken“**, mit Status-LED.
- **Taster 2 „Ausschalten“**: fährt den Pi sauber herunter.

Zusätzlich will der Admin den Sammelausdruck **zum Testen manuell** auslösen
können, ohne curl.

## Ziele

- Ein Tastendruck druckt die Anwesenheitsliste für **heute 00:00 bis jetzt**
  (Ortszeit) auf dem eingestellten Drucker.
- Die LED sagt ehrlich, ob gedruckt wurde: läuft / Erfolg / nichts zu drucken /
  Fehler.
- Ein langer Druck auf Taster 2 fährt den Pi herunter. Ist der Pi
  ausgeschaltet, startet ihn derselbe Taster wieder.
- Im Web-GUI lassen sich Sammel-Layouts anlegen, bearbeiten und mit
  „Jetzt drucken“ testen. Dort wird auch der Taster-Zugang eingerichtet.
- Der Auslöse-Endpunkt ist allgemein gehalten (Token + Secret über HTTP).
  Später kann ihn auch ein Stream Deck, n8n oder ein WLAN-Taster nutzen.

## Nicht-Ziele

- Erkennen, dass der Check-in in ChurchTools geschlossen wurde, und dann
  automatisch drucken. Möglicher späterer Ausbau, dafür ist erst eine Recherche
  zur oldApi nötig.
- Mehrere Check-in-Durchgänge pro Tag. Der Zeitraum ist fest „heute“.
- `verify_against_ct` (bleibt unimplementiert).
- Der bekannte Bug, dass `window_close`-Sammelausdrucke bei mehreren
  Druckergruppen mehrfach drucken. Wird separat behoben.
- GPIO-Zugriff aus v2 bzw. dem Docker-Container heraus.

## Anti-Ziele (wäre trotz „funktioniert“ ein Fehlschlag)

- Die LED meldet Erfolg, obwohl der Drucker nichts gedruckt hat.
- Mehrmals drücken ergibt mehrere Ausdrucke.
- Der Pi geht durch versehentliches kurzes Antippen aus.
- Der Taster-Zugang braucht das Admin-Passwort oder schwächt den Admin-Login.

## Rahmenbedingungen

- v2 läuft im Docker-Container auf dem Pi. Der Container bekommt **keine**
  zusätzlichen Rechte (kein `privileged`, kein `/dev/gpiochip`).
- Pi 4 mit **Raspberry Pi OS 64-bit (Bookworm)**. Alle nativen Abhängigkeiten
  haben ARM64-Binaries, real auf dem Pi getestet ist das aber noch nicht. Der
  erste Docker-Build auf dem Pi ist zugleich der erste Docker-Build überhaupt.
- Taster und LED hängen direkt an den GPIO-Pins des Pi.

## Ansätze (betrachtet)

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | Kleiner Python-Dienst auf dem Pi-Host (`gpiozero`, systemd) ruft einen token-geschützten Endpunkt in v2 über `localhost` auf. Ausschalten über das Kernel-Overlay `gpio-shutdown`. | v2 bleibt hardwareunabhängig, Container braucht keine Sonderrechte, Ausschalten geht auch, wenn v2 hängt. Dafür eine zweite Komponente auf dem Pi. |
| B | GPIO direkt in v2 (Node). | Container bräuchte GPIO-Gerät plus Host-Rechte zum Herunterfahren; v2 wäre fest an den Pi gebunden und schwer zu testen. Verworfen. |
| C | WLAN-Taster (Shelly/ESP32) ruft denselben Endpunkt auf. | Fürs Ausschalten braucht es trotzdem etwas auf dem Pi. Lohnt sich erst, wenn der Taster weit weg vom Pi sitzt. Bleibt als spätere Option, weil der Endpunkt das schon unterstützt. |

Gewählt hat der Nutzer A.

## Design

### 1. Sammelausdruck meldet echte Fehler (Backend, Voraussetzung)

`SummaryReportService.generate()` ignoriert heute das Druckergebnis
(`printDocument`/`printLabel` → `PrintResult`) und steigt bei fehlendem Drucker
oder Medium still aus. Neu:

- Ein Fehlschlag beim Drucken einer Gruppe führt zu `ok: false` mit
  verständlicher `message` (z. B. „Drucker ‚Büro‘ nicht erreichbar: …“). Die
  übrigen Gruppen werden trotzdem versucht. Das Ergebnis meldet
  `groupsPrinted` (erfolgreich) und `groupsFailed`.
- Ein fehlender Drucker bzw. ein fehlendes Medium ist ein Fehler (`ok: false`),
  kein stilles Überspringen.
- Gibt es keine Check-ins im Zeitraum, bleibt es bei `ok: true`,
  `groupsPrinted: 0`. Das Ergebnis bekommt dafür ein eigenes Feld
  `empty: true`, damit die LED „nichts zu drucken“ zeigen kann.

### 2. Taster-Zugang pro Sammel-Layout (Backend)

Migration 0008, neue Spalten in `summary_layouts`:

- `trigger_token` (text, unique, nullable): zufälliger Pfad-Token
- `trigger_secret_enc` (text, nullable): verschlüsseltes Bearer-Secret, wie
  bei `webhooks_incoming`
- `trigger_enabled` (boolean, Default false)

Neue öffentliche Route (ohne Session):

```
POST /api/summary-trigger/:token
Authorization: Bearer <secret>
```

- Zeitraum: heute 00:00 Ortszeit bis jetzt (gleiche Logik wie der bestehende
  `/print`-Endpunkt ohne Body).
- Das Secret wird zeitkonstant verglichen (`crypto.timingSafeEqual`).
- Pro Layout läuft höchstens ein Druck gleichzeitig (Sperre im Prozess).
  Kommt ein zweiter Aufruf, während einer läuft → `409`, es wird nicht
  gedruckt.
- Antworten: `404` (Token unbekannt oder deaktiviert), `401` (falsches oder
  fehlendes Secret), `409` (läuft schon), `200` mit
  `{ ok, empty, groupsPrinted, groupsFailed, message }`. Der Aufrufer prüft
  nur `ok` und `empty`.
- Anders als beim eingehenden Webhook wartet die Antwort auf das echte
  Druckergebnis, weil die LED es braucht.

Admin-Routen (mit Session) zum Verwalten: Zugang aktivieren/deaktivieren,
Token+Secret erzeugen bzw. neu erzeugen, Secret anzeigen. Nach dem Muster von
`api/webhooksIncoming.ts`.

### 3. GUI-Seite „Sammelausdrucke“ (Frontend)

Neue Seite `/summary-layouts`, Navigationspunkt „Sammelausdrucke“:

- Liste der Sammel-Layouts; Anlegen, Bearbeiten, Löschen: Name, Zieldrucker
  (A4-Dokumentdrucker **oder** Etikettendrucker), Spalten, Titel, Auslöser
  (`manual`/`window_close`).
- Button **„Jetzt drucken (heute)“** pro Layout. Zeigt das Ergebnis an
  („3 Gruppen gedruckt“ / „Keine Check-ins heute“ / Fehlermeldung). Das ist
  der manuelle Testweg.
- Abschnitt **„Hardware-Taster“** pro Layout: aktivieren, Zugang erzeugen,
  Aufruf-URL und Secret anzeigen, dazu ein fertiger Konfigurationsblock zum
  Kopieren für `/etc/ct-summary-button.env` (siehe 4).

### 4. Tasten-Dienst auf dem Pi (neu, Verzeichnis `pi/`)

- `pi/summary_button.py`: Python 3, `gpiozero` (auf Raspberry Pi OS
  vorinstalliert), nur Standardbibliothek für HTTP (`urllib`).
- `pi/ct-summary-button.service`: systemd-Unit, startet nach dem Netzwerk,
  startet bei Absturz neu.
- `pi/README.md`: Verdrahtung, Installation, Konfiguration, Test.
- Konfiguration über `/etc/ct-summary-button.env`: `TRIGGER_URL`
  (z. B. `http://localhost:3000/api/summary-trigger/<token>`),
  `TRIGGER_SECRET`, optional Pin-Nummern.

Verhalten:

| Situation | LED |
|---|---|
| Dienst gestartet | 3× kurz blinken („bereit“) |
| Druck läuft (Taster gedrückt, wartet auf Antwort) | langsam blinken |
| `ok: true`, gedruckt | 5 s an |
| `ok: true, empty: true` | 2× lang blinken |
| Fehler (`ok: false`, HTTP-Fehler, Timeout, v2 nicht erreichbar) | 10 s schnell blinken |

- Tastendrücke, während ein Druck läuft, werden ignoriert (zweite Schutzlinie
  neben dem `409`).
- HTTP-Timeout 60 s (IPP-Druck mehrerer Gruppen kann dauern).
- Jeder Druck und jeder Fehler wird ins Journal geloggt (`journalctl -u
  ct-summary-button`).

### 5. Ausschalt-Taster (nur Konfiguration, kein Code)

In `/boot/firmware/config.txt`:

```
dtoverlay=gpio-shutdown,gpio_pin=3,debounce=3000
```

- 3 Sekunden gedrückt halten → sauberes Herunterfahren.
- Auf GPIO3 schaltet derselbe Taster den ausgeschalteten Pi wieder ein
  (Pi-Firmware-Eigenschaft).
- GPIO3 ist auch I2C-SCL. Wird I2C nicht genutzt, ist das unproblematisch.
  Steht so im README.

### 6. Verdrahtung (Vorschlag)

| Funktion | GPIO | Pin | Anschluss |
|---|---|---|---|
| Taster „Liste drucken“ | GPIO17 | 11 | Taster gegen GND (Pin 9), interner Pull-up |
| Status-LED | GPIO27 | 13 | LED + 330 Ω gegen GND |
| Taster „Ausschalten“ | GPIO3 | 5 | Taster gegen GND (Pin 6) |

### 7. Zeitzone im Container

`docker-compose.yml` bekommt `TZ: ${TZ:-Europe/Zurich}`, `.env.example`
dokumentiert `TZ`. Ohne das läuft der Container auf UTC: „heute 00:00“, die
Uhrzeiten auf der Liste und die `activeTimes`-Fenster wären um 1–2 h
verschoben. Node bringt die Zeitzonen-Daten über ICU selbst mit, `tzdata` im
Image ist nicht nötig. Das muss beim ersten Pi-Test verifiziert werden.

## Tests

- Backend per TDD (Vitest): Fehlerweitergabe in `generate()`; Trigger-Route
  (404/401/409/200, `empty`, zeitkonstanter Vergleich, Sperre gegen paralleles
  Auslösen); Admin-Routen für Token/Secret; Migration.
- Pi-Dienst: Zustandslogik (Antwort → LED-Muster, Sperre während eines Drucks)
  mit `gpiozero`s `MockFactory` testbar, ohne Hardware.
- Manuell auf dem Pi: Docker-Build, Brother-Druck, A4-Druck per IPP, beide
  Taster, Zeitzone.

## Dem Umsetzenden überlassen

- Genaues Fehlertext-Wording, Layout der GUI-Seite im bestehenden Stil.
- Ob die Sperre gegen paralleles Auslösen auch für den GUI-Button
  `/print` gilt (empfohlen: ja, gleiche Sperre).
- Installationsskript für den Pi-Dienst oder nur Anleitung im README.

## Festlegungen von Claude (nicht vom Nutzer entschieden)

- Pin-Belegung (Abschnitt 6) und LED-Muster (Abschnitt 4).
- 3 s Haltezeit fürs Ausschalten.
- Taster-Zugang **pro Sammel-Layout** statt global. Dadurch braucht der
  Pi-Dienst keine Layout-ID, nur URL + Secret.
- Die GUI-Seite „Sammelausdrucke“ gehört zu diesem Vorhaben, weil Taster-Zugang
  und Testdruck sonst nur per curl einzurichten wären.
- `TZ`-Default `Europe/Zurich`.
