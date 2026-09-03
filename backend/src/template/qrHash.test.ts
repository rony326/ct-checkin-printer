import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeQrHash } from './qrHash.js';

describe('computeQrHash', () => {
  it('matches sha1(id + code + timestamp) with no separators/salt', () => {
    const expected = createHash('sha1').update('2693ZRYK1713355078').digest('hex');
    expect(computeQrHash('2693', 'ZRYK', 1713355078)).toBe(expected);
  });

  it('is sensitive to timestamp (same id/code, different timestamp -> different hash)', () => {
    const a = computeQrHash('1', 'AB12', 1000);
    const b = computeQrHash('1', 'AB12', 1001);
    expect(a).not.toBe(b);
  });

  it('coerces numeric-looking ids/codes the same way as string concatenation', () => {
    // String(id)+String(code) für id=1, code=23 muss "123" ergeben, nicht "1"+"23" verwechselt mit id=12,code=3
    expect(computeQrHash('1', '23', 999)).toBe(computeQrHash('12', '3', 999));
  });
});
