import {
  aggregateRuns,
  aggregateRunsBy,
  bucketRunsDaily,
  durationOf,
  InMemoryRunAnalyticsSource,
  percentile,
  runOutcomeFromStatus,
  type RunRecord,
} from '../analytics';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  runId: 'run-1',
  outcome: 'completed',
  startedAt: '2026-06-13T00:00:00.000Z',
  endedAt: '2026-06-13T00:00:01.000Z', // 1000ms by default
  ...over,
});

describe('percentile', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // n=10, ascending

  it('returns 0 for an empty array', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('uses nearest-rank: p0→min, p100→max, p50/p95 land on the right element', () => {
    expect(percentile(sorted, 0)).toBe(10); // clamps to min
    expect(percentile(sorted, 100)).toBe(100); // max
    expect(percentile(sorted, 50)).toBe(50); // ceil(0.5*10)=5 → idx 4
    expect(percentile(sorted, 95)).toBe(100); // ceil(0.95*10)=10 → idx 9
    expect(percentile(sorted, 99)).toBe(100);
  });

  it('handles a single value', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });
});

describe('runOutcomeFromStatus', () => {
  it('maps terminal Temporal statuses (both cancel spellings, case-insensitive)', () => {
    expect(runOutcomeFromStatus('COMPLETED')).toBe('completed');
    expect(runOutcomeFromStatus('Failed')).toBe('failed');
    expect(runOutcomeFromStatus('CANCELED')).toBe('cancelled');
    expect(runOutcomeFromStatus('CANCELLED')).toBe('cancelled');
    expect(runOutcomeFromStatus('TERMINATED')).toBe('terminated');
    expect(runOutcomeFromStatus('TIMED_OUT')).toBe('timed_out');
  });

  it('returns undefined for non-terminal or unknown statuses (excluded from analytics)', () => {
    expect(runOutcomeFromStatus('RUNNING')).toBeUndefined();
    expect(runOutcomeFromStatus('CONTINUED_AS_NEW')).toBeUndefined();
    expect(runOutcomeFromStatus('whatever')).toBeUndefined();
  });
});

describe('durationOf', () => {
  it('prefers an explicit durationMs', () => {
    expect(durationOf(run({ durationMs: 250, endedAt: '2026-06-13T00:00:09.000Z' }))).toBe(250);
  });

  it('derives from start/end when durationMs is absent', () => {
    expect(durationOf(run({ durationMs: undefined, endedAt: '2026-06-13T00:00:02.500Z' }))).toBe(2500);
  });

  it('is undefined when neither duration nor end is known, and never negative', () => {
    expect(durationOf(run({ durationMs: undefined, endedAt: undefined }))).toBeUndefined();
    expect(durationOf(run({ durationMs: -5 }))).toBe(0);
  });
});

describe('aggregateRuns', () => {
  it('returns zeroed stats for no runs', () => {
    const a = aggregateRuns([]);
    expect(a.runs).toBe(0);
    expect(a.successRate).toBe(0);
    expect(a.latencyMs).toEqual({ count: 0, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 });
    expect(a.cost).toEqual({ count: 0, totalUsd: 0, avgUsd: 0, maxUsd: 0 });
  });

  it('counts outcomes, computes success rate, and splits failed vs cancelled', () => {
    const a = aggregateRuns([
      run({ outcome: 'completed' }),
      run({ outcome: 'completed' }),
      run({ outcome: 'failed' }),
      run({ outcome: 'timed_out' }),
      run({ outcome: 'cancelled' }),
    ]);
    expect(a.runs).toBe(5);
    expect(a.byOutcome).toEqual({ completed: 2, failed: 1, cancelled: 1, terminated: 0, timed_out: 1 });
    expect(a.succeeded).toBe(2);
    expect(a.failed).toBe(2); // failed + timed_out (cancelled excluded)
    expect(a.successRate).toBe(0.4);
  });

  it('summarises latency from durations (explicit and derived)', () => {
    const a = aggregateRuns([
      run({ durationMs: 100, endedAt: undefined }),
      run({ durationMs: 200, endedAt: undefined }),
      run({ durationMs: 300, endedAt: undefined }),
      run({ durationMs: undefined, endedAt: '2026-06-13T00:00:00.400Z' }), // 400ms derived
    ]);
    expect(a.latencyMs.count).toBe(4);
    expect(a.latencyMs.minMs).toBe(100);
    expect(a.latencyMs.maxMs).toBe(400);
    expect(a.latencyMs.avgMs).toBe(250);
    expect(a.latencyMs.p50Ms).toBe(200); // ceil(0.5*4)=2 → idx 1
  });

  it('only counts runs that have a cost/duration in those stats', () => {
    const a = aggregateRuns([
      run({ costUsd: 1.5, durationMs: 100, endedAt: undefined }),
      run({ costUsd: 0.5, durationMs: undefined, endedAt: undefined }), // no duration
      run({ costUsd: undefined, durationMs: 300, endedAt: undefined }), // no cost
    ]);
    expect(a.runs).toBe(3);
    expect(a.cost).toEqual({ count: 2, totalUsd: 2.0, avgUsd: 1.0, maxUsd: 1.5 });
    expect(a.latencyMs.count).toBe(2); // the two with a duration
  });
});

describe('aggregateRunsBy', () => {
  it('groups runs by an arbitrary key', () => {
    const byWorkflow = aggregateRunsBy(
      [
        run({ workflow: 'build', outcome: 'completed' }),
        run({ workflow: 'build', outcome: 'failed' }),
        run({ workflow: 'deploy', outcome: 'completed' }),
      ],
      (r) => r.workflow ?? 'unknown',
    );
    expect(Object.keys(byWorkflow).sort()).toEqual(['build', 'deploy']);
    expect(byWorkflow.build.runs).toBe(2);
    expect(byWorkflow.build.successRate).toBe(0.5);
    expect(byWorkflow.deploy.successRate).toBe(1);
  });
});

describe('bucketRunsDaily', () => {
  it('buckets by UTC day, oldest first', () => {
    const series = bucketRunsDaily([
      run({ startedAt: '2026-06-12T23:00:00.000Z' }),
      run({ startedAt: '2026-06-13T01:00:00.000Z', outcome: 'failed' }),
      run({ startedAt: '2026-06-13T10:00:00.000Z' }),
    ]);
    expect(series.map((d) => d.day)).toEqual(['2026-06-12', '2026-06-13']);
    expect(series[0].analytics.runs).toBe(1);
    expect(series[1].analytics.runs).toBe(2);
    expect(series[1].analytics.successRate).toBe(0.5);
  });
});

describe('InMemoryRunAnalyticsSource', () => {
  it('lists added runs and filters by workflow and time window', async () => {
    const source = new InMemoryRunAnalyticsSource();
    source.add(
      run({ runId: 'a', workflow: 'build', startedAt: '2026-06-10T00:00:00.000Z' }),
      run({ runId: 'b', workflow: 'deploy', startedAt: '2026-06-12T00:00:00.000Z' }),
      run({ runId: 'c', workflow: 'build', startedAt: '2026-06-14T00:00:00.000Z' }),
    );

    expect((await source.listRuns()).map((r) => r.runId)).toEqual(['a', 'b', 'c']);
    expect((await source.listRuns({ workflow: 'build' })).map((r) => r.runId)).toEqual(['a', 'c']);

    const windowed = await source.listRuns({ from: '2026-06-11T00:00:00.000Z', to: '2026-06-13T00:00:00.000Z' });
    expect(windowed.map((r) => r.runId)).toEqual(['b']); // a is before from, c is at/after to

    // The source composes with the aggregators.
    const a = aggregateRuns(await source.listRuns({ workflow: 'build' }));
    expect(a.runs).toBe(2);
  });
});
