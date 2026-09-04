# Druckergruppen ("virtueller Drucker") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ersetzt "mehrere `printers`-Zeilen teilen sich einen Hostnamen" (Funktions-Fix ohne GUI-Sichtbarkeit) durch eine echte `printer_groups`-Entität mit Anlege-Assistent (Einzel-/Router-Drucker), Listen- und Detailansicht — v1-Parität für den Routing-Modus.

**Architecture:** Neue Tabelle `printer_groups` trägt die ChurchTools-Identität (Hostname, Name, Zeitfenster, Check, Status-Webhook). `printers` wird auf rein physische Felder reduziert (Hersteller, IP, Port, Medientyp) und referenziert `printer_groups` per `group_id`. Der Orchestrator (`PrintOrchestrator`/`PrinterPoller`) iteriert `printer_groups`-Zeilen statt Hostnamen zu gruppieren; ein `PrinterPoller` bekommt eine Gruppe + ihre Beine als getrennte Deps statt einer Liste mit implizitem "primärem" Element.

**Tech Stack:** Fastify, Drizzle ORM (SQLite/better-sqlite3), Zod, Vitest, React 19, react-router-dom.

**Spec:** [docs/superpowers/specs/2026-09-04-printer-groups-design.md](../specs/2026-09-04-printer-groups-design.md)

## Global Constraints

- Physische Geräte (Name, IP, Hersteller, Port, Medientyp einzelner Beine) werden **nie** an ChurchTools übertragen — ChurchTools sieht ausschliesslich `printer_groups.hostname`/`.name`.
- Bestehende `printers`-IDs bleiben über die Migration hinweg unverändert (keine kaputten Fremdschlüssel in `label_layouts`/`print_queue`/`print_log`/`summary_layouts`).
- Kein `mode`-Flag ("Einzel"/"Router") wird persistiert — abgeleitet aus der Anzahl Beine einer Gruppe.
- TDD: jeder Task schreibt zuerst den fehlschlagenden Test.
- Nach jedem Backend-Task: `npm run typecheck --workspace backend` UND `npm run test --workspace backend` müssen grün sein, bevor committet wird — der Compiler ist hier die verlässlichste Methode, jede Stelle zu finden, die die Schema-Änderung berührt.

---

## Task 1: Datenmodell + Migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/migrations/0005_*.sql`, `backend/migrations/0006_*.sql` (Namen von `drizzle-kit generate` vergeben, s.u.)
- Test: `backend/src/db/migration.test.ts` (neu)

**Interfaces:**
- Produces: `printerGroups` (Drizzle-Tabelle, Felder: `id, hostname, name, activeTimesMode, activeTimesExpr, checkEnabled, checkRetryMs, statusWebhookEnabled, createdAt, updatedAt`), `printers` (neu: `id, groupId, name, vendor, host, port, mediaId, createdAt, updatedAt` — OHNE die bisherigen `hostname`/`activeTimes*`/`check*`/`statusWebhookEnabled`-Felder).

Diese Änderung entfernt Spalten aus `printers`, auf die praktisch der ganze Orchestrator und mehrere API-Routen zugreifen — der Compiler wird nach diesem Task jede betroffene Stelle mit einem Typfehler markieren. Das ist beabsichtigt und der verlässlichste Weg, nichts zu übersehen; die folgenden Tasks arbeiten diese Fehlermeldungen systematisch ab.

- [ ] **Step 1: Schema in zwei Schritten ändern (vermeidet eine interaktive Rückfrage von drizzle-kit)**

Zuerst in `backend/src/db/schema.ts` die bestehende `printers`-Definition ersetzen (NUR neue Tabelle + nullable `group_id` hinzufügen, alte Felder noch NICHT entfernen):

```ts
export const printerGroups = sqliteTable('printer_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  hostname: text('hostname').notNull().unique(),
  name: text('name').notNull(),
  activeTimesMode: text('active_times_mode', { enum: ['inherit', 'always', 'custom'] })
    .notNull()
    .default('inherit'),
  activeTimesExpr: text('active_times_expr'),
  checkEnabled: integer('check_enabled', { mode: 'boolean' }).notNull().default(true),
  checkRetryMs: integer('check_retry_ms').notNull().default(30000),
  statusWebhookEnabled: integer('status_webhook_enabled', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const printers = sqliteTable('printers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').references(() => printerGroups.id),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  vendor: text('vendor', { enum: ['brother-ql', 'zebra-zpl'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(9100),
  activeTimesMode: text('active_times_mode', { enum: ['inherit', 'always', 'custom'] })
    .notNull()
    .default('inherit'),
  activeTimesExpr: text('active_times_expr'),
  checkEnabled: integer('check_enabled', { mode: 'boolean' }).notNull().default(true),
  checkRetryMs: integer('check_retry_ms').notNull().default(30000),
  statusWebhookEnabled: integer('status_webhook_enabled', { mode: 'boolean' }).notNull().default(false),
  mediaId: integer('media_id').references(() => mediaTypes.id),
  ...timestamps,
});
```

Run: `cd backend && npx drizzle-kit generate`
Expected: erzeugt `migrations/0005_<random-name>.sql` OHNE Rückfrage (nur `CREATE TABLE printer_groups` + `ALTER TABLE printers ADD group_id`). Falls doch eine interaktive Rückfrage erscheint ("Is group_id column ... created or renamed"), stimmt die Zwischen-Schema-Version nicht mit obigem exakt überein — nochmal vergleichen.

- [ ] **Step 2: Datenbackfill in die generierte 0005-Migration einfügen**

Ans Ende der generierten `migrations/0005_*.sql`-Datei anfügen (nach der letzten Zeile, mit `--> statement-breakpoint` getrennt):

```sql
--> statement-breakpoint
INSERT INTO `printer_groups` (`id`, `hostname`, `name`, `active_times_mode`, `active_times_expr`, `check_enabled`, `check_retry_ms`, `status_webhook_enabled`, `created_at`, `updated_at`)
SELECT `id`, `hostname`, `name`, `active_times_mode`, `active_times_expr`, `check_enabled`, `check_retry_ms`, `status_webhook_enabled`, `created_at`, `updated_at`
FROM `printers`
WHERE `id` IN (SELECT MIN(`id`) FROM `printers` GROUP BY `hostname`);
--> statement-breakpoint
UPDATE `printers`
SET `group_id` = (SELECT MIN(p2.`id`) FROM `printers` p2 WHERE p2.`hostname` = `printers`.`hostname`);
```

Diese zwei Statements: (a) legen pro **distinktem** Hostnamen genau eine Gruppen-Zeile an — Quelle ist die Zeile mit der niedrigsten `id` für diesen Hostnamen (deckt sich mit der "primäres Bein"-Konvention aus `PrinterPoller`); (b) verknüpfen JEDE `printers`-Zeile (nicht nur die primäre) mit der so entstandenen Gruppe. Wichtig: NICHT "eine Gruppe pro Zeile" machen — das würde bei bereits geteilten Hostnamen zwei Gruppen mit demselben Hostnamen erzeugen und an der neuen `UNIQUE`-Regel scheitern (siehe Spec, Abschnitt "Migration bestehender Daten", dort inkl. Beleg per Testlauf).

- [ ] **Step 3: Alte Felder aus `printers` entfernen, `group_id` NOT NULL machen**

In `backend/src/db/schema.ts` die `printers`-Definition auf die Zielform bringen:

```ts
export const printers = sqliteTable('printers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id')
    .notNull()
    .references(() => printerGroups.id),
  name: text('name').notNull(),
  vendor: text('vendor', { enum: ['brother-ql', 'zebra-zpl'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(9100),
  mediaId: integer('media_id').references(() => mediaTypes.id),
  ...timestamps,
});
```

(`printerGroups` bleibt unverändert von Step 1.)

Run: `npx drizzle-kit generate`
Expected: erzeugt `migrations/0006_<random-name>.sql` mit einer `PRAGMA foreign_keys=OFF` / `__new_printers`-Tabellenneubau (SQLite kann Spalten nicht direkt droppen + gleichzeitig eine Spalte NOT NULL machen) — kein Prompt, da diese Änderung nur Spalten entfernt, keine neuen hinzufügt.

- [ ] **Step 4: Migration gegen eine realistische Test-DB verifizieren**

Test-Skript `backend/scratch-verify-migration.ts` (wird in Step 6 wieder gelöscht):

```ts
import { createDb } from './src/db/client.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

const DB_PATH = './scratch-verify.db';
rmSync(DB_PATH, { force: true });
rmSync(DB_PATH + '-wal', { force: true });
rmSync(DB_PATH + '-shm', { force: true });

const db = createDb(DB_PATH);
migrate(db, { migrationsFolder: './migrations' });

const raw = new Database(DB_PATH);
raw.prepare(`INSERT INTO printers (name, hostname, vendor, host) VALUES ('Empfang', 'A1', 'brother-ql', '10.0.0.1')`).run();
raw.close();
```

Run: `cd backend && npx tsx scratch-verify-migration.ts && npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('./scratch-verify.db');
console.log(db.prepare('SELECT * FROM printer_groups').all());
console.log(db.prepare('SELECT * FROM printers').all());
"`

Erwartet: läuft ohne Fehler durch (bestätigt, dass beide Migrationen in Folge anwendbar sind). Weil diese Test-DB frisch ist (keine Alt-Daten VOR Migration 0005/0006), prüft dieser Schritt nur "Migration läuft technisch durch" — die Datenkorrektheit bei bestehenden Alt-Daten prüft der Vitest-Test in Step 5.

- [ ] **Step 5: Vitest-Test für die Migrations-Datenkorrektheit schreiben**

`backend/src/db/migration.test.ts`:

```ts
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './client.js';

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('printer_groups Migration', () => {
  it('erzeugt eine Gruppe je distinktem Hostnamen und verknüpft alle Beine korrekt, auch wenn mehrere Zeilen sich vorher einen Hostnamen teilten', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ct-checkin-printer-migtest-'));
    const dbPath = path.join(tmpDir, 'app.db');

    // Baseline: nur Migrationen VOR der Gruppen-Migration anwenden.
    const baselineDir = path.join(tmpDir, 'baseline-migrations');
    const migrationsDir = path.join(import.meta.dirname, '../../migrations');
    const journal = JSON.parse(readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'));
    const baselineEntries = journal.entries.filter((e: { tag: string }) => !e.tag.startsWith('0005_') && !e.tag.startsWith('0006_'));
    cpSync(migrationsDir, baselineDir, { recursive: true });
    for (const entry of journal.entries) {
      if (!baselineEntries.includes(entry)) rmSync(path.join(baselineDir, `${entry.tag}.sql`), { force: true });
    }
    writeFileSync(path.join(baselineDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: baselineEntries }, null, 2));

    const baselineDb = createDb(dbPath);
    migrate(baselineDb, { migrationsFolder: baselineDir });

    const raw = new Database(dbPath);
    raw.prepare(`INSERT INTO printers (name, hostname, vendor, host) VALUES ('Empfang', 'A1', 'brother-ql', '10.0.0.1')`).run();
    raw.prepare(`INSERT INTO printers (name, hostname, vendor, host, check_enabled) VALUES ('Kind', 'B2', 'brother-ql', '10.0.0.10', 1)`).run();
    raw.prepare(`INSERT INTO printers (name, hostname, vendor, host, check_enabled) VALUES ('Eltern', 'B2', 'zebra-zpl', '10.0.0.11', 0)`).run();
    raw.close();

    // Volle Migrationskette (inkl. 0005/0006) anwenden.
    const upgradedDb = createDb(dbPath);
    migrate(upgradedDb, { migrationsFolder: migrationsDir });

    const after = new Database(dbPath);
    const groups = after.prepare('SELECT * FROM printer_groups ORDER BY id').all() as Array<{ id: number; hostname: string; name: string }>;
    const printers = after.prepare('SELECT id, group_id, name, hostname FROM printers ORDER BY id').all() as Array<{ id: number; group_id: number; name: string }>;
    after.close();

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: 1, hostname: 'A1', name: 'Empfang' });
    expect(groups[1]).toMatchObject({ id: 2, hostname: 'B2', name: 'Kind' }); // primäres (niedrigste id) Bein liefert die Gruppen-Werte

    expect(printers).toEqual([
      { id: 1, group_id: 1, name: 'Empfang', hostname: undefined },
      { id: 2, group_id: 2, name: 'Kind', hostname: undefined },
      { id: 3, group_id: 2, name: 'Eltern', hostname: undefined },
    ].map(({ hostname: _h, ...rest }) => rest)); // `hostname`-Spalte existiert nach der Migration nicht mehr auf `printers`
  });
});
```

- [ ] **Step 6: Test ausführen, Scratch-Datei löschen, aufräumen**

Run: `cd backend && npx vitest run src/db/migration.test.ts`
Expected: PASS.

Dann: `rm backend/scratch-verify-migration.ts backend/scratch-verify.db backend/scratch-verify.db-wal backend/scratch-verify.db-shm 2>/dev/null; true`

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/schema.ts backend/migrations backend/src/db/migration.test.ts
git commit -m "feat: printer_groups-Tabelle + Migration (Datenmodell für Druckergruppen)"
```

(An dieser Stelle schlagen `npm run typecheck --workspace backend` und mehrere Tests fehl — erwartet, wird in den folgenden Tasks behoben. Committen trotzdem, um den Fortschritt klein zu halten; die restlichen Tasks in diesem Plan sind die Fortsetzung.)

---

## Task 2: `routing.ts` auf Gruppen umstellen

**Files:**
- Modify: `backend/src/orchestrator/routing.ts`
- Test: `backend/src/orchestrator/routing.test.ts`

**Interfaces:**
- Consumes: `printerGroups`, `printers` (aus `../db/schema.js`)
- Produces: `resolveLayoutsForJob(db: Db, hostname: string, ctTypeKey: string): LabelLayoutRow[]` (Signatur unverändert)

- [ ] **Step 1: Test-Helper auf Gruppe+Bein umstellen, Tests anpassen**

`backend/src/orchestrator/routing.test.ts` komplett ersetzen:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts, printerGroups, printers } from '../db/schema.js';
import { resolveLayoutsForJob } from './routing.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

function makeGroup(hostname: string) {
  return db.insert(printerGroups).values({ name: hostname, hostname }).returning().all()[0]!;
}

function makeLeg(groupId: number, vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  return db.insert(printers).values({ groupId, name: 'Leg', vendor, host: '10.0.0.1' }).returning().all()[0]!;
}

describe('resolveLayoutsForJob', () => {
  it('returns an empty array when no group with this hostname exists', () => {
    expect(resolveLayoutsForJob(db, 'does-not-exist', 'parent')).toEqual([]);
  });

  it('returns an empty array when no layout matches the printer + ctTypeKey', () => {
    const group = makeGroup('B1');
    makeLeg(group.id);
    expect(resolveLayoutsForJob(db, 'B1', 'parent')).toEqual([]);
  });

  it('returns just the primary layout when it has no also[] links', () => {
    const group = makeGroup('B1');
    const leg = makeLeg(group.id);
    const [layout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: leg.id }).returning().all();

    const result = resolveLayoutsForJob(db, 'B1', 'parent');
    expect(result.map((l) => l.id)).toEqual([layout!.id]);
  });

  it('appends also[] layouts, even when they target a different printer', () => {
    const groupA = makeGroup('B1');
    const legA = makeLeg(groupA.id);
    const groupB = makeGroup('B2');
    const legB = makeLeg(groupB.id);
    const [primary] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: legA.id }).returning().all();
    const [also] = db.insert(labelLayouts).values({ name: 'Sammelzettel', ctTypeKey: 'summary', printerId: legB.id }).returning().all();
    db.insert(labelLayoutAlso).values({ layoutId: primary!.id, alsoLayoutId: also!.id }).run();

    const result = resolveLayoutsForJob(db, 'B1', 'parent');
    expect(result.map((l) => l.id)).toEqual([primary!.id, also!.id]);
    expect(result[1]!.printerId).toBe(legB.id);
  });

  it('resolves the PRIMARY layout to a different physical leg within the SAME group (v1 routing-mode: one CT location, per-type physical printer)', () => {
    const group = makeGroup('B2');
    const legChild = makeLeg(group.id, 'brother-ql'); // z.B. "child", 54mm
    const legParent = makeLeg(group.id, 'zebra-zpl'); // "parent", anderes Format, anderer physischer Drucker

    const [childLayout] = db.insert(labelLayouts).values({ name: 'Kind', ctTypeKey: 'child', printerId: legChild.id }).returning().all();
    const [parentLayout] = db.insert(labelLayouts).values({ name: 'Eltern', ctTypeKey: 'parent', printerId: legParent.id }).returning().all();

    expect(resolveLayoutsForJob(db, 'B2', 'child').map((l) => l.id)).toEqual([childLayout!.id]);
    expect(resolveLayoutsForJob(db, 'B2', 'parent').map((l) => l.id)).toEqual([parentLayout!.id]);
  });
});
```

- [ ] **Step 2: Test ausführen, bestätigen dass er fehlschlägt (Implementierung noch alt)**

Run: `cd backend && npx vitest run src/orchestrator/routing.test.ts`
Expected: FAIL (`resolveLayoutsForJob` nutzt noch `printers.hostname`, das jetzt nicht mehr existiert — TypeScript-Fehler oder Laufzeitfehler, je nachdem was tsx toleriert).

- [ ] **Step 3: `routing.ts` implementieren**

`backend/src/orchestrator/routing.ts` komplett ersetzen:

```ts
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { labelLayoutAlso, labelLayouts, printerGroups, printers } from '../db/schema.js';

export type LabelLayoutRow = typeof labelLayouts.$inferSelect;

/**
 * Findet für einen eingehenden Check-in-Job (Ziel-Hostname + `checkin.type`)
 * das zuständige Layout ("Route", siehe `label_layouts`) plus alle über
 * `label_layout_also` verknüpften Zusatz-Layouts (v1s `also[]`, siehe
 * label-router.js) — diese können auf einen ANDEREN Drucker zeigen als das
 * Primär-Layout. Gibt `[]` zurück, wenn kein Layout für diesen Hostnamen+Typ
 * konfiguriert ist (mirrors v1: "Kein Route für Label-Typ ... übersprungen").
 *
 * Gesucht wird über ALLE physischen Beine (`printers`) der `printer_groups`-
 * Zeile mit diesem Hostnamen — mehrere Beine derselben Gruppe bilden einen
 * "virtuellen Drucker" (siehe Spec docs/superpowers/specs/2026-09-04-printer-groups-design.md).
 * So kann z.B. "parent" auf Bein A und "child" auf Bein B als jeweils
 * PRIMÄRES Layout landen, obwohl beide von derselben ChurchTools-Gruppe kommen.
 */
export function resolveLayoutsForJob(db: Db, hostname: string, ctTypeKey: string): LabelLayoutRow[] {
  const group = db.select({ id: printerGroups.id }).from(printerGroups).where(eq(printerGroups.hostname, hostname)).get();
  if (!group) return [];

  const legIds = db
    .select({ id: printers.id })
    .from(printers)
    .where(eq(printers.groupId, group.id))
    .all()
    .map((row) => row.id);
  if (legIds.length === 0) return [];

  const primary = db
    .select()
    .from(labelLayouts)
    .where(inArray(labelLayouts.printerId, legIds))
    .all()
    .find((layout) => layout.ctTypeKey === ctTypeKey);
  if (!primary) return [];

  const alsoIds = db
    .select({ alsoLayoutId: labelLayoutAlso.alsoLayoutId })
    .from(labelLayoutAlso)
    .where(eq(labelLayoutAlso.layoutId, primary.id))
    .all()
    .map((r) => r.alsoLayoutId);
  if (alsoIds.length === 0) return [primary];

  const alsoLayouts = db.select().from(labelLayouts).where(inArray(labelLayouts.id, alsoIds)).all();
  const byId = new Map(alsoLayouts.map((l) => [l.id, l]));
  const ordered = alsoIds.map((id) => byId.get(id)).filter((l): l is LabelLayoutRow => l !== undefined);

  return [primary, ...ordered];
}
```

- [ ] **Step 4: Test ausführen, bestätigen dass er jetzt besteht**

Run: `cd backend && npx vitest run src/orchestrator/routing.test.ts`
Expected: PASS (5 Tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/orchestrator/routing.ts backend/src/orchestrator/routing.test.ts
git commit -m "refactor: routing.ts löst Layouts über printer_groups statt Hostname-Spalte auf"
```

---

## Task 3: `PrintPipeline.ts` auf Gruppen umstellen

**Files:**
- Modify: `backend/src/orchestrator/PrintPipeline.ts`
- Test: `backend/src/orchestrator/PrintPipeline.test.ts`

**Interfaces:**
- Consumes: `printerGroups`, `printers` (aus `../db/schema.js`), `resolveLayoutsForJob` (Task 2, Signatur unverändert)
- Produces: `processIncomingJob(hostname: string, rawData: string, now?): Promise<ProcessIncomingJobResult>` (Signatur unverändert)

- [ ] **Step 1: Test-Helper auf Gruppe+Bein umstellen**

In `backend/src/orchestrator/PrintPipeline.test.ts` den bestehenden `makePrinter`-Helper ersetzen:

```ts
import { labelLayoutAlso, labelLayouts, mediaTypes, printLog, printQueue, printerGroups, printers, type LabelElement } from '../db/schema.js';
// (printerGroups zur bestehenden Import-Zeile hinzufügen)

function makePrinter(hostname: string, vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  const [group] = db.insert(printerGroups).values({ name: hostname, hostname }).returning().all();
  return db.insert(printers).values({ groupId: group!.id, name: hostname, vendor, host: '10.0.0.1' }).returning().all()[0]!;
}
```

Alle Aufrufe von `pipeline.processIncomingJob(printer.id, ...)` bleiben `pipeline.processIncomingJob(printer.hostname, ...)` — das war bereits so (siehe aktuellen Dateiinhalt), hier ändert sich nur, WIE `printer` (jetzt ein Bein mit `hostname` aus der zugehörigen Gruppe) entsteht. `printer.hostname` existiert nach diesem Helper-Umbau nicht mehr direkt auf dem zurückgegebenen Objekt (das ist jetzt eine `printers`-Zeile ohne `hostname`-Feld) — deshalb den Helper so anpassen, dass er **beide** zurückgibt:

```ts
function makePrinter(hostname: string, vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  const [group] = db.insert(printerGroups).values({ name: hostname, hostname }).returning().all();
  const [leg] = db.insert(printers).values({ groupId: group!.id, name: hostname, vendor, host: '10.0.0.1' }).returning().all();
  return { ...leg!, hostname: group!.hostname };
}
```

Damit bleiben alle bestehenden Testaufrufe (`printer.hostname`, `printer.id`) unverändert gültig — nur der Helfer ändert sich.

- [ ] **Step 2: Tests ausführen, bestätigen dass sie fehlschlagen**

Run: `cd backend && npx vitest run src/orchestrator/PrintPipeline.test.ts`
Expected: FAIL (Compile-Fehler: `printerGroups` unbekannt in `printers`-Insert, `printers.hostname` existiert nicht mehr).

- [ ] **Step 3: `PrintPipeline.ts` anpassen**

In `backend/src/orchestrator/PrintPipeline.ts`:

Import-Zeile ändern:
```ts
import { labelLayouts, mediaTypes, printLog, printerGroups, printers, type LabelElement } from '../db/schema.js';
```

`processIncomingJob` und die privaten Helper ersetzen:

```ts
  async processIncomingJob(hostname: string, rawData: string, now: () => number = Date.now): Promise<ProcessIncomingJobResult> {
    if (!rawData || !rawData.trim()) return { enriched: false, printed: 0, queued: 0 };

    // Repräsentative Identität für diesen Hostnamen, nur für die Check-in-
    // Webhook-Identität (name/host) — bei mehreren physischen Beinen in
    // dieser Gruppe (siehe routing.ts) ist `leg` das zuerst angelegte; das
    // eigentliche Druckziel je Etikett bestimmt weiterhin `layout.printerId`.
    const origin = this.getOriginByHostname(hostname);
    if (!origin) return { enriched: false, printed: 0, queued: 0 };

    const parsed = parseCheckinData(rawData);
    const unixTimestampSeconds = Math.floor(now() / 1000);
    const layouts = resolveLayoutsForJob(this.deps.db, hostname, parsed.type ?? '');

    let printed = 0;
    let queued = 0;
    for (const layout of layouts) {
      const outcome = await this.attemptPrintLayout(layout, parsed, unixTimestampSeconds);
      if (outcome.success) {
        printed++;
      } else {
        queued++;
        enqueueJob(this.deps.db, {
          printerId: layout.printerId ?? origin.leg.id,
          layoutId: layout.id,
          payload: { rawData, unixTimestampSeconds },
          reason: outcome.errorMessage ?? 'Unbekannter Fehler',
          printError: outcome.printError ?? false,
        });
      }
    }

    const payload = buildCheckinWebhookPayload({ hostname: origin.group.hostname, name: origin.group.name, host: origin.leg.host }, parsed, unixTimestampSeconds);
    await dispatchOutgoingWebhooks(this.deps.db, this.deps.env, 'checkin', payload);

    return { enriched: true, printed, queued };
  }
```

(`attemptPrintLayout`, `logAndReturn`, `retryQueuedJob`, `getLayoutRow` bleiben unverändert — sie arbeiten bereits mit `layout.printerId`/`getPrinterRow`, was weiterhin ein Bein per `id` ist.)

`getPrimaryPrinterByHostname` ersetzen durch:

```ts
  private getOriginByHostname(hostname: string): { group: typeof printerGroups.$inferSelect; leg: typeof printers.$inferSelect } | undefined {
    const group = this.deps.db.select().from(printerGroups).where(eq(printerGroups.hostname, hostname)).get();
    if (!group) return undefined;
    const leg = this.deps.db.select().from(printers).where(eq(printers.groupId, group.id)).orderBy(asc(printers.id)).get();
    if (!leg) return undefined;
    return { group, leg };
  }
```

(`getPrinterRow(printerId)` bleibt unverändert bestehen — wird weiterhin für `layout.printerId`-Auflösung gebraucht.)

- [ ] **Step 4: Tests ausführen, bestätigen dass sie bestehen**

Run: `cd backend && npx vitest run src/orchestrator/PrintPipeline.test.ts`
Expected: PASS (7 Tests, unverändert gegenüber vorher).

- [ ] **Step 5: Commit**

```bash
git add backend/src/orchestrator/PrintPipeline.ts backend/src/orchestrator/PrintPipeline.test.ts
git commit -m "refactor: PrintPipeline löst Check-in-Herkunft über printer_groups auf"
```

---

## Task 4: `PrinterPoller.ts` auf Gruppe/Beine umstellen

**Files:**
- Modify: `backend/src/orchestrator/PrinterPoller.ts`
- Test: `backend/src/orchestrator/PrinterPoller.test.ts`

**Interfaces:**
- Produces: `PrinterPollerGroup { id, hostname, name, activeTimesMode, activeTimesExpr, checkEnabled, statusWebhookEnabled }`, `PrinterPollerLeg { id, name, vendor, host, port }`, `PrinterPollerDeps.group: PrinterPollerGroup`, `PrinterPollerDeps.legs: PrinterPollerLeg[]` (ersetzt `PrinterPollerDeps.printers: PrinterPollerPrinter[]`), `status(): { groupId, legIds, running, mode, consecutiveErrors, lastJobAt }` (ersetzt `printerId`/`printerIds`), `onWindowClosed?: (windowOpenedAt: number, windowClosedAt: number) => void` (Parameter `printerId` entfernt — war bereits vom Aufrufer ignoriert).

- [ ] **Step 1: Test-Fixtures auf Gruppe+Beine umstellen**

`backend/src/orchestrator/PrinterPoller.test.ts`: `BASE_PRINTER` ersetzen durch `BASE_GROUP` + `BASE_LEG`:

```ts
import { PrinterPoller, type PrinterPollerGroup, type PrinterPollerLeg } from './PrinterPoller.js';

const BASE_GROUP: PrinterPollerGroup = {
  id: 1,
  hostname: 'B1',
  name: 'Empfang',
  checkEnabled: false,
  activeTimesMode: 'always',
  activeTimesExpr: null,
  statusWebhookEnabled: false,
};

const BASE_LEG: PrinterPollerLeg = { id: 1, name: 'Empfang', vendor: 'brother-ql', host: '10.0.0.1', port: 9100 };
```

Jede `new PrinterPoller({ ..., printer: BASE_PRINTER, ... })`-Konstruktion wird zu `new PrinterPoller({ ..., group: BASE_GROUP, legs: [BASE_LEG], ... })`; jede `printers: [custom]`-Variante (Zeitfenster-Tests) zu `group: { ...BASE_GROUP, activeTimesMode: 'custom', activeTimesExpr: 'Mo:10:05-10:10' }, legs: [BASE_LEG]`.

Die Assertion `expect(pipeline.processIncomingJob).toHaveBeenCalledWith(BASE_PRINTER.id, ...)` wird zu `expect(pipeline.processIncomingJob).toHaveBeenCalledWith(BASE_GROUP.hostname, ...)` (war schon `.hostname` seit dem vorherigen Umbau — nur die Fixture-Referenz ändert sich).

Der `onWindowClosed`-Test:
```ts
    expect(onWindowClosed).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    const [windowOpenedAt, windowClosedAt] = onWindowClosed.mock.calls[0]!;
    expect(windowOpenedAt).toBeLessThanOrEqual(windowClosedAt);
```
(Kein `custom.id`-Argument mehr — der Callback trägt keine ID mehr, siehe Interfaces oben.)

Das multi-leg-Describe-Block am Ende (`legPrimary`/`legSecondary`) umbauen zu einer echten Gruppe mit zwei Beinen:

```ts
describe('PrinterPoller multi-leg groups (virtueller Drucker mit mehreren physischen Beinen, siehe v1 Routing-Modus)', () => {
  const group: PrinterPollerGroup = { ...BASE_GROUP, activeTimesMode: 'custom', activeTimesExpr: 'Mo:10:05-10:10', checkEnabled: true };
  const legPrimary: PrinterPollerLeg = { id: 20, name: 'Kind', vendor: 'brother-ql', host: '10.0.0.20', port: 9100 };
  const legSecondary: PrinterPollerLeg = { id: 21, name: 'Eltern', vendor: 'zebra-zpl', host: '10.0.0.21', port: 9100 };

  it('checks every physical leg before the single ChurchTools activation for the shared hostname', async () => {
    const client = fakeClient();
    const statusByLeg = new Map([
      [legPrimary.id, PrinterStatus.ONLINE],
      [legSecondary.id, PrinterStatus.PAPER_EMPTY],
    ]);
    const getAdapter = vi.fn(async (p: PrinterPollerLeg) => ({
      getStatus: vi.fn(async () => ({ status: statusByLeg.get(p.id)!, humanMessage: 'x', source: 'print-channel' as const, timestamp: new Date() })),
    })) as unknown as (p: PrinterPollerLeg) => Promise<LabelPrinterAdapter>;
    const poller = new PrinterPoller({
      db,
      env,
      group,
      legs: [legPrimary, legSecondary],
      client,
      pipeline: fakePipeline(),
      adapters: { getAdapter },
      config: DEFAULT_APP_CONFIG,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getAdapter).toHaveBeenCalledWith(legPrimary);
    expect(getAdapter).toHaveBeenCalledWith(legSecondary);
    expect(client.activatePrinter).toHaveBeenCalledTimes(1);
    expect(client.activatePrinter).toHaveBeenCalledWith(group.hostname, group.name);

    poller.stop();
  });

  it('polls ChurchTools and dispatches incoming jobs using the shared hostname, not any single leg`s id', async () => {
    const client = fakeClient({ getNextPrinterJob: vi.fn(async () => ({ success: true, data: 'name=Max\nid=1\ncode=AB\ntype=parent' })) });
    const pipeline = fakePipeline();
    const poller = new PrinterPoller({ db, env, group, legs: [legPrimary, legSecondary], client, pipeline, adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(0);

    expect(pipeline.processIncomingJob).toHaveBeenCalledWith(group.hostname, 'name=Max\nid=1\ncode=AB\ntype=parent');

    poller.stop();
  });
});
```

- [ ] **Step 2: Tests ausführen, bestätigen dass sie fehlschlagen**

Run: `cd backend && npx vitest run src/orchestrator/PrinterPoller.test.ts`
Expected: FAIL (Compile-Fehler: `PrinterPollerGroup` existiert noch nicht, `group`/`legs`-Props unbekannt).

- [ ] **Step 3: `PrinterPoller.ts` implementieren**

`backend/src/orchestrator/PrinterPoller.ts` komplett ersetzen:

```ts
import type { CheckinBackendClient } from '../adapters/churchtools/types.js';
import { PrinterStatus, type LabelPrinterAdapter } from '../adapters/printer/types.js';
import type { PrinterVendor } from '../adapters/printer/factory.js';
import { isActiveNow, msUntilNextWindow } from '../schedule/activeTimes.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import type { AppConfigValues } from './appConfig.js';
import { buildStatusWebhookPayload } from './payloads.js';
import { resolvePrinterSchedule } from './printerSchedule.js';
import { dispatchOutgoingWebhooks } from './webhookDispatch.js';

/** ChurchTools-Identität der Gruppe (siehe db/schema.ts `printer_groups`) — das, was ChurchTools sieht. NIE mit physischen Feldern (host/port/vendor) mischen. */
export interface PrinterPollerGroup {
  id: number;
  hostname: string;
  name: string;
  checkEnabled: boolean;
  activeTimesMode: 'inherit' | 'always' | 'custom';
  activeTimesExpr: string | null;
  statusWebhookEnabled: boolean;
}

/** Ein physisches Gerät ("Bein") — rein intern, siehe Sicherheits-Invariante in der Spec: NIE an ChurchTools übertragen. */
export interface PrinterPollerLeg {
  id: number;
  name: string;
  vendor: PrinterVendor;
  host: string;
  port: number;
}

export interface PrinterPollerPipeline {
  processIncomingJob(hostname: string, rawData: string): Promise<{ enriched: boolean; printed: number; queued: number }>;
}

export interface PrinterPollerAdapters {
  getAdapter(leg: PrinterPollerLeg): Promise<LabelPrinterAdapter>;
}

export interface PrinterPollerDeps {
  db: Db;
  env: Env;
  group: PrinterPollerGroup;
  /** Alle physischen Beine dieser Gruppe, mindestens eins. */
  legs: PrinterPollerLeg[];
  client: CheckinBackendClient;
  pipeline: PrinterPollerPipeline;
  adapters: PrinterPollerAdapters;
  config: AppConfigValues;
  /** Feuert beim Schliessen des Zeitfensters mit [Fenster-Öffnungszeit, Schliesszeit] als ms-Epoch — Anknüpfungspunkt für den Gruppen-Sammelausdruck. */
  onWindowClosed?: (windowOpenedAt: number, windowClosedAt: number) => void;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

type Mode = 'sleeping' | 'idle' | 'active';

/**
 * Ein Poller pro `printer_groups`-Zeile (i.d.R. ein physisches Gerät,
 * optional mehrere Beine — siehe `PrinterPollerDeps.legs`) — Zeitfenster-
 * gesteuertes adaptives Polling gegen ChurchTools, MAX_ERRORS-Cooldown mit
 * isolierter Auto-Recovery (ein instabiler Drucker legt keine anderen lahm,
 * siehe v1 Issue #21), Aktivierung/Abmeldung an Fensterrändern. Ersetzt v1s
 * `JobPoller`; Routing/Rendern/Queueing sind an `PrintPipeline` ausgelagert.
 */
export class PrinterPoller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveErrors = 0;
  private lastJobAt: number | null = null;
  private lastMode: Mode | null = null;
  private needsReactivation = false;
  private windowOpenedAt: number | null = null;

  constructor(private readonly deps: PrinterPollerDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status(): { groupId: number; legIds: number[]; running: boolean; mode: Mode; consecutiveErrors: number; lastJobAt: number | null } {
    return {
      groupId: this.deps.group.id,
      legIds: this.deps.legs.map((l) => l.id),
      running: this.running,
      mode: this.currentMode(),
      consecutiveErrors: this.consecutiveErrors,
      lastJobAt: this.lastJobAt,
    };
  }

  private get schedule() {
    return resolvePrinterSchedule(this.deps.group, this.deps.config.activeTimesDefault);
  }

  private currentMode(): Mode {
    if (!isActiveNow(this.schedule, new Date())) return 'sleeping';
    if (this.lastJobAt !== null && Date.now() - this.lastJobAt < this.deps.config.pollActiveTtlMs) return 'active';
    return 'idle';
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private sleepUntilNextWindowMs(): number {
    const ms = msUntilNextWindow(this.schedule, new Date());
    if (ms === null || ms === Infinity) return 30_000;
    return Math.min(ms + 1000, 30_000);
  }

  private backoffDelayMs(): number {
    return Math.min(this.deps.config.pollIdleMs * 2 ** (this.consecutiveErrors - 1), 30_000);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    const mode = this.currentMode();
    if (mode !== this.lastMode) {
      const prevMode = this.lastMode;
      this.lastMode = mode;
      await this.onModeChange(prevMode, mode);
    } else if (this.needsReactivation && mode !== 'sleeping') {
      this.needsReactivation = false;
      await this.activateWithCheck();
    }

    if (mode === 'sleeping') {
      this.needsReactivation = false;
      this.scheduleNext(this.sleepUntilNextWindowMs());
      return;
    }

    const interval = mode === 'active' ? this.deps.config.pollActiveMs : this.deps.config.pollIdleMs;

    try {
      const result = await this.deps.client.getNextPrinterJob(this.deps.group.hostname);
      if (!result.success) throw new Error(result.message ?? 'API-Fehler');

      if (!result.data || !result.data.trim()) {
        this.consecutiveErrors = 0;
        this.scheduleNext(interval);
        return;
      }

      await this.deps.pipeline.processIncomingJob(this.deps.group.hostname, result.data);
      this.consecutiveErrors = 0;
      this.lastJobAt = Date.now();
      this.scheduleNext(200);
    } catch (err) {
      await this.handlePollError(err);
    }
  }

  private async handlePollError(err: unknown): Promise<void> {
    this.consecutiveErrors++;
    const message = err instanceof Error ? err.message : String(err);
    this.deps.logger?.error(`[${this.deps.group.hostname}] Poll-Fehler #${this.consecutiveErrors}: ${message}`);

    if (this.consecutiveErrors >= this.deps.config.maxErrors) {
      try {
        await this.deps.client.hidePrinter(this.deps.group.hostname);
      } catch {
        // Best effort — der Poller pausiert ohnehin gleich für einen Cooldown.
      }
      await this.dispatchStatusEvent('printer.fatal', {
        status: PrinterStatus.ERROR,
        humanMessage: `${this.deps.config.maxErrors} Fehler hintereinander: ${message}`,
        source: 'print-channel',
        timestamp: new Date(),
      });

      this.consecutiveErrors = 0;
      this.needsReactivation = true;
      this.scheduleNext(this.deps.config.pollerRestartDelayMs);
    } else {
      this.scheduleNext(this.backoffDelayMs());
    }
  }

  /**
   * Prüft (falls `checkEnabled`) einmalig den Status ALLER physischen Beine
   * dieser Gruppe und meldet danach EINMAL bei ChurchTools an (v1
   * Routing-Modus: `checkAllPrinters`/`getUniqueHosts` in label-router.js —
   * ein instabiles Bein blockiert die Anmeldung nicht, es wird nur wie in v1
   * ein Status-Webhook pro betroffenem Bein verschickt).
   */
  private async activateWithCheck(): Promise<void> {
    if (this.deps.group.checkEnabled) {
      await Promise.all(
        this.deps.legs.map(async (leg) => {
          try {
            const adapter = await this.deps.adapters.getAdapter(leg);
            const status = await adapter.getStatus();
            if (status.status !== PrinterStatus.ONLINE) {
              await this.dispatchStatusEvent('printer.warning', status, leg);
            }
          } catch (err) {
            this.deps.logger?.warn(`[${this.deps.group.hostname}] Statusprüfung für "${leg.name}" fehlgeschlagen (${leg.host}:${leg.port}): ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    }

    const result = await this.deps.client.activatePrinter(this.deps.group.hostname, this.deps.group.name);
    if (!result.success) this.deps.logger?.error(`[${this.deps.group.hostname}] Anmeldung fehlgeschlagen: ${result.message}`);
  }

  private async onModeChange(prevMode: Mode | null, newMode: Mode): Promise<void> {
    const { hostname } = this.deps.group;

    if (prevMode === 'sleeping' && newMode !== 'sleeping') {
      this.windowOpenedAt = Date.now();
      await this.deps.client.ensureLogin();
      await this.activateWithCheck();
    }

    if (prevMode !== 'sleeping' && prevMode !== null && newMode === 'sleeping') {
      const result = await this.deps.client.hidePrinter(hostname);
      if (!result.success) this.deps.logger?.error(`[${hostname}] Abmeldung fehlgeschlagen: ${result.message}`);
      await this.deps.client.onWindowClose();
      const windowClosedAt = Date.now();
      this.deps.onWindowClosed?.(this.windowOpenedAt ?? windowClosedAt, windowClosedAt);
      this.windowOpenedAt = null;
    }
  }

  /** `leg` identifiziert, welches physische Gerät betroffen ist (v1: `printerHost`/`printerPort` im Status-Payload zeigen den konkreten Routing-Host); `statusWebhookEnabled` gilt gruppenweit. Default (erstes Bein) deckt gruppenweite Events ab (z.B. `printer.fatal`), die keinem einzelnen Bein zuzuordnen sind. */
  private async dispatchStatusEvent(event: string, status: Parameters<typeof buildStatusWebhookPayload>[2], leg: PrinterPollerLeg = this.deps.legs[0]!): Promise<void> {
    if (!this.deps.group.statusWebhookEnabled) return;
    const payload = buildStatusWebhookPayload(event, { hostname: this.deps.group.hostname, name: this.deps.group.name, host: leg.host, port: leg.port }, status);
    await dispatchOutgoingWebhooks(this.deps.db, this.deps.env, 'status', payload);
  }
}
```

- [ ] **Step 4: Tests ausführen, bestätigen dass sie bestehen**

Run: `cd backend && npx vitest run src/orchestrator/PrinterPoller.test.ts`
Expected: PASS (13 Tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/orchestrator/PrinterPoller.ts backend/src/orchestrator/PrinterPoller.test.ts
git commit -m "refactor: PrinterPoller nutzt Gruppe+Beine statt implizitem 'primärem' Element"
```

---

## Task 5: `PrintOrchestrator.ts` + `orchestratorLike.ts` auf Gruppen umstellen

**Files:**
- Modify: `backend/src/orchestrator/PrintOrchestrator.ts`
- Modify: `backend/src/orchestrator/orchestratorLike.ts`
- Test: `backend/src/orchestrator/PrintOrchestrator.test.ts`

**Interfaces:**
- Consumes: `PrinterPollerGroup`, `PrinterPollerLeg` (Task 4)
- Produces: `OrchestratorPollerStatus { groupId, legIds, running, mode, consecutiveErrors, lastJobAt }` (ersetzt `printerId`/`printerIds`)

- [ ] **Step 1: `orchestratorLike.ts` anpassen**

In `backend/src/orchestrator/orchestratorLike.ts` die Interface-Felder umbenennen:

```ts
export interface OrchestratorPollerStatus {
  groupId: number;
  legIds: number[];
  running: boolean;
  mode: 'sleeping' | 'idle' | 'active';
  consecutiveErrors: number;
  lastJobAt: number | null;
}
```

(Rest der Datei — `OrchestratorStatus`, `OrchestratorLike`, `noopOrchestrator` — bleibt unverändert, `noopOrchestrator.status()` gibt weiterhin `{ pollers: [] }` zurück.)

- [ ] **Step 2: Test für "ein Poller pro Gruppe, auch bei mehreren Beinen" schreiben**

In `backend/src/orchestrator/PrintOrchestrator.test.ts`, Import-Zeile erweitern:
```ts
import { churchtoolsConnection, printerGroups, printers, summaryLayouts } from '../db/schema.js';
```

Bestehende Test-Inserts wie `db.insert(printers).values({ name: 'B1', hostname: 'B1', vendor: 'brother-ql', host: '10.0.0.1' }).run();` werden zu einem Insert in BEIDE Tabellen. Neuer Helper am Dateianfang (nach den Imports):

```ts
function makePrinterGroupWithLeg(hostname: string, vendor: 'brother-ql' | 'zebra-zpl' = 'brother-ql') {
  const [group] = db.insert(printerGroups).values({ name: hostname, hostname }).returning().all();
  const [leg] = db.insert(printers).values({ groupId: group!.id, name: hostname, vendor, host: '10.0.0.1' }).returning().all();
  return { group: group!, leg: leg! };
}
```

Jedes bisherige `db.insert(printers).values({ name: 'B1', hostname: 'B1', ... }).run();` durch `makePrinterGroupWithLeg('B1');` ersetzen (Rückgabewert nur nutzen, wo der Test bisher `printer.hostname`/`printer.id` brauchte — dann `const { group, leg } = makePrinterGroupWithLeg('B1');` und `group.hostname`/`leg.id` verwenden).

Den Test `starts one poller per configured printer once a ChurchTools connection exists` (zwei Drucker `B1`/`B2`) entsprechend umstellen: zwei Aufrufe von `makePrinterGroupWithLeg`.

Für `summary_layouts`-Tests (`outputPrinter`), die `printerId: outputPrinter.id` nutzen — dort reicht weiterhin ein Bein, `const { leg } = makePrinterGroupWithLeg('OUT'); db.insert(summaryLayouts).values({ ..., printerId: leg.id, ... })`.

Neuen Test hinzufügen (nach dem bestehenden "starts one poller per configured printer"-Test):

```ts
  it('starts exactly ONE poller for a group with two physical legs (virtueller Drucker, siehe v1 Routing-Modus) — never one per leg', async () => {
    db.insert(churchtoolsConnection).values({ baseUrl: 'https://example.church.tools', username: 'bot', passwordEnc: encryptSecret('secret', env.ENCRYPTION_KEY) }).run();
    const [group] = db.insert(printerGroups).values({ name: 'Kind', hostname: 'B2' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'Kind', vendor: 'brother-ql', host: '10.0.0.1' }).run();
    db.insert(printers).values({ groupId: group!.id, name: 'Eltern', vendor: 'zebra-zpl', host: '10.0.0.2' }).run();
    const orchestrator = new PrintOrchestrator({ db, env });

    await orchestrator.start();

    expect(orchestrator.status().pollers).toHaveLength(1);
    await orchestrator.stop();
  });
```

- [ ] **Step 3: Tests ausführen, bestätigen dass sie fehlschlagen**

Run: `cd backend && npx vitest run src/orchestrator/PrintOrchestrator.test.ts`
Expected: FAIL (Compile-Fehler: `printerGroups`-Insert-Shape passt noch nicht zur alten `PrintOrchestrator.ts`-Logik, bzw. `printers`-Insert ohne `hostname` schlägt fehl solange `PrintOrchestrator.ts` noch die alte Gruppierung erwartet).

- [ ] **Step 4: `PrintOrchestrator.ts` implementieren**

In `backend/src/orchestrator/PrintOrchestrator.ts`:

Imports anpassen:
```ts
import { eq, asc } from 'drizzle-orm';
...
import { churchtoolsConnection, printerGroups, printers, summaryLayouts } from '../db/schema.js';
...
import { PrinterPoller, type PrinterPollerGroup, type PrinterPollerLeg } from './PrinterPoller.js';
```

`toPollerPrinter` ersetzen durch zwei Mapper:
```ts
function toPollerGroup(row: typeof printerGroups.$inferSelect): PrinterPollerGroup {
  return {
    id: row.id,
    hostname: row.hostname,
    name: row.name,
    checkEnabled: row.checkEnabled,
    activeTimesMode: row.activeTimesMode,
    activeTimesExpr: row.activeTimesExpr,
    statusWebhookEnabled: row.statusWebhookEnabled,
  };
}

function toPollerLeg(row: typeof printers.$inferSelect): PrinterPollerLeg {
  return { id: row.id, name: row.name, vendor: row.vendor, host: row.host, port: row.port };
}
```

`start()` — den Abschnitt ab `const printerRows = ...` bis zum Ende des `this.pollers = ...`-Blocks ersetzen durch:

```ts
    const groupRows = this.db.select().from(printerGroups).all();
    this.pollers = groupRows.map((groupRow) => {
      const legRows = this.db.select().from(printers).where(eq(printers.groupId, groupRow.id)).orderBy(asc(printers.id)).all();
      const poller = new PrinterPoller({
        db: this.db,
        env: this.env,
        group: toPollerGroup(groupRow),
        legs: legRows.map(toPollerLeg),
        client,
        pipeline,
        adapters,
        config,
        logger: this.logger,
        onWindowClosed: (windowOpenedAt, windowClosedAt) => {
          void this.triggerWindowCloseSummaries(new Date(windowOpenedAt), new Date(windowClosedAt));
        },
      });
      poller.start();
      return poller;
    });
    this.logger.info(`PrintOrchestrator gestartet: ${this.pollers.length} Drucker.`);
```

`handleIncomingJob`:
```ts
  async handleIncomingJob(hostname: string, rawData: string): Promise<{ ok: boolean; message?: string; printed?: number; queued?: number }> {
    if (!this.pipeline) return { ok: false, message: 'Orchestrator läuft nicht' };

    const group = this.db.select().from(printerGroups).where(eq(printerGroups.hostname, hostname)).get();
    if (!group) return { ok: false, message: `Unbekannter Drucker-Hostname "${hostname}"` };

    const result = await this.pipeline.processIncomingJob(hostname, rawData);
    return { ok: true, printed: result.printed, queued: result.queued };
  }
```

Docstring über der Klasse ("Bauschritt 9: ...") anpassen: `PrinterPoller je printer_groups-Zeile` statt `je Hostnamen-Gruppe`.

- [ ] **Step 5: Tests ausführen, bestätigen dass sie bestehen**

Run: `cd backend && npx vitest run src/orchestrator/PrintOrchestrator.test.ts`
Expected: PASS (alle bestehenden + der neue Multi-Bein-Test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/orchestrator/PrintOrchestrator.ts backend/src/orchestrator/orchestratorLike.ts backend/src/orchestrator/PrintOrchestrator.test.ts
git commit -m "refactor: PrintOrchestrator iteriert printer_groups statt Hostnamen zu gruppieren"
```

---

## Task 6: `dashboard.ts` auf Gruppen umstellen

**Files:**
- Modify: `backend/src/api/dashboard.ts`
- Test: `backend/src/api/dashboard.test.ts`

**Interfaces:**
- Consumes: `OrchestratorPollerStatus` (Task 5, jetzt mit `groupId`/`legIds`)
- Produces: `DashboardPrinterStatus { groupId, hostname, name, running, mode, consecutiveErrors, lastJobAt, pendingQueueCount }` (Feld `printerId` → `groupId` umbenannt)

- [ ] **Step 1: Test anpassen**

`backend/src/api/dashboard.test.ts` komplett ersetzen:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { printerGroups, printers } from '../db/schema.js';
import type { OrchestratorPollerStatus } from '../orchestrator/orchestratorLike.js';
import { enqueueJob } from '../orchestrator/printQueueStore.js';
import { createTestDb } from '../orchestrator/testDb.js';
import { buildDashboardStatus } from './dashboard.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

function makePoller(overrides: Partial<OrchestratorPollerStatus> = {}): OrchestratorPollerStatus {
  return { groupId: 1, legIds: [1], running: true, mode: 'idle', consecutiveErrors: 0, lastJobAt: null, ...overrides };
}

describe('buildDashboardStatus', () => {
  it('enriches a poller status with the group name/hostname', () => {
    const [group] = db.insert(printerGroups).values({ name: 'Minis', hostname: 'B2' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'Minis', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    const result = buildDashboardStatus(db, [makePoller({ groupId: group!.id, legIds: [1], mode: 'active', consecutiveErrors: 2, lastJobAt: 12345 })]);

    expect(result).toEqual([
      { groupId: group!.id, hostname: 'B2', name: 'Minis', running: true, mode: 'active', consecutiveErrors: 2, lastJobAt: 12345, pendingQueueCount: 0 },
    ]);
  });

  it('sums pending queue entries across every physical leg of a multi-printer group', () => {
    const [group] = db.insert(printerGroups).values({ name: 'Kind', hostname: 'B2' }).returning().all();
    const [legA] = db.insert(printers).values({ groupId: group!.id, name: 'Kind', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [legB] = db.insert(printers).values({ groupId: group!.id, name: 'Eltern', vendor: 'zebra-zpl', host: '10.0.0.2' }).returning().all();
    enqueueJob(db, { printerId: legA!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });
    enqueueJob(db, { printerId: legA!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });
    enqueueJob(db, { printerId: legB!.id, layoutId: null, payload: { rawData: 'x', unixTimestampSeconds: 1 }, reason: 'test' });

    const result = buildDashboardStatus(db, [makePoller({ groupId: group!.id, legIds: [legA!.id, legB!.id] })]);

    expect(result[0]!.pendingQueueCount).toBe(3);
  });

  it('falls back to "?" when the group no longer exists (deleted mid-run)', () => {
    const result = buildDashboardStatus(db, [makePoller({ groupId: 999, legIds: [999] })]);

    expect(result[0]!.hostname).toBe('?');
    expect(result[0]!.name).toBe('?');
  });

  it('returns an empty array for no pollers', () => {
    expect(buildDashboardStatus(db, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Test ausführen, bestätigen dass er fehlschlägt**

Run: `cd backend && npx vitest run src/api/dashboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: `dashboard.ts` implementieren**

`backend/src/api/dashboard.ts` komplett ersetzen:

```ts
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import type { Db } from '../db/client.js';
import { printerGroups } from '../db/schema.js';
import type { OrchestratorPollerStatus } from '../orchestrator/orchestratorLike.js';
import { listAllPendingJobs } from '../orchestrator/printQueueStore.js';

export interface DashboardPrinterStatus {
  groupId: number;
  hostname: string;
  name: string;
  running: boolean;
  mode: 'sleeping' | 'idle' | 'active';
  consecutiveErrors: number;
  lastJobAt: number | null;
  pendingQueueCount: number;
}

/**
 * Reichert `PrintOrchestrator.status()` mit Gruppen-Stammdaten und der Anzahl
 * wartender Retry-Queue-Einträge an. Bei mehreren physischen Beinen (siehe
 * db/schema.ts `printer_groups`) wird die Queue über alle Beine der Gruppe
 * summiert, nicht nur über eines.
 */
export function buildDashboardStatus(db: Db, pollers: OrchestratorPollerStatus[]): DashboardPrinterStatus[] {
  const pendingByPrinter = new Map<number, number>();
  for (const job of listAllPendingJobs(db)) {
    pendingByPrinter.set(job.printerId, (pendingByPrinter.get(job.printerId) ?? 0) + 1);
  }

  return pollers.map((poller) => {
    const group = db.select().from(printerGroups).where(eq(printerGroups.id, poller.groupId)).get();
    const pendingQueueCount = poller.legIds.reduce((sum, id) => sum + (pendingByPrinter.get(id) ?? 0), 0);
    return {
      groupId: poller.groupId,
      hostname: group?.hostname ?? '?',
      name: group?.name ?? '?',
      running: poller.running,
      mode: poller.mode,
      consecutiveErrors: poller.consecutiveErrors,
      lastJobAt: poller.lastJobAt,
      pendingQueueCount,
    };
  });
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', { preHandler: requireAuth }, async () => {
    const status = app.orchestrator.status();
    return { pollers: buildDashboardStatus(app.db, status.pollers) };
  });
}
```

- [ ] **Step 4: Test ausführen, bestätigen dass er besteht**

Run: `cd backend && npx vitest run src/api/dashboard.test.ts`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/dashboard.ts backend/src/api/dashboard.test.ts
git commit -m "refactor: dashboard.ts liest Gruppen-Stammdaten über printer_groups"
```

---

## Task 7: Neue Backend-API (`printerGroups.ts` + schlankes `printers.ts`) + `server.ts`

**Files:**
- Create: `backend/src/api/printerGroups.ts`
- Modify: `backend/src/api/printers.ts` (deutlich schlanker)
- Modify: `backend/src/api/server.ts`
- Test: `backend/src/api/printerGroups.test.ts` (neu)

**Interfaces:**
- Produces: `registerPrinterGroupRoutes(app)` — `GET/POST /api/printer-groups`, `GET/PUT/DELETE /api/printer-groups/:id`, `POST /api/printer-groups/:id/legs`; `registerPrinterRoutes(app)` — `PUT/DELETE /api/printers/:id`.

- [ ] **Step 1: Test für die neue Gruppen-API schreiben**

`backend/src/api/printerGroups.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import type { Env } from '../env.js';
import { labelLayouts, printerGroups, printers } from '../db/schema.js';
import { buildServer } from './server.js';

let app: FastifyInstance;
let db: Db;
let tmpDir: string;
let sessionCookie: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ct-checkin-printer-test-'));
  const env: Env = {
    DB_PATH: path.join(tmpDir, 'test.db'),
    APP_PORT: 0,
    APP_HOST: '127.0.0.1',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(32).toString('base64'),
    LOG_LEVEL: 'error',
  };
  db = createDb(env.DB_PATH);
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../migrations') });

  app = await buildServer(db, env);
  await app.ready();

  const setupRes = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correcthorsebatterystaple' } });
  const cookie = setupRes.cookies.find((c) => c.name === 'sessionId')!;
  sessionCookie = `${cookie.name}=${cookie.value}`;
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  db.delete(labelLayouts).run();
  db.delete(printers).run();
  db.delete(printerGroups).run();
});

function authed(overrides: Record<string, unknown> = {}) {
  return { headers: { cookie: sessionCookie }, ...overrides };
}

describe('POST /api/printer-groups', () => {
  it('creates a single-leg group ("Einzel-Drucker")', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      ...authed(),
      payload: { name: 'Empfang', hostname: 'A1', legs: [{ name: 'Empfang', vendor: 'brother-ql', host: '10.0.0.1' }] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.hostname).toBe('A1');
    expect(body.legs).toHaveLength(1);
  });

  it('creates a multi-leg group ("Router-Drucker") atomically, with a layout assignment inline', async () => {
    const [layout] = db.insert(labelLayouts).values({ name: 'Kind-Etikett', ctTypeKey: 'child' }).returning().all();

    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      ...authed(),
      payload: {
        name: 'Kind',
        hostname: 'B2',
        legs: [
          { name: 'Kind', vendor: 'brother-ql', host: '10.0.0.10', layoutIds: [layout!.id] },
          { name: 'Eltern', vendor: 'zebra-zpl', host: '10.0.0.11' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.legs).toHaveLength(2);

    const updatedLayout = db.select().from(labelLayouts).where(eq(labelLayouts.id, layout!.id)).get();
    expect(updatedLayout!.printerId).toBe(body.legs[0].id);
  });

  it('rejects a duplicate hostname', async () => {
    await app.inject({ method: 'POST', url: '/api/printer-groups', ...authed(), payload: { name: 'A', hostname: 'DUP', legs: [{ name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }] } });
    const res = await app.inject({ method: 'POST', url: '/api/printer-groups', ...authed(), payload: { name: 'B', hostname: 'DUP', legs: [{ name: 'B', vendor: 'brother-ql', host: '10.0.0.2' }] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects zero legs', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/printer-groups', ...authed(), payload: { name: 'A', hostname: 'E1', legs: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a layoutId that is already assigned elsewhere', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'X', hostname: 'X1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'X', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [layout] = db.insert(labelLayouts).values({ name: 'Belegt', ctTypeKey: 'child', printerId: leg!.id }).returning().all();

    const res = await app.inject({
      method: 'POST',
      url: '/api/printer-groups',
      ...authed(),
      payload: { name: 'Y', hostname: 'Y1', legs: [{ name: 'Y', vendor: 'brother-ql', host: '10.0.0.2', layoutIds: [layout!.id] }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/printer-groups', payload: { name: 'A', hostname: 'E2', legs: [{ name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }] } });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/printer-groups', () => {
  it('lists groups with embedded legs', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    const res = await app.inject({ method: 'GET', url: '/api/printer-groups', ...authed() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].legs).toHaveLength(1);
  });
});

describe('GET /api/printer-groups/:id', () => {
  it('includes each leg`s assigned layouts', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    db.insert(labelLayouts).values({ name: 'Kind-Etikett', ctTypeKey: 'child', printerId: leg!.id }).run();

    const res = await app.inject({ method: 'GET', url: `/api/printer-groups/${group!.id}`, ...authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().legs[0].routes).toHaveLength(1);
  });
});

describe('POST /api/printer-groups/:id/legs', () => {
  it('adds a leg to an existing group', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).run();

    const res = await app.inject({ method: 'POST', url: `/api/printer-groups/${group!.id}/legs`, ...authed(), payload: { name: 'B', vendor: 'zebra-zpl', host: '10.0.0.2' } });
    expect(res.statusCode).toBe(201);

    const legs = db.select().from(printers).where(eq(printers.groupId, group!.id)).all();
    expect(legs).toHaveLength(2);
  });
});

describe('DELETE /api/printer-groups/:id', () => {
  it('deletes the group and all its legs, unassigning their layouts', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();
    const [layout] = db.insert(labelLayouts).values({ name: 'X', ctTypeKey: 'child', printerId: leg!.id }).returning().all();

    const res = await app.inject({ method: 'DELETE', url: `/api/printer-groups/${group!.id}`, ...authed() });
    expect(res.statusCode).toBe(200);

    expect(db.select().from(printers).all()).toHaveLength(0);
    expect(db.select().from(printerGroups).all()).toHaveLength(0);
    expect(db.select().from(labelLayouts).all()[0]!.printerId).toBeNull();
  });
});

describe('DELETE /api/printers/:id', () => {
  it('rejects removing the last leg of a group', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    const [leg] = db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).returning().all();

    const res = await app.inject({ method: 'DELETE', url: `/api/printers/${leg!.id}`, ...authed() });
    expect(res.statusCode).toBe(400);
  });

  it('allows removing one of several legs', async () => {
    const [group] = db.insert(printerGroups).values({ name: 'A', hostname: 'A1' }).returning().all();
    db.insert(printers).values({ groupId: group!.id, name: 'A', vendor: 'brother-ql', host: '10.0.0.1' }).run();
    const [legB] = db.insert(printers).values({ groupId: group!.id, name: 'B', vendor: 'zebra-zpl', host: '10.0.0.2' }).returning().all();

    const res = await app.inject({ method: 'DELETE', url: `/api/printers/${legB!.id}`, ...authed() });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Test ausführen, bestätigen dass er fehlschlägt**

Run: `cd backend && npx vitest run src/api/printerGroups.test.ts`
Expected: FAIL (Route existiert noch nicht → 404).

- [ ] **Step 3: `printerGroups.ts` implementieren**

`backend/src/api/printerGroups.ts` (neu):

```ts
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { labelLayouts, printerGroups, printers } from '../db/schema.js';
import { parseActiveTimes } from '../schedule/activeTimes.js';
import { getAlsoLayoutIds } from './labelLayouts.js';

const legInputSchema = z.object({
  name: z.string().min(1),
  vendor: z.enum(['brother-ql', 'zebra-zpl']),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  layoutIds: z.array(z.number()).optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1),
  activeTimesMode: z.enum(['inherit', 'always', 'custom']).optional(),
  activeTimesExpr: z.string().optional(),
  checkEnabled: z.boolean().optional(),
  checkRetryMs: z.number().int().positive().optional(),
  statusWebhookEnabled: z.boolean().optional(),
  legs: z.array(legInputSchema).min(1),
});

const updateGroupSchema = createGroupSchema.omit({ legs: true }).partial();

function validateActiveTimes(mode: string | undefined, expr: string | undefined): string | null {
  if (mode !== 'custom') return null;
  try {
    parseActiveTimes(expr);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Ungültiges Zeitfenster';
  }
}

function legsWithRoutes(app: FastifyInstance, groupId: number) {
  return app.db
    .select()
    .from(printers)
    .where(eq(printers.groupId, groupId))
    .orderBy(asc(printers.id))
    .all()
    .map((leg) => ({
      ...leg,
      routes: app.db
        .select()
        .from(labelLayouts)
        .where(eq(labelLayouts.printerId, leg.id))
        .all()
        .map((route) => ({ ...route, alsoLayoutIds: getAlsoLayoutIds(app, route.id) })),
    }));
}

export async function registerPrinterGroupRoutes(app: FastifyInstance) {
  app.get('/api/printer-groups', { preHandler: requireAuth }, async () => {
    return app.db
      .select()
      .from(printerGroups)
      .all()
      .map((group) => ({
        ...group,
        legs: app.db.select().from(printers).where(eq(printers.groupId, group.id)).orderBy(asc(printers.id)).all(),
      }));
  });

  app.get('/api/printer-groups/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const group = app.db.select().from(printerGroups).where(eq(printerGroups.id, id)).get();
    if (!group) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    return { ...group, legs: legsWithRoutes(app, id) };
  });

  app.post('/api/printer-groups', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createGroupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const scheduleError = validateActiveTimes(parsed.data.activeTimesMode, parsed.data.activeTimesExpr);
    if (scheduleError) return reply.code(400).send({ error: scheduleError });

    const existing = app.db.select().from(printerGroups).where(eq(printerGroups.hostname, parsed.data.hostname)).get();
    if (existing) return reply.code(400).send({ error: `Hostname „${parsed.data.hostname}" wird bereits verwendet` });

    const requestedLayoutIds = parsed.data.legs.flatMap((leg) => leg.layoutIds ?? []);
    if (requestedLayoutIds.length > 0) {
      const foundLayouts = app.db.select().from(labelLayouts).where(inArray(labelLayouts.id, requestedLayoutIds)).all();
      if (foundLayouts.length !== requestedLayoutIds.length) return reply.code(400).send({ error: 'Unbekannte Etiketten-Layout-ID' });
      const alreadyAssigned = foundLayouts.find((l) => l.printerId !== null);
      if (alreadyAssigned) return reply.code(400).send({ error: `Layout "${alreadyAssigned.name}" ist bereits einem Drucker zugeordnet` });
    }

    const { legs, ...groupFields } = parsed.data;
    const [group] = app.db.insert(printerGroups).values(groupFields).returning().all();

    for (const legInput of legs) {
      const { layoutIds, ...legFields } = legInput;
      const [leg] = app.db.insert(printers).values({ ...legFields, groupId: group!.id }).returning().all();
      for (const layoutId of layoutIds ?? []) {
        app.db.update(labelLayouts).set({ printerId: leg!.id }).where(eq(labelLayouts.id, layoutId)).run();
      }
    }

    await app.orchestrator.reload();
    return reply.code(201).send({ ...group, legs: app.db.select().from(printers).where(eq(printers.groupId, group!.id)).orderBy(asc(printers.id)).all() });
  });

  app.post('/api/printer-groups/:id/legs', { preHandler: requireAuth }, async (request, reply) => {
    const groupId = Number((request.params as { id: string }).id);
    const group = app.db.select().from(printerGroups).where(eq(printerGroups.id, groupId)).get();
    if (!group) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    const parsed = legInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const { layoutIds, ...legFields } = parsed.data;
    const [leg] = app.db.insert(printers).values({ ...legFields, groupId }).returning().all();
    for (const layoutId of layoutIds ?? []) {
      app.db.update(labelLayouts).set({ printerId: leg!.id }).where(eq(labelLayouts.id, layoutId)).run();
    }

    await app.orchestrator.reload();
    return reply.code(201).send(leg);
  });

  app.put('/api/printer-groups/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateGroupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(printerGroups).where(eq(printerGroups.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Drucker nicht gefunden' });

    const scheduleError = validateActiveTimes(parsed.data.activeTimesMode ?? existing.activeTimesMode, parsed.data.activeTimesExpr ?? existing.activeTimesExpr ?? undefined);
    if (scheduleError) return reply.code(400).send({ error: scheduleError });

    if (parsed.data.hostname && parsed.data.hostname !== existing.hostname) {
      const conflict = app.db.select().from(printerGroups).where(eq(printerGroups.hostname, parsed.data.hostname)).get();
      if (conflict) return reply.code(400).send({ error: `Hostname „${parsed.data.hostname}" wird bereits verwendet` });
    }

    app.db.update(printerGroups).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(printerGroups.id, id)).run();
    await app.orchestrator.reload();
    return app.db.select().from(printerGroups).where(eq(printerGroups.id, id)).get();
  });

  app.delete('/api/printer-groups/:id', { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    const legIds = app.db.select({ id: printers.id }).from(printers).where(eq(printers.groupId, id)).all().map((row) => row.id);
    if (legIds.length > 0) {
      app.db.update(labelLayouts).set({ printerId: null }).where(inArray(labelLayouts.printerId, legIds)).run();
      app.db.delete(printers).where(eq(printers.groupId, id)).run();
    }
    app.db.delete(printerGroups).where(eq(printerGroups.id, id)).run();
    await app.orchestrator.reload();
    return { ok: true };
  });
}
```

- [ ] **Step 4: `printers.ts` auf reine Bein-Verwaltung reduzieren**

`backend/src/api/printers.ts` komplett ersetzen:

```ts
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { labelLayouts, printers } from '../db/schema.js';

const updateLegSchema = z.object({
  name: z.string().min(1).optional(),
  vendor: z.enum(['brother-ql', 'zebra-zpl']).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  mediaId: z.number().nullable().optional(),
});

export async function registerPrinterRoutes(app: FastifyInstance) {
  app.put('/api/printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateLegSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' });

    const existing = app.db.select().from(printers).where(eq(printers.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Gerät nicht gefunden' });

    app.db.update(printers).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(printers.id, id)).run();
    await app.orchestrator.reload();
    return app.db.select().from(printers).where(eq(printers.id, id)).get();
  });

  app.delete('/api/printers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const existing = app.db.select().from(printers).where(eq(printers.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Gerät nicht gefunden' });

    const siblingCount = app.db.select().from(printers).where(eq(printers.groupId, existing.groupId)).all().length;
    if (siblingCount <= 1) {
      return reply.code(400).send({ error: 'Letztes Gerät einer Gruppe kann nicht einzeln entfernt werden — dazu die ganze Druckergruppe löschen.' });
    }

    app.db.update(labelLayouts).set({ printerId: null }).where(eq(labelLayouts.printerId, id)).run();
    app.db.delete(printers).where(eq(printers.id, id)).run();
    await app.orchestrator.reload();
    return { ok: true };
  });
}
```

- [ ] **Step 5: `server.ts` registrieren**

In `backend/src/api/server.ts`:

```ts
import { registerPrinterGroupRoutes } from './printerGroups.js';
```
(direkt vor oder nach `import { registerPrinterRoutes } from './printers.js';`, alphabetisch einsortieren wie die übrigen Imports.)

Registrierung:
```ts
  await registerPrinterGroupRoutes(app);
  await registerPrinterRoutes(app);
```
(ersetzt die bisherige einzelne `await registerPrinterRoutes(app);`-Zeile — Reihenfolge relativ zu den anderen `register*`-Aufrufen unverändert lassen.)

- [ ] **Step 6: Tests ausführen, bestätigen dass sie bestehen**

Run: `cd backend && npx vitest run src/api/printerGroups.test.ts`
Expected: PASS (alle Fälle).

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/printerGroups.ts backend/src/api/printerGroups.test.ts backend/src/api/printers.ts backend/src/api/server.ts
git commit -m "feat: printer-groups API (Anlegen/Bearbeiten/Löschen von Druckergruppen samt Beinen)"
```

---

## Task 8: `server.test.ts` aktualisieren + Sicherheits-Invarianten-Test

**Files:**
- Modify: `backend/src/api/server.test.ts`
- Test: `backend/src/orchestrator/PrinterPoller.test.ts` (Ergänzung)

**Interfaces:**
- Keine neuen — reine Testanpassung + ein neuer Test.

Die bisherigen `/api/printers`-CRUD-Tests in `server.test.ts` (Erstellen/Duplikat-Hostname/Löschen-hebt-Zuordnung-auf) testen jetzt Funktionalität, die nach `printerGroups.ts` (Task 7) verschoben wurde und dort bereits eigene Tests hat. Sie werden hier entfernt, nicht neu geschrieben — Duplikation vermeiden.

- [ ] **Step 1: Veraltete Printer-CRUD-Tests aus `server.test.ts` entfernen**

In `backend/src/api/server.test.ts` die Tests `'erlaubt mehrere Drucker mit demselben Hostname...'`, `'lehnt ein ungültiges activeTimesExpr ab'` (Payload nutzt `hostname`/`vendor`/`host` auf `/api/printers` — jetzt ungültige Route-Form) und `'hebt beim Löschen die Layout-Zuordnung auf...'` (falls dieser Test `/api/printers` POST nutzt) suchen und entfernen — diese Fälle deckt jetzt `printerGroups.test.ts` ab. Andere Tests in `server.test.ts`, die NICHT `/api/printers` POST/hostname-Validierung betreffen (z.B. Webhook-, Layout-, Font-Tests), bleiben unverändert.

Run: `cd backend && grep -n "url: '/api/printers'" src/api/server.test.ts` — jede Fundstelle einzeln durchgehen und entscheiden: POST auf `/api/printers` → entfernen (Route existiert nicht mehr); andere Methoden auf `/api/printers/:id` (PUT/DELETE) → prüfen ob sie zu einem Test gehören, der noch sinnvoll ist (ggf. auf ein per `printerGroups`+`printers`-Insert vorbereitetes Bein umstellen statt zu entfernen).

- [ ] **Step 2: Volle Testsuite laufen lassen, verbleibende Fehler in `server.test.ts` beheben**

Run: `cd backend && npx vitest run src/api/server.test.ts`
Erwartet zunächst: FAIL an den Stellen, wo `server.test.ts` an anderer Stelle (z.B. Sammelausdruck-Tests, die einen `printerId` brauchen) noch direkt `printers` mit altem Schema anlegt. Jede Fundstelle `db.insert(printers).values({ ..., hostname: ..., ... })` in `server.test.ts` auf das neue Zwei-Tabellen-Muster umstellen (siehe Helper-Muster aus Task 5, Step 2 — `printerGroups` + `printers` einfügen, `hostname` landet auf der Gruppe).

- [ ] **Step 3: Sicherheits-Invarianten-Test schreiben**

An `backend/src/orchestrator/PrinterPoller.test.ts` anhängen (deckt die Spec-Anforderung "physische Geräte nie an ChurchTools übertragen" ab):

```ts
describe('PrinterPoller Sicherheits-Invariante: ChurchTools sieht nie physische Gerätedaten', () => {
  it('ruft activatePrinter/hidePrinter ausschliesslich mit Gruppen-Hostname/-Name auf, nie mit einem Bein-Feld', async () => {
    const group: PrinterPollerGroup = { ...BASE_GROUP, activeTimesMode: 'custom', activeTimesExpr: 'Mo:10:05-10:10' };
    const legs: PrinterPollerLeg[] = [
      { id: 50, name: 'Geheimes-Gerät-A', vendor: 'brother-ql', host: '10.0.0.50', port: 9100 },
      { id: 51, name: 'Geheimes-Gerät-B', vendor: 'zebra-zpl', host: '10.0.0.51', port: 9100 },
    ];
    const client = fakeClient();
    const poller = new PrinterPoller({ db, env, group, legs, client, pipeline: fakePipeline(), adapters: fakeAdapters(), config: DEFAULT_APP_CONFIG });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date('2026-01-05T10:05:30'));
    await vi.advanceTimersByTimeAsync(30_000);
    vi.setSystemTime(new Date('2026-01-05T10:10:30'));
    await vi.advanceTimersByTimeAsync(DEFAULT_APP_CONFIG.pollIdleMs);

    // Jeder Aufruf an den ChurchTools-Client trägt ausschliesslich Gruppen-Werte.
    for (const call of client.activatePrinter.mock.calls) {
      expect(call).toEqual([group.hostname, group.name]);
      for (const leg of legs) {
        expect(call).not.toContain(leg.host);
        expect(call).not.toContain(leg.name === group.name ? '__never__' : leg.name);
      }
    }
    for (const call of client.hidePrinter.mock.calls) {
      expect(call).toEqual([group.hostname]);
    }
    for (const call of client.getNextPrinterJob.mock.calls) {
      expect(call).toEqual([group.hostname]);
    }

    poller.stop();
  });
});
```

- [ ] **Step 4: Alle Backend-Tests + Typecheck laufen lassen**

Run: `cd backend && npm run typecheck && npx vitest run`
Expected: PASS, 0 Fehler.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/server.test.ts backend/src/orchestrator/PrinterPoller.test.ts
git commit -m "test: Drucker-Tests auf printer_groups umgestellt, Sicherheits-Invariante abgesichert"
```

---

## Task 9: Frontend `types.ts` aktualisieren

**Files:**
- Modify: `frontend/src/types.ts`

**Interfaces:**
- Produces: `PrinterLeg`, `PrinterLegWithRoutes`, `PrinterGroup`, `PrinterGroupDetail` (ersetzen `Printer`, `PrinterDetail`); `DashboardPrinterStatus.groupId` (ersetzt `.printerId`).

- [ ] **Step 1: Typen ersetzen**

In `frontend/src/types.ts` `Printer` und `PrinterDetail` entfernen, ersetzen durch:

```ts
export interface PrinterLeg {
  id: number;
  groupId: number;
  name: string;
  vendor: Vendor;
  host: string;
  port: number;
  mediaId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterLegWithRoutes extends PrinterLeg {
  routes: LabelLayoutWithAlso[];
}

export interface PrinterGroup {
  id: number;
  hostname: string;
  name: string;
  activeTimesMode: ActiveTimesMode;
  activeTimesExpr: string | null;
  checkEnabled: boolean;
  checkRetryMs: number;
  statusWebhookEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  legs: PrinterLeg[];
}

export interface PrinterGroupDetail extends Omit<PrinterGroup, 'legs'> {
  legs: PrinterLegWithRoutes[];
}
```

`DashboardPrinterStatus` anpassen: Feld `printerId: number;` → `groupId: number;`.

- [ ] **Step 2: Typecheck laufen lassen (erwartet: Fehler in PrinterList.tsx/PrinterDetail.tsx/Dashboard.tsx)**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: FAIL — `Printer`/`PrinterDetail` nicht mehr gefunden in `PrinterList.tsx`, `PrinterDetail.tsx`; `printerId` nicht mehr auf `DashboardPrinterStatus` in `Dashboard.tsx`. Das ist erwartet, wird in den folgenden Tasks behoben.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "refactor: Frontend-Typen auf PrinterGroup/PrinterLeg umgestellt"
```

---

## Task 10: Frontend Anlege-Assistent (`/printers/new`)

**Files:**
- Create: `frontend/src/pages/PrinterCreate.tsx`

**Interfaces:**
- Consumes: `api.get<LabelLayout[]>('/api/label-layouts')`, `api.post<PrinterGroup>('/api/printer-groups', {...})` (Task 7)
- Produces: `PrinterCreate` React-Komponente

- [ ] **Step 1: Komponente schreiben**

`frontend/src/pages/PrinterCreate.tsx` (neu):

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { LabelLayout, PrinterGroup, Vendor } from '../types.js';

type Mode = 'single' | 'router';

interface LegForm {
  name: string;
  vendor: Vendor;
  host: string;
  layoutId: number | '';
}

const EMPTY_LEG: LegForm = { name: '', vendor: 'brother-ql', host: '', layoutId: '' };

export function PrinterCreate() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode | null>(null);
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [legs, setLegs] = useState<LegForm[]>([{ ...EMPTY_LEG }]);
  const [unassignedLayouts, setUnassignedLayouts] = useState<LabelLayout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<LabelLayout[]>('/api/label-layouts').then((all) => setUnassignedLayouts(all.filter((l) => l.printerId === null)));
  }, []);

  function chooseMode(next: Mode) {
    setMode(next);
    setLegs(next === 'single' ? [{ ...EMPTY_LEG }] : [{ ...EMPTY_LEG }, { ...EMPTY_LEG }]);
  }

  function updateLeg(index: number, patch: Partial<LegForm>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const legsPayload =
        mode === 'single'
          ? [{ name, vendor: legs[0]!.vendor, host: legs[0]!.host, layoutIds: legs[0]!.layoutId ? [legs[0]!.layoutId] : undefined }]
          : legs.map((leg) => ({ name: leg.name, vendor: leg.vendor, host: leg.host, layoutIds: leg.layoutId ? [leg.layoutId] : undefined }));
      const created = await api.post<PrinterGroup>('/api/printer-groups', { name, hostname, legs: legsPayload });
      navigate(`/printers/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (!mode) {
    return (
      <div className="page">
        <div className="topbar">
          <h1>Neuer Drucker</h1>
        </div>
        <div style={{ padding: '1.5rem', display: 'flex', gap: '1rem', maxWidth: 720 }}>
          <button type="button" className="panel" style={{ flex: 1, padding: '1.5rem', textAlign: 'left', cursor: 'pointer' }} onClick={() => chooseMode('single')}>
            <strong>Einzel-Drucker</strong>
            <p className="hint" style={{ marginBottom: 0 }}>
              Ein ChurchTools-Ort, ein physisches Gerät.
            </p>
          </button>
          <button type="button" className="panel" style={{ flex: 1, padding: '1.5rem', textAlign: 'left', cursor: 'pointer' }} onClick={() => chooseMode('router')}>
            <strong>Router-Drucker</strong>
            <p className="hint" style={{ marginBottom: 0 }}>
              Ein ChurchTools-Ort, mehrere physische Geräte — je Etikettentyp ein eigenes Gerät.
            </p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <button type="button" className="topbar-back" onClick={() => setMode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>
          ← Zurück
        </button>
        <h1>{mode === 'single' ? 'Einzel-Drucker anlegen' : 'Router-Drucker anlegen'}</h1>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: '1.5rem', maxWidth: 720 }}>
        <div className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div className="field-row">
            <div className="field">
              <label>Name (Anzeigename)</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Minis" required autoFocus />
            </div>
            <div className="field">
              <label>Hostname (technisch, in ChurchTools sichtbar)</label>
              <input type="text" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="z.B. B2" required />
            </div>
          </div>
        </div>

        {mode === 'single' ? (
          <div className="panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="field-row">
              <div className="field">
                <label>Druckertyp</label>
                <select value={legs[0]!.vendor} onChange={(e) => updateLeg(0, { vendor: e.target.value as Vendor })}>
                  <option value="brother-ql">Brother QL</option>
                  <option value="zebra-zpl">Zebra (ZPL)</option>
                </select>
              </div>
              <div className="field">
                <label>Netzwerkadresse (IP)</label>
                <input type="text" value={legs[0]!.host} onChange={(e) => updateLeg(0, { host: e.target.value })} placeholder="192.168.1.50" required />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Etiketten-Layout zuordnen (optional)</label>
              <select value={legs[0]!.layoutId} onChange={(e) => updateLeg(0, { layoutId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Später zuordnen</option>
                {unassignedLayouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.ctTypeKey})
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            {legs.map((leg, i) => (
              <div className="panel" key={i} style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>Gerät {i + 1}</strong>
                  {legs.length > 2 && (
                    <button type="button" className="btn btn-danger" onClick={() => setLegs((prev) => prev.filter((_, idx) => idx !== i))}>
                      − Entfernen
                    </button>
                  )}
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Name</label>
                    <input type="text" value={leg.name} onChange={(e) => updateLeg(i, { name: e.target.value })} placeholder="z.B. Kind" required />
                  </div>
                  <div className="field">
                    <label>Druckertyp</label>
                    <select value={leg.vendor} onChange={(e) => updateLeg(i, { vendor: e.target.value as Vendor })}>
                      <option value="brother-ql">Brother QL</option>
                      <option value="zebra-zpl">Zebra (ZPL)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Netzwerkadresse (IP)</label>
                    <input type="text" value={leg.host} onChange={(e) => updateLeg(i, { host: e.target.value })} placeholder="192.168.1.50" required />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Etiketten-Layout zuordnen (optional)</label>
                  <select value={leg.layoutId} onChange={(e) => updateLeg(i, { layoutId: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Später zuordnen</option>
                    {unassignedLayouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.ctTypeKey})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setLegs((prev) => [...prev, { ...EMPTY_LEG }])} style={{ marginBottom: '1.5rem' }}>
              + Weiteres Gerät
            </button>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Legt an…' : 'Anlegen'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck für diese Datei laufen lassen**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep PrinterCreate`
Expected: keine Ausgabe (keine Fehler in dieser Datei — Fehler in `PrinterList.tsx`/`PrinterDetail.tsx` bestehen zu diesem Zeitpunkt noch, das ist erwartet, siehe Task 9 Step 2).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PrinterCreate.tsx
git commit -m "feat: Anlege-Assistent für Drucker (Einzel-/Router-Drucker-Wahl)"
```

---

## Task 11: Frontend `PrinterList.tsx` auf Gruppen umbauen

**Files:**
- Modify: `frontend/src/pages/PrinterList.tsx`

**Interfaces:**
- Consumes: `api.get<PrinterGroup[]>('/api/printer-groups')` (Task 7), `PrinterGroup` (Task 9)

- [ ] **Step 1: Komponente ersetzen**

`frontend/src/pages/PrinterList.tsx` komplett ersetzen (Inline-Anlage-Formular entfällt zugunsten des Assistenten aus Task 10):

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { PrinterGroup } from '../types.js';

export function PrinterList() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<PrinterGroup[] | null>(null);

  async function load() {
    setGroups(await api.get<PrinterGroup[]>('/api/printer-groups'));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page">
      <div className="topbar">
        <h1>Drucker</h1>
        <button className="btn btn-primary" onClick={() => navigate('/printers/new')}>
          Neuer Drucker
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 900 }}>
        {groups === null ? (
          <p className="hint">Lädt…</p>
        ) : groups.length === 0 ? (
          <p className="hint">Noch keine Drucker angelegt.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hostname</th>
                <th>Typ</th>
                <th>Geräte</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="clickable" onClick={() => navigate(`/printers/${group.id}`)}>
                  <td>{group.name}</td>
                  <td className="mono">{group.hostname}</td>
                  <td>{group.legs.length <= 1 ? 'Einzel' : `Router (${group.legs.length} Geräte)`}</td>
                  <td className="hint">{group.legs.map((leg) => `${leg.name} (${leg.vendor === 'brother-ql' ? 'Brother' : 'Zebra'})`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck für diese Datei laufen lassen**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep PrinterList`
Expected: keine Ausgabe.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PrinterList.tsx
git commit -m "refactor: Druckerliste zeigt Druckergruppen statt einzelner Zeilen"
```

---

## Task 12: Frontend `PrinterDetail.tsx` auf Gruppe+Beine umbauen

**Files:**
- Modify: `frontend/src/pages/PrinterDetail.tsx`

**Interfaces:**
- Consumes: `api.get<PrinterGroupDetail>('/api/printer-groups/:id')`, `api.put('/api/printer-groups/:id', ...)`, `api.post('/api/printer-groups/:id/legs', ...)`, `api.put('/api/printers/:id', ...)`, `api.delete('/api/printers/:id')`, `api.delete('/api/printer-groups/:id')` (Task 7)

- [ ] **Step 1: Komponente ersetzen**

`frontend/src/pages/PrinterDetail.tsx` komplett ersetzen:

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import type { ActiveTimesMode, LabelLayout, LabelLayoutWithAlso, MediaType, PrinterGroupDetail, PrinterLegWithRoutes, Vendor } from '../types.js';

export function PrinterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<PrinterGroupDetail | null>(null);
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>([]);
  const [allLayouts, setAllLayouts] = useState<LabelLayout[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [groupRes, mediaRes, layoutsRes] = await Promise.all([
      api.get<PrinterGroupDetail>(`/api/printer-groups/${id}`),
      api.get<MediaType[]>('/api/media-types'),
      api.get<LabelLayout[]>('/api/label-layouts'),
    ]);
    setGroup(groupRes);
    setMediaTypes(mediaRes);
    setAllLayouts(layoutsRes);
  }

  useEffect(() => {
    load();
  }, [id]);

  function updateGroupField<K extends keyof PrinterGroupDetail>(key: K, value: PrinterGroupDetail[K]) {
    setGroup((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSaveGroup() {
    if (!group) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put(`/api/printer-groups/${id}`, {
        name: group.name,
        hostname: group.hostname,
        checkEnabled: group.checkEnabled,
        checkRetryMs: group.checkRetryMs,
        statusWebhookEnabled: group.statusWebhookEnabled,
        activeTimesMode: group.activeTimesMode,
        activeTimesExpr: group.activeTimesExpr ?? undefined,
      });
      setMessage('Gespeichert.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGroup() {
    await api.delete(`/api/printer-groups/${id}`);
    navigate('/printers');
  }

  async function updateLeg(legId: number, patch: { name?: string; vendor?: Vendor; host?: string; port?: number; mediaId?: number | null }) {
    await api.put(`/api/printers/${legId}`, patch);
    await load();
  }

  async function removeLeg(legId: number) {
    await api.delete(`/api/printers/${legId}`);
    await load();
  }

  async function addLeg() {
    await api.post(`/api/printer-groups/${id}/legs`, { name: 'Neues Gerät', vendor: 'brother-ql', host: '0.0.0.0' });
    await load();
  }

  async function assignLayout(legId: number, layoutId: number) {
    await api.put(`/api/label-layouts/${layoutId}`, { printerId: legId });
    await load();
  }

  async function unassignLayout(layoutId: number) {
    await api.put(`/api/label-layouts/${layoutId}`, { printerId: null });
    await load();
  }

  async function toggleAlso(layout: LabelLayoutWithAlso, alsoLayoutId: number, checked: boolean) {
    const next = checked ? [...layout.alsoLayoutIds, alsoLayoutId] : layout.alsoLayoutIds.filter((x) => x !== alsoLayoutId);
    await api.put(`/api/label-layouts/${layout.id}`, { alsoLayoutIds: next });
    await load();
  }

  if (!group) return null;

  const unassignedLayouts = allLayouts.filter((l) => l.printerId === null);

  return (
    <div className="page">
      <div className="topbar">
        <Link to="/printers" className="topbar-back">
          ← Drucker
        </Link>
        <h1>{group.name}</h1>
        {message && <span className="hint">{message}</span>}
        <button className="btn btn-primary" onClick={handleSaveGroup} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 780, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <section className="panel" style={{ padding: '1.25rem' }}>
          <p className="hint" style={{ marginTop: 0 }}>Gilt für alle Geräte dieser Druckergruppe.</p>
          <div className="field-row">
            <div className="field">
              <label>Name (Anzeigename)</label>
              <input type="text" value={group.name} onChange={(e) => updateGroupField('name', e.target.value)} />
            </div>
            <div className="field">
              <label>Hostname</label>
              <input type="text" value={group.hostname} onChange={(e) => updateGroupField('hostname', e.target.value)} />
            </div>
          </div>

          <div className="checkbox-field">
            <input id="check-enabled" type="checkbox" checked={group.checkEnabled} onChange={(e) => updateGroupField('checkEnabled', e.target.checked)} />
            <label htmlFor="check-enabled">Drucker-Check vor Anmeldung (Band leer, Deckel offen etc.)</label>
          </div>
          <div className="checkbox-field">
            <input id="status-webhook" type="checkbox" checked={group.statusWebhookEnabled} onChange={(e) => updateGroupField('statusWebhookEnabled', e.target.checked)} />
            <label htmlFor="status-webhook">Status-Webhooks für diese Gruppe senden</label>
          </div>

          <div className="field">
            <label>Zeitfenster</label>
            <select value={group.activeTimesMode} onChange={(e) => updateGroupField('activeTimesMode', e.target.value as ActiveTimesMode)}>
              <option value="inherit">Globales Zeitfenster übernehmen</option>
              <option value="always">Immer aktiv</option>
              <option value="custom">Eigenes Zeitfenster</option>
            </select>
          </div>
          {group.activeTimesMode === 'custom' && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Zeitfenster-Ausdruck</label>
              <input
                type="text"
                className="mono"
                value={group.activeTimesExpr ?? ''}
                onChange={(e) => updateGroupField('activeTimesExpr', e.target.value)}
                placeholder="So:09:00-12:00"
              />
              <span className="hint">Format: „Mo-Fr:08:00-17:00,So:09:00-12:00" — mehrere Fenster pro Tag mit Leerzeichen trennen.</span>
            </div>
          )}
        </section>

        <section className="panel" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '0.9rem', marginTop: 0 }}>Geräte</h2>
          {group.legs.map((leg) => (
            <LegCard
              key={leg.id}
              leg={leg}
              mediaTypes={mediaTypes}
              allLayouts={allLayouts}
              unassignedLayouts={unassignedLayouts}
              canRemove={group.legs.length > 1}
              onUpdate={(patch) => updateLeg(leg.id, patch)}
              onRemove={() => removeLeg(leg.id)}
              onAssignLayout={(layoutId) => assignLayout(leg.id, layoutId)}
              onUnassignLayout={unassignLayout}
              onToggleAlso={toggleAlso}
            />
          ))}
          <button className="btn" onClick={addLeg}>
            + Weiteres Gerät hinzufügen
          </button>
        </section>

        <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={handleDeleteGroup}>
          Ganze Druckergruppe löschen
        </button>
      </div>
    </div>
  );
}

interface LegCardProps {
  leg: PrinterLegWithRoutes;
  mediaTypes: MediaType[];
  allLayouts: LabelLayout[];
  unassignedLayouts: LabelLayout[];
  canRemove: boolean;
  onUpdate: (patch: { name?: string; vendor?: Vendor; host?: string; port?: number; mediaId?: number | null }) => void;
  onRemove: () => void;
  onAssignLayout: (layoutId: number) => void;
  onUnassignLayout: (layoutId: number) => void;
  onToggleAlso: (layout: LabelLayoutWithAlso, alsoLayoutId: number, checked: boolean) => void;
}

function LegCard({ leg, mediaTypes, allLayouts, unassignedLayouts, canRemove, onUpdate, onRemove, onAssignLayout, onUnassignLayout, onToggleAlso }: LegCardProps) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.85rem' }}>{leg.name}</strong>
        {canRemove && (
          <button className="btn btn-danger" onClick={onRemove}>
            Gerät entfernen
          </button>
        )}
      </div>
      <div className="field-row">
        <div className="field">
          <label>Name</label>
          <input type="text" value={leg.name} onChange={(e) => onUpdate({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>Hersteller</label>
          <select value={leg.vendor} onChange={(e) => onUpdate({ vendor: e.target.value as Vendor })}>
            <option value="brother-ql">Brother QL</option>
            <option value="zebra-zpl">Zebra (ZPL)</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Netzwerkadresse (IP)</label>
          <input type="text" value={leg.host} onChange={(e) => onUpdate({ host: e.target.value })} />
        </div>
        <div className="field">
          <label>Port</label>
          <input type="number" value={leg.port} onChange={(e) => onUpdate({ port: Number(e.target.value) })} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: '0.75rem' }}>
        <label>Etikettengrösse (Standard, falls nicht automatisch erkannt)</label>
        <select value={leg.mediaId ?? ''} onChange={(e) => onUpdate({ mediaId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Automatisch erkennen</option>
          {mediaTypes
            .filter((m) => m.vendor === leg.vendor)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </div>

      {leg.routes.length === 0 ? (
        <p className="hint">Noch keine Layouts zugeordnet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {leg.routes.map((route) => (
            <li key={route.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Link to={`/layouts/${route.id}`}>{route.name}</Link> <span className="mono hint">({route.ctTypeKey})</span>
                </div>
                <button className="btn btn-danger" onClick={() => onUnassignLayout(route.id)}>
                  Zuordnung aufheben
                </button>
              </div>
              <div style={{ marginTop: '0.3rem' }}>
                <span className="hint">Auch drucken: </span>
                {allLayouts
                  .filter((l) => l.id !== route.id)
                  .map((l) => (
                    <label key={l.id} style={{ marginRight: '0.75rem', fontSize: '0.8rem' }}>
                      <input type="checkbox" checked={route.alsoLayoutIds.includes(l.id)} onChange={(e) => onToggleAlso(route, l.id, e.target.checked)} /> {l.name}
                    </label>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {unassignedLayouts.length > 0 && (
        <div className="field" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          <label>Bestehendes Layout zuordnen</label>
          <select value="" onChange={(e) => e.target.value && onAssignLayout(Number(e.target.value))}>
            <option value="">Bitte wählen</option>
            {unassignedLayouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck für diese Datei laufen lassen**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep PrinterDetail`
Expected: keine Ausgabe.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PrinterDetail.tsx
git commit -m "refactor: Drucker-Detailansicht zeigt Gruppen-Einstellungen + Geräte-Karten"
```

---

## Task 13: Routing verdrahten, README aktualisieren, volle Verifikation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `README.md`

**Interfaces:**
- Keine neuen — Verdrahtung + Doku + Endverifikation.

- [ ] **Step 1: Route für den Assistenten ergänzen**

In `frontend/src/App.tsx`:

```ts
import { PrinterCreate } from './pages/PrinterCreate.js';
```

Route VOR `<Route path="/printers/:id" .../>` einfügen (sonst würde `:id` fälschlich `"new"` matchen):
```tsx
        <Route path="/printers/new" element={<PrinterCreate />} />
        <Route path="/printers/:id" element={<PrinterDetail />} />
```

- [ ] **Step 2: Volle Typecheck-Läufe (Backend + Frontend)**

Run: `cd backend && npm run typecheck`
Expected: 0 Fehler.

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 0 Fehler.

- [ ] **Step 3: Volle Backend-Testsuite**

Run: `cd backend && npx vitest run`
Expected: alle Tests grün.

- [ ] **Step 4: Frontend bauen**

Run: `cd frontend && npm run build`
Expected: Build erfolgreich.

- [ ] **Step 5: Live-Boot-Test — kompletten Flow gegen einen echten Server durchspielen**

Frischen Test-Server starten (neue temporäre DB, `ENCRYPTION_KEY`/`SESSION_SECRET` per `openssl rand -base64 32`, `npx tsx src/db/migrate.ts` dann `npx tsx src/index.ts`), danach per curl:

1. `POST /api/auth/setup` (Admin anlegen).
2. `POST /api/printer-groups` mit `legs: [{...}, {...}]` (Router-Drucker, zwei Beine, wie im Task-7-Test) — erwartet `201` mit zwei eingebetteten `legs`.
3. `GET /api/printer-groups` — erwartet eine Gruppe mit zwei Beinen.
4. `POST /api/webhooks/incoming` + `POST /api/webhooks/in/:token` mit `{"hostname": "<gewählter Hostname>", "data": "name=X\nid=1\ncode=AB\ntype=<typA>"}` und danach `type=<typB>` — erwartet, dass die beiden Check-ins (per zuvor angelegter, den Beinen zugeordneter Layouts) an ihrem jeweiligen physischen Bein landen (prüfbar über `print_queue`/`print_log`-Einträge mit dem jeweils korrekten `printer_id`, analog zur Verifikation, die bereits für den ursprünglichen Hostname-Sharing-Fix in dieser Session durchgeführt wurde).
5. `DELETE /api/printers/:legId` auf das letzte verbleibende Bein einer frisch angelegten Einzel-Drucker-Gruppe — erwartet `400`.
6. `GET /api/dashboard` — erwartet einen Eintrag mit `groupId`, korrektem `hostname`/`name` der Gruppe.

Alle 6 Punkte müssen wie beschrieben antworten. Bei Abweichungen: root cause im jeweils zuständigen Task beheben, nicht hier symptomatisch flicken.

- [ ] **Step 6: README aktualisieren**

In `README.md`:
- Abschnitt "Ersteinrichtung im Web-GUI", Punkt 3 ("Drucker anlegen"): ergänzen, dass beim Anlegen zwischen Einzel- und Router-Drucker gewählt wird und ein Router-Drucker mehrere physische Geräte unter einem Hostnamen bündelt (mit Verweis auf die neue Möglichkeit, statt des bisherigen Verweises auf `also[]` als einzigen Mechanismus für "mehrere Drucker pro Check-in").
- Feature-Liste: vorhandenen `also[]`-Punkt unverändert lassen (bleibt bestehen, unabhängiger Mechanismus), neuen Punkt "Router-Drucker" ergänzen, der den Unterschied zu `also[]` kurz erklärt (`also[]` = zusätzlich, Router-Drucker = alternativ je Typ).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx README.md
git commit -m "feat: Anlege-Assistent verdrahtet, README auf Druckergruppen aktualisiert"
```

---

## Self-Review-Notizen (für den nächsten Bearbeiter)

- Spec-Abdeckung: alle Abschnitte der Spec (Datenmodell, Migration, Backend-API, Orchestrator, Frontend-Assistent, Liste/Detail, Sicherheits-Invariante) haben einen zugehörigen Task.
- `SummaryReportService.ts` und `printerSchedule.ts` brauchen laut Analyse in diesem Plan **keine** Änderung (sie lesen nur Felder, die auf der jeweils richtigen Tabelle bleiben) — nach Task 1 den Typecheck trotzdem beobachten, falls diese Analyse eine Stelle übersehen hat.
- `AdapterRegistry`/`adapterRegistry.ts` braucht keine Änderung — `AdapterRegistryPrinter` (`id, vendor, name, host, port`) ist bereits deckungsgleich mit dem neuen schlanken `printers`-Schema.
