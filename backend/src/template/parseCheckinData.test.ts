import { describe, expect, it } from 'vitest';
import { parseCheckinData } from './parseCheckinData.js';

describe('parseCheckinData', () => {
  it('parses all known fields', () => {
    const data = parseCheckinData('name=Max Muster\nid=2693\ncode=ZRYK\ngroup=Kids\ntype=parent');
    expect(data).toEqual({ name: 'Max Muster', id: '2693', code: 'ZRYK', group: 'Kids', type: 'parent', extra: [] });
  });

  it('collects lines with an unknown key into extra', () => {
    const data = parseCheckinData('name=Max\nallergie=Erdnuss');
    expect(data.name).toBe('Max');
    expect(data.extra).toEqual(['allergie=Erdnuss']);
  });

  it('collects lines without a separator into extra', () => {
    const data = parseCheckinData('name=Max\nBitte am Empfang melden');
    expect(data.extra).toEqual(['Bitte am Empfang melden']);
  });

  it('ignores blank lines', () => {
    const data = parseCheckinData('name=Max\n\n\nid=1');
    expect(data.name).toBe('Max');
    expect(data.id).toBe('1');
  });

  it('trims whitespace around keys and values', () => {
    const data = parseCheckinData('name = Max Muster \n id = 123');
    expect(data.name).toBe('Max Muster');
    expect(data.id).toBe('123');
  });

  it('supports a custom separator', () => {
    const data = parseCheckinData('name:Max\nid:123', ':');
    expect(data.name).toBe('Max');
    expect(data.id).toBe('123');
  });

  it('returns null for fields that are not present', () => {
    const data = parseCheckinData('name=Max');
    expect(data.id).toBeNull();
    expect(data.code).toBeNull();
  });

  it('only uses the first occurrence of the separator to split key/value', () => {
    const data = parseCheckinData('code=AB=12');
    expect(data.code).toBe('AB=12');
  });
});
