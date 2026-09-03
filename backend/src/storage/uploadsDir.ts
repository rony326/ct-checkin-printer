import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type UploadKind = 'fonts' | 'logos';

/** Uploads liegen neben der SQLite-Datei (`<DB_PATH-Verzeichnis>/uploads/...`), damit ein einzelnes Volume-Mount im Docker-Setup beides sichert. */
export function getUploadsDir(dbPath: string, kind: UploadKind): string {
  const dir = path.join(path.dirname(dbPath), 'uploads', kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}
