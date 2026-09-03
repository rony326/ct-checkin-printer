import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secrets.js';

describe('secrets encryption', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a plaintext value', () => {
    const encrypted = encryptSecret('super-secret-password', key);
    expect(encrypted).not.toContain('super-secret-password');
    expect(decryptSecret(encrypted, key)).toBe('super-secret-password');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-input', key);
    const b = encryptSecret('same-input', key);
    expect(a).not.toBe(b);
  });

  it('rejects a wrong key', () => {
    const encrypted = encryptSecret('secret', key);
    const wrongKey = randomBytes(32).toString('base64');
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('secret', 'dG9vc2hvcnQ=')).toThrow(/32 Bytes/);
  });
});
