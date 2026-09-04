# Druckergruppen ("virtueller Drucker") — Design

**Status:** zur Review. **Datum:** 2026-09-04.

## Kontext

v1 konnte einen ChurchTools-„Ort" (Hostname) im Routing-Modus so konfigurieren,
dass verschiedene Check-in-Typen auf unterschiedliche **physische** Drucker mit
unterschiedlichem Etikettenformat gedruckt werden (`printers-config.js`
`labels{}`-Tabelle, siehe `legacy-v1/src/label-router.js`). Das war ein
einziger, expliziter Config-Eintrag pro Hostname mit einer klar sichtbaren
Routing-Tabelle darin.

Ein früherer Fix in dieser Session (Commit `8fca1b1`) hat die **Funktion**
wiederhergestellt, indem die Eindeutigkeits-Regel auf `printers.hostname`
aufgehoben wurde — mehrere `printers`-Zeilen dürfen seitdem denselben Hostnamen
teilen. Das funktioniert nachweislich (End-to-End getestet), hat aber zwei
Probleme:

1. **Keine sichtbare Gruppierung im GUI.** Zwei Zeilen mit gleichem Hostnamen
   sehen in der Druckerliste wie zwei unabhängige Drucker aus.
2. **"Primäres Bein besitzt die Einstellungen"-Hack.** Name/Zeitfenster/Check/
   Status-Webhook liegen technisch weiterhin pro Zeile, obwohl sie konzeptionell
   zur ganzen Gruppe gehören — `PrinterPoller` behilft sich damit, dass die
   zuerst angelegte Zeile (niedrigste ID) als „primär" für diese Werte gilt.

Dieses Dokument beschreibt den Umbau auf ein sauberes Datenmodell mit einer
echten Gruppen-Entität plus die dazu passende GUI (Anlege-Assistent,
Listen-/Detailansicht), die v1s Konzept——ein Eintrag pro Hostname mit klar
sichtbarer Routing-Tabelle — wieder direkt abbildet.

## Ziel

- Beim Anlegen eines Druckers explizit zwischen **Einzel-Drucker** (ein
  physisches Gerät) und **Router-Drucker** (mehrere physische Geräte unter
  einem ChurchTools-Ort, je Etikettentyp ein eigenes Gerät) wählen.
- Die Zugehörigkeit mehrerer physischer Geräte zu einem Router-Drucker ist im
  GUI jederzeit sichtbar (Liste und Detailansicht), nicht nur aus zufällig
  gleichen Hostnamen ableitbar.
- Gruppen-weite Einstellungen (Name, Hostname, Zeitfenster, Check,
  Status-Webhook) leben an **einer** Stelle im Datenmodell, nicht dupliziert
  pro physischem Gerät.
- Geräte einer Gruppe können jederzeit nachträglich ergänzt oder entfernt
  werden (nicht nur beim Anlegen).

## Nicht-Ziele

- Keine Änderung an der Etiketten-Layout-Datenstruktur (`label_layouts`) —
  ein Layout zeigt weiterhin per `printerId` auf genau ein physisches Gerät,
  das bleibt exakt wie heute.
- Kein neuer Mechanismus für `also[]` (zusätzliche Etiketten auf anderem
  Drucker) — bleibt unverändert bestehen.
- Keine UI zum Umbenennen "Router" ↔ "Einzel" nach dem Anlegen als expliziter
  Modus-Schalter — der Unterschied ist rein die Anzahl Geräte einer Gruppe,
  kein gespeichertes Flag (siehe Datenmodell).

## Sicherheits-/Datenschutz-Invariante

**Physische Geräte (Name, IP, Hersteller, Port, Medientyp einzelner Beine)
werden nie an ChurchTools übertragen.** ChurchTools sieht ausschliesslich
`printer_groups.hostname` und `printer_groups.name` — das ist der einzige
Aufruf, der überhaupt Richtung ChurchTools geht
(`client.activatePrinter(hostname, name)` / `client.hidePrinter(hostname)`,
einmal pro Gruppe, nie pro physischem Gerät). Diese Trennung existiert bereits
heute strukturell (ein `PrinterPoller` pro Hostname-Gruppe ruft diese
Methoden mit den Werten des "primären" Beins auf); der Umbau macht sie nur
explizit statt implizit. Host/Port eines Beins können ausschliesslich in
selbst konfigurierten **ausgehenden** Status-Webhooks (Drittsysteme wie n8n)
auftauchen — bestehendes, unverändertes Verhalten, nichts mit ChurchTools zu
tun.

Diese Invariante wird durch einen Test abgesichert (siehe Testing-Strategie).

## Datenmodell

### Neue Tabelle `printer_groups`

Übernimmt die heute auf `printers` liegenden gruppen-weiten Felder:

```
id                      integer PK autoincrement
hostname                text NOT NULL UNIQUE   -- CT-"Ort", wieder eindeutig
name                    text NOT NULL          -- an CT übermittelter Anzeigename
active_times_mode       text NOT NULL DEFAULT 'inherit'  -- 'inherit'|'always'|'custom'
active_times_expr       text
check_enabled           integer NOT NULL DEFAULT 1 (boolean)
check_retry_ms          integer NOT NULL DEFAULT 30000
status_webhook_enabled  integer NOT NULL DEFAULT 0 (boolean)
created_at, updated_at  text (wie bestehende timestamps-Konvention)
```

### `printers` wird auf physische Felder reduziert

```
id            integer PK autoincrement   -- UNVERÄNDERT, gleiche IDs bleiben gültig
group_id      integer NOT NULL REFERENCES printer_groups(id)
name          text NOT NULL              -- Anzeigename DIESES Geräts (Logs, Dropdowns)
vendor        text NOT NULL              -- 'brother-ql' | 'zebra-zpl'
host          text NOT NULL
port          integer NOT NULL DEFAULT 9100
media_id      integer REFERENCES media_types(id)
created_at, updated_at
```

Entfernt aus `printers`: `hostname`, `active_times_mode`, `active_times_expr`,
`check_enabled`, `check_retry_ms`, `status_webhook_enabled` (wandern zu
`printer_groups`).

**Kein `mode`-Flag** ("Einzel" vs. "Router") wird persistiert — das ist reine
Anlege-Assistent-UX. Eine Gruppe mit einem Bein *ist* ein Einzel-Drucker, eine
mit ≥2 Beinen ein Router-Drucker; beides ist einfach `printer_groups` mit N
zugehörigen `printers`-Zeilen.

### Migration bestehender Daten

Rein additiv, keine Fremdschlüssel in `label_layouts`/`print_queue`/
`print_log`/`summary_layouts` (alle referenzieren `printers.id`) müssen
angefasst werden, weil **die ID jeder bestehenden `printers`-Zeile
unverändert bleibt**:

1. Neue Tabelle `printer_groups` anlegen.
2. Für jede bestehende `printers`-Zeile eine `printer_groups`-Zeile mit
   **derselben ID** einfügen, befüllt aus den heutigen
   hostname/name/active_times_*/check_*/status_webhook_enabled-Werten dieser
   Zeile.
3. `printers` neu aufbauen (SQLite-Tabellen-Neubau-Pattern, da Spalten
   entfernt und eine NOT-NULL-FK-Spalte ergänzt wird): neue Struktur wie
   oben, `group_id` jeder migrierten Zeile = ihre eigene alte ID.
4. Alte `printers`-Tabelle droppen, neue umbenennen.

Ergebnis: jeder heute bestehende Drucker ist danach automatisch eine
Einzel-Drucker-Gruppe mit einem Bein — ohne jede sichtbare Verhaltensänderung
für bestehende Installationen.

## Backend-API

Ersetzt `backend/src/api/printers.ts` durch zwei Dateien:

**`printerGroups.ts`**
- `GET /api/printer-groups` — alle Gruppen inkl. eingebetteter Beine
  (`{ ...group, legs: PrinterLeg[] }[]`).
- `GET /api/printer-groups/:id` — eine Gruppe inkl. Beine, pro Bein die
  zugeordneten Layouts (`legs: (PrinterLeg & { routes: LabelLayoutWithAlso[] })[]`).
- `POST /api/printer-groups` — legt Gruppe + alle mitgelieferten Beine
  atomisch an. Body: Gruppen-Felder + `legs: LegInput[]` (min. 1 Element,
  zod `.min(1)`). `LegInput = { name, vendor, host, port?, layoutIds?: number[] }`
  — mitgelieferte `layoutIds` werden nach dem Anlegen des Beins per
  `label_layouts.printer_id = <neue Bein-ID>` zugewiesen (nur IDs, die aktuell
  `printerId: null` haben — sonst 400).
- `PUT /api/printer-groups/:id` — Gruppen-Felder ändern (Hostname-Eindeutigkeit
  wieder serverseitig geprüft, jetzt wieder sinnvoll).
- `DELETE /api/printer-groups/:id` — Gruppe + alle Beine löschen, Layouts der
  Beine werden entkoppelt (`printerId = null`), nicht gelöscht — wie heute.

**`printers.ts`** (schlanker, nur noch Beine — der Pfad `/api/printer-groups/:id/legs`
liegt aus Konsistenzgründen mit den übrigen Bein-Routen hier, auch wenn er
unter dem Gruppen-Prefix hängt)
- `POST /api/printer-groups/:id/legs` — ein Bein zu bestehender Gruppe
  hinzufügen.
- `PUT /api/printers/:id` — ein Bein bearbeiten (name/vendor/host/port/mediaId).
- `DELETE /api/printers/:id` — ein Bein entfernen; **400**, wenn es das
  letzte Bein seiner Gruppe wäre (Fehlermeldung verweist auf
  „ganze Gruppe löschen").

`label_layouts.ts` bleibt unverändert (`printerId` zeigt weiterhin auf ein
Bein).

## Orchestrator-Anpassungen

- **`routing.ts`**: `resolveLayoutsForJob(db, hostname, ctTypeKey)` sucht
  Beine über `printers.group_id = (SELECT id FROM printer_groups WHERE
  hostname = ?)` statt der bisherigen direkten Hostname-Spalte auf `printers`.
  Rückgabewert/Verhalten sonst unverändert.
- **`PrintOrchestrator`**: `start()` iteriert `printer_groups` (nicht mehr
  "nach Hostname gruppierte `printers`-Zeilen") und baut einen `PrinterPoller`
  pro Gruppe mit deren Beinen. `handleIncomingJob(hostname, ...)` sucht die
  Gruppe jetzt mit einem eindeutigen `.get()` (kein Mehrdeutigkeits-Fallback
  mehr nötig).
- **`PrinterPoller`**: Deps ändern sich von `printers: PrinterPollerPrinter[]`
  (Beine mit dupliziertem Gruppen-Feldern) zu `group: PrinterPollerGroup`
  (hostname/name/activeTimes*/checkEnabled/checkRetryMs/statusWebhookEnabled)
  + `legs: PrinterPollerLeg[]` (id/name/vendor/host/port). Der
  `this.primary`-Hack aus dem letzten Umbau entfällt ersatzlos — Gruppen-Werte
  kommen direkt aus `this.deps.group`. Status-Check/Aktivierung/Status-Webhook-
  Dispatch iterieren weiterhin über alle `legs`.
- **`orchestratorLike.ts`**: `OrchestratorPollerStatus` bekommt `groupId`
  statt `printerId`/`printerIds`, plus `legIds: number[]` für die
  Queue-Aggregation.
- **`dashboard.ts`**: `buildDashboardStatus` lädt Hostname/Name über
  `groupId` aus `printer_groups` statt bisher über `printers`, Queue-Summe
  weiterhin über alle `legIds`.

## Frontend

### Anlege-Assistent (`/printers/new`, neue Seite, ersetzt Inline-Formular in `PrinterList.tsx`)

1. Modus-Auswahl: zwei Kacheln "Einzel-Drucker" / "Router-Drucker".
2. **Einzel-Drucker**: heutiges Formular unverändert (Name, Hostname,
   Hersteller, IP) — intern wird daraus `POST /api/printer-groups` mit genau
   einem `legs`-Eintrag (Bein-Name = Gruppen-Name).
3. **Router-Drucker**: Gruppen-Felder einmal (Name, Hostname), darunter
   Bein-Formulare (Start: 2, "+ weiteres Gerät" / "− entfernen"): je Name,
   Hersteller, IP, optionales Dropdown "Etiketten-Layout zuordnen" (nur
   Layouts mit `printerId: null`).
4. Etikettengrösse (Medientyp) wird im Assistenten **nicht** abgefragt — wie
   heute erst in der Detailansicht editierbar.
5. Absenden → ein `POST /api/printer-groups`-Aufruf für beide Modi, danach
   Redirect auf `/printers/:groupId`.

### Druckerliste (`/printers`)

Lädt `/api/printer-groups`, eine Zeile pro Gruppe: Name, Hostname, Typ
("Einzel" / "Router (N Geräte)"), Geräte-Kurzübersicht (z.B. "Kind (Brother),
Eltern (Zebra)"). Klick → Detailansicht. "Neuer Drucker"-Button navigiert zu
`/printers/new` statt das Inline-Formular zu togglen.

### Detailansicht (`/printers/:id`)

- Oben: Gruppen-Einstellungen (Name, Hostname, Zeitfenster, Check,
  Status-Webhook) mit Hinweistext "gilt für alle Geräte dieser Gruppe".
- **Geräte**-Bereich: eine Karte pro Bein — Name/Hersteller/IP/Port/Medientyp
  editierbar, darunter die diesem Bein zugeordneten Etiketten-Layouts
  (Name, ctTypeKey, "auch drucken"-Checkboxen — wie heute, nur scope auf
  dieses eine Bein statt den ganzen Drucker) + "Bestehendes Layout zuordnen"-
  Dropdown pro Bein. "Entfernen"-Button pro Karte (deaktiviert/Fehler, wenn
  letztes Bein). Unten "+ Weiteres Gerät hinzufügen".
- Unten: "Ganze Druckergruppe löschen".

## Testing-Strategie

TDD wie im restlichen Projekt (siehe README "Entwicklung"). Neue/angepasste
Vitest-Suiten:

- `printerGroups.test.ts`: CRUD, atomisches Anlegen mit mehreren Beinen,
  Hostname-Eindeutigkeit, Layout-Zuweisung beim Anlegen, letztes-Bein-Schutz.
- `routing.test.ts`: Anpassung der bestehenden Fälle auf das neue Schema,
  weiterhin: unterschiedliche Typen routen auf unterschiedliche Beine
  derselben Gruppe.
- `PrinterPoller.test.ts`: Anpassung auf `group`/`legs`-Deps, bestehende
  Multi-Bein-Tests (Status-Check über alle Beine, eine Anmeldung pro Gruppe)
  bleiben inhaltlich erhalten.
- `PrintOrchestrator.test.ts`: ein Poller pro Gruppe statt pro Hostname-Gruppierung.
- **Neuer expliziter Test** für die Sicherheits-Invariante: ein
  `CheckinBackendClient`-Fake protokolliert alle Aufrufe; Assertion, dass
  `activatePrinter`/`hidePrinter` ausschliesslich mit
  `printer_groups.hostname`/`.name` aufgerufen werden, nie mit einem Wert,
  der aus `printers` (Beinen) stammt.
- Migrations-Test (falls im Projekt üblich, sonst manueller Check wie bei der
  hostname-Unique-Migration zuvor in dieser Session): bestehende `printers`-
  Zeile vor Migration → nach Migration existiert `printer_groups`-Zeile
  gleicher ID mit identischen Werten, `printers.group_id` zeigt darauf.

## Offene Punkte / bewusst nicht in diesem Umbau

- Kein Umzug der Frontend-Typen (`types.ts`) in eine gemeinsame Bibliothek —
  bleibt wie heute dupliziert zwischen Backend/Frontend.
- Keine Migration der `PrinterPollerPrinter`-Interface-Historie — alte
  Typnamen werden umbenannt, nicht als Alias weitergeführt (kein Grund für
  Rückwärtskompatibilität innerhalb desselben Deploys).
