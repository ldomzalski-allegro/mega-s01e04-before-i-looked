import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { readNight } from '../src/digest/reader.js';
import type { ReadNight } from '../src/digest/types.js';

vi.mock('node:fs', { spy: true });

const night = '2026-10-28';
const valid = { at: '2026-10-29T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' };
const event = (changes: Record<string, unknown> = {}) => JSON.stringify({ ...valid, ...changes });
let runsDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(runsDir, { recursive: true, force: true });
});

function write(content: string, date = night): void {
  writeFileSync(join(runsDir, `${date}.jsonl`), content);
}

describe('readNight', () => {
  it('implements the synchronous shared signature', () => {
    const reader: ReadNight = readNight;
    expect(reader(runsDir, night)).toBeNull();
  });

  it('reads the supplied fixture without changing its timestamps or dropping null owners', () => {
    const result = readNight('runs', night);
    expect(result).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('distinguishes missing files and directories from existing empty and bad-only files', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
    write('');
    const empty = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
    expect(readNight(runsDir, night)).toEqual(empty);
    write('\n \t\r\n\n');
    expect(readNight(runsDir, night)).toEqual(empty);
    write('null\n{broken\n');
    expect(readNight(runsDir, night)).toEqual({ ...empty, badLines: 2 });
  });

  it('keeps valid events on either side of bad lines and accepts CRLF and no final newline', () => {
    write([event(), '', '{broken', event({ status: 'retry', error: 'busy' }), '[]', event()].join('\r\n'));
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 2,
      counts: { ok: 2, retry: 1, fail: 0 },
      rows: [{ runs: 3, retries: 1, lastStatus: 'ok', lastError: 'busy' }],
    });
  });

  it('uses chronological instants rather than file order or timestamp string order', () => {
    const latest = '2026-10-29T02:00:00+01:00';
    const earliest = '2026-10-29T02:30:00+02:00';
    write([
      event({ at: latest, owner: null }),
      event({ at: '2026-10-29T00:45:00Z', status: 'retry', error: ' busy ' }),
      event({ at: earliest, status: 'fail', owner: 'old', error: 'old error' }),
    ].join('\n'));
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: valid.job, owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: ' busy ',
      firstAt: earliest, lastAt: latest,
    }]);
  });

  it('breaks equal-instant ties by file order and retains the latest nonempty error after recovery', () => {
    write([
      event({ at: '2026-10-29T01:00:00+01:00', status: 'fail', error: 'first' }),
      event({ at: '2026-10-29T00:00:00Z', status: 'retry', error: ' last error ' }),
      event({ at: '2026-10-29T00:00:00.000Z', owner: null, error: '' }),
      event({ at: '2026-10-29T00:00:00Z', owner: null, error: ' \t ' }),
    ].join('\n'));
    expect(readNight(runsDir, night)).toMatchObject({
      counts: { ok: 2, retry: 1, fail: 1 },
      rows: [{
        owner: null, runs: 4, retries: 1, lastStatus: 'ok', lastError: ' last error ',
        firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T00:00:00Z',
      }],
    });
  });

  it('compares arbitrary fractional precision without millisecond rounding', () => {
    const earliest = '2026-10-29T01:00:00.0000001+01:00';
    const latest = '2026-10-29T01:00:00.0000002+01:00';
    write([
      event({ at: latest, error: 'latest' }),
      event({ at: earliest, status: 'retry', error: 'older' }),
      event({ at: '2026-10-29T01:00:00.0000001000+01:00', status: 'fail', error: 'tied earliest' }),
    ].join('\n'));
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({
      firstAt: earliest, lastAt: latest, lastStatus: 'ok', lastError: 'latest', runs: 3, retries: 1,
    });
  });

  it('sorts exact job names consistently and safely handles object-property-like names', () => {
    const names = ['ä', 'constructor', 'a', '__proto__', 'Z', ' A '];
    write(names.map((job) => event({ job, owner: ' owner ', ignored: { status: 'bad' } })).join('\n'));
    const result = readNight(runsDir, night);
    expect(result?.rows.map((row) => row.job)).toEqual([' A ', 'Z', '__proto__', 'a', 'constructor', 'ä']);
    expect(result?.rows.every((row) => row.owner === ' owner ' && row.runs === 1)).toBe(true);
    expect(result?.counts).toEqual({ ok: 6, retry: 0, fail: 0 });
  });

  it('counts identical events and keeps empty errors as no error', () => {
    write([event({ error: '' }), event({ error: '' })].join('\n'));
    expect(readNight(runsDir, night)).toMatchObject({
      counts: { ok: 2, retry: 0, fail: 0 },
      rows: [{ runs: 2, retries: 0, lastError: null }],
    });
  });

  it.each([
    'null', '[]', '"text"', '42', 'true', '{',
    ...[
      { at: undefined }, { at: null }, { at: 123 }, { at: '' },
      { at: '2026-10-29T00:00:00' }, { at: '2026-10-29 00:00:00Z' },
      { at: '2026-10-29T00:00:00Z\n' }, { at: '2026-02-29T00:00:00Z' },
      { at: '2026-04-31T00:00:00Z' }, { at: '1900-02-29T00:00:00Z' },
      { at: '2026-00-01T00:00:00Z' }, { at: '2026-13-01T00:00:00Z' },
      { at: '2026-01-00T00:00:00Z' }, { at: '0000-01-01T00:00:00Z' },
      { at: '2026-10-29T24:00:00Z' }, { at: '2026-10-29T00:60:00Z' },
      { at: '2026-10-29T00:00:60Z' }, { at: '2026-10-29T00:00:00+24:00' },
      { at: '2026-10-29T00:00:00+01:60' }, { at: '2026-10-29T00:00:00+0100' },
      { job: undefined }, { job: '' }, { job: ' \t' }, { job: null }, { job: 123 },
      { status: undefined }, { status: 'OK' }, { status: 'unknown' }, { status: null },
      { owner: undefined }, { owner: '' }, { owner: ' \t' }, { owner: false }, { owner: {} },
      { error: null }, { error: 123 }, { error: false }, { error: [] }, { error: {} },
    ].map(event),
  ])('rejects invalid event data without losing later valid lines: %s', (badLine) => {
    write(`${badLine}\n${event()}`);
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 1, counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ runs: 1 }],
    });
  });

  it.each([
    '2000-02-29T23:59:59.123456Z',
    '2024-02-29t00:00:00z',
    '0001-01-01T00:00:00+00:00',
    '9999-12-31T23:59:59-00:00',
    '2026-10-29T00:00:00-05:30',
    '2026-10-29T00:00:00+23:59',
  ])('accepts valid timestamp %s and preserves it exactly', (at) => {
    write(event({ at }));
    expect(readNight(runsDir, night)).toMatchObject({ badLines: 0, rows: [{ firstAt: at, lastAt: at }] });
  });

  it.each([
    '', '.', '..', '../2026-10-28', '/2026-10-28', '2026/10/28', '2026-10-28.jsonl',
    '2026-10-28/../2026-10-29', '2026-10-28\\other', '2026-10-28\0',
    ' 2026-10-28', '2026-10-28 ', '2026-10-28\n', '2026-1-01', '2026-01-1',
    '0000-01-01', '10000-01-01', '2026-02-29', '1900-02-29', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32',
  ])('rejects unsafe or impossible night %j before filesystem access', (date) => {
    const read = vi.mocked(fs.readFileSync);
    expect(readNight(runsDir, date)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])(
    'reads the exact filename for valid night %s', (date) => {
      write(event(), date);
      expect(readNight(runsDir, date)).toMatchObject({ night: date, badLines: 0, rows: [{ runs: 1 }] });
    },
  );

  it('propagates filesystem errors other than missing files', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw denied; });
    expect(() => readNight(runsDir, night)).toThrow(denied);
  });
});
