# Sammelausdruck per Hardware-Taster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Anwesenheitsliste (Gruppen-Sammelausdruck) lässt sich über das Web-GUI verwalten und testen sowie über einen GPIO-Taster am Raspberry Pi auslösen, mit ehrlicher LED-Rückmeldung. Ein zweiter Taster fährt den Pi herunter.

**Architecture:** v2 bekommt einen token- und secret-geschützten öffentlichen Endpunkt pro Sammel-Layout, der synchron das echte Druckergebnis zurückgibt. Ein kleiner Python-Dienst auf dem Pi-Host (ausserhalb von Docker) liest den Taster, ruft den Endpunkt über `localhost` auf und steuert die LED. Das Ausschalten läuft rein über das Kernel-Overlay `gpio-shutdown`.

**Tech Stack:** Fastify 5, Drizzle/SQLite, Vitest (Backend); React/Vite (Frontend); Python 3 + `gpiozero` + `urllib` + `unittest` (Pi-Dienst); systemd.

**Spec:** `docs/superpowers/specs/2026-11-24-summary-hardware-trigger-design.md`

## Global Constraints

- Zeitraum für Taster und GUI-Button: **heute 00:00 Ortszeit bis jetzt**. Gleiche Logik wie der bestehende `/print`-Endpunkt ohne Body.
- Der Container bekommt keine zusätzlichen Rechte (kein `privileged`, kein `/dev/gpiochip`).
- Das Secret wird zeitkonstant verglichen (`crypto.timingSafeEqual`).
- Pro Sammel-Layout läuft höchstens ein Druck gleichzeitig, für Taster **und** GUI-Button.
- Pi-Dienst: nur Standardbibliothek plus `gpiozero`. HTTP-Timeout 60 s.
- Pins: Druck-Taster GPIO17, LED GPIO27, Ausschalt-Taster GPIO3 (`dtoverlay=gpio-shutdown,gpio_pin=3,debounce=3000`).
- `TZ`-Default `Europe/Zurich`.
- Neue Abhängigkeiten im Backend: keine. Kommt doch eine CJS-Abhängigkeit hinzu, ist ein echter Server-Start Pflicht (Vitest übersieht Interop-Fehler).
- Texte im GUI und in Fehlermeldungen auf Deutsch, im Stil der bestehenden Seiten.

## Review Focus

1. **Der Pi-Dienst schickt einen POST ohne Body.** Setzt er dabei `Content-Type: application/json`, lehnt Fastify die Anfrage mit `400 FST_ERR_CTP_EMPTY_JSON_BODY` ab, und die LED zeigt bei jedem Druck einen Fehler. Erwartet: Der Endpunkt akzeptiert einen POST ohne Body und ohne Content-Type, und der Dienst setzt keinen Content-Type. Getestet in Task 3 und Task 5.
2. **v2 ist nach dem Booten noch nicht erreichbar**, weil der Container langsamer startet als der systemd-Dienst. Erwartet: Fehlermuster auf der LED, kein Absturz des Dienstes, der nächste Druck klappt. Getestet in Task 5.
3. **Das Sammel-Layout zeigt auf einen gelöschten oder nicht erreichbaren A4-Drucker.** Erwartet: `ok: false` mit verständlicher Meldung, kein stilles `ok: true`. Getestet in Task 1.
4. **Das Secret wurde neu erzeugt oder der Zugang deaktiviert**, aber auf dem Pi steht noch der alte Wert. Erwartet: `401` bzw. `404`, LED zeigt Fehler. Getestet in Task 3.
5. **Der Orchestrator lädt gerade neu** (`reload()` nach einer Konfigurationsänderung), während jemand den Taster drückt. Erwartet: `ok: false` „Orchestrator läuft nicht“ → Fehler-LED, kein Absturz. Folgt aus dem bestehenden Verhalten von `triggerManualSummary`. Task 3 prüft per Stub, dass `ok: false` als `200` mit `ok: false` durchgereicht wird.

---

### Task 1: Sammelausdruck meldet echte Fehler

**Files:**
- Modify: `backend/src/orchestrator/SummaryReportService.ts`
- Modify: `backend/src/orchestrator/orchestratorLike.ts` (Rückgabetyp + `noopOrchestrator`)
- Modify: `backend/src/orchestrator/PrintOrchestrator.ts` (`triggerManualSummary` ohne Service → neue Felder)
- Test: `backend/src/orchestrator/SummaryReportService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GenerateSummaryResult {
    ok: boolean;
    message?: string;
    groupsPrinted: number;
    groupsFailed: number;
    /** true = keine erfolgreichen Check-ins im Zeitraum, nichts gedruckt (ok bleibt true). */
    empty: boolean;
  }
  ```
  `OrchestratorLike.triggerManualSummary(...)` gibt `Promise<GenerateSummaryResult>` zurück (Typ in `orchestratorLike.ts` strukturell gleich definieren oder importieren; `noopOrchestrator` → `{ ok: false, message: 'Orchestrator nicht verfügbar', groupsPrinted: 0, groupsFailed: 0, empty: false }`).

- [ ] **Step 1: Failing Tests schreiben** im describe-Block `Fehlerfälle`:
  - `it('reports ok:false with the printer error when the document printer fails')`: `printDocument` gibt `{ success: false, errorMessage: 'IPP: connection refused' }` zurück, 1 Gruppe → `ok === false`, `groupsPrinted === 0`, `groupsFailed === 1`, `message` enthält `'IPP: connection refused'`.
  - `it('keeps printing remaining groups after one group fails')`: 2 Gruppen, erster `printDocument`-Aufruf schlägt fehl, zweiter klappt → `printDocument` 2× aufgerufen, `groupsPrinted === 1`, `groupsFailed === 1`, `ok === false`.
  - `it('reports ok:false when the referenced document printer no longer exists')`: Layout mit `documentPrinterId` auf eine gelöschte Zeile → `ok === false`, `groupsFailed === 1`.
  - `it('reports ok:false when the label printer has no media')`: Etikettendrucker ohne `mediaId` → `ok === false`.
  - Bestehenden Test `reports zero groups ...` erweitern: `empty === true`, `ok === true`, `groupsFailed === 0`.
  - Ein bestehender Erfolgstest prüft zusätzlich `empty === false`, `groupsFailed === 0`.
  - Fängt der Adapter eine Exception (`printDocument` wirft), zählt das als fehlgeschlagene Gruppe: `it('treats a thrown adapter error as a failed group')`.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**
  Run: `npm run test --workspace backend -- SummaryReportService`
  Expected: die neuen Tests FAIL (`ok` ist `true` bzw. `groupsFailed` undefined)

- [ ] **Step 3: Implementieren.** `printToLabelPrinter`/`printToDocumentPrinter` geben `Promise<PrintResult>` zurück (fehlender Drucker → `{ success: false, errorMessage: 'Drucker „…“ nicht gefunden' }`, fehlendes Medium entsprechend). `generate()` sammelt pro Gruppe das Ergebnis (try/catch um jeden Gruppen-Druck) und setzt `message` auf die erste Fehlermeldung mit Gruppenname, z. B. `Gruppe „Kids“: IPP: connection refused`. `ok = groupsFailed === 0`. Typen in `orchestratorLike.ts` und `PrintOrchestrator.triggerManualSummary` nachziehen.

- [ ] **Step 4: Tests + Typecheck laufen lassen**
  Run: `npm run test --workspace backend && npm run typecheck --workspace backend`
  Expected: alles PASS, keine Typfehler

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/orchestrator
  git commit -m "fix: Sammelausdruck meldet Druckfehler statt immer ok:true"
  ```

---

### Task 2: Schema + Migration für den Taster-Zugang

**Files:**
- Modify: `backend/src/db/schema.ts` (`summaryLayouts`)
- Create: `backend/migrations/0008_*.sql` + `meta/0008_snapshot.json` + Journal-Eintrag (generiert)
- Test: `backend/src/db/migration.test.ts`

**Interfaces:**
- Produces: in `summaryLayouts`:
  `triggerToken: text('trigger_token').unique()` (nullable),
  `triggerSecretEnc: text('trigger_secret_enc')` (nullable),
  `triggerEnabled: integer('trigger_enabled', { mode: 'boolean' }).notNull().default(false)`

- [ ] **Step 1: Failing Test schreiben** in `migration.test.ts`: `it('adds trigger columns to summary_layouts with trigger_enabled defaulting to false')`. Nach `migrate` eine Zeile in `summary_layouts` ohne die neuen Felder einfügen und zurücklesen: `triggerEnabled === false`, `triggerToken === null`. Zwei Zeilen mit gleichem `triggerToken` → Insert wirft (UNIQUE).
- [ ] **Step 2: Test laufen lassen** — `npm run test --workspace backend -- migration` → FAIL (Spalte fehlt)
- [ ] **Step 3: Schema ergänzen, Migration generieren:** `npm run db:generate`. Die erzeugte SQL prüfen: nur `ALTER TABLE ... ADD`, dazu ein `CREATE UNIQUE INDEX` für `trigger_token`. Kein Tabellen-Neuaufbau (vgl. Migration-0006-Bug mit FKs).
- [ ] **Step 4: Tests laufen lassen** — `npm run test --workspace backend` → PASS
- [ ] **Step 5: Commit** — `git add backend/src/db/schema.ts backend/migrations backend/src/db/migration.test.ts && git commit -m "feat: summary_layouts bekommt Taster-Zugang (Token/Secret/enabled)"`

---

### Task 3: Auslöse-Endpunkt, Admin-Routen, Sperre

**Files:**
- Modify: `backend/src/crypto/secrets.ts` (+ Test `secrets.test.ts`)
- Modify: `backend/src/api/summaryLayouts.ts`
- Test: `backend/src/api/server.test.ts` (neuer describe-Block `Summary-Trigger API`)

**Interfaces:**
- Consumes: `GenerateSummaryResult` (Task 1), Spalten aus Task 2.
- Produces:
  - `secretsEqual(a: string, b: string): boolean` in `crypto/secrets.ts`. Zeitkonstant, ungleiche Länge → `false` ohne Exception.
  - Admin (Session): `POST /api/summary-layouts/:id/trigger` mit Body `{ enabled?: boolean; regenerateSecret?: boolean }`. Existiert noch kein Token, werden Token **und** Secret erzeugt. Antwort `{ triggerToken, triggerEnabled, secret? }`; `secret` nur, wenn neu erzeugt. `GET /api/summary-layouts/:id/trigger/secret` → `{ secret: string | null }`.
  - `GET /api/summary-layouts` und `/:id` liefern **nie** `triggerSecretEnc`. Stattdessen `hasTriggerSecret: boolean`.
  - Öffentlich: `POST /api/summary-trigger/:token`, Header `Authorization: Bearer <secret>`, ohne Body. Antworten: `404 { error }` (Token unbekannt oder `triggerEnabled=false`), `401 { error }`, `409 { error: 'Sammelausdruck läuft bereits' }`, sonst `200` + `GenerateSummaryResult`.
  - Sperre: pro Layout-ID ein `Set<number>` innerhalb von `registerSummaryLayoutRoutes`, genutzt von `/print` **und** `/summary-trigger`. `/print` antwortet bei belegter Sperre ebenfalls mit `409`.
  - Token: `randomBytes(16).toString('hex')`, Secret: `randomBytes(24).toString('base64url')`, wie in `webhooksIncoming.ts`.

- [ ] **Step 1: Failing Test für `secretsEqual`**: gleiche Strings → `true`; verschiedene gleicher Länge → `false`; verschiedene Länge → `false`; leerer String vs. Wert → `false`.
- [ ] **Step 2: Failing Tests in `server.test.ts`.** Für den Erfolgs-, Fehler- und Sperr-Fall eine zweite App mit Stub-Orchestrator bauen (`buildServer(db, env, stub)`), in dem `triggerManualSummary` per `vi.fn` steuerbar ist:
  - `it('returns 404 for an unknown token')`
  - `it('returns 404 when the trigger is disabled')`
  - `it('returns 401 for a missing or wrong secret')`
  - `it('accepts a POST without body and without content-type and returns the summary result')`: `app.inject({ method: 'POST', url, headers: { authorization: 'Bearer <secret>' } })` → `200`, Body gleich dem Stub-Ergebnis; Stub wurde mit `since` = heute 00:00 lokal aufgerufen.
  - `it('passes ok:false results through as 200')`: Stub gibt `{ ok: false, message: 'Orchestrator läuft nicht', ... }` → `200`, `body.ok === false`.
  - `it('returns 409 while a summary for the same layout is still printing')`: Stub hängt an einem offenen Promise, zweiter Aufruf → `409`, Stub nur 1× aufgerufen; danach freigeben, dritter Aufruf → `200`.
  - `it('blocks the GUI /print endpoint while a trigger print is running')` → `409`.
  - `it('rejects the old secret after regenerateSecret')` → `401`.
  - `it('never exposes triggerSecretEnc in layout listings')`: `GET /api/summary-layouts` enthält kein `triggerSecretEnc`, aber `hasTriggerSecret: true`.
  - `it('requires a session for the trigger admin routes')` → `401` ohne Cookie.
- [ ] **Step 3: Tests laufen lassen** — `npm run test --workspace backend -- server secrets` → FAIL
- [ ] **Step 4: Implementieren** gemäss Interfaces. Die Sperre im `finally` freigeben.
- [ ] **Step 5: Tests + Typecheck** — `npm run test --workspace backend && npm run typecheck --workspace backend` → PASS
- [ ] **Step 6: Live-Boot-Test** — `cd backend && DB_PATH=$(mktemp -d)/t.db ENCRYPTION_KEY=$(openssl rand -base64 32) SESSION_SECRET=x npx tsx src/db/migrate.ts && <gleiche Env> timeout 8 npx tsx src/index.ts`. Erwartet: Log „läuft auf http://…“, kein Importfehler.
- [ ] **Step 7: Commit** — `git commit -m "feat: token-geschützter Auslöse-Endpunkt für den Sammelausdruck"`

---

### Task 4: GUI-Seite „Sammelausdrucke“

**Files:**
- Create: `frontend/src/pages/SummaryLayouts.tsx`
- Modify: `frontend/src/types.ts` (`SummaryLayout`, `SummaryResult`)
- Modify: `frontend/src/App.tsx` (Route `/summary-layouts`)
- Modify: `frontend/src/components/NavShell.tsx` (Eintrag `{ to: '/summary-layouts', label: 'Sammelausdrucke' }` vor „Sammelausdruck-Drucker“)

**Interfaces:**
- Consumes: alle Routen aus Task 3 sowie die bestehenden `GET/POST/PUT/DELETE /api/summary-layouts`, `POST /api/summary-layouts/:id/print`, `GET /api/document-printers`, `GET /api/printer-groups` (für Etikettendrucker-Auswahl; Beine als Optionen).
- Produces: `SummaryLayout` = Backend-Zeile ohne `triggerSecretEnc`, plus `hasTriggerSecret`. `SummaryResult` = `GenerateSummaryResult`.

Inhalt der Seite, Stil wie `DocumentPrinters.tsx`/`Webhooks.tsx`:
- Liste der Layouts mit Name, Ziel, Auslöser.
- Anlegen/Bearbeiten-Formular: Name; Ziel als Radiobuttons „A4-Drucker“ (Auswahl aus `document-printers`) oder „Etikettendrucker“ (Auswahl der Beine); Spalten-Checkboxen `name`/`code`/`checkinTime` (Labels Name/Code/Zeit); Titel (Default `Sammelausdruck {{checkin.group}}`, Hinweis auf den Platzhalter); Auslöser `manual`/`window_close` (Labels „Nur manuell / per Taster“, „Automatisch bei Fensterende“).
- Löschen mit `confirm()`.
- Button „Jetzt drucken (heute)“. Ergebnisanzeige: `empty` → „Heute keine Check-ins – nichts gedruckt.“; `ok` → „{n} Gruppe(n) gedruckt.“; sonst die `message` als Fehler. Bei 409 die Fehlermeldung aus der API anzeigen.
- Abschnitt „Hardware-Taster“: Checkbox aktiv, Button „Zugang erzeugen“ bzw. „Secret neu erzeugen“ (mit `confirm()`, Hinweis, dass der Pi neu konfiguriert werden muss), Anzeige `http://localhost:3000/api/summary-trigger/<token>` und Secret (per „Anzeigen“ über `/trigger/secret`). Dazu ein kopierbarer Block:
  ```
  TRIGGER_URL=http://localhost:3000/api/summary-trigger/<token>
  TRIGGER_SECRET=<secret>
  ```

- [ ] **Step 1: Typen + Route + Nav-Eintrag ergänzen, Seite implementieren**
- [ ] **Step 2: Typecheck + Build** — `cd frontend && npx tsc --noEmit && cd .. && npm run build`. Erwartet: keine Fehler.
- [ ] **Step 3: Manuell prüfen**: Backend+Frontend im Dev-Modus starten, Layout mit A4-Drucker anlegen, bearbeiten, „Jetzt drucken“ zeigt „Heute keine Check-ins“, Zugang erzeugen, mit dem kopierten Block per `curl -X POST -H "Authorization: Bearer …" <url>` auslösen, Ergebnis als JSON, Layout löschen.
- [ ] **Step 4: Commit** — `git commit -m "feat: GUI-Seite Sammelausdrucke (Verwalten, Testdruck, Taster-Zugang)"`

---

### Task 5: Tasten-Dienst für den Pi

**Files:**
- Create: `pi/button_logic.py` (reine Logik, ohne `gpiozero`-Import)
- Create: `pi/summary_button.py` (Verdrahtung mit `gpiozero`, `main()`)
- Create: `pi/test_button_logic.py` (`unittest`)
- Create: `pi/ct-summary-button.service`
- Create: `pi/ct-summary-button.env.example`
- Create: `pi/README.md`

**Interfaces:**
- Consumes: `POST TRIGGER_URL` mit `Authorization: Bearer TRIGGER_SECRET` (Task 3), Antwort `{ ok, empty, ... }`.
- Produces (`button_logic.py`):
  - `class Outcome(Enum): SUCCESS, EMPTY, ERROR`
  - `call_trigger(url: str, secret: str, timeout: float = 60, opener=urllib.request.urlopen) -> Outcome`: POST ohne Body und **ohne Content-Type**. HTTP-Status ≠ 200, Timeout, Verbindungsfehler, kaputtes JSON oder `ok: false` → `ERROR`; `ok and empty` → `EMPTY`; `ok` → `SUCCESS`. Wirft nie.
  - `class TriggerController(trigger: Callable[[], Outcome], led: LedLike, log: Callable[[str], None])` mit `on_press() -> None`: ignoriert Drücke, solange ein Druck läuft (Flag). Ablauf: LED langsam blinken → `trigger()` → Muster nach Outcome.
  - `LedLike` = Protocol mit `blink(on_time, off_time, n=None, background=True)`, `on()`, `off()`, wie bei `gpiozero.LED`.
  - LED-Muster (aus der Spec): Start = 3× kurz (`blink(0.15, 0.15, n=3)`); läuft = `blink(0.5, 0.5)`; SUCCESS = `on()` und nach 5 s `off()`; EMPTY = `blink(1, 0.5, n=2)`; ERROR = `blink(0.1, 0.1)` für 10 s, dann `off()`.

`summary_button.py`: liest `TRIGGER_URL`, `TRIGGER_SECRET`, optional `BUTTON_PIN` (17) und `LED_PIN` (27) aus der Umgebung; `Button(pin, pull_up=True, bounce_time=0.1)`. `when_pressed` startet `controller.on_press` in einem Thread, damit die gpiozero-Callback-Schleife nicht blockiert. Logs auf stdout (Journal).

Unit (`ct-summary-button.service`): `After=network-online.target docker.service`, `EnvironmentFile=/etc/ct-summary-button.env`, `ExecStart=/usr/bin/python3 /opt/ct-summary-button/summary_button.py`, `Restart=always`.

- [ ] **Step 1: Failing Tests schreiben** (`test_button_logic.py`, Fake-`opener` und Fake-LED, die Aufrufe aufzeichnet):
  - `test_success_response_maps_to_success`: `{"ok":true,"empty":false}` → `SUCCESS`
  - `test_empty_response_maps_to_empty`
  - `test_ok_false_maps_to_error`
  - `test_http_error_401_maps_to_error`, `test_http_error_409_maps_to_error`
  - `test_connection_refused_maps_to_error` (Opener wirft `URLError`): Pi gebootet, v2 noch nicht da
  - `test_timeout_maps_to_error`
  - `test_request_has_no_body_and_no_content_type_and_bearer_header`: Fake-Opener prüft `req.data is None`, `req.get_header('Content-type') is None`, `Authorization == 'Bearer s3cret'`, `req.get_method() == 'POST'`
  - `test_press_while_running_is_ignored`: Trigger blockiert über ein `threading.Event`, zweiter `on_press` in eigenem Thread kehrt sofort zurück, Trigger nur 1× aufgerufen
  - `test_led_patterns_per_outcome`: SUCCESS → `on()`; EMPTY → `blink(1, 0.5, n=2, …)`; ERROR → `blink(0.1, 0.1, …)`. Die Zeitgeber (5 s/10 s) über einen injizierbaren `sleep`/`timer` testen, ohne echt zu warten.
- [ ] **Step 2: Tests laufen lassen** — `python3 -m unittest discover -s pi -v` → FAIL (Modul fehlt)
- [ ] **Step 3: `button_logic.py` implementieren**, danach `summary_button.py`, Service-Datei, `.env.example`.
- [ ] **Step 4: Tests laufen lassen** — `python3 -m unittest discover -s pi -v` → alle PASS
- [ ] **Step 5: `pi/README.md` schreiben**:
  - Verdrahtungstabelle aus der Spec, Abschnitt 6.
  - Installation: Dateien nach `/opt/ct-summary-button/`, `.env` nach `/etc/ct-summary-button.env` (Rechte `600`), `systemctl enable --now ct-summary-button`, Logs mit `journalctl -u ct-summary-button -f`.
  - Ausschalt-Taster: `dtoverlay=gpio-shutdown,gpio_pin=3,debounce=3000` in `/boot/firmware/config.txt`, Neustart. 3 s halten → aus. Erneut drücken → an. Hinweis, dass GPIO3 = I2C-SCL ist.
  - Bedeutung der LED-Muster.
  - Test ohne Taster: `curl -X POST -H "Authorization: Bearer …" $TRIGGER_URL`.
- [ ] **Step 6: Commit** — `git add pi && git commit -m "feat: Pi-Tasten-Dienst für den Sammelausdruck (GPIO, LED, systemd)"`

---

### Task 6: Zeitzone, Doku, Abschluss

**Files:**
- Modify: `docker-compose.yml` (`TZ: ${TZ:-Europe/Zurich}` unter `environment`)
- Modify: `.env.example` (`TZ` mit Kommentar)
- Modify: `README.md`: Abschnitt „Gruppen-Sammelausdruck“ auf GUI-Seite und Taster umschreiben (Verweis auf `pi/README.md`); neuer Abschnitt „Betrieb auf dem Raspberry Pi“ (64-bit-Pi-OS, ARM64-Binaries vorhanden, aber ungetestet, `TZ`); veralteten Satz zu `inherit` („kein eigener GUI-Screen“) korrigieren, die Einstellung liegt unter `/settings`; Env-Tabelle um `TZ` ergänzen.

- [ ] **Step 1: Änderungen vornehmen**
- [ ] **Step 2: Prüfen, dass Node die Zeitzone ohne tzdata auflöst** — `TZ=Europe/Zurich node -e "console.log(new Date().toString())"` → Ausgabe enthält `GMT+0100` (Winterzeit) und den Namen der Zeitzone. In `README.md` vermerken, dass das im Docker-Image beim ersten Pi-Test zu bestätigen ist (`docker compose exec app date` reicht nicht, Node prüfen: `docker compose exec app node -e "console.log(new Date().toString())"`).
- [ ] **Step 3: Gesamtprüfung** — `npm run test --workspace backend && npm run typecheck --workspace backend && python3 -m unittest discover -s pi && npm run build` → alles grün
- [ ] **Step 4: Commit** — `git commit -m "docs: Pi-Betrieb, Taster und Zeitzone dokumentiert; TZ in docker-compose"`
