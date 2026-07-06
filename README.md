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
| 🔀 | **Label-Routing** — verschiedene Etiketten auf verschiedene Drucker mit eigenem Layout |
| 🔖 | **Flexibles Layout** — Schriftgrösse, Ausrichtung, Logo, QR-Code, Freitext via JSON |
| 📱 | **QR-Code** — SHA1-Hash aus ID, Code und Timestamp auf dem Etikett |
| 🔗 | **Webhooks** — Check-In Webhook + separater Status-Webhook für Drucker-Events |
| 🔄 | **Exponential Backoff** bei API-Fehlern, automatischer Neustart via systemd |
| ✅ | **Graceful Shutdown** — Drucker werden in ChurchTools sauber abgemeldet |

---

## Voraussetzungen

- Raspberry Pi / Debian, Node.js ≥ 18, Python 3
- Brother QL Labeldrucker im Netzwerk (getestet: QL-720NWB, QL-820NWB)
- **Weboberfläche des Druckers auf Englisch gestellt** — die automatische Fehlererkennung (Band leer, Deckel offen etc.) sucht nach englischen Textstrings im Drucker-Webstatus und funktioniert mit anderen Sprachen nicht zuverlässig
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

# Falls schon mal das Original-Paket installiert wurde: zuerst entfernen,
# sonst kann es mit brother_ql-inventree kollidieren (beide nutzen denselben
# Modulnamen "brother_ql")
pip3 uninstall -y brother_ql 2>/dev/null

pip3 install -r requirements.txt --break-system-packages

# 4. Konfiguration
cp .env.example .env
nano .env        # CT_BASE_URL, CT_USERNAME, CT_PASSWORD eintragen
nano config.js   # Drucker, Zeitfenster, Webhooks konfigurieren
```

> **Hinweis:** Wir verwenden `brother_ql-inventree` statt dem originalen `brother_ql` für bessere QL-820NWB Unterstützung und natives `60x86` (DK-11234) Label. Beide Pakete stellen dasselbe Python-Modul (`brother_ql`) bereit — nicht parallel installieren.

<details>
<summary><b>Optional: Python-Abhängigkeiten in venv statt systemweit installieren</b></summary>

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# In config.js unter "printer" eintragen:
# pythonBin: '/home/pi/checkin-printer/venv/bin/python3',
```

Vermeidet, dass ungepinnte Pakete systemweit installiert werden und mit anderen Tools kollidieren könnten.
</details>

---

## Konfiguration

### .env

Enthält ausschliesslich Secrets und Umgebungsvariablen.

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

Zentrale Konfigurationsdatei — kann sicher in Git eingecheckt werden,
**solange keine echten Secrets direkt darin stehen** (siehe Warnung bei
`webhooks` unten).
Alle Optionen sind inline kommentiert.

**Zwei Drucker-Modi:**
- **Einzel-Modus** — `printerHost` direkt, alle Etiketten auf einen Drucker
- **Routing-Modus** — `labels{}`, jeder Etikettentyp auf eigenen Drucker/Layout

> ⚠️ **Booleans strikt als `true`/`false` schreiben, nicht als String.**
> `enabled: "false"` (mit Anführungszeichen) wird als *aktiviert* behandelt,
> nicht deaktiviert — der Dienst validiert das beim Start und bricht mit
> einer klaren Fehlermeldung ab, wenn irgendwo ein String statt eines
> Booleans steht. Betroffene Felder: `checkEnabled`, `statusWebhook`,
> `enabled` (Drucker/Routen/Webhooks), `retryOnPrintError`, `blockPrint`.

```javascript
module.exports = {

  polling: {
    idleMs: 15000,        // Intervall im Ruhemodus
    activeMs: 5000,       // Intervall nach erkanntem Job
    activeTtlMs: 300000,  // Aktiv-Modus Dauer nach letztem Job (5min)
    activeTimes: 'So:09:00-13:00',  // Globales Zeitfenster (leer = immer aktiv)
    maxErrors: 10,
  },

  printer: {
    labelType: '54',                    // Nur Einzel-Modus
    layoutFile: './label-layout.json',
    timeoutMs: 5000,
    pythonBin: 'python3',                // z.B. Pfad zu venv-Python
  },

  fieldMapping: {
    separator: '=',
    fields: { name: 'name', id: 'id', code: 'code', group: 'group', type: 'type' },
    parentValue: 'parent',
    childValue: 'child',
  },

  logging: {
    dir: './logs',
    retentionDays: 14,
  },

  printers: [

    // ── Einzel-Modus ──────────────────────────────────────────────────────
    {
      hostname: 'B2',
      printerName: 'Minis',         // erscheint in CT als "Minis (B2)"
      printerHost: '192.168.1.50',
      printerPort: 9100,
      activeTimes: 'So:09:00-12:00 18:00-20:00',
      checkEnabled: true,
      checkRetryIntervalMs: 30000,
      statusWebhook: true,
      printQueue: {
        maxRetries: 5,
        maxAgeMs: 1800000,
        retryDelayMs: 30000,
        retryOnPrintError: true,
      },
    },

    // ── Routing-Modus ─────────────────────────────────────────────────────
    {
      hostname: 'A1',
      printerName: 'Foyer',
      activeTimes: 'So:09:00-13:00',
      checkEnabled: true,
      checkRetryIntervalMs: 30000,
      statusWebhook: true,
      printQueue: {
        maxRetries: 5,
        maxAgeMs: 1800000,
        retryDelayMs: 30000,
        retryOnPrintError: true,
      },

      labels: {
        parent: {
          printerHost: '192.168.1.51',
          printerPort: 9100,
          labelType:   '54',
          rotate:      '0',        // '0' | '90' | '180' | '270'
          enabled:     true,
          copies:      1,
          also:        ['leader'], // zusätzlich leader drucken
        },
        leader: {
          printerHost: '192.168.1.51',
          printerPort: 9100,
          labelType:   '54',
          rotate:      '0',
          enabled:     true,
          copies:      1,
        },
        child: {
          printerHost: '192.168.1.52',
          printerPort: 9100,
          labelType:   '60x86',   // DK-11234
          rotate:      '0',
          enabled:     true,
          copies:      1,
        },
      },
    },
  ],

  webhooks: [
    // secret: 'env:WEBHOOK_SECRET_PROD' liest den echten Wert aus .env,
    // damit kein Secret im (git-versionierten) config.js landet.
    { name: 'Prod', url: 'https://meinserver.ch/webhook', method: 'POST',
      secret: 'env:WEBHOOK_SECRET_PROD', retry: 3, retryMs: 2000, enabled: true },
  ],

  webhookOptions: {
    blockPrint: false,
  },

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

#### Routing-Modus

`labels{}` aktiviert den Routing-Modus. Jeder Key entspricht dem `type`-Feld im CT-Etikettentemplate.

| Feld | Beschreibung |
|---|---|
| `printerHost` | IP des physischen Druckers |
| `labelType` | brother_ql Label-Identifier (z.B. `54`, `60x86`) |
| `rotate` | Rotation: `'0'`, `'90'`, `'180'`, `'270'` |
| `enabled` | `false` = Etikett deaktiviert |
| `copies` | Anzahl Kopien |
| `also` | Zusätzliche Etikettentypen mit denselben Job-Daten drucken |

**Gleichzeitiger Druck:** verschiedene Drucker parallel, gleicher Drucker sequenziell.

**Beim Start:** alle physischen Drucker des Standorts müssen bereit sein vor Anmeldung.

#### `also[]` — Zusätzliche Etiketten

Wenn CT nur ein Template erlaubt aber zwei verschiedene Layouts gedruckt werden sollen:

```javascript
parent: {
  printerHost: '192.168.1.51',
  labelType: '54',
  also: ['leader'],   // druckt automatisch auch leader-Layout
},
leader: {
  printerHost: '192.168.1.51',
  labelType: '54',
  // eigenes Layout in label-layout.json["leader"]
},
```

#### Drucker-Check

Vor jeder Anmeldung wird der Drucker via TCP-Ping und Brother Web-API geprüft:

| Status | Verhalten |
|---|---|
| Nicht erreichbar | Warten bis TCP ok, dann anmelden |
| Band leer / Deckel offen | Warten bis Fehler behoben, dann anmelden |
| Warnung | Anmelden + Status-Webhook |
| `checkEnabled: false` | Direkt anmelden ohne Check |

#### Retry-Queue

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
| `printer.job_expired` | Job aus Queue verworfen |
| `printer.fatal` | `MAX_ERRORS` erreicht — dieser Drucker pausiert und meldet sich nach einer Cool-down-Zeit automatisch selbst wieder an (andere Drucker laufen unabhängig weiter) |

#### Zeitfenster — activeTimes Format

```javascript
activeTimes: 'So:09:00-12:00'
activeTimes: 'So:09:00-12:00 18:00-20:00'
activeTimes: 'Mo-Fr:08:00-17:00,So:09:00-12:00'
activeTimes: ''           // immer aktiv
// activeTimes: null      // immer aktiv (ignoriert globales)
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

Definiert Layout und Inhalt pro Etikettentyp. Der Key entspricht dem `type`-Feld aus CT (`parent`, `child`, `leader` etc.).

**Block-Typen:**

| type | Felder | Beschreibung |
|---|---|---|
| `text` | `field`, `font_size`, `bold`, `align`, `prefix`, `gap_after_mm` | Textfeld aus CT-Daten |
| `static` | `value`, `font_size`, `bold`, `align`, `gap_after_mm` | Fixer Freitext |
| `logo` | `image`, `height_mm`, `align`, `gap_after_mm` | Bilddatei (PNG/JPG) |
| `qr` | `size_mm`, `align`, `gap_after_mm` | QR-Code aus SHA1-Hash |

**Verfügbare Felder:** `name` `id` `code` `group` `extra`

**Ausrichtung:** `left` `center` `right`

```json
{
  "parent": {
    "length_mm": 50,
    "padding_mm": 2,
    "line_spacing_mm": 0.8,
    "blocks": [
      { "type": "logo",   "image": "logo.png", "height_mm": 10, "align": "left", "gap_after_mm": 2 },
      { "type": "text",   "field": "id",    "font_size": 52, "bold": true,  "gap_after_mm": 2 },
      { "type": "text",   "field": "name",  "font_size": 36, "bold": false, "gap_after_mm": 0 },
      { "type": "text",   "field": "code",  "font_size": 36, "bold": false, "gap_after_mm": 2, "prefix": "Abholcode: " },
      { "type": "qr",     "size_mm": 20,   "align": "left", "gap_after_mm": 0 }
    ]
  },
  "leader": {
    "length_mm": 50,
    "padding_mm": 2,
    "line_spacing_mm": 0.8,
    "blocks": [
      { "type": "static", "value": "Leiter", "font_size": 24, "bold": true, "align": "center", "gap_after_mm": 2 },
      { "type": "text",   "field": "name",  "font_size": 36, "bold": false, "gap_after_mm": 0 },
      { "type": "text",   "field": "code",  "font_size": 36, "bold": false, "gap_after_mm": 0, "prefix": "Abholcode: " }
    ]
  },
  "child": {
    "length_mm": 50,
    "padding_mm": 2,
    "line_spacing_mm": 0.8,
    "blocks": [
      { "type": "text",   "field": "name",  "font_size": 52, "bold": true,  "gap_after_mm": 2 },
      { "type": "text",   "field": "code",  "font_size": 36, "bold": false, "gap_after_mm": 0, "prefix": "Abholcode: " }
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

> **Wichtig:** `User`, `WorkingDirectory` und der Node-Pfad in `ExecStart`
> müssen zum eigenen System passen — Standardwerte funktionieren oft nicht:
> - Neuere Raspberry-Pi-OS-Images haben keinen "pi"-Nutzer mehr (eigenen ermitteln: `whoami`)
> - `/usr/bin/node` existiert nicht bei nvm-Installationen (eigenen Pfad ermitteln: `which node`)

```bash
nano checkin-printer.service   # User, WorkingDirectory und Node-Pfad prüfen (siehe Hinweis oben)

sudo cp checkin-printer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable checkin-printer
sudo systemctl start checkin-printer

sudo systemctl status checkin-printer
sudo journalctl -u checkin-printer -f
```

```bash
sudo systemctl stop checkin-printer
sudo systemctl restart checkin-printer
sudo systemctl disable checkin-printer
```

---

## Diagnose

```bash
node diagnose.js
```

Meldet den Drucker an, wartet auf einen Check-In und speichert den rohen Job-Payload in `job-dump.json`.

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
| 🔴 MAX_ERRORS Fehler | Nur dieser Drucker: abmelden → `printer.fatal`-Webhook → 60s Pause → automatischer Wiederanlauf. Andere Drucker laufen unbeeinträchtigt weiter (kein Neustart des ganzen Dienstes) |

---

## Troubleshooting

**Drucker erscheint nicht in ChurchTools**
```bash
LOG_LEVEL=debug npm start
# hostname in config.js muss eindeutig sein
```

**TCP-Verbindung testen**
```bash
nc -zv 192.168.1.50 9100
```

**Brother Web-Status prüfen**
```bash
curl http://192.168.1.50/general/status.html | grep -E "moni|Media|Emulation"
```

**Etikett-Vorschau ohne Drucker**
```bash
DRY_RUN=true npm start
# → label_preview_N_type.png
```

**Alle verfügbaren Label-Typen**
```bash
python3 -c "from brother_ql.labels import ALL_LABELS; [print(l.identifier, l.name) for l in ALL_LABELS]"
```

**Queue-Status prüfen**
```bash
LOG_LEVEL=debug npm start
# Queue-Monitor und flush im Debug-Log sichtbar
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
          │         └── Session-Renewal alle 23h
          │
          ├──→ PrinterChecker ──→ TCP-Ping + Brother Web-API
          │
          ├──→ PrinterManager (Einzel-Modus)
          │         │  enrichJobs() → QR-Hash, Timestamp
          │         └──→ print_label.py → TCP 9100 → Drucker
          │
          ├──→ LabelRouter (Routing-Modus)
          │         │  type-Feld → Route → physischer Drucker
          │         │  also[] → zusätzliche Etiketten
          │         └──→ print_label.py (parallel/sequenziell)
          │
          ├──→ PrintQueue ──→ Retry bei Druckfehler
          │
          ├──→ WebhookService ──→ Check-In Events
          │
          └──→ StatusWebhookService ──→ Drucker-Events
```

### Dateien

| Datei | Aufgabe |
|---|---|
| `config.js` | Zentrale Konfiguration |
| `label-layout.json` | Etikett-Layout pro Typ |
| `.env` | Secrets (CT-Credentials, Log-Level) |
| `requirements.txt` | Python-Abhängigkeiten |
| `src/index.js` | Einstiegspunkt |
| `src/config.js` | Lädt `.env` + `config.js` |
| `src/churchtools-client.js` | Login, Session-Management, oldApi |
| `src/printer-manager.js` | Einzel-Modus: Jobs anreichern, Python aufrufen |
| `src/label-router.js` | Routing-Modus: type-Feld → Drucker |
| `src/printer-checker.js` | TCP-Ping + Brother Web-API Status |
| `src/print-queue.js` | Retry-Queue |
| `src/job-poller.js` | Polling-Loop, Zeitfenster, Queue, Webhooks |
| `src/schedule.js` | Zeitfenster parsen |
| `src/webhook-service.js` | Check-In Webhooks |
| `src/status-webhook-service.js` | Status-Webhooks |
| `src/printers-config.js` | Drucker-Liste laden |
| `src/logger.js` | Logging + Datei-Rotation |
| `src/validate.js` | Strikte Boolean-Validierung für config.js |
| `src/secrets.js` | Löst `env:VAR_NAME`-Secret-Referenzen auf |
| `print_label.py` | Text → PNG → Brother Raster → TCP |
| `diagnose.js` | Diagnose-Script |

---

## Getestete Hardware

| Gerät | Status |
|---|---|
| Brother QL-720NWB | ✅ |
| Brother QL-820NWB | ✅ |
| DK-N55224 (54mm, nicht-klebend) | ✅ |
| DK-11234 (60x86mm, selbstklebend) | ✅ |
| Raspberry Pi / Debian | ✅ |

---

## Lizenz

MIT