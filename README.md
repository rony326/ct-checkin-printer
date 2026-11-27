# ct-checkin-printer

Kompletter Neubau des ChurchTools-Check-in-Etikettendruckers ("v2"). Die alte
Node.js+Python-Implementierung ("v1") ist unter [`legacy-v1/`](legacy-v1/)
archiviert und wird nicht weiterentwickelt — dieses README beschreibt den
Neubau, der jetzt die Hauptversion dieses Repositories ist. Der ursprüngliche
Architektur-/Datenmodell-/Bauplan ist ein Claude-Code-Planungsartefakt
ausserhalb dieses Repositories (`cozy-fluttering-cray.md`) — sein Inhalt ist
in diesem README sowie in Code-Kommentaren an den jeweils relevanten Stellen
zusammengefasst.

**Stand:** Alle 12 Bauschritte abgeschlossen (Grundgerüst, Drucker-Adapter
Brother/Zebra, ChurchTools-Anbindung, Template-Engine/Renderer, visueller
Etiketten-Editor, übriges Web-GUI, `PrintOrchestrator`,
`SummaryReportService`/Gruppen-Sammelausdruck, Testsuite, Betriebsdoku).
Anders als v1 gibt es **keine Konfigurationsdateien** mehr (`.env`/
`config.js`/`label-layout.json`) — alles Fachliche wird über das Web-GUI
verwaltet und verschlüsselt in einer SQLite-Datei abgelegt. Offene Punkte
siehe [Bekannte Lücken](#bekannte-lücken).

## Inhalt

- [Features](#features)
- [Schnellstart (Docker)](#schnellstart-docker)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Konfiguration (Bootstrap-Env-Variablen)](#konfiguration-bootstrap-env-variablen)
- [Ersteinrichtung im Web-GUI](#ersteinrichtung-im-web-gui)
- [Zeitfenster (`activeTimes`)](#zeitfenster-activetimes)
- [Webhooks](#webhooks)
- [Gruppen-Sammelausdruck](#gruppen-sammelausdruck)
- [Betrieb auf dem Raspberry Pi](#betrieb-auf-dem-raspberry-pi)
- [Migration von v1](#migration-von-v1)
- [Betrieb: Backup & Updates](#betrieb-backup--updates)
- [Bekannte Lücken](#bekannte-lücken)
- [Entwicklung](#entwicklung)

## Features

- **Multi-Vendor-Drucker** über ein Adapter-Interface: Brother QL (Statuskanal +
  HTTP-Fallback, Medienerkennung) und Zebra ZPL (`~HQES`-Statusabfrage).
- **ChurchTools-Anbindung** über die oldApi (Check-in/Drucker-Verwaltung ist dort
  aktuell alternativlos), mit Login-Token-Wiederverwendung nach Neustarts.
- **Visueller Etiketten-Editor** (Drag & Drop, react-konva) für Text-, Freitext-,
  Logo-, QR- und Linien-Elemente je Etikettentyp, inkl. Live-Vorschau.
- **`also[]`-Routing**: ein Check-in kann zusätzliche Etiketten auf einem
  *anderen* Drucker auslösen (z.B. Eltern- und Kinder-Etikett auf getrennten
  Geräten).
- **Router-Drucker**: eine Druckergruppe kann mehrere physische Geräte
  (unterschiedlicher Hersteller möglich) unter einem gemeinsamen `hostname`
  bündeln; welches Bein einen Check-in bekommt, entscheidet der pro Etikett
  zugewiesene Ziel-Drucker im Layout. Unterschied zu `also[]`: `also[]` druckt
  *zusätzlich* auf einem weiteren Drucker, ein Router-Drucker druckt
  *alternativ* je Check-in-Typ auf dem jeweils passenden Bein — nach außen
  bleibt es für ChurchTools ein einziger Check-in-Drucker.
- **DB-persistente Retry-Queue**: nicht zustellbare Etiketten überleben einen
  Neustart und werden automatisch nachgedruckt, sobald der Zieldrucker wieder
  bereit ist.
- **Gruppen-Sammelausdruck**: am Ende eines Check-in-Zeitfensters (oder per
  Knopfdruck im GUI) eine Anwesenheitsliste pro Gruppe mit allen empfangenen
  Check-ins — wahlweise als Etikettenstreifen oder als gestaltbares A4-PDF auf
  einem IPP-Netzwerkdrucker.
- **Hardware-Taster am Raspberry Pi**: ein Tastendruck druckt die
  Anwesenheitsliste für heute, eine LED zeigt den Status (Pi-Dienst in
  [`pi/`](pi/README.md)).
- **Webhooks**: ausgehend (Check-in-Events, Drucker-Statusereignisse) und
  eingehend (secret-geschützter Endpunkt, z.B. für n8n oder ein künftiges
  Self-Checkin-Kiosk, unabhängig von ChurchTools).
- **Ein einzelner Admin-Login** fürs Web-GUI, passend zum Betriebsmodell
  (ein Gerät pro Gemeinde, lokal gehostet).
- **Live-Status-Dashboard** (Startseite): Modus/Fehler/letzter Job/Warteschlange
  je Drucker, alle 5s aktualisiert.
- **Globale Einstellungen** im GUI (`/settings`): Polling-Intervalle,
  Fehler-Schwelle, Retry-Queue-Defaults und globales Zeitfenster — wirkt
  sofort, ohne Neustart.

## Schnellstart (Docker)

```bash
cp .env.example .env
# ENCRYPTION_KEY und SESSION_SECRET eintragen, je mit:
openssl rand -base64 32

docker compose build
docker compose up -d
```

Das Backend liefert das gebaute Frontend mit aus — nach dem Start ist die
gesamte Anwendung unter `http://<host>:3000` erreichbar (Web-GUI). Migrationen
laufen bei jedem Start automatisch (idempotent). SQLite-Datei und
Font-/Logo-Uploads liegen gemeinsam im `data`-Volume.

> **Hinweis:** Das Dockerfile wurde in dieser Entwicklungsumgebung nicht
> gebaut/getestet (kein Docker-Daemon verfügbar). Vor dem ersten produktiven
> Rollout einmal `docker compose build && docker compose up` durchspielen und
> insbesondere den Brother-Druckpfad (Python-Helper) und den Zebra-Pfad gegen
> echte Hardware verifizieren.

## Lokale Entwicklung

```bash
npm install
npm run db:generate   # nur bei Schemaänderungen
npm run db:migrate    # Migration gegen DB_PATH anwenden

npm run dev:backend   # Fastify auf APP_PORT (Standard 3000)
npm run dev:frontend  # Vite Dev-Server mit Proxy auf /api
```

Für den Brother-Druckpfad zusätzlich (siehe `backend/python/requirements.txt`
— **nicht** parallel zum Original-`brother_ql`-Paket installieren, beide
belegen denselben Modulnamen):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/python/requirements.txt
```

Produktion ohne Docker: `npm run build` (Frontend + Backend), dann
`npm start --workspace backend`.

## Konfiguration (Bootstrap-Env-Variablen)

Nur diese technischen Werte werden vor dem ersten DB-Zugriff gebraucht — alles
Fachliche (ChurchTools, Drucker, Layouts, Webhooks, Sammelausdrucke) wird
danach über das Web-GUI verwaltet:

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `ENCRYPTION_KEY` | ja | – | 32 Byte, base64 (`openssl rand -base64 32`) — verschlüsselt Passwörter/Tokens/Secrets in der DB |
| `SESSION_SECRET` | ja | – | Signiert das Session-Cookie |
| `DB_PATH` | nein | `./data/app.db` | SQLite-Datei; Uploads liegen unter `<Verzeichnis>/uploads/` daneben |
| `APP_PORT` | nein | `3000` | HTTP-Port |
| `APP_HOST` | nein | `0.0.0.0` | Bind-Adresse |
| `LOG_LEVEL` | nein | `info` | `debug` \| `info` \| `warn` \| `error` |
| `TZ` | nein | `Europe/Zurich` (in `docker-compose.yml`) | Zeitzone des Containers. Ohne sie läuft er auf UTC: „heute 00:00“ beim Sammelausdruck, die Uhrzeiten auf der Liste und die `activeTimes`-Fenster wären um 1–2 h verschoben |

## Ersteinrichtung im Web-GUI

1. **Setup**: beim ersten Aufruf ein Admin-Passwort vergeben (mind. 8 Zeichen).
2. **ChurchTools-Verbindung**: Basis-URL, Benutzername, Passwort eines Bots/
   Service-Users mit Check-in-/Drucker-Berechtigung. Der Verbindungstest prüft
   den Login sofort.
3. **Drucker anlegen**: im Anlege-Assistenten zunächst zwischen **Einzel-
   Drucker** (ein physisches Gerät) und **Router-Drucker** (mehrere physische
   Geräte, ggf. unterschiedlicher Hersteller, unter einem gemeinsamen
   `hostname` — der CT-„Ort", identisch zu dem in ChurchTools hinterlegten
   Check-in-Drucker) wählen. Je Gerät/Bein: Name, Hersteller (Brother/Zebra),
   IP/Port, Medientyp. Zeitfenster-Modus (`inherit`/`always`/`custom`) gilt pro
   Gruppe. Änderungen wirken **sofort**, ohne Neustart — der Orchestrator lädt
   sich nach jeder Drucker-/ChurchTools-Änderung automatisch neu.
4. **Etiketten-Layout(s)**: im visuellen Editor pro Etikettentyp (`ct_type_key`,
   z.B. `parent`/`child`) Text-/QR-/Logo-/Linien-Elemente platzieren, Medium
   und Ziel-Drucker zuweisen — bei einem Router-Drucker das jeweilige Bein, um
   Check-in-Typen auf unterschiedliche physische Geräte zu verteilen, optional
   zusätzlich `also[]` für ein weiteres Etikett auf einem anderen Drucker.
5. **Webhooks/Sammelausdruck** (optional): siehe unten.

## Zeitfenster (`activeTimes`)

Unverändert zu v1s Grammatik, jetzt als Textfeld im Drucker-Formular
(`activeTimesMode: custom`) statt in einer Config-Datei:

```
Mo-Fr:08:00-17:00,So:09:00-12:00
So:09:00-12:00 18:00-20:00        # mehrere Fenster am selben Tag, space-getrennt
```

Leer/`always` = immer aktiv. `inherit` übernimmt das globale Zeitfenster, das im GUI unter `/settings`
(„Globales Zeitfenster“) gepflegt wird. Alle Fenster gelten in der
Zeitzone des Containers (`TZ`, siehe oben).

## Webhooks

- **Ausgehend** (`Webhooks`-Screen): pro Ziel-URL wählbar, ob es Check-in-Events
  (`checkin`), Drucker-Statusereignisse (`status`) oder beides (`both`)
  erhält. Bearer-Secret optional, mit Retry.
- **Eingehend**: ein secret-geschützter Endpunkt
  (`POST /api/webhooks/in/:token`, `Authorization: Bearer <secret>`,
  Payload `{ "hostname": "<Drucker-Hostname>", "data": "name=...\nid=...\n..." }`)
  — läuft **unabhängig von ChurchTools** durch dieselbe Druck-Pipeline wie ein
  normaler CT-Poll-Treffer. Gedacht für n8n-Integrationen oder ein künftiges,
  von ChurchTools entkoppeltes Self-Checkin-Kiosk.

## Gruppen-Sammelausdruck

Ein Sammelausdruck druckt pro ChurchTools-Gruppe eine Anwesenheitsliste (für
Checkout und Evakuierung) — also **ein Dokument pro Gruppe**. Zielausgabe
wahlweise:

- ein vorhandener Etikettendrucker im Endlosband-Modus, oder
- ein A4/Büro-Netzwerkdrucker per IPP (`document_printers`, PDF-Tabelle).

### Wer auf der Liste steht

- Datenquelle ist ausschliesslich `print_log`: alle Check-ins, die dieser Dienst
  im Zeitraum für einen hier angelegten Drucker empfangen hat — **auch solche,
  deren Etikettendruck fehlgeschlagen ist** oder für deren Typ kein Layout
  konfiguriert ist. Check-ins, die den Dienst nie erreicht haben, fehlen.
- Jede Person steht pro Gruppe einmal auf der Liste. Zwei Einträge (z.B.
  Eltern- und Kinder-Etikett oder ein wiederholter Druck) werden nur dann
  zusammengefasst, wenn **Gruppe, Name und Code** übereinstimmen; es gilt die
  früheste Uhrzeit. Dieselbe Person mit einem anderen Code erscheint also
  zweimal. Einträge ohne Name und ohne Code werden nie zusammengefasst.
- Check-ins ohne Gruppenangabe stehen auf der Liste „Ohne Gruppe“.
- **Gäste** sind Personen, deren Name mit dem Erkennungswort (Standard `Gast`,
  Gross-/Kleinschreibung egal) beginnt, gefolgt von einem Leerzeichen oder einer
  Ziffer (`Gast 1`, `Gast2`, nicht aber `Gastmann`). Gäste stehen zuoberst,
  danach alle anderen, jeweils nach Name sortiert.

### Einstellungen

Pro Sammelausdruck wählbar: Titel, die Spalten Name/Code/Zeit (mindestens eine;
für eine Evakuierungsliste den Namen angewählt lassen) und der Auslöser.

Beim Ziel „A4-Drucker“ kommt die Gestaltung der Liste dazu:

| Einstellung | Möglich | Standard |
|---|---|---|
| Reihenfolge der Spalten | Knöpfe „↑“/„↓“ | Name, Code, Zeit |
| Logo | ein hochgeladenes PNG/JPEG (Upload im Etiketten-Editor) oder keines; ein unlesbares oder gelöschtes Logo wird weggelassen | keines |
| Schriftgrösse | 8–18 pt; wird für die Tabelle bei Bedarf verkleinert, damit Namen nicht im Wort umbrechen | 11 pt |
| Ausrichtung | Querformat / Hochformat | Querformat |
| Abhak-Spalten | 0–4, Überschrift je bis 20 Zeichen; Spalten ohne Überschrift werden verworfen | „Abgeholt“, „Da“ |
| Gast-Spalte | an/aus, Überschrift bis 30 Zeichen; Schreiblinie bei Gästen für den echten Namen | an, „Name Gast“ |
| Erkennungswort | 1–30 Zeichen; wirkt auch bei ausgeschalteter Gast-Spalte auf die Sortierung | `Gast` |
| Fusszeile | bis 200 Zeichen | leer |

Die Liste enthält die Abhak-Spalten, dann Name/Code/Zeit, dann die Gast-Spalte.
Jede Seite wiederholt den Kopf (Logo, Titel, Anzahl Personen, Druckzeitpunkt)
und den Tabellenkopf und trägt die Seitenzahl.

Der Etikettenstreifen hat ein festes Aussehen; die Gestaltungs-Einstellungen
gelten dort nicht. Einzig ein früher beim selben Sammelausdruck gespeichertes
Erkennungswort bestimmt weiterhin, wer als Gast zuoberst steht (sonst `Gast`).

**Vorschau**: Der Knopf „Vorschau“ im Formular (nur A4) öffnet die Liste mit dem
aktuellen, auch noch ungespeicherten Formularstand und Beispieldaten (2 Gäste,
40 weitere Personen) als PDF in einem neuen Tab. Es wird nichts gedruckt und
nichts gespeichert. Der Browser muss dafür Pop-ups der Seite zulassen.

Bedienung:

- **Verwalten**: im GUI auf der Seite „Sammelausdrucke“ (`/summary-layouts`)
  Layouts anlegen, ändern, löschen.
- **Testen**: dort „Jetzt drucken (heute)“ — Zeitraum ist heute 00:00
  (Ortszeit, siehe `TZ`) bis jetzt.
- **Auslösen im Alltag**: per Hardware-Taster am Raspberry Pi. Der Abschnitt
  „Hardware-Taster“ auf der GUI-Seite erzeugt URL und Secret (Token/Secret,
  Env-Block zum Kopieren); der Pi-Dienst liegt in [`pi/`](pi/README.md)
  (Verdrahtung, Installation, LED-Muster). Der Endpunkt
  `POST /api/summary-trigger/<token>` (`Authorization: Bearer <secret>`) lässt
  sich auch von Hand testen — genau so, ohne `-d` und ohne Content-Type (ein
  leerer Body mit Content-Type wird abgelehnt):

  ```bash
  curl -X POST -H "Authorization: Bearer <SECRET>" <URL>
  ```

- **Grenze beim Drucken**: „erfolgreich“ (Antwort `ok: true`, grüne LED am Pi)
  heisst nur „der Drucker hat den Auftrag angenommen“. Ein Drucker ohne
  Papier, mit offener Klappe oder im Pausenmodus nimmt den Auftrag trotzdem
  oft an. Nach den ersten echten Tests deshalb den Fall „Papier leer“ einmal
  von Hand ausprobieren.

- **Automatisch**: `trigger: window_close` druckt weiterhin am Ende des
  Check-in-Zeitfensters von selbst.

> **Bekannte Lücke:** der optionale `verify_against_ct`-Abgleich gegen
> ChurchTools' eigene Checkin-Liste einer Gruppe (Absicherung gegen Check-ins,
> die den Dienst nie erreicht haben) ist im Schema vorgesehen, aber noch
> **nicht implementiert** — dafür fehlt noch die Recherche zu einem
> passenden ChurchTools-oldApi-Endpunkt.

## Betrieb auf dem Raspberry Pi

Vorgesehen ist ein Raspberry Pi 4, auf dem sowohl Docker (dieser Server) als
auch der Tasten-Dienst aus [`pi/`](pi/README.md) laufen. **Status: nicht
getestet.** Für alle nativen Abhängigkeiten gibt es ARM64-Binaries, aber der
Betrieb auf einem echten Pi ist unverifiziert, und das Docker-Image wurde bisher
nicht einmal auf x86 gebaut — es *sollte* laufen, ist aber noch nicht getestet.

- **64-bit Raspberry Pi OS** ist Voraussetzung.
- **`TZ`** ist in `docker-compose.yml` auf `Europe/Zurich` voreingestellt
  (überschreibbar über `.env`). Beim ersten Pi-Test bestätigen, dass Node im
  Image die Zeitzone auflöst:
  `docker compose exec app node -e "console.log(new Date().toString())"`
  (in der Winterzeit muss `GMT+0100` erscheinen; `date` im Container reicht
  nicht als Nachweis).

## Migration von v1

Kein gemeinsamer Datenbestand (v1 hat keine DB):

1. v2 parallel unter einem **anderen** Test-`hostname` aufsetzen (ChurchTools
   kennt pro `hostname` nur einen aktiven Drucker) und die Konfiguration aus
   v1s `config.js`/`label-layout.json` einmalig im GUI nachbauen.
2. Verifizieren (Testdruck, Zeitfenster, Webhooks).
3. Cutover: v1-Dienst stoppen (`systemctl stop checkin-printer` o.ä.), v2 auf
   den echten `hostname` umstellen.

Der QR-Hash-Algorithmus (`sha1(id+code+timestamp)`) ist bewusst
byte-identisch zu v1 geblieben — bestehende nachgelagerte Verarbeitung (z.B.
ein n8n-Workflow, der Check-ins per Hash abgleicht) muss nicht angepasst
werden.

## Betrieb: Backup & Updates

- **Backup**: das komplette `data`-Volume (SQLite-Datei + `uploads/`-Ordner)
  sichert alles — Konfiguration, Layouts, Fonts/Logos, Print-Log/-Queue.
  Einfaches Kopieren im laufenden Betrieb ist wegen SQLite WAL-Modus
  unkritisch, ein kurzer Stop für ein konsistentes Backup ist trotzdem
  vorsichtiger.
- **Updates**: neues Image bauen/ziehen, `docker compose up -d` — Migrationen
  laufen automatisch vor jedem Start.

## Bekannte Lücken

- **Zebra-Adapter** ist ausschliesslich nach den recherchierten `~HQES`/ZPL-
  Spezifikationen gebaut und mit Unit-Tests gegen dokumentierte
  Beispiel-Antworten abgesichert — **keine Verifikation gegen echte
  Hardware**, da keine zur Verfügung stand.
- **`verify_against_ct`** (Sammelausdruck-Absicherung gegen ChurchTools'
  eigene Checkin-Liste) ist nicht implementiert, siehe oben.
- **Editor nicht per Playwright/E2E abgesichert** — Drag/Drop, Vorschau und
  Speichern wurden manuell verifiziert, es existiert keine automatisierte
  Browser-Testsuite.
- **Raspberry-Pi-Betrieb** (Docker + Tasten-Dienst) ungetestet, siehe
  [Betrieb auf dem Raspberry Pi](#betrieb-auf-dem-raspberry-pi).
- **Dockerfile ungebaut/ungetestet** in dieser Entwicklungsumgebung (siehe
  oben) — vor Produktivbetrieb einmal real durchspielen.

## Entwicklung

```bash
npm run test --workspace backend        # Vitest
npm run typecheck --workspace backend   # tsc --noEmit
```

```
backend/   Fastify-API, Drizzle-Schema/Migrationen, Adapter, Orchestrator, Renderer
frontend/  React + Vite SPA (Web-GUI, inkl. visuellem Etiketten-Editor)
```

TDD durchgehend verwendet — neue Logik bekommt einen Test, bevor sie
geschrieben wird (siehe Commit-Historie/Testdateien für Beispiele).
