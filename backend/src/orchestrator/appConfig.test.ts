import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { appConfig } from '../db/schema.js';
import { DEFAULT_APP_CONFIG, loadAppConfig } from './appConfig.js';
import { createTestDb } from './testDb.js';

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterEach(() => cleanup());

describe('loadAppConfig', () => {
  it('returns defaults when app_config is empty', () => {
    expect(loadAppConfig(db)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('overrides individual defaults from stored rows', () => {
    db.insert(appConfig).values({ key: 'poll_idle_ms', value: '20000' }).run();
    db.insert(appConfig).values({ key: 'active_times_default', value: 'Mo-Fr:08:00-17:00' }).run();

    const config = loadAppConfig(db);
    expect(config.pollIdleMs).toBe(20000);
    expect(config.activeTimesDefault).toBe('Mo-Fr:08:00-17:00');
    expect(config.pollActiveMs).toBe(DEFAULT_APP_CONFIG.pollActiveMs);
  });

  it('ignores unparsable numeric overrides and falls back to the default', () => {
    db.insert(appConfig).values({ key: 'max_errors', value: 'not-a-number' }).run();
    expect(loadAppConfig(db).maxErrors).toBe(DEFAULT_APP_CONFIG.maxErrors);
  });
});
