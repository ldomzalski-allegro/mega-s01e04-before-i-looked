export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's valid events, ordered by instant; equal instants keep file order. */
export type DigestRow = {
  job: string;
  /** Owner on the latest event, including an explicit null (display as —). */
  owner: string | null;
  /** All valid events for this job, including retries and failures. */
  runs: number;
  /** Events whose status is retry; a subset of runs, not consecutive retries. */
  retries: number;
  lastStatus: RunStatus;
  /** Latest non-whitespace error, or null; a later success does not clear it. */
  lastError: string | null;
  /** Earliest/latest event's original timestamp, preserving its offset verbatim. */
  firstAt: string;
  lastAt: string;
};

/** Raw valid-event counts across the night, NOT counts of jobs' last statuses. */
export type EventCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type NightResult = {
  night: string;
  /** Ascending job names using JS string comparison (< / >), never localeCompare. */
  rows: DigestRow[];
  /** Nonblank lines rejected as malformed JSON or invalid event data. */
  badLines: number;
  /** Sum of these counts equals the sum of rows' runs. */
  counts: EventCounts;
};

/**
 * Synchronous contract: reader.ts exports the real readNight implementation.
 * Import ReadNight with `import type`; this module exports no runtime reader.
 *
 * Read only runsDir/<night>.jsonl. night must be an exact, real Gregorian
 * YYYY-MM-DD date (years 0001–9999), with no paths, suffixes or whitespace.
 * Invalid nights return null without filesystem access. ENOENT also returns
 * null; other filesystem errors propagate. A present empty/blank file returns
 * { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } }.
 * A file containing only bad lines likewise exists, but has badLines > 0.
 *
 * Ignore whitespace-only lines (including a trailing newline). Each other line
 * must be a JSON object, not an array, with required at, job, status and owner.
 * at is a real RFC 3339 timestamp with explicit Z or ±HH:mm offset, seconds
 * 00–59, and optional fractional seconds; reject impossible dates/times.
 * job is a non-whitespace string; status is exactly ok, retry or fail; owner
 * is a non-whitespace string or null. Optional error must be a string when
 * present. Unknown properties are ignored. Each rejected line adds one to
 * badLines, contributes no events, and never prevents reading later lines.
 *
 * Keep strings verbatim, grouping by the exact job string. Count every valid
 * event, including duplicates. firstAt is the earliest instant (first line on
 * ties); lastAt, lastStatus and owner use the latest instant (last line on ties).
 * lastError independently uses the latest event with a non-whitespace error,
 * retaining that original string even after recovery. Do not filter timestamps
 * by night: a night's file can extend past midnight. All consumers use the same
 * sorted rows and raw counts; no additional page/API/board aggregation needed.
 */
export type ReadNight = (runsDir: string, night: string) => NightResult | null;
