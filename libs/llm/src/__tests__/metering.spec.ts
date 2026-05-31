import { InMemoryUsageSink, MeteredProvider, UsageSink } from '../lib/metering';
import { LlmCompletion, LlmProvider, LlmStreamEvent, LlmUsage } from '../lib/types';

const usage = (o: Partial<LlmUsage> = {}): LlmUsage => ({
  inputTokens: 1000,
  outputTokens: 500,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  ...o,
});

const completion = (model = 'claude-opus-4-8', u = usage()): LlmCompletion => ({
  model,
  stopReason: 'end_turn',
  content: [{ type: 'text', text: 'ok' }],
  text: 'ok',
  usage: u,
});

function provider(
  complete: () => Promise<LlmCompletion>,
  streamImpl?: () => AsyncIterable<LlmStreamEvent>,
): LlmProvider {
  return {
    name: 'anthropic',
    complete,
    stream:
      streamImpl ??
      async function* () {
        yield { type: 'done', completion: completion() };
      },
  };
}

// Monotonic clock that advances 10ms per read.
function fakeClock(step = 10) {
  let t = 0;
  return () => (t += step);
}

describe('MeteredProvider.complete', () => {
  it('records usage, derived cost, latency and context on success', async () => {
    const sink = new InMemoryUsageSink();
    const metered = new MeteredProvider(
      provider(async () => completion('claude-opus-4-8')),
      sink,
      { monotonicMs: fakeClock(10) },
    );

    const out = await metered.complete({
      messages: [{ role: 'user', content: 'hi' }],
      context: { runId: 'run_1', orgId: 'org_1', agentRole: 'planning' },
    });

    expect(out.text).toBe('ok');
    expect(sink.records).toHaveLength(1);
    const r = sink.records[0];
    expect(r).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      streamed: false,
      context: { runId: 'run_1', orgId: 'org_1', agentRole: 'planning' },
    });
    // opus: 1000 in @ $5/M + 500 out @ $25/M = 0.005 + 0.0125 = 0.0175
    expect(r.costUsd).toBeCloseTo(0.0175, 6);
    expect(r.latencyMs).toBe(10);
    expect(r.at).toBeInstanceOf(Date);
  });

  it('records null cost when the model has no known pricing', async () => {
    const sink = new InMemoryUsageSink();
    const metered = new MeteredProvider(provider(async () => completion('mystery-model')), sink);
    await metered.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(sink.records[0].costUsd).toBeNull();
  });

  it('does not record when the call fails', async () => {
    const sink = new InMemoryUsageSink();
    const metered = new MeteredProvider(
      provider(async () => {
        throw new Error('boom');
      }),
      sink,
    );
    await expect(metered.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('boom');
    expect(sink.records).toHaveLength(0);
  });

  it('never lets a sink failure break the call', async () => {
    const onSinkError = jest.fn();
    const badSink: UsageSink = {
      record() {
        throw new Error('db down');
      },
    };
    const metered = new MeteredProvider(provider(async () => completion()), badSink, { onSinkError });
    await expect(metered.complete({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toMatchObject({ text: 'ok' });
    expect(onSinkError).toHaveBeenCalledTimes(1);
  });
});

describe('MeteredProvider.stream', () => {
  it('passes events through and records usage from the final completion', async () => {
    const sink = new InMemoryUsageSink();
    const streamImpl = async function* (): AsyncIterable<LlmStreamEvent> {
      yield { type: 'text', text: 'he' };
      yield { type: 'text', text: 'llo' };
      yield { type: 'done', completion: completion('claude-haiku-4-5', usage({ inputTokens: 1_000_000, outputTokens: 0 })) };
    };
    const metered = new MeteredProvider(provider(async () => completion(), streamImpl), sink);

    const events = [];
    for await (const e of metered.stream({ messages: [{ role: 'user', content: 'hi' }] })) events.push(e);

    expect(events).toHaveLength(3);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ model: 'claude-haiku-4-5', streamed: true });
    expect(sink.records[0].costUsd).toBeCloseTo(1.0, 6); // 1M haiku input @ $1/M
  });
});

describe('InMemoryUsageSink', () => {
  it('totals cost across records, treating null as 0', async () => {
    const sink = new InMemoryUsageSink();
    const metered = new MeteredProvider(provider(async () => completion('claude-opus-4-8')), sink);
    await metered.complete({ messages: [{ role: 'user', content: 'a' }] });
    await metered.complete({ messages: [{ role: 'user', content: 'b' }] });
    expect(sink.totalCostUsd()).toBeCloseTo(0.035, 6);
  });
});
