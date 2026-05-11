# Changelog

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

## v1.2.0-beta.1 — Config Refactor & Session Management

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
