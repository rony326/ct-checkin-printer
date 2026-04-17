# Changelog

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
