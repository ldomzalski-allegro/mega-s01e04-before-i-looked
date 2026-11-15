import type { DigestRow, NightResult } from '../digest/types.js';

function compareJobs(a: DigestRow, b: DigestRow): number {
  if (a.job < b.job) return -1;
  if (a.job > b.job) return 1;
  return 0;
}

function missing(value: string | null): string {
  return value ?? '—';
}

export function DigestPage({ result }: { result: NightResult }) {
  const rows = [...result.rows].sort(compareJobs);

  return (
    <>
      <h1>digest · {result.night}</h1>
      <p class="mute">
        events: ok {result.counts.ok} · retry {result.counts.retry} · fail {result.counts.fail}
        {' · '}bad lines {result.badLines}
      </p>
      {rows.length === 0 && <p class="mute">nothing ran</p>}
      <table>
        <thead>
          <tr>
            <th>job</th>
            <th>owner</th>
            <th>runs</th>
            <th>retries</th>
            <th>last status</th>
            <th>last error</th>
            <th>first time</th>
            <th>last time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr>
              <td>{row.job}</td>
              <td>{missing(row.owner)}</td>
              <td>{row.runs}</td>
              <td>
                <span class={row.retries >= 3 ? 'warn' : ''}>{row.retries}</span>
              </td>
              <td>
                <span class={row.lastStatus === 'fail' ? 'warn' : ''}>{row.lastStatus}</span>
              </td>
              <td>{missing(row.lastError)}</td>
              <td>{row.firstAt}</td>
              <td>{row.lastAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
