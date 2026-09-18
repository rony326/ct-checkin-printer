import { describe, expect, it } from 'vitest';
import { extractJobTexts, extractMessage, extractStatusCode, isEmptyJobData } from './errorHelpers.js';

describe('extractMessage', () => {
  it('prefers a top-level Error.message', () => {
    expect(extractMessage(new Error('Netzwerkfehler'))).toBe('Netzwerkfehler');
  });

  it('falls back to response.data.message for a logical oldApi error', () => {
    expect(extractMessage({ response: { data: { message: 'Ort nicht gefunden' }, status: 200 } })).toBe('Ort nicht gefunden');
  });

  it('falls back to response.data.translatedMessage', () => {
    expect(extractMessage({ response: { data: { translatedMessage: 'Übersetzt' }, status: 200 } })).toBe('Übersetzt');
  });

  it('falls back to "HTTP <status>" when no message is present', () => {
    expect(extractMessage({ response: { status: 500, data: {} } })).toBe('HTTP 500');
  });

  it('falls back to JSON.stringify for a totally unstructured error', () => {
    expect(extractMessage({ weird: 'shape' })).toBe('{"weird":"shape"}');
  });
});

describe('extractStatusCode', () => {
  it('reads response.status', () => {
    expect(extractStatusCode({ response: { status: 401 } })).toBe(401);
  });

  it('reads a top-level status as fallback', () => {
    expect(extractStatusCode({ status: 404 })).toBe(404);
  });

  it('returns null when no status is present', () => {
    expect(extractStatusCode(new Error('x'))).toBeNull();
  });
});

describe('isEmptyJobData', () => {
  it.each([null, undefined, '', '   ', {}, []])('treats %p as empty', (value) => {
    expect(isEmptyJobData(value)).toBe(true);
  });

  it('treats a non-empty string as non-empty', () => {
    expect(isEmptyJobData('name=Max\nid=123')).toBe(false);
  });

  it('treats a non-empty object as non-empty', () => {
    expect(isEmptyJobData({ id: '123' })).toBe(false);
  });
});

describe('extractJobTexts', () => {
  it.each([null, undefined, '', '   ', {}, []])('returns [] for %p', (value) => {
    expect(extractJobTexts(value)).toEqual([]);
  });

  it('passes a raw string through unchanged', () => {
    expect(extractJobTexts('name=Max\nid=123')).toEqual(['name=Max\nid=123']);
  });

  it('extracts .data from a single job object (the shape CT actually sends)', () => {
    expect(extractJobTexts({ data: 'name=Max\nid=123', ort: 'B2' })).toEqual(['name=Max\nid=123']);
  });

  it('extracts .data from every entry when CT sends an array of job objects', () => {
    expect(extractJobTexts([{ data: 'a=1' }, { data: 'b=2' }])).toEqual(['a=1', 'b=2']);
  });

  it('drops entries whose .data is missing or blank instead of crashing', () => {
    expect(extractJobTexts([{ data: 'a=1' }, { ort: 'no-data-field' }, { data: '   ' }])).toEqual(['a=1']);
  });
});
