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
  - [printers.json](#printersjson)
  - [label-layout.json](#label-layoutjson)
  - [field-mapping.json](#field-mappingjson)
  - [webhooks.json](#webhooksjson)
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
| 🕐 | **Zeitfenster** — Drucker wird automatisch an/abgemeldet beim Öffnen/Schliessen |
| 🔖 | **Flexibles Layout** — Schriftgrösse, Ausrichtung, Logo, QR-Code via JSON konfigurierbar |
| 🔑 | **QR-Code** — SHA1-Hash aus ID, Code und Timestamp auf dem Etikett |
| 🔗 | **Webhooks** — POST/PUT an beliebig viele Ziele nach jedem Check-In |
| 🔄 | **Exponential Backoff** bei API-Fehlern |
| ✅ | **Graceful Shutdown** — Drucker werden in ChurchTools sauber abgemeldet |

---

## Voraussetzungen

- Raspberry Pi / Debian, Node.js ≥ 18, Python 3
- Brother QL Labeldrucker im Netzwerk (getestet: QL-720NWB, DK-N55224 / 54mm)
- ChurchTools mit Check-In-Modul, Benutzer mit Rechten:
  - Check-in sehen
  - Drucker verwalten

---

## Installation

```bash
# 1. Repository klonen
git clone https://github.com/dein-name/churchtools-checkin-printer
cd churchtools-checkin-printer

# 2. Node-Abhängigkeiten
npm install

# 3. Python-Abhängigkeiten
apt-get install -y python3-pip python3-pil fonts-dejavu
pip3 install brother_ql qrcode pillow --break-system-packages

# 4. Konfiguration
cp .env.example .env
nano .env

# 5. Drucker definieren
nano printers.json

# 6. Webhooks definieren (optional)
nano webhooks.json
```

---

## Konfiguration

### .env

```ini
# ── ChurchTools ───────────────────────────────────────────────
CT_BASE_URL=https://meinegemeinde.church.tools
CT_USERNAME=drucker@meinegemeinde.de
CT_PASSWORD=sicheresPasswort

# ── Drucker & Layout ──────────────────────────────────────────
PRINTERS_FILE=./printers.json
LABEL_TYPE=54                      # brother_ql Label-Identifier
LAYOUT_FILE=./label-layout.json
MAPPING_FILE=./field-mapping.json
# DRY_RUN=true                     # Nur PNG rendern, nicht drucken

# ── Polling ───────────────────────────────────────────────────
POLL_IDLE_MS=15000                 # Intervall ohne aktiven Job
POLL_ACTIVE_MS=5000                # Intervall nach erkanntem Job
POLL_ACTIVE_TTL_MS=300000          # Aktiv-Modus Dauer nach letztem Job (5min)

# ── Zeitfenster ───────────────────────────────────────────────
# ACTIVE_TIMES=So:09:00-12:00 18:00-20:00

# ── Fehlerbehandlung & Logging ────────────────────────────────
MAX_ERRORS=10
LOG_LEVEL=info                     # debug | info | warn | error

# ── Webhook ───────────────────────────────────────────────────
# WEBHOOKS_FILE=./webhooks.json
# WEBHOOKS_ENABLED=true            # false = alle Webhooks deaktivieren
# WEBHOOK_RETRY=3
# WEBHOOK_RETRY_MS=2000
# WEBHOOK_BLOCK_PRINT=false        # true = Druck wartet auf Webhook
```

#### ACTIVE_TIMES Format

Tagkürzel: `Mo` `Di`/`Tu` `Mi`/`We` `Do`/`Th` `Fr` `Sa` `So`/`Su` — Bereiche wie `Mo-Fr` werden expandiert.

```ini
ACTIVE_TIMES=So:09:00-12:00
ACTIVE_TIMES=So:09:00-12:00 18:00-20:00
ACTIVE_TIMES=Mo-Fr:08:00-17:00,So:09:00-12:00
ACTIVE_TIMES=Mo-So:00:00-23:59    # immer aktiv
```

---

### printers.json

```json
[
  {
    "hostname":    "foyer",
    "printerName": "Foyer-Drucker",
    "printerHost": "192.168.1.50",
    "printerPort": 9100
  }
]
```

> `hostname` muss exakt dem Standort-Namen in ChurchTools entsprechen (Gross-/Kleinschreibung beachten).

---

### label-layout.json

Definiert Layout und Inhalt für `parent`- und `child`-Etiketten.

**Block-Typen:**

| type | Felder | Beschreibung |
|---|---|---|
| `text` | `field`, `font_size`, `bold`, `align`, `prefix`, `gap_after_mm` | Textfeld aus CT-Daten |
| `logo` | `image`, `height_mm`, `align`, `gap_after_mm` | Bilddatei |
| `qr`   | `size_mm`, `align`, `gap_after_mm` | QR-Code aus SHA1-Hash |

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
      { "type": "text", "field": "name", "font_size": 52, "bold": true,  "gap_after_mm": 2 },
      { "type": "text", "field": "code", "font_size": 36, "bold": false, "gap_after_mm": 0, "prefix": "Abholcode: " }
    ]
  }
}
```

---

### field-mapping.json

Definiert wie CT-Felder (linke Seite des Trennzeichens) auf interne Felder gemappt werden.

```json
{
  "separator": "=",
  "fields": {
    "name":  "name",
    "id":    "id",
    "code":  "code",
    "group": "group",
    "type":  "type",
    "extra": "extra"
  },
  "parent_value": "parent",
  "child_value":  "child"
}
```

Das CT-Etikettentemplate muss entsprechend aufgebaut sein:
```
name={Vorname} {Nachname}
id={PersonID}
code={Abholcode}
group={Gruppenname}
type=parent
```

---

### webhooks.json

```json
[
  {
    "name":     "Prod",
    "url":      "https://prod.ch/checkin/webhook",
    "method":   "POST",
    "secret":   "deinToken",
    "retry":    3,
    "retry_ms": 2000,
    "enabled":  true
  },
  {
    "name":     "Dev",
    "url":      "https://dev.ch/checkin/webhook",
    "method":   "POST",
    "enabled":  false
  }
]
```

**Webhook-Payload:**
```json
{
  "event":     "checkin.printed",
  "timestamp": 1713355078,
  "printer": { "hostname": "foyer", "name": "Foyer-Drucker", "host": "192.168.1.50" },
  "labels": [
    {
      "ct_job_id":      "683",
      "label_type":     "parent",
      "unix_timestamp": 1713355078,
      "qr_hash":        "a3f8c2d4e1b9...",
      "fields": { "name": "Noa Jaël", "id": "2693", "code": "ZRYK", "group": "Kids", "type": "parent" }
    }
  ]
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

Das Script meldet den Drucker an, wartet auf einen Check-In und speichert den rohen Job-Payload in `job-dump.json` — nützlich um das CT-Format zu analysieren ohne den Drucker zu benötigen.

---

## Polling-Verhalten

| Zustand | Verhalten |
|---|---|
| 💤 Ausserhalb Zeitfenster | Schläft, `hidePrinter` wurde aufgerufen. Prüft sekunden-genau wann nächstes Fenster öffnet. |
| 🔔 Fenster öffnet | `activatePrinter` → Polling startet |
| 🕐 Innerhalb, kein Job | Polling alle `POLL_IDLE_MS` (Standard: 15s) |
| ⚡ Job empfangen | Polling alle `POLL_ACTIVE_MS` (Standard: 5s) für `POLL_ACTIVE_TTL_MS` (Standard: 5min) |
| 🕐 5min ohne Job | Zurück zu `POLL_IDLE_MS` |
| 🔕 Fenster schliesst | `hidePrinter` → Polling pausiert |
| 🔴 10× Fehler | 60s Pause, dann Neustart |

Jeder Drucker hat seinen eigenen unabhängigen Modus.

---

## Troubleshooting

**Drucker erscheint nicht in ChurchTools**
```bash
LOG_LEVEL=debug npm start
# Prüfe: activatePrinter success: true?
# hostname in printers.json muss exakt dem CT-Standort entsprechen
```

**TCP-Verbindung testen**
```bash
nc -zv 192.168.1.50 9100
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

---

## Architektur

```
.env + printers.json + label-layout.json + field-mapping.json + webhooks.json
      │
      ▼
  index.js  —  Login, Drucker aktivieren, Poller starten
      │
      ├── JobPoller  ──→  ChurchToolsClient  ──→  ChurchTools oldApi
      │       │                                   (getNextPrinterJob)
      │       │
      │       ├── PrinterManager
      │       │       │  enrichJobs() → QR-Hash, Timestamp, Felder
      │       │       │
      │       │       └──→ print_label.py (Python)
      │       │                   │  field-mapping.json → parse
      │       │                   │  label-layout.json  → render
      │       │                   │  Pillow → PNG
      │       │                   │  brother_ql → Raster
      │       │                   └──→ TCP Port 9100 → Labeldrucker
      │       │
      │       └── WebhookService  ──→  webhooks.json  ──→  HTTP POST/PUT
      │
      ├── JobPoller  ──→ ...  (Drucker 2)
      └── JobPoller  ──→ ...  (Drucker n)
```

### Dateien

| Datei | Aufgabe |
|---|---|
| `src/index.js` | Einstiegspunkt |
| `src/config.js` | `.env` laden und validieren |
| `src/churchtools-client.js` | Login + oldApi Wrapper |
| `src/printer-manager.js` | Jobs anreichern, Python aufrufen |
| `src/job-poller.js` | Polling-Loop, Zeitfenster, Webhook auslösen |
| `src/schedule.js` | `ACTIVE_TIMES` parsen und auswerten |
| `src/webhook-service.js` | Webhooks senden mit Retry |
| `src/printers-config.js` | `printers.json` laden |
| `src/logger.js` | Logging mit Timestamps |
| `print_label.py` | Text → PNG → Brother Raster → TCP |
| `diagnose.js` | Anmeldung testen, Job-Format erfassen |

---

## Getestete Hardware

| Gerät | Status |
|---|---|
| Brother QL-720NWB | ✅ |
| DK-N55224 (54mm, nicht-klebend) | ✅ |
| Raspberry Pi / Debian | ✅ |

---

## Lizenz

MIT
