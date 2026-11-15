import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { NightResult } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';

describe('digest page view', () => {
  it('renders every row field, sorts jobs lexically, and marks retries and failures', () => {
    const result: NightResult = {
      night: '2026-10-28',
      rows: [
        {
          job: 'job-2',
          owner: null,
          runs: 4,
          retries: 3,
          lastStatus: 'fail',
          lastError: '<script>alert(1)</script>',
          firstAt: '2026-10-28T01:00:00+02:00',
          lastAt: '2026-10-28T03:00:00-04:00',
        },
        {
          job: 'job-10',
          owner: 'Ada',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T02:00:00Z',
          lastAt: '2026-10-28T02:00:00Z',
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 3, fail: 1 },
    };

    const html = renderToString(<DigestPage result={result} />);

    expect(html.indexOf('job-10')).toBeLessThan(html.indexOf('job-2'));
    expect(html).toContain('events: ok 1 · retry 3 · fail 1 · bad lines 1');
    expect(html).toContain('—');
    expect(html).toContain('first time');
    expect(html).toContain('last time');
    expect(html).toContain('2026-10-28T01:00:00+02:00');
    expect(html).toContain('2026-10-28T03:00:00-04:00');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html.match(/class="warn"/g)).toHaveLength(2);
  });

  it('shows nothing ran for an empty night and keeps the bad-line count visible', () => {
    const result: NightResult = {
      night: '2026-10-29',
      rows: [],
      badLines: 2,
      counts: { ok: 0, retry: 0, fail: 0 },
    };

    const html = renderToString(<DigestPage result={result} />);

    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines 2');
  });
});
