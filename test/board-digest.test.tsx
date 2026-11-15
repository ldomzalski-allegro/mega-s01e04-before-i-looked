import { describe, expect, it } from 'vitest';
import { renderToString } from 'hono/jsx/dom/server';
import { StatusBoard } from '../src/views/status.js';
import type { Status } from '../src/status.js';

const baseStatus: Status = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  lastBeat: null,
  nights: ['2026-10-28', '2026-10-27'],
};

describe('status board digest links', () => {
  it('links each night to its digest and shows raw event counts', () => {
    const html = renderToString(
      <StatusBoard
        status={{
          ...baseStatus,
          summaries: [
            { night: '2026-10-28', counts: { ok: 4, retry: 2, fail: 1 } },
            { night: '2026-10-27', counts: { ok: 3, retry: 0, fail: 0 } },
          ],
        }}
      />,
    );

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('ok 4 / retry 2 / fail 1');
    expect(html).toContain('ok 3 / retry 0 / fail 0');
  });

  it('renders missing reader counts without failing the board', () => {
    const html = renderToString(
      <StatusBoard
        status={{
          ...baseStatus,
          summaries: [{ night: '2026-10-28', counts: null }],
        }}
      />,
    );

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok — / retry — / fail —');
  });

  it('keeps the existing nights-only status shape renderable', () => {
    const html = renderToString(<StatusBoard status={baseStatus} />);

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok — / retry — / fail —');
  });
});
