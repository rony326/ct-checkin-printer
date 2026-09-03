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
- **DB-persistente Retry-Queue**: nicht zustellbare Etiketten überleben einen
  Neustart und werden automatisch nachgedruckt, sobald der Zieldrucker wieder
  bereit ist.
- **Gruppen-Sammelausdruck**: am Ende eines Check-in-Zeitfensters (oder manuell)
  ein Ausdruck pro Gruppe mit allen Namen/Codes — wahlweise als
  Etikettenstreifen oder als PDF auf einem IPP-Netzwerkdrucker.
- **Webhooks**: ausgehend (Check-in-Events, Drucker-Statusereignisse) und
  eingehend (secret-geschützter Endpunkt, z.B. für n8n oder ein künftiges
  Self-Checkin-Kiosk, unabhängig von ChurchTools).
- **Ein einzelner Admin-Login** fürs Web-GUI, passend zum Betriebsmodell
  (ein Gerät pro Gemeinde, lokal gehostet).

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

## Ersteinrichtung im Web-GUI

1. **Setup**: beim ersten Aufruf ein Admin-Passwort vergeben (mind. 8 Zeichen).
2. **ChurchTools-Verbindung**: Basis-URL, Benutzername, Passwort eines Bots/
   Service-Users mit Check-in-/Drucker-Berechtigung. Der Verbindungstest prüft
   den Login sofort.
3. **Drucker anlegen**: Name, `hostname` (der CT-„Ort", identisch zu dem in
   ChurchTools hinterlegten Check-in-Drucker), Hersteller (Brother/Zebra),
   IP/Port, Medientyp, Zeitfenster-Modus (`inherit`/`always`/`custom`).
   Änderungen wirken **sofort**, ohne Neustart — der Orchestrator lädt sich
   nach jeder Drucker-/ChurchTools-Änderung automatisch neu.
4. **Etiketten-Layout(s)**: im visuellen Editor pro Etikettentyp (`ct_type_key`,
   z.B. `parent`/`child`) Text-/QR-/Logo-/Linien-Elemente platzieren, Medium
   und Ziel-Drucker zuweisen, optional `also[]` für ein zusätzliches Etikett
   auf einem anderen Drucker.
5. **Webhooks/Sammelausdruck** (optional): siehe unten.

## Zeitfenster (`activeTimes`)

Unverändert zu v1s Grammatik, jetzt als Textfeld im Drucker-Formular
(`activeTimesMode: custom`) statt in einer Config-Datei:

```
Mo-Fr:08:00-17:00,So:09:00-12:00
So:09:00-12:00 18:00-20:00        # mehrere Fenster am selben Tag, space-getrennt
```

Leer/`always` = immer aktiv. `inherit` übernimmt einen globalen Default (siehe
`app_config`-Tabelle — aktuell nur DB-seitig setzbar, kein eigener GUI-Screen).

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

Ein `summary_layouts`-Eintrag druckt am Ende eines Check-in-Zeitfensters
(`trigger: window_close`) oder per Knopfdruck (`trigger: manual`,
`POST /api/summary-layouts/:id/print`) pro Gruppe eine Liste aller
erfolgreich gedruckten Check-ins (Name/Code/Uhrzeit) — Datenquelle ist
ausschliesslich `print_log`. Zielausgabe wahlweise:

- ein vorhandener Etikettendrucker im Endlosband-Modus, oder
- ein A4/Büro-Netzwerkdrucker per IPP (`document_printers`, PDF-Tabelle).

> **Bekannte Lücke:** der optionale `verify_against_ct`-Abgleich gegen
> ChurchTools' eigene Checkin-Liste einer Gruppe (Absicherung gegen
> fehlgeschlagene/wiederholte Drucke) ist im Schema vorgesehen, aber noch
> **nicht implementiert** — dafür fehlt noch die Recherche zu einem
> passenden ChurchTools-oldApi-Endpunkt.

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
- **Kein `/api/dashboard`**-Endpunkt/Live-Status-UI — `PrintOrchestrator.status()`
  existiert serverseitig, ist aber noch nicht ans GUI angebunden.
- **Kein globaler `app_config`-GUI-Screen** — Polling-Intervalle/Defaults
  (`poll_idle_ms` etc.) sind nur direkt in der DB änderbar, fallen sonst auf
  v1-kompatible Standardwerte zurück.
- **Editor nicht per Playwright/E2E abgesichert** — Drag/Drop, Vorschau und
  Speichern wurden manuell verifiziert, es existiert keine automatisierte
  Browser-Testsuite.
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
