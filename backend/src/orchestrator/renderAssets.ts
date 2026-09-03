import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/client.js';
import { fonts, logos } from '../db/schema.js';
import { getUploadsDir } from '../storage/uploadsDir.js';

/**
 * Lädt Font-/Logo-Referenzen für `LabelRenderer.renderLabel()` — dieselbe
 * Zuordnung wie in `api/fonts.ts`/`api/logos.ts` (Editor-Vorschau), hier
 * bewusst ohne Fastify-Abhängigkeit (`db`/`DB_PATH` direkt), damit der
 * Orchestrator ohne laufenden Server testbar bleibt.
 */
export function loadFontPaths(db: Db, dbPath: string, fontIds: number[]): Record<number, string> {
  if (fontIds.length === 0) return {};
  const dir = getUploadsDir(dbPath, 'fonts');
  const rows = db.select().from(fonts).all();
  const result: Record<number, string> = {};
  for (const row of rows) {
    if (fontIds.includes(row.id)) result[row.id] = path.join(dir, row.filePath);
  }
  return result;
}

export async function loadLogoBuffers(db: Db, dbPath: string, logoIds: number[]): Promise<Record<number, Buffer>> {
  if (logoIds.length === 0) return {};
  const dir = getUploadsDir(dbPath, 'logos');
  const rows = db.select().from(logos).all();
  const result: Record<number, Buffer> = {};
  for (const row of rows) {
    if (logoIds.includes(row.id)) result[row.id] = await readFile(path.join(dir, row.filePath));
  }
  return result;
}
