/**
 * Run analytics aggregation (HELIX-140). Folds a set of finished-run records into
 * the rollups a dashboard needs — throughput, success rate, latency percentiles,
 * and cost — over the whole set, grouped by a dimension, or bucketed by day.
 *
 * Deliberately **pure and source-agnostic**: it operates on {@link RunRecord}s the
 * caller has already gathered (from Temporal's run history, a runs table, …), so
 * the same math serves any backend. Cost-per-run is sourced from the HELIX-67
 * token-usage rollup (`TokenUsageRollupService.byRun`); this layer just sums and
 * summarises it. The live data source (turning Temporal/DB rows into RunRecords)
 * is the swappable seam — see {@link RunAnalyticsSource} and DEFERRED.md.
 */

/** Terminal outcome of a run, normalised across backends (mirrors Temporal's statuses). */
export type RunOutcome = 'completed' | 'failed' | 'cancelled' | 'terminated' | 'timed_out';

/** The outcome counted as a successful run for the success-rate calculation. */
const SUCCESS_OUTCOME: RunOutcome = 'completed';

/**
 * Map a Temporal-style execution status name (what `describeWorkflowRun` returns)
 * to a {@link RunOutcome}, or `undefined` for a run that hasn't reached a terminal
 * state yet (`RUNNING` / `CONTINUED_AS_NEW`) and so shouldn't be counted. Accepts
 * both `CANCELED` and `CANCELLED` spellings. This is the only piece that knows the
 * backend's vocabulary; the rest of the module works in {@link RunOutcome}s.
 */
export function runOutcomeFromStatus(status: string): RunOutcome | undefined {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelled';
    case 'TERMINATED':
      return 'terminated';
    case 'TIMED_OUT':
      return 'timed_out';
    default:
      return undefined; // RUNNING, CONTINUED_AS_NEW, or unknown → not a finished run
  }
}

/** The minimal facts about one finished run needed for analytics. */
export interface RunRecord {
  runId: string;
  outcome: RunOutcome;
  /** ISO 8601 start — used for time bucketing and (with `endedAt`) latency. */
  startedAt: string;
  /** ISO 8601 end. */
  endedAt?: string;
  /** Wall-clock latency in ms; derived from `startedAt`/`endedAt` when omitted. */
  durationMs?: number;
  /** Run cost in USD (from the token-usage rollup), if known. */
  costUsd?: number;
  /** Optional dimension to group by (e.g. the workflow name). */
  workflow?: string;
}

/** Latency distribution over the runs that have a known duration. */
export interface LatencyStats {
  /** How many runs contributed (had a duration). */
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/** Cost distribution over the runs that have a known cost. */
export interface CostStats {
  /** How many runs contributed (had a cost). */
  count: number;
  totalUsd: number;
  avgUsd: number;
  maxUsd: number;
}

/** The aggregate analytics for a set of runs. */
export interface RunAnalytics {
  /** Total runs analysed. */
  runs: number;
  /** Count per terminal outcome (every outcome present as a key, zero when none). */
  byOutcome: Record<RunOutcome, number>;
  /** Runs that completed successfully. */
  succeeded: number;
  /** Runs that ended in a non-success terminal state (failed / terminated / timed out). */
  failed: number;
  /** `succeeded / runs` in `[0, 1]`; `0` when there are no runs. */
  successRate: number;
  latencyMs: LatencyStats;
  cost: CostStats;
}

const FAILURE_OUTCOMES: ReadonlySet<RunOutcome> = new Set(['failed', 'terminated', 'timed_out']);

function emptyOutcomeCounts(): Record<RunOutcome, number> {
  return { completed: 0, failed: 0, cancelled: 0, terminated: 0, timed_out: 0 };
}

/** A run's latency in ms: the explicit `durationMs`, else derived from start/end, else `undefined`. */
export function durationOf(run: RunRecord): number | undefined {
  if (run.durationMs != null) return Math.max(0, run.durationMs);
  if (run.endedAt) return Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));
  return undefined;
}

/**
 * Nearest-rank percentile of an **ascending-sorted** array. `p` is in `[0, 100]`
 * (50 → median, 95 → p95). Returns `0` for an empty array.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(Math.max(rank - 1, 0), sortedAsc.length - 1);
  return sortedAsc[idx];
}

function latencyStats(durations: number[]): LatencyStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) return { count: 0, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count,
    minMs: sorted[0],
    maxMs: sorted[count - 1],
    avgMs: sum / count,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

function costStats(costs: number[]): CostStats {
  const count = costs.length;
  if (count === 0) return { count: 0, totalUsd: 0, avgUsd: 0, maxUsd: 0 };
  const total = costs.reduce((a, b) => a + b, 0);
  return { count, totalUsd: total, avgUsd: total / count, maxUsd: Math.max(...costs) };
}

/** Aggregate a set of runs into one {@link RunAnalytics} rollup. */
export function aggregateRuns(records: Iterable<RunRecord>): RunAnalytics {
  const byOutcome = emptyOutcomeCounts();
  const durations: number[] = [];
  const costs: number[] = [];
  let runs = 0;

  for (const r of records) {
    runs += 1;
    byOutcome[r.outcome] += 1;
    const d = durationOf(r);
    if (d != null) durations.push(d);
    if (r.costUsd != null) costs.push(r.costUsd);
  }

  let failed = 0;
  for (const o of FAILURE_OUTCOMES) failed += byOutcome[o];

  return {
    runs,
    byOutcome,
    succeeded: byOutcome[SUCCESS_OUTCOME],
    failed,
    successRate: runs === 0 ? 0 : byOutcome[SUCCESS_OUTCOME] / runs,
    latencyMs: latencyStats(durations),
    cost: costStats(costs),
  };
}

/**
 * Aggregate runs grouped by a key (e.g. workflow name, agent role, org). Returns a
 * map from key to that group's {@link RunAnalytics}.
 */
export function aggregateRunsBy(
  records: Iterable<RunRecord>,
  keyFn: (run: RunRecord) => string,
): Record<string, RunAnalytics> {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const key = keyFn(r);
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  const out: Record<string, RunAnalytics> = {};
  for (const [key, recs] of groups) out[key] = aggregateRuns(recs);
  return out;
}

/** One day's analytics in a time series. */
export interface DailyRunAnalytics {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  analytics: RunAnalytics;
}

/** Bucket runs into per-day (UTC) analytics by `startedAt`, oldest day first. */
export function bucketRunsDaily(records: Iterable<RunRecord>): DailyRunAnalytics[] {
  const byDay = aggregateRunsBy(records, (r) => new Date(r.startedAt).toISOString().slice(0, 10));
  return Object.keys(byDay)
    .sort()
    .map((day) => ({ day, analytics: byDay[day] }));
}

/** Optional filter when pulling runs from a {@link RunAnalyticsSource}. */
export interface RunAnalyticsQuery {
  /** Inclusive lower bound on `startedAt` (ISO 8601). */
  from?: string;
  /** Exclusive upper bound on `startedAt` (ISO 8601). */
  to?: string;
  /** Restrict to one workflow. */
  workflow?: string;
}

/**
 * Where run records come from. The pure aggregators above don't care how runs are
 * stored; an implementation of this seam (Temporal history lister, a runs table, …)
 * is the deferred binding that feeds them. {@link InMemoryRunAnalyticsSource} is
 * the in-process implementation for tests/dev.
 */
export interface RunAnalyticsSource {
  listRuns(query?: RunAnalyticsQuery): Promise<RunRecord[]>;
}

function matchesQuery(run: RunRecord, query: RunAnalyticsQuery): boolean {
  if (query.workflow != null && run.workflow !== query.workflow) return false;
  const started = Date.parse(run.startedAt);
  if (query.from != null && started < Date.parse(query.from)) return false;
  if (query.to != null && started >= Date.parse(query.to)) return false;
  return true;
}

/** In-memory {@link RunAnalyticsSource} — keeps run records in process (tests/dev). */
export class InMemoryRunAnalyticsSource implements RunAnalyticsSource {
  private readonly runs: RunRecord[] = [];

  add(...records: RunRecord[]): void {
    this.runs.push(...records);
  }

  async listRuns(query: RunAnalyticsQuery = {}): Promise<RunRecord[]> {
    return this.runs.filter((r) => matchesQuery(r, query));
  }
}
