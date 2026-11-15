import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const night = '2026-11-15';
const unsafeJob = '<script>alert("x")</script>';

let runsDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

function app() {
  const config: RigConfig = {
    adapter: 'test',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };

  return createApp(config);
}

async function writeNight(contents: string) {
  await writeFile(join(runsDir, `${night}.jsonl`), contents, 'utf8');
}

function event(
  at: string,
  job: string,
  status: 'ok' | 'retry' | 'fail',
  owner: string | null,
  error?: string,
) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

describe('digest routes', () => {
  it('serves the same sorted night in HTML and the full JSON contract', async () => {
    await writeNight(
      [
        event('2026-11-15T02:00:00+01:00', 'zeta', 'retry', 'worker-z'),
        event('2026-11-15T02:01:00+01:00', 'zeta', 'retry', 'worker-z'),
        event('2026-11-15T02:02:00+01:00', 'zeta', 'retry', 'worker-z'),
        event('2026-11-15T02:03:00+01:00', 'zeta', 'fail', null, '<img src=x onerror=alert(1)>'),
        event('2026-11-15T01:30:00+05:30', 'Alpha', 'ok', 'alice'),
        event('2026-11-15T02:00:00Z', 'alpha', 'ok', 'bob'),
        event('2026-11-15T03:00:00-04:00', unsafeJob, 'ok', 'safe-owner'),
        '{not valid json',
        JSON.stringify({ at: '2026-11-15T04:00:00Z', job: 'ignored', status: 'done', owner: 'nobody' }),
      ].join('\n'),
    );

    const htmlResponse = await app().request(`/digest/${night}`);
    const jsonResponse = await app().request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const html = await htmlResponse.text();
    const result: unknown = await jsonResponse.json();

    expect(jsonResponse.headers.get('content-type')).toContain('application/json');

    expect(result).toMatchObject({
      night,
      badLines: 2,
      counts: { ok: 3, retry: 3, fail: 1 },
      rows: [
        { job: unsafeJob, runs: 1, retries: 0, lastStatus: 'ok' },
        { job: 'Alpha', owner: 'alice', firstAt: '2026-11-15T01:30:00+05:30', lastAt: '2026-11-15T01:30:00+05:30' },
        { job: 'alpha', owner: 'bob', runs: 1, lastStatus: 'ok' },
        {
          job: 'zeta',
          owner: null,
          runs: 4,
          retries: 3,
          lastStatus: 'fail',
          lastError: '<img src=x onerror=alert(1)>',
          firstAt: '2026-11-15T02:00:00+01:00',
          lastAt: '2026-11-15T02:03:00+01:00',
        },
      ],
    });

    if (typeof result !== 'object' || result === null || !('rows' in result)) {
      throw new Error('Expected JSON response to be a NightResult');
    }
    const rows = result.rows as { job: string }[];
    const sortedJobs = rows.map((row) => row.job);
    expect(sortedJobs).toEqual([unsafeJob, 'Alpha', 'alpha', 'zeta']);

    const renderedJobs = [
      '&lt;script&gt;alert("x")&lt;/script&gt;',
      'Alpha',
      'alpha',
      'zeta',
    ];
    const jobPositions = renderedJobs.map((job) => html.indexOf(job));
    expect(jobPositions.every((position) => position >= 0)).toBe(true);
    expect(jobPositions).toEqual([...jobPositions].sort((left, right) => left - right));

    expect(html).toContain('—');
    expect(html).toContain('2026-11-15T01:30:00+05:30');
    expect(html).toContain('3');
    expect(html).toContain('fail');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert("x")</script>');
  });

  it('returns 404 for missing and invalid nights from both endpoints', async () => {
    for (const path of ['/digest/2026-11-14', '/api/digest/2026-11-14', '/digest/2026-02-30', '/api/digest/2026-02-30']) {
      const response = await app().request(path);
      expect(response.status, path).toBe(404);
    }
  });

  it('renders an empty night and returns empty rows and zero counts', async () => {
    await writeNight('');

    const htmlResponse = await app().request(`/digest/${night}`);
    const jsonResponse = await app().request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const html = await htmlResponse.text();
    const result: unknown = await jsonResponse.json();

    expect(html).toContain('nothing ran');
    expect(result).toEqual({
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps valid rows when the night contains malformed lines', async () => {
    await writeNight(
      [
        '{broken',
        event('2026-11-15T08:00:00-07:00', 'still-valid', 'ok', 'reader'),
        '[]',
      ].join('\n'),
    );

    const htmlResponse = await app().request(`/digest/${night}`);
    const jsonResponse = await app().request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const html = await htmlResponse.text();
    const result: unknown = await jsonResponse.json();

    expect(html).toContain('still-valid');
    expect(result).toMatchObject({
      night,
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ job: 'still-valid', runs: 1, owner: 'reader' }],
    });
  });
});
