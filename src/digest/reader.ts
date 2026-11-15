import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightResult, RunStatus } from './types.js';

type Instant = { seconds: number; fraction: string };
type RunEvent = {
  at: string;
  instant: Instant;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};
type Job = {
  row: DigestRow;
  first: Instant;
  last: Instant;
  lastError: Instant | null;
};

function validDate(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= days[month - 1];
}

function validNight(night: string): boolean {
  return night.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(night)
    && validDate(Number(night.slice(0, 4)), Number(night.slice(5, 7)), Number(night.slice(8)));
}

function parseInstant(at: string): Instant | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/i.exec(at);
  if (!parts || parts[0] !== at) return null;
  if (!validDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))
    || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59
    || Number(parts[9] ?? 0) > 23 || Number(parts[10] ?? 0) > 59) return null;

  // Compare fractional seconds separately: Date would discard sub-millisecond precision.
  return {
    seconds: Date.parse(`${at.slice(0, 19)}${parts[8]}`) / 1000,
    fraction: (parts[7] ?? '').replace(/0+$/, ''),
  };
}

function compare(a: Instant, b: Instant): number {
  return a.seconds - b.seconds || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0);
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.at !== 'string' || !nonblank(event.job)
    || (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail')
    || (event.owner !== null && !nonblank(event.owner))
    || ('error' in event && typeof event.error !== 'string')) return null;
  const instant = parseInstant(event.at);
  if (!instant) return null;
  return {
    at: event.at,
    instant,
    job: event.job,
    status: event.status,
    owner: event.owner,
    error: nonblank(event.error) ? event.error : null,
  };
}

export function readNight(runsDir: string, night: string): NightResult | null {
  if (!validNight(night)) return null;
  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const result: NightResult = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, Job>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (!event) {
      result.badLines += 1;
      continue;
    }
    result.counts[event.status] += 1;
    const job = jobs.get(event.job);
    if (!job) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error,
          firstAt: event.at,
          lastAt: event.at,
        },
        first: event.instant,
        last: event.instant,
        lastError: event.error === null ? null : event.instant,
      });
      continue;
    }
    job.row.runs += 1;
    if (event.status === 'retry') job.row.retries += 1;
    if (compare(event.instant, job.first) < 0) {
      job.first = event.instant;
      job.row.firstAt = event.at;
    }
    if (compare(event.instant, job.last) >= 0) {
      job.last = event.instant;
      job.row.lastAt = event.at;
      job.row.lastStatus = event.status;
      job.row.owner = event.owner;
    }
    if (event.error !== null && (job.lastError === null || compare(event.instant, job.lastError) >= 0)) {
      job.lastError = event.instant;
      job.row.lastError = event.error;
    }
  }
  result.rows = [...jobs.values()].map((job) => job.row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
}
