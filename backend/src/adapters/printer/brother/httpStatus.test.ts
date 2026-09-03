import { describe, expect, it } from 'vitest';
import { parseWebStatus } from './httpStatus.js';

describe('parseWebStatus', () => {
  it('parses a ready/ok status', () => {
    const html = '<dt class="moni moniOk">Status</dt><dd>Ready</dd>';
    const { errors, warnings } = parseWebStatus(html);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('detects "Cover Open" via the moniError class', () => {
    const html = '<span class="moni moniError">Cover Open</span>';
    const { errors, errorKeys } = parseWebStatus(html);
    expect(errorKeys).toContain('COVER OPEN');
    expect(errors).toContain('Deckel offen');
  });

  it('detects "No Media" via the moniError class', () => {
    const html = '<span class="moni moniError">No Media</span>';
    const { errorKeys } = parseWebStatus(html);
    expect(errorKeys).toContain('NO MEDIA');
  });

  it('detects end-of-media via the Media Status dt/dd pair', () => {
    const html = '<dt>Media&#32;Status</dt><dd>Empty</dd>';
    const { errorKeys, info } = parseWebStatus(html);
    expect(errorKeys).toContain('END OF MEDIA');
    expect(info.mediaStatus).toBe('Empty');
  });

  it('falls back to a keyword scan when the moni-class regex does not match', () => {
    const html = '<div>Some unexpected markup mentioning CUTTER JAM somewhere</div>';
    const { errorKeys } = parseWebStatus(html);
    expect(errorKeys).toContain('CUTTER JAM');
  });

  it('treats an unrecognized moniError text as a generic error', () => {
    const html = '<span class="moni moniError">Something Else Entirely</span>';
    const { errors } = parseWebStatus(html);
    expect(errors[0]).toContain('Gerätestatus');
  });

  it('extracts media type and emulation info', () => {
    const html = '<dt>Media&#32;Type</dt><dd>Continuous Length Tape</dd><dt>Emulation</dt><dd>ESC/P</dd>';
    const { info } = parseWebStatus(html);
    expect(info.mediaType).toBe('Continuous Length Tape');
    expect(info.emulation).toBe('ESC/P');
  });

  it('reports a warning without an error for moniWarning', () => {
    const html = '<span class="moni moniWarning">Low Battery</span>';
    const { errors, warnings } = parseWebStatus(html);
    expect(errors).toEqual([]);
    expect(warnings[0]).toContain('Low Battery');
  });
});
