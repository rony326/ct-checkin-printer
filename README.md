# churchtools-checkin-printer

> ChurchTools Check-In label printer service for Raspberry Pi / Debian.
> Polls print jobs via the ChurchTools oldApi and sends them to a Brother QL label printer over TCP.

---

## Inhalt

- [Features](#features)
- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Konfiguration](#konfiguration)
  - [.env](#env)
  - [config.js](#configjs)
  - [label-layout.json](#label-layoutjson)
- [Starten](#starten)
- [Systemdienst](#systemdienst-autostart)
- [Diagnose](#diagnose)
- [Polling-Verhalten](#polling-verhalten)
- [Troubleshooting](#troubleshooting)
- [Architektur](#architektur)

---

## Features

| | |
|---|---|
| 🖨️ | **Mehrere Drucker** gleichzeitig — ein unabhängiger Poller pro Gerät |
| ⚡ | **Adaptives Polling** — langsam im Ruhemodus, schnell nach einem Job |
| 🕐 | **Zeitfenster** — pro Drucker konfigurierbar, An/Abmeldung automatisch |
| 🔑 | **Session-Management** — Login nur bei aktivem Zeitfenster, automatische Renewal alle 23h |
| 🔍 | **Drucker-Check** — TCP-Ping + Brother Web-API Status vor Anmeldung (Band leer, Deckel offen etc.) |
| 🔁 | **Retry-Queue** — fehlgeschlagene Aufträge automatisch nachdrucken wenn Drucker wieder bereit |
| 🔖 | **Flexibles Layout** — Schriftgrösse, Ausrichtung, Logo, QR-Code via JSON konfigurierbar |
| 📱 | **QR-Code** — SHA1-Hash aus ID, Code und Timestamp auf dem Etikett |
| 🔗 | **Webhooks** — Check-In Webhook + separater Status-Webhook für Drucker-Events |
| 🔄 | **Exponential Backoff** bei API-Fehlern, automatischer Neustart via systemd |
| ✅ | **Graceful Shutdown** — Drucker werden in ChurchTools sauber abgemeldet |

---

## Voraussetzungen

- Raspberry Pi / Debian, Node.js ≥ 18, Python 3
- Brother QL Labeldrucker im Netzwerk (getestet: QL-720NWB, QL-820NWB)
- ChurchTools mit Check-In-Modul, Benutzer mit Rechten:
  - Check-in sehen
  - Drucker verwalten

---

## Installation

```bash
# 1. Repository klonen
git clone https://github.com/rony326/ct-checkin-printer
cd ct-checkin-printer

# 2. Node-Abhängigkeiten
npm install

# 3. Python-Abhängigkeiten
apt-get install -y python3-pip python3-pil fonts-dejavu
pip3 install brother_ql qrcode pillow --break-system-packages

# 4. Konfiguration
cp .env.example .env
nano .env        # CT_BASE_URL, CT_USERNAME, CT_PASSWORD eintragen
nano config.js   # Drucker, Zeitfenster, Webhooks konfigurieren
```

---

## Konfiguration

### .env

Enthält ausschliesslich Secrets und Umgebungsvariablen — **nie in Git einchecken**.

```ini
# ChurchTools Zugangsdaten
CT_BASE_URL=https://meinegemeinde.church.tools
CT_USERNAME=drucker@meinegemeinde.de
CT_PASSWORD=sicheresPasswort

# Log-Level: debug | info | warn | error (Standard: info)
LOG_LEVEL=info

# Nur PNG rendern, nicht drucken (Standard: false)
# DRY_RUN=true

# Logfiles deaktivieren (Standard: true)
# LOG_TO_FILE=true

# Alternativer Pfad zur Konfigurationsdatei (Standard: ./config.js)
# CONFIG_FILE=./config.js
```

---

### config.js

Zentrale Konfigurationsdatei — kann sicher in Git eingecheckt werden.
Alle Optionen sind inline kommentiert.

```javascript
module.exports = {

  polling: {
    idleMs: 15000,        // Intervall im Ruhemodus
    activeMs: 5000,       // Intervall nach erkanntem Job
    activeTtlMs: 300000,  // Aktiv-Modus Dauer nach letztem Job (5min)
    activeTimes: 'So:09:00-13:00',  // Globales Zeitfenster (leer = immer aktiv)
    maxErrors: 10,        // Fehler bis Dienst sich neu startet
  },

  printer: {
    labelType: '54',                    // 54mm Endlosband
    layoutFile: './label-layout.json',
    timeoutMs: 5000,
  },

  fieldMapping: {
    separator: '=',
    fields: { name: 'name', id: 'id', code: 'code', group: 'group', type: 'type' },
    parentValue: 'parent',
    childValue: 'child',
  },

  logging: {
    dir: './logs',          // Logfile-Verzeichnis (täglich rotiert)
    retentionDays: 14,      // Aufbewahrung in Tagen
  },

  printers: [
    {
      hostname: 'B2',           // Technischer Bezeichner / Raumnummer
      printerName: 'Minis',     // Anzeigename — erscheint in CT als "Minis (B2)"
      printerHost: '192.168.1.50',
      printerPort: 9100,
      activeTimes: 'So:09:00-12:00 18:00-20:00',  // drucker-spezifisches Zeitfenster

      // Drucker-Check
      checkEnabled: true,             // false = Check überspringen
      checkRetryIntervalMs: 30000,    // Retry-Intervall wenn offline/fehlerhaft

      // Status-Webhook bei Drucker-Fehler/Warnung (siehe statusWebhooks[])
      statusWebhook: true,

      // Retry-Queue für fehlgeschlagene Druckaufträge
      printQueue: {
        maxRetries: 5,              // Max. Versuche bevor Job verworfen
        maxAgeMs: 1800000,          // Max. Alter in ms (30min)
        retryDelayMs: 30000,        // Wie oft Drucker-Status prüfen
        retryOnPrintError: true,    // Auch bei Druckfehler in Queue
      },
    },
  ],

  // Check-In Webhooks — nach jedem Druckauftrag
  webhooks: [
    { name: 'Prod', url: 'https://meinserver.ch/webhook', method: 'POST',
      secret: 'token', retry: 3, retryMs: 2000, enabled: true },
  ],

  webhookOptions: {
    blockPrint: false,  // true = Druck wartet auf Webhook
  },

  // Status-Webhooks — für Drucker-Events (Fehler, Warnung, Bereit)
  statusWebhooks: [
    { name: 'Alert', url: 'https://meinserver.ch/printer/alert', method: 'POST',
      secret: null, retry: 3, retryMs: 2000, enabled: false },
  ],
};
```

#### Drucker — hostname vs. printerName

In ChurchTools erscheint der Drucker als **`printerName (hostname)`**, z.B. `Minis (B2)`.

| Feld | Bedeutung | Beispiel |
|---|---|---|
| `hostname` | Technischer Bezeichner / Raumnummer — von CT intern verwendet | `B2` |
| `printerName` | Anzeigename / Raumname | `Minis` |

#### Drucker-Check

Vor jeder Anmeldung wird der Drucker via TCP-Ping und Brother Web-API geprüft:

| Status | Verhalten |
|---|---|
| Nicht erreichbar | Warten bis TCP ok, dann anmelden |
| Band leer / Deckel offen | Warten bis Fehler behoben, dann anmelden |
| Warnung | Anmelden + Status-Webhook |
| `checkEnabled: false` | Direkt anmelden ohne Check |

#### Retry-Queue

Fehlgeschlagene Druckaufträge werden pro Etikett in eine Queue aufgenommen:

| Konfiguration | Beschreibung |
|---|---|
| `maxRetries` | Max. Versuche bevor Job verworfen wird |
| `maxAgeMs` | Max. Alter in ms — danach verworfen |
| `retryDelayMs` | Wie oft Drucker-Status geprüft wird |
| `retryOnPrintError` | `true` = auch bei Druckfehler in Queue |

#### Status-Webhook Events

| Event | Auslöser |
|---|---|
| `printer.error` | Kritischer Fehler (Band leer, Deckel offen etc.) |
| `printer.warning` | Warnung (nicht kritisch) |
| `printer.ready` | Drucker wieder bereit nach Fehler |
| `printer.job_expired` | Job aus Queue verworfen (zu alt / zu viele Versuche) |

```json
{
  "event": "printer.error",
  "timestamp": 1713355078,
  "printer": { "name": "Minis", "hostname": "B2", "host": "192.168.1.50", "port": 9100 },
  "status": { "reachable": true, "ok": false, "errors": ["Band leer"], "warnings": [] }
}
```

#### Zeitfenster — activeTimes Format

Tagkürzel: `Mo` `Di`/`Tu` `Mi`/`We` `Do`/`Th` `Fr` `Sa` `So`/`Su` — Bereiche wie `Mo-Fr` werden expandiert.

```javascript
activeTimes: 'So:09:00-12:00'                        // Sonntag, ein Fenster
activeTimes: 'So:09:00-12:00 18:00-20:00'            // Sonntag, zwei Fenster
activeTimes: 'Mo-Fr:08:00-17:00,So:09:00-12:00'      // Werktags + Sonntag
activeTimes: ''                                       // immer aktiv
// activeTimes: null                                  // immer aktiv (ignoriert globales)
```

#### Check-In Webhook-Payload

```json
{
  "event": "checkin.printed",
  "timestamp": 1713355078,
  "printer": { "hostname": "B2", "name": "Minis", "host": "192.168.1.50" },
  "labels": [
    {
      "ct_job_id": "683",
      "label_type": "parent",
      "unix_timestamp": 1713355078,
      "qr_hash": "a3f8c2d4e1b9...",
      "fields": { "name": "Max Muster", "id": "2693", "code": "ZRYK", "group": "Kids", "type": "parent" }
    }
  ]
}
```

---

### label-layout.json

Definiert Layout und Inhalt für `parent`- und `child`-Etiketten.

**Block-Typen:**

| type | Felder | Beschreibung |
|---|---|---|
| `text` | `field`, `font_size`, `bold`, `align`, `prefix`, `gap_after_mm` | Textfeld aus CT-Daten |
| `logo` | `image`, `height_mm`, `align`, `gap_after_mm` | Bilddatei (PNG/JPG) |
| `qr` | `size_mm`, `align`, `gap_after_mm` | QR-Code aus SHA1-Hash |

**Verfügbare Felder:** `name` `id` `code` `group` `extra`

**Ausrichtung:** `left` `center` `right`

```json
{
  "parent": {
    "length_mm": 80,
    "padding_mm": 2,
    "line_spacing_mm": 0.8,
    "blocks": [
      { "type": "logo", "image": "logo.png", "height_mm": 10, "align": "left", "gap_after_mm": 2 },
      { "type": "text", "field": "id",   "font_size": 52, "bold": true,  "align": "left", "gap_after_mm": 2 },
      { "type": "text", "field": "name", "font_size": 36, "bold": false, "align": "left", "gap_after_mm": 0 },
      { "type": "text", "field": "code", "font_size": 36, "bold": false, "align": "left", "gap_after_mm": 2, "prefix": "Abholcode: " },
      { "type": "qr",   "size_mm": 20,  "align": "left", "gap_after_mm": 0 }
    ]
  },
  "child": {
    "length_mm": 60,
    "padding_mm": 2,
    "line_spacing_mm": 0.8,
    "blocks": [
      { "type": "text", "field": "name", "font_size": 52, "bold": true,  "align": "left", "gap_after_mm": 2 },
      { "type": "text", "field": "code", "font_size": 36, "bold": false, "align": "left", "gap_after_mm": 0, "prefix": "Abholcode: " }
    ]
  }
}
```

---

## Starten

```bash
npm start                    # normal
LOG_LEVEL=debug npm start    # mit Debug-Logging
DRY_RUN=true npm start       # Dry-Run (speichert label_preview_N_type.png)
```

---

## Systemdienst (Autostart)

```bash
# Service-Datei anpassen (User und WorkingDirectory prüfen)
nano checkin-printer.service

# Installieren und aktivieren
sudo cp checkin-printer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable checkin-printer
sudo systemctl start checkin-printer

# Status und Logs
sudo systemctl status checkin-printer
sudo journalctl -u checkin-printer -f
```

```bash
sudo systemctl stop checkin-printer      # stoppen
sudo systemctl restart checkin-printer   # neu starten
sudo systemctl disable checkin-printer   # Autostart deaktivieren
```

---

## Diagnose

```bash
node diagnose.js
```

Meldet den Drucker an, wartet auf einen Check-In und speichert den rohen Job-Payload in `job-dump.json` — nützlich um das CT-Format zu analysieren ohne den Drucker zu benötigen.

---

## Polling-Verhalten

| Zustand | Verhalten |
|---|---|
| 💤 Ausserhalb Zeitfenster | Schläft, `hidePrinter` aufgerufen. Prüft sekunden-genau wann nächstes Fenster öffnet. |
| 🔔 Fenster öffnet | Drucker-Check → Session sicherstellen → `activatePrinter` → Polling startet |
| 🕐 Innerhalb, kein Job | Polling alle `idleMs` (Standard: 15s) |
| ⚡ Job empfangen | Polling alle `activeMs` (Standard: 5s) für `activeTtlMs` (Standard: 5min) |
| 🕐 5min ohne Job | Zurück zu `idleMs` |
| 🔕 Fenster schliesst | `hidePrinter` → Polling pausiert → Session-Renewal pausiert |
| 🔴 MAX_ERRORS Fehler | Drucker abmelden → `process.exit(1)` → systemd startet neu |

Jeder Drucker hat seinen eigenen unabhängigen Modus.

---

## Troubleshooting

**Drucker erscheint nicht in ChurchTools**
```bash
LOG_LEVEL=debug npm start
# Prüfe: activatePrinter success: true?
# hostname in config.js muss eindeutig sein
```

**TCP-Verbindung testen**
```bash
nc -zv 192.168.1.50 9100
```

**Brother Web-Status manuell prüfen**
```bash
curl http://192.168.1.50/general/status.html | grep -E "moni|Media|Emulation"
```

**Etikett-Vorschau ohne Drucker**
```bash
DRY_RUN=true npm start
# → label_preview_1_parent.png, label_preview_2_child.png
```

**Alle verfügbaren Label-Typen**
```bash
python3 -c "from brother_ql.labels import ALL_LABELS; [print(l.identifier, l.name) for l in ALL_LABELS]"
```

**ChurchTools-Verbindung testen**
```bash
curl -X POST https://meinegemeinde.church.tools/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user@mail.ch","password":"passwort"}'
```

**Queue-Status prüfen**
```bash
LOG_LEVEL=debug npm start
# Queue-Monitor und flush werden im Debug-Log sichtbar
```

---

## Architektur

```
.env (Secrets)   config.js (Konfiguration)   label-layout.json
      │                    │                          │
      └────────────────────┼──────────────────────────┘
                           ▼
                       index.js
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
      JobPoller      JobPoller        JobPoller
      (Drucker 1)    (Drucker 2)      (Drucker n)
          │
          ├──→ ChurchToolsClient ──→ ChurchTools oldApi
          │         │                (getNextPrinterJob)
          │         └── Session-Renewal alle 23h
          │
          ├──→ PrinterChecker ──→ TCP-Ping + Brother Web-API
          │
          ├──→ PrinterManager
          │         │  enrichJobs() → QR-Hash, Timestamp
          │         └──→ print_label.py
          │                   │  label-layout.json → render
          │                   │  Pillow → PNG
          │                   │  brother_ql → Raster
          │                   └──→ TCP 9100 → Labeldrucker
          │
          ├──→ PrintQueue ──→ Retry bei Druckfehler
          │
          ├──→ WebhookService ──→ HTTP POST/PUT (Check-In Events)
          │
          └──→ StatusWebhookService ──→ HTTP POST/PUT (Drucker-Events)
```

### Dateien

| Datei | Aufgabe |
|---|---|
| `config.js` | Zentrale Konfiguration (Drucker, Webhooks, Polling, Mapping) |
| `label-layout.json` | Etikett-Layout (Blöcke, Schriften, Logo, QR-Code) |
| `.env` | Secrets (CT-Credentials, Log-Level) |
| `src/index.js` | Einstiegspunkt |
| `src/config.js` | Lädt und validiert `.env` + `config.js` |
| `src/churchtools-client.js` | Login, Session-Management, oldApi |
| `src/printer-manager.js` | Jobs anreichern, Python aufrufen |
| `src/printer-checker.js` | TCP-Ping + Brother Web-API Status |
| `src/print-queue.js` | Retry-Queue für fehlgeschlagene Jobs |
| `src/job-poller.js` | Polling-Loop, Zeitfenster, Queue, Webhooks |
| `src/schedule.js` | Zeitfenster parsen und auswerten |
| `src/webhook-service.js` | Check-In Webhooks mit Retry |
| `src/status-webhook-service.js` | Status-Webhooks für Drucker-Events |
| `src/printers-config.js` | Drucker-Liste aus config.js laden |
| `src/logger.js` | Logging mit Timestamps und Datei-Rotation |
| `print_label.py` | Text → PNG → Brother Raster → TCP |
| `diagnose.js` | Anmeldung testen, Job-Format erfassen |

---

## Getestete Hardware

| Gerät | Status |
|---|---|
| Brother QL-720NWB | ✅ |
| Brother QL-820NWB | ✅ |
| DK-N55224 (54mm, nicht-klebend) | ✅ |
| Raspberry Pi / Debian | ✅ |

---

## Lizenz

MIT