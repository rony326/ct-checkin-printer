import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const VALID: NodeJS.ProcessEnv = {
  ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  SESSION_SECRET: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
};

describe('loadEnv', () => {
  it('accepts a minimal valid environment and fills in the documented defaults', () => {
    const env = loadEnv(VALID);
    expect(env).toEqual({
      DB_PATH: './data/app.db',
      APP_PORT: 3000,
      APP_HOST: '0.0.0.0',
      ENCRYPTION_KEY: VALID.ENCRYPTION_KEY,
      SESSION_SECRET: VALID.SESSION_SECRET,
      LOG_LEVEL: 'info',
    });
  });

  it('lets explicit values override the defaults', () => {
    const env = loadEnv({ ...VALID, DB_PATH: '/data/custom.db', APP_PORT: '8080', LOG_LEVEL: 'debug' });
    expect(env.DB_PATH).toBe('/data/custom.db');
    expect(env.APP_PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('throws a helpful, path-labeled error when ENCRYPTION_KEY is missing', () => {
    expect(() => loadEnv({ SESSION_SECRET: VALID.SESSION_SECRET })).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws when LOG_LEVEL is set to an unsupported value', () => {
    expect(() => loadEnv({ ...VALID, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('throws when APP_PORT is not a positive integer', () => {
    expect(() => loadEnv({ ...VALID, APP_PORT: '-1' })).toThrow();
  });
});
