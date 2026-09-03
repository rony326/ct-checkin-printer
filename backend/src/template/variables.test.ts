import { describe, expect, it } from 'vitest';
import type { ParsedCheckinData } from './parseCheckinData.js';
import { buildRenderContext, resolveTextField, type RenderContext } from './variables.js';

const FULL: ParsedCheckinData = { name: 'Max Muster', id: '2693', code: 'ZRYK', group: 'Kids', type: 'parent', extra: ['Allergie: Erdnuss'] };
const EMPTY: ParsedCheckinData = { name: null, id: null, code: null, group: null, type: null, extra: [] };

describe('buildRenderContext', () => {
  it('maps every parsed field into the matching context slot', () => {
    const ctx = buildRenderContext(FULL, 1713355078);
    expect(ctx).toEqual({
      person: { name: 'Max Muster', id: '2693' },
      checkin: { code: 'ZRYK', group: 'Kids', type: 'parent', timestamp: 1713355078, extra: ['Allergie: Erdnuss'] },
    });
  });

  it('falls back to empty strings (never null/undefined) for missing fields, so the renderer never draws "null"', () => {
    const ctx = buildRenderContext(EMPTY, 0);
    expect(ctx.person.name).toBe('');
    expect(ctx.person.id).toBe('');
    expect(ctx.checkin.code).toBe('');
    expect(ctx.checkin.group).toBe('');
    expect(ctx.checkin.type).toBe('');
  });
});

describe('resolveTextField', () => {
  const ctx: RenderContext = buildRenderContext(FULL, 1713355078);
  const emptyCtx: RenderContext = buildRenderContext(EMPTY, 0);

  it.each([
    ['person.name', ['Max Muster']],
    ['person.id', ['2693']],
    ['checkin.code', ['ZRYK']],
    ['checkin.group', ['Kids']],
    ['checkin.type', ['parent']],
    ['checkin.extra', ['Allergie: Erdnuss']],
  ] as const)('resolves %s to %j when present', (field, expected) => {
    expect(resolveTextField(field, ctx)).toEqual(expected);
  });

  it.each(['person.name', 'person.id', 'checkin.code', 'checkin.group', 'checkin.type'] as const)(
    'resolves %s to an empty array (not [""]) when the value is missing',
    (field) => {
      expect(resolveTextField(field, emptyCtx)).toEqual([]);
    },
  );

  it('resolves checkin.extra to an empty array when there are no extra lines', () => {
    expect(resolveTextField('checkin.extra', emptyCtx)).toEqual([]);
  });

  it('resolves checkin.extra to multiple lines, unlike every other field', () => {
    const multiExtra = buildRenderContext({ ...FULL, extra: ['a', 'b', 'c'] }, 0);
    expect(resolveTextField('checkin.extra', multiExtra)).toEqual(['a', 'b', 'c']);
  });
});
