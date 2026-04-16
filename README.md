# ChurchTools Check-In Printer Service

Node.js-Dienst für Raspberry Pi. Pollt automatisch Druckaufträge vom ChurchTools Check-In und sendet sie per TCP an einen oder mehrere Labeldrucker.

## Features

- **Mehrere Drucker** gleichzeitig – ein Poller pro Drucker, alle laufen parallel
- **Adaptives Polling** – langsam im Ruhemodus, schnell nach einem Druckauftrag
- **Zeitfenster** – außerhalb konfigurierter Zeiten schläft der Dienst komplett
- **Graceful Shutdown** – Drucker werden in ChurchTools sauber abgemeldet
- **Exponential Backoff** bei API-Fehlern

## Voraussetzungen

- Raspberry Pi mit Linux, Node.js ≥ 18
- Labeldrucker im Netzwerk mit TCP/RAW-Port (Standard: 9100)
- ChurchTools mit API-Token und Check-In-Modul

## Installation

```bash
cd /home/pi
# Projektordner ablegen, dann:
cd checkin-printer
npm install
cp .env.example .env
nano .env            # CT_BASE_URL und CT_API_TOKEN eintragen
nano printers.json   # Drucker definieren
```

## Drucker konfigurieren – printers.json

```json
[
  {
    "hostname":    "foyer",
    "printerName": "Foyer-Drucker",
    "printerHost": "192.168.1.50",
    "printerPort": 9100
  },
  {
    "hostname":    "kinder",
    "printerName": "Kinder-Drucker",
    "printerHost": "192.168.1.51",
    "printerPort": 9100
  }
]
```

| Feld          | Pflicht | Beschreibung                                              |
|---------------|---------|-----------------------------------------------------------|
| `hostname`    | ✅      | Standort-ID in ChurchTools (Check-In → Standorte)        |
| `printerName` | ✅      | Anzeigename in ChurchTools                               |
| `printerHost` | ✅      | IP-Adresse oder Hostname des Druckers                    |
| `printerPort` | –       | TCP-Port (Standard: 9100)                                |

## .env – Polling & Zeitfenster

| Variable            | Standard  | Beschreibung                                        |
|---------------------|-----------|-----------------------------------------------------|
| `CT_BASE_URL`       | –         | URL deiner ChurchTools-Instanz (**Pflicht**)        |
| `CT_API_TOKEN`      | –         | API-Token aus ChurchTools (**Pflicht**)             |
| `PRINTERS_FILE`     | ./printers.json | Pfad zur Drucker-Konfiguration              |
| `PRINTER_TIMEOUT_MS`| 5000      | TCP-Timeout pro Drucker in ms                       |
| `POLL_IDLE_MS`      | 15000     | Polling-Intervall ohne aktiven Job                  |
| `POLL_ACTIVE_MS`    | 5000      | Polling-Intervall nach erkanntem Job                |
| `POLL_ACTIVE_TTL_MS`| 300000    | Wie lange aktives Polling nach letztem Job (ms)     |
| `ACTIVE_TIMES`      | (leer)    | Zeitfenster – leer = immer aktiv                    |
| `MAX_ERRORS`        | 10        | Fehler vor 60s-Pause                                |
| `LOG_LEVEL`         | info      | debug / info / warn / error                         |

### ACTIVE_TIMES Format

```
# Nur Sonntag
ACTIVE_TIMES=So:09:00-12:00

# Sonntag zwei Fenster
ACTIVE_TIMES=So:09:00-12:00 18:00-20:00

# Werktags + Sonntag
ACTIVE_TIMES=Mo-Fr:08:00-17:00,So:09:00-12:00 18:00-20:00

# Immer aktiv
ACTIVE_TIMES=Mo-So:00:00-23:59
```

## Polling-Verhalten

```
Außerhalb Zeitfenster  →  💤 schläft (prüft alle 30 s ob Fenster öffnet)
Innerhalb, kein Job    →  🕐 POLL_IDLE_MS   (Standard 15 s)
Job empfangen          →  ⚡ POLL_ACTIVE_MS  (Standard 5 s)
                            für POLL_ACTIVE_TTL_MS (Standard 5 min)
Keine Jobs mehr 5 min  →  🕐 zurück zu POLL_IDLE_MS
```

Jeder Drucker hat seinen eigenen unabhängigen Modus – ein aktiver Job bei Drucker A
beeinflusst das Polling-Intervall von Drucker B nicht.

## Starten

```bash
npm start         # normal
npm run dev       # mit Debug-Logging
```

## Als Systemdienst (Autostart)

```bash
sudo cp checkin-printer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable checkin-printer
sudo systemctl start checkin-printer
sudo journalctl -u checkin-printer -f
```

## Troubleshooting

```bash
# Drucker TCP testen
nc -zv 192.168.1.50 9100

# ChurchTools API testen
curl -H "Authorization: Login DEIN_TOKEN" \
  "https://meinegemeinde.church.tools/api/whoami"

# Debug-Logging
LOG_LEVEL=debug npm start
```

## Architektur

```
printers.json
     │  (n Drucker)
     ▼
  index.js
     │  erstellt pro Drucker:
     ├── JobPoller ──→ ChurchToolsClient ──→ ChurchTools API (oldApi)
     │       │
     │       └──→ PrinterManager ──→ TCP Port 9100 ──→ Labeldrucker
     │
     ├── JobPoller ──→ ...  (Drucker 2)
     └── JobPoller ──→ ...  (Drucker n)
```
