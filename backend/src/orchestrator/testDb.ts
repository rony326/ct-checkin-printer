import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, type Db } from '../db/client.js';

/** Test-Helper: frische, migrierte SQLite-DB in einem Temp-Verzeichnis (siehe api/server.test.ts für das Vorbild). */
export async function createTestDb(): Promise<{ db: Db; cleanup: () => void }> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'ct-checkin-printer-test-'));
  const db = createDb(path.join(tmpDir, 'test.db'));
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../migrations') });
  return { db, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) };
}
