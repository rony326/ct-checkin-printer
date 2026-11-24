# Tasten-Dienst für den Sammelausdruck (Raspberry Pi 4)

Ein Taster am Pi löst den Ausdruck der Anwesenheitsliste aus. Eine LED zeigt den Status.
Der Dienst ruft `POST /api/summary-trigger/<token>` des v2-Servers auf (Docker auf demselben Pi).

## Verdrahtung

| Funktion | GPIO | Pin | Anschluss |
|---|---|---|---|
| Taster „Liste drucken“ | GPIO17 | 11 | Taster gegen GND (Pin 9), interner Pull-up |
| Status-LED | GPIO27 | 13 | LED + 330 Ω gegen GND |
| Taster „Ausschalten“ | GPIO3 | 5 | Taster gegen GND (Pin 6) |

## Installation

```bash
sudo mkdir -p /opt/ct-summary-button
sudo cp button_logic.py summary_button.py /opt/ct-summary-button/
sudo cp ct-summary-button.env.example /etc/ct-summary-button.env
sudo chmod 600 /etc/ct-summary-button.env
sudo nano /etc/ct-summary-button.env        # TRIGGER_URL und TRIGGER_SECRET eintragen
sudo cp ct-summary-button.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ct-summary-button
```

URL und Secret stehen auf der GUI-Seite „Sammelausdrucke“. `gpiozero` ist unter Raspberry Pi OS vorinstalliert.

Logs: `journalctl -u ct-summary-button -f` (das Secret wird nie geloggt).

Startet Docker nach dem Dienst, wird ein Druck als Fehler gemeldet (LED schnell blinken); der nächste Druck funktioniert normal.

## Ausschalt-Taster

In `/boot/firmware/config.txt` eintragen und neu starten:

```
dtoverlay=gpio-shutdown,gpio_pin=3,debounce=3000
```

3 Sekunden halten fährt den Pi herunter. Im ausgeschalteten Zustand startet ein erneuter Druck ihn wieder.
Hinweis: GPIO3 ist zugleich I2C-SCL; der Pin ist daher fürs Aufwecken geeignet, I2C darf aber nicht anderweitig genutzt werden.
Dafür ist kein Code nötig.

## LED-Muster

| Muster | Bedeutung |
|---|---|
| 3× kurz blinken | Dienst gestartet, bereit |
| langsam blinken (0,5 s) | Druck läuft, bitte warten |
| 5 s dauerhaft an | Erfolgreich gedruckt |
| 2× langsam blinken (1 s an / 0,5 s aus) | Nichts zu drucken (leere Liste) |
| 10 s schnell blinken | Fehler (Server nicht erreichbar, Druckfehler, Druck läuft schon, falsches Secret) |

Drücke während eines laufenden Drucks werden ignoriert.

## Test ohne Taster

```bash
curl -X POST -H "Authorization: Bearer <SECRET>" <TRIGGER_URL>
```

Kein `-d` und kein `Content-Type`-Header: Ein leerer Body mit Content-Type wird vom Server abgelehnt.
Antworten: 200 (gedruckt, JSON mit `ok`/`empty`), 401 falsches Secret, 404 unbekannter oder deaktivierter Token, 409 Druck läuft bereits.
Der Aufruf wartet auf das echte Druckergebnis und kann länger dauern (Timeout 60 s).

## Unit-Tests (auf dem Entwicklungsrechner)

```bash
python3 -m unittest discover -s pi -v
```
