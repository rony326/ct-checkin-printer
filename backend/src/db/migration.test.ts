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
    // `hostname` wird hier bewusst NICHT selektiert — die Spalte existiert nach der Migration
    // nicht mehr auf `printers` (SQLite würfe bei "SELECT hostname" sonst "no such column").
    const printers = after.prepare('SELECT id, group_id, name FROM printers ORDER BY id').all() as Array<{ id: number; group_id: number; name: string }>;
    // Zusatzabsicherung, dass die Spalte wirklich weg ist (statt nur ungenutzt in obigem SELECT).
    const printersColumns = (after.prepare('PRAGMA table_info(printers)').all() as Array<{ name: string }>).map((c) => c.name);
    after.close();

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: 1, hostname: 'A1', name: 'Empfang' });
    expect(groups[1]).toMatchObject({ id: 2, hostname: 'B2', name: 'Kind' }); // primäres (niedrigste id) Bein liefert die Gruppen-Werte

    expect(printers).toEqual([
      { id: 1, group_id: 1, name: 'Empfang' },
      { id: 2, group_id: 2, name: 'Kind' },
      { id: 3, group_id: 2, name: 'Eltern' },
    ]);

    expect(printersColumns).not.toContain('hostname');
  });
});
