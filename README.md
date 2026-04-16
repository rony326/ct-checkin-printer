## Was es tut

Beim Check-In in ChurchTools werden Etiketten für Kinder und Eltern erzeugt. Dieses Projekt ersetzt das offizielle Windows-LabelPrinter-Tool durch einen Node.js-Dienst der auf einem Raspberry Pi oder einem beliebigen Debian-Rechner läuft.

```
ChurchTools Check-In
        │  getNextPrinterJob (oldApi)
        ▼
   Node.js Poller
        │  JSON (Textdaten)
        ▼
   Python (Pillow)  →  PNG
        │
   brother_ql       →  Brother Raster
        │
   TCP Port 9100    →  Brother QL-720NWB
```

**Besonderheiten:**
- Mehrere Drucker gleichzeitig — ein unabhängiger Poller pro Gerät
- Adaptives Polling — langsam im Ruhemodus, schnell nach einem Job
- Zeitfenster — ausserhalb konfigurierter Zeiten schläft der Dienst
- Dry-Run Modus — rendert Etiketten als PNG ohne zu drucken
- Graceful Shutdown — Drucker werden in ChurchTools sauber abgemeldet

---

## Voraussetzungen

- Debian / Raspberry Pi OS, Node.js ≥ 18, Python 3
- Brother QL Labeldrucker im Netzwerk (getestet: QL-720NWB, DK-N55224 / 54mm)
- ChurchTools mit Check-In-Modul und einem Benutzer mit den Rechten:
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
pip3 install brother_ql --break-system-packages

# 4. Konfiguration
cp .env.example .env
nano .env

# 5. Drucker definieren
nano printers.json
```

---

## Konfiguration

### .env

```ini
# ChurchTools
CT_BASE_URL=https://meinegemeinde.church.tools
CT_USERNAME=drucker@meinegemeinde.de
CT_PASSWORD=sicheresPasswort

# Drucker
PRINTERS_FILE=./printers.json
LABEL_TYPE=54          # brother_ql Label-Identifier (54 = 54mm Endlosband)
# DRY_RUN=true         # Nur PNG rendern, nicht drucken

# Polling
POLL_IDLE_MS=15000     # Intervall ohne aktiven Job (15s)
POLL_ACTIVE_MS=5000    # Intervall nach erkanntem Job (5s)
POLL_ACTIVE_TTL_MS=300000  # Aktiv-Modus Dauer nach letztem Job (5min)

# Zeitfenster (leer = immer aktiv)
# ACTIVE_TIMES=So:09:00-12:00 18:00-20:00

# Logging
LOG_LEVEL=info
```

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

`hostname` muss exakt dem Standort-Namen in ChurchTools entsprechen (Check-In → Standorte). Gross-/Kleinschreibung beachten.

### ACTIVE_TIMES Format

```ini
# Nur Sonntag, ein Fenster
ACTIVE_TIMES=So:09:00-12:00

# Sonntag, zwei Fenster
ACTIVE_TIMES=So:09:00-12:00 18:00-20:00

# Werktags + Sonntag
ACTIVE_TIMES=Mo-Fr:08:00-17:00,So:09:00-12:00

# Immer aktiv
ACTIVE_TIMES=Mo-So:00:00-23:59
```

---

## Starten

```bash
# Manuell
npm start

# Mit Debug-Logging
LOG_LEVEL=debug npm start

# Dry-Run (druckt nicht, speichert label_preview_N.png)
DRY_RUN=true npm start
```

### Systemdienst (Autostart)

```bash
sudo cp checkin-printer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable checkin-printer
sudo systemctl start checkin-printer
sudo journalctl -u checkin-printer -f
```

---

## Polling-Verhalten

| Zustand | Verhalten |
|---|---|
| 💤 Ausserhalb Zeitfenster | Schläft, prüft alle 30s ob ein Fenster öffnet |
| 🕐 Innerhalb, kein Job | Polling alle `POLL_IDLE_MS` (Standard: 15s) |
| ⚡ Job empfangen | Polling alle `POLL_ACTIVE_MS` (Standard: 5s) für `POLL_ACTIVE_TTL_MS` (Standard: 5min) |
| 🕐 5min ohne Job | Zurück zu `POLL_IDLE_MS` |
| 🔴 10× Fehler | 60s Pause, dann Neustart |

Jeder Drucker hat seinen eigenen unabhängigen Modus.

---

## Troubleshooting

**Drucker erscheint nicht in ChurchTools**
```bash
# Benutzerrechte prüfen: "Check-in sehen" + "Drucker verwalten"
# hostname in printers.json muss exakt dem CT-Standort entsprechen
LOG_LEVEL=debug npm start
```

**Drucker nicht erreichbar**
```bash
nc -zv 192.168.1.50 9100
```

**Etikett-Vorschau ohne Drucker**
```bash
DRY_RUN=true npm start
# Erzeugt: label_preview_1.png, label_preview_2.png
```

**Alle verfügbaren Label-Typen anzeigen**
```bash
python3 -c "from brother_ql.labels import ALL_LABELS; [print(l.identifier, l.name) for l in ALL_LABELS]"
```

---

## Getestete Hardware

| Gerät | Status |
|---|---|
| Brother QL-720NWB | ✅ getestet |
| DK-N55224 (54mm nicht-klebend) | ✅ getestet |
| Raspberry Pi / Debian | ✅ getestet |

---

## Projektstruktur

```
├── src/
│   ├── index.js              Einstiegspunkt
│   ├── config.js             Konfiguration (.env)
│   ├── churchtools-client.js ChurchTools oldApi (Login, Polling, Drucker)
│   ├── printer-manager.js    Ruft print_label.py auf
│   ├── job-poller.js         Polling-Loop mit adaptiven Intervallen
│   ├── schedule.js           ACTIVE_TIMES Parser
│   ├── printers-config.js    printers.json Loader
│   └── logger.js             Logging
├── print_label.py            Text → PNG → Brother Raster → TCP
├── diagnose.js               Diagnose-Script (Anmeldung + Job-Dump)
├── printers.json             Drucker-Konfiguration
├── .env.example              Konfigurationsvorlage
└── checkin-printer.service   systemd Unit
```

---

## Lizenz

MIT
