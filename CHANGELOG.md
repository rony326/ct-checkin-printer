# Changelog

## [1.3.0-beta.2] — 2026-07-06

Umfassende Sicherheits-, Zuverlässigkeits- und Installations-Härtung nach
einem vollständigen Audit des Tools. Für jeden Punkt existiert ein GitHub-Issue
(#19–#32).

### 🧹 Versionierung

- `package.json` stand seit mehreren Releases auf veralteter `1.1.0` (der
  Tag `1.3.0-beta.1` für Label-Routing/static-Blocks/Rotation wurde nie in
  `package.json` nachgezogen) — jetzt auf `1.3.0-beta.2` aktualisiert.
- `package-lock.json` zeigte noch Name/Version des ursprünglichen Projekt-
  Arbeitstitels (`checkin-printer` `1.0.0`) — an `package.json` angeglichen.
- CHANGELOG um den bisher undokumentierten `1.3.0-beta.1`-Release ergänzt
  (siehe unten) und Versions-Überschriften einheitlich formatiert.

### 🔒 Sicherheit

- **Webhook-Secrets nicht mehr im Klartext in `config.js`** (#19) — `secret`
  kann jetzt als `env:VAR_NAME` referenziert werden und wird zur Laufzeit aus
  `.env` aufgelöst. `config.js` bleibt so git-versionierbar, ohne dass echte
  Secrets mit eingecheckt werden.
- **Strikte Boolean-Validierung für config.js** (#20) — Felder wie
  `checkEnabled`, `statusWebhook`, `enabled` (Drucker/Routen/Webhooks),
  `retryOnPrintError` und `blockPrint` akzeptieren nur noch echte
  JS-Booleans. Ein versehentlicher String wie `"false"` (der bisher lautlos
  als *aktiviert* interpretiert wurde) führt jetzt zu einem klaren
  Konfigurationsfehler beim Start statt zu stillem Fehlverhalten.
- **Personenbezogene Daten in Debug-Logs maskiert** (#30) — Namen und
  Abholcodes werden in `print_label.py`- und Node-Debug-Ausgaben nicht mehr
  im Klartext geloggt (nur noch erster Buchstabe + Länge bzw. interne Job-ID).

### 🐛 Fixes

- **Ein Drucker konnte den gesamten Dienst lahmlegen** (#21) — `MAX_ERRORS`
  führte zu `process.exit(1)` und beendete damit *alle* Poller im Prozess.
  Jetzt pausiert nur der betroffene Drucker (60s Cool-down), meldet sich
  danach automatisch selbst wieder an und feuert einen neuen
  `printer.fatal`-Status-Webhook. Andere Drucker laufen unbeeinträchtigt weiter.
- **Ungültiger `copies`-Wert druckte lautlos 0 Etiketten** (#23) — z.B.
  `copies: 'stk'` ergab intern `NaN` und die Kopie-Schleife lief nie durch,
  ohne jede Fehlermeldung. Wird jetzt beim Start als Konfigurationsfehler
  erkannt.
- **Irreführende Zeitfenster-Logausgabe beim Start** (#24) — zeigte für
  `activeTimes: ''` (erbt globales Zeitfenster) fälschlich "immer aktiv
  (drucker-spezifisch)" an. Zeigt jetzt korrekt an, ob ein Drucker das
  globale Zeitfenster erbt, ein eigenes hat, oder immer aktiv ist.
- **Status-Webhook feuerte nicht zuverlässig bei nicht auswertbarem
  Drucker-Status** (#22) — wenn die Weboberfläche des Druckers nicht auf
  Englisch steht, wird jetzt einmalig pro Drucker gewarnt, statt fälschlich
  "bereit" zu melden.

### 🔧 Robustheit

- **`ChurchToolsClient`-Interceptor-Guard** (#32) — verhindert lautloses
  Duplizieren von Axios-Interceptoren, falls künftig mehr als eine Instanz
  im selben Prozess erzeugt wird.
- **Python-Interpreter-Pfad konfigurierbar** (`printer.pythonBin`, #29) —
  ermöglicht ein isoliertes venv statt systemweiter Installation.
- **Versions-Pins in `requirements.txt`** (#27) — `brother_ql-inventree`,
  `Pillow`, `qrcode` waren völlig ungepinnt; künftige Breaking-Changes
  konnten unbemerkt einfliessen.

### 📝 Dokumentation

- Hinweis auf notwendige englische Drucker-Web-UI-Sprache (#22).
- `checkin-printer.service` und README erklären jetzt explizit, warum
  `User=pi` und `/usr/bin/node` bei neueren Raspberry-Pi-OS-Images bzw.
  nvm-Installationen angepasst werden müssen (#25, #26).
- Installationsschritt gegen `brother_ql`/`brother_ql-inventree`-Namenskollision
  ergänzt, optionale venv-Anleitung hinzugefügt (#28, #29).
- `.npmrc` mit `engine-strict=true` — `npm install` bricht jetzt mit einer
  klaren Fehlermeldung ab, statt dass zu altes Node.js erst beim Start mit
  einem kryptischen `SyntaxError` scheitert (#31).

### 🎨 Logging

- **Emojis aus allen Log-Ausgaben entfernt** — stattdessen werden Log-Zeilen
  auf der Konsole nach Level eingefärbt (grau=debug, cyan=info, gelb=warn,
  rot=error). Funktioniert nur wenn die Ausgabe an ein TTY geht und respektiert
  die `NO_COLOR`-Konvention; Logdateien bleiben unfarbig (reiner Text).

## [1.3.0-beta.1] — 2026-05-17

### ✨ Neu

- **Label-Routing** (#7, #8, #9, #10) — Etiketten anhand des `type`-Felds auf
  unterschiedliche physische Drucker mit eigenem Layout routen
  (`printers[].labels{}` statt `printerHost` direkt)
  - `labels.<type>.enabled: false` — einzelnes Etikett deaktivieren (#7)
  - `labels.<type>.copies: N` — mehrfach drucken (#9)
  - Beliebig viele Etikettentypen — einfach weiterer Key in `labels{}` (#10)
  - `also: ['leader']` — zusätzliches Etikett mit denselben Job-Daten aber
    eigenem Layout drucken, wenn ChurchTools nur ein Template erlaubt (#8)
  - Beim Start müssen alle physischen Drucker eines Standorts bereit sein,
    bevor angemeldet wird; gleicher Drucker druckt sequenziell, verschiedene
    Drucker parallel
- **Static Block-Typ** (#12) — `"type": "static"` in `label-layout.json` für
  fixen Freitext unabhängig von CT-Felddaten (z.B. "Leiter"-Beschriftung)
- **Inhalts-Rotation für Die-Cut-Labels** — `rotate: '90'/'180'/'270'` dreht
  jetzt den Etiketten-*Inhalt* statt der Bild-Dimensionen, dadurch keine
  Grössen-/Positionsfehler mehr bei selbstklebenden Die-Cut-Labels (DK-11234)

### 📦 Python-Abhängigkeiten

- `requirements.txt` eingeführt (`brother_ql-inventree`, `Pillow`, `qrcode`)
  statt manueller `pip3 install`-Anleitung in der README

## [1.2.0] — 2026-05-13

### 🚀 Highlights
- Vollständiges Drucker-Status-Monitoring mit Brother Web-API
- Retry-Queue für fehlgeschlagene Druckaufträge
- Separater Status-Webhook für Drucker-Events
- Verbessertes Session-Management

### ✨ Neu

#### Drucker-Check (#6)
- TCP-Ping + Brother Web-API Status-Check vor jeder Drucker-Anmeldung
- Erkennt: Band leer, Deckel offen, Schneidwerk blockiert, kein Band
- Wartet automatisch bis Drucker erreichbar und fehlerfrei
- Pro Drucker deaktivierbar: `checkEnabled: false`
- Konfigurierbares Retry-Intervall: `checkRetryIntervalMs`

#### Retry-Queue (#11)
- Fehlgeschlagene Druckaufträge werden pro Etikett in Queue aufgenommen
- Queue-Monitor prüft regelmässig ob Drucker wieder bereit
- Automatisches Nachdrucken sobald Drucker bereit
- Konfigurierbar: `maxRetries`, `maxAgeMs`, `retryDelayMs`, `retryOnPrintError`
- Abgelaufene/erschöpfte Jobs werden verworfen mit Log + Webhook

#### Status-Webhook
- Separater Webhook für Drucker-Status-Events (unabhängig von Check-In Webhook)
- Events: `printer.error`, `printer.warning`, `printer.ready`, `printer.job_expired`
- Pro Drucker konfigurierbar: `statusWebhook: true/false`
- Eigene Ziele in `statusWebhooks[]` in `config.js`
- Feuert auch im Dry-Run Modus

#### Session-Management (#1)
- Test-Login beim Dienststart zur Credential-Prüfung
- Session wird nur aufgebaut wenn Zeitfenster aktiv
- Automatische Session-Renewal alle 23h
- Automatischer Re-Login bei 401 Unauthorized
- Session-Renewal pausiert wenn alle Zeitfenster geschlossen

#### Zeitfenster je Drucker (#3)
- `activeTimes` pro Drucker in `config.js` konfigurierbar
- Überschreibt globales `polling.activeTimes`
- `null` = immer aktiv (ignoriert globales Zeitfenster)

### 🐛 Fixes
- Debug-Logs beim Dienststart (#5) — dotenv wird als erstes geladen
- Doppelte Fehlermeldungen beim Drucker-Status-Check behoben
- `Not Empty` wurde fälschlicherweise als `Empty` erkannt (Substring-Bug)
- `undefined` Fehlermeldungen in `callOldApi` behoben
- Drucker wird bei `MAX_ERRORS` sauber abgemeldet vor `process.exit(1)`
- `checkEnabled: false` wurde beim Dienststart ignoriert

### 🔄 Geändert
- Drucker-Abmeldung bei Zeitfenster-Wechsel (An/Abmelden automatisch)
- Präzises Zeitfenster-Scheduling (sekunden-genau statt 30s Intervall)
- `process.exit(1)` nach `MAX_ERRORS` statt 60s Pause → systemd Neustart
- Logfiles mit täglicher Rotation und konfigurierbarer Retention (#2)

### ⚠️ Breaking Changes
- `printers.json`, `webhooks.json`, `field-mapping.json` → in `config.js` integriert
- `.env` enthält nur noch Secrets und Umgebungsvariablen
- `src/config.js` liest aus `config.js` (JS-Modul) statt `.env`

### 📦 Migration von v1.2.0-beta.2
1. `config.js` aus diesem Release als Vorlage nehmen
2. Drucker-Einstellungen aus `printers.json` übertragen
3. Webhooks aus `webhooks.json` übertragen
4. Field-Mapping aus `field-mapping.json` übertragen
5. Alte Dateien löschen: `printers.json`, `webhooks.json`, `field-mapping.json`
6. `.env` auf Secrets reduzieren
7. Python: `pip3 install qrcode --break-system-packages`
8. Neue `src/`-Dateien deployen

### 🐍 Python-Abhängigkeiten
```bash
pip3 install brother_ql qrcode pillow --break-system-packages
```

### 🔧 Neue Config-Felder
```javascript
// Pro Drucker
checkEnabled: true
checkRetryIntervalMs: 30000
statusWebhook: true
printQueue: {
  maxRetries: 5,
  maxAgeMs: 1800000,
  retryDelayMs: 30000,
  retryOnPrintError: true,
}

// Neu in config.js
statusWebhooks: [{ name, url, method, secret, retry, retryMs, enabled }]
```

## [1.2.0-beta.2] — 2026-05-10

### ✨ Neu
- **Drucker-Check vor Anmeldung** (#6) — TCP-Ping + ESC/P Status-Request (32 Bytes) vor jedem `activatePrinter`
  - Wartet automatisch bis Drucker erreichbar ist (konfigurierbar: `checkRetryIntervalMs`)
  - Erkennt: Band leer, kein Band, Schneidwerk blockiert, Deckel offen
  - Drucker wird trotz Fehler-Status angemeldet — Fehler wird geloggt und optional per Webhook gemeldet
- **Status-Webhook** (#11 teilweise) — bei Drucker-Fehler oder Warnung wird ein separater Webhook gefeuert
  - Event: `printer.status` mit `errors` und `warnings` Array
  - Pro Drucker konfigurierbar: `statusWebhook: true/false`
  - Nutzt dieselben Webhook-Ziele wie Check-In Events

### 🐛 Fixes
- **Fehler-Handling `callOldApi`** — `undefined` Fehlermeldungen behoben durch robuste `_extractMessage()` Methode
  - Wertet `err.message`, `err.response.data.message`, `err.response.data.translatedMessage` und HTTP-Statuscode aus
  - Debug-Log zeigt vollständigen Fehler-Kontext für bessere Diagnose
- **Debug-Logs beim Dienststart** — `require('dotenv').config()` wird jetzt als erstes in `index.js` geladen

### 🔄 Geändert
- **Automatischer Neustart nach MAX_ERRORS** — statt 60s Pause wird `process.exit(1)` aufgerufen, systemd startet den Dienst automatisch neu
- **`checkin-printer.service`** — `StartLimitIntervalSec=300` und `StartLimitBurst=5` ergänzt (max. 5 Neustarts in 5 Minuten)

### 📦 Migration von v1.2.0-beta.1
In `config.js` pro Drucker-Eintrag ergänzen:
```javascript
checkRetryIntervalMs: 30000,  // Retry-Intervall wenn Drucker offline
statusWebhook: true,           // Webhook bei Drucker-Fehler
```
In `src/index.js` den `pollerConfig` um folgende Felder ergänzen:
```javascript
PRINTER_PORT:           p.printerPort,
PRINTER_CHECK_RETRY_MS: p.checkRetryIntervalMs,
STATUS_WEBHOOK_ENABLED: p.statusWebhook,
```

## [1.2.0-beta.1] — 2026-04-19 — Config Refactor & Session Management

### ⚠️ Breaking Changes
- `printers.json`, `webhooks.json` und `field-mapping.json` wurden in `config.js` zusammengeführt und können gelöscht werden
- `.env` enthält nur noch Secrets (`CT_BASE_URL`, `CT_USERNAME`, `CT_PASSWORD`) und Umgebungsvariablen (`LOG_LEVEL`, `DRY_RUN`)

### ✨ Neu
- **`config.js`** — zentrale Konfigurationsdatei als JS-Modul mit inline Kommentaren
  - Polling, Drucker, Webhooks, Field-Mapping und Logging in einer Datei
  - Kann sicher in Git eingecheckt werden (keine Secrets)
- **Zeitfenster je Drucker** (#3) — `activeTimes` pro Drucker in `config.js`, überschreibt globales Zeitfenster
- **Session Management** (#1) — Login nur bei aktivem Zeitfenster
  - Einmaliger Test-Login beim Dienststart zur Credential-Prüfung
  - Session wird automatisch alle 23h erneuert solange ein Drucker aktiv ist
  - Bei Zeitfenster-Wechsel wird Session gezielt gestartet/pausiert
  - Automatischer Re-Login bei 401 Unauthorized

### 🐛 Fixes
- **Debug-Logs** (#5) — `LOG_LEVEL=debug` wurde nicht korrekt ausgewertet (dotenv Timing-Problem)

### 📝 Änderungen
- **Logfiles** (#2) — tägliche Rotation (`logs/YYYY-MM-DD.log`), konfigurierbare Retention
- `config.js` zeigt Druckernamen in CT korrekt als `Minis (B2)` — `printerName (hostname)`

### 🗑️ Entfernt
- `printers.json` → jetzt in `config.js` unter `printers`
- `webhooks.json` → jetzt in `config.js` unter `webhooks`
- `field-mapping.json` → jetzt in `config.js` unter `fieldMapping`

### 📦 Migration von v1.1.0
1. `config.js` aus diesem Release als Vorlage nehmen
2. Werte aus `printers.json`, `webhooks.json` und `field-mapping.json` übertragen
3. Alte Dateien löschen
4. `.env` auf Secrets reduzieren (alle anderen Werte sind jetzt in `config.js`) 

## [1.1.0] — 2026-04-17

### Neu
- **Webhooks** — HTTP POST/PUT an konfigurierbare Ziele nach jedem Check-In
  - Externe Konfiguration via `webhooks.json` (mehrere Ziele, Prod + Dev)
  - Pro Eintrag: URL, Method, Secret, Retry, enabled-Flag
  - Globaler Schalter `WEBHOOKS_ENABLED` in `.env`
  - Blockierender oder non-blockierender Modus (`WEBHOOK_BLOCK_PRINT`)
  - Retry mit konfigurierbarem Backoff
- **QR-Code** — neuer Block-Typ `"type": "qr"` in `label-layout.json`
  - Hash: `SHA1(id + code + unixTimestamp)`
  - Konfigurierbar: Grösse, Ausrichtung, Position im Layout
- **Text-Ausrichtung** — `"align": "left" | "center" | "right"` jetzt für alle Block-Typen
- **Key=Value Feld-Mapping** — CT-Etikettenformat vollständig konfigurierbar via `field-mapping.json`
  - Trenner, Feldnamen und type-Werte anpassbar ohne Code-Änderung
- **Logo-Support** — `"type": "logo"` Block mit konfigurierbarer Grösse und Ausrichtung
- **Drucker An/Abmelden bei Zeitfenster-Wechsel** — `activatePrinter` / `hidePrinter` automatisch beim Öffnen/Schliessen eines Zeitfensters
- **Präzises Zeitfenster-Scheduling** — Sleep-Timer berechnet exakt wann nächstes Fenster öffnet (sekunden-genau)
- **Diagnose-Script** (`diagnose.js`) — Anmeldung testen und Job-Format erfassen ohne Drucker

### Geändert
- **Authentifizierung** — von API-Token auf Username/Passwort mit Session-Cookie (zuverlässiger mit oldApi)
- **Layout vollständig konfigurierbar** via `label-layout.json` — Schriftgrösse, Bold, Ausrichtung, Abstände, Länge pro Etikettentyp
- **Zwei Etikettentypen** — `parent` und `child` werden automatisch anhand des `type`-Feldes unterschieden
- **Job-Anreicherung** — jeder Job wird vor dem Druck mit `unix_timestamp`, `parsed_fields` und `qr_hash` angereichert (bereit für Webhook)
- **`printer-manager.js`** — delegiert Druck an `print_label.py` (Python), gibt angereicherte Jobs zurück
- **Mehrere Drucker** — ein unabhängiger Poller pro Eintrag in `printers.json`
- **`ACTIVE_TIMES`** — Validierung mit verständlicher Fehlermeldung bei ungültigem Format

### Entfernt
- `HOSTNAME`, `PRINTER_HOST`, `PRINTER_PORT`, `PRINTER_NAME` aus `.env` — alles in `printers.json`
- `POLL_INTERVAL_MS` — ersetzt durch `POLL_IDLE_MS` und `POLL_ACTIVE_MS`
- `WEBHOOK_URL`, `WEBHOOK_METHOD`, `WEBHOOK_SECRET` aus `.env` — alles in `webhooks.json`

### Python-Abhängigkeiten
- `brother_ql` — Brother Raster-Protokoll
- `Pillow` — Bildrendering
- `qrcode` — QR-Code Generierung

---

## [1.0.0] — 2026-04-15

### Initial Release
- Node.js Polling-Dienst für ChurchTools Check-In oldApi
- Adaptives Polling (idle / aktiv / schlafend)
- Zeitfenster (`ACTIVE_TIMES`) mit Wochentag + Uhrzeit
- Mehrere Drucker parallel (`printers.json`)
- Python-Pipeline: Text → PNG → Brother Raster → TCP
- Graceful Shutdown mit Drucker-Abmeldung
- systemd Service-Datei
- Dry-Run Modus
