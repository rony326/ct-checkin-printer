import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { fonts, logos } from '../db/schema.js';
import { getUploadsDir } from '../storage/uploadsDir.js';
import { loadFontPaths, loadLogoBuffers } from './renderAssets.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;
let dbPath: string;
let dbDir: string;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  dbDir = mkdtempSync(path.join(tmpdir(), 'ct-checkin-printer-assets-'));
  dbPath = path.join(dbDir, 'app.db');
});

afterEach(() => {
  cleanup();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('loadFontPaths', () => {
  it('maps requested font ids to their absolute file path on disk', () => {
    const fontsDir = getUploadsDir(dbPath, 'fonts');
    writeFileSync(path.join(fontsDir, 'custom.ttf'), 'fake-ttf');
    const [font] = db.insert(fonts).values({ name: 'Custom', filePath: 'custom.ttf' }).returning().all();

    const result = loadFontPaths(db, dbPath, [font!.id]);
    expect(result[font!.id]).toBe(path.join(fontsDir, 'custom.ttf'));
  });

  it('returns an empty object for an empty id list without touching the DB', () => {
    expect(loadFontPaths(db, dbPath, [])).toEqual({});
  });
});

describe('loadLogoBuffers', () => {
  it('reads the requested logo files into buffers keyed by id', async () => {
    const logosDir = getUploadsDir(dbPath, 'logos');
    writeFileSync(path.join(logosDir, 'logo.png'), 'fake-png-bytes');
    const [logo] = db.insert(logos).values({ name: 'Logo', filePath: 'logo.png' }).returning().all();

    const result = await loadLogoBuffers(db, dbPath, [logo!.id]);
    expect(result[logo!.id]?.toString()).toBe('fake-png-bytes');
  });
});
