import { LlmProviderError, LlmTimeoutError } from '../lib/errors';
import { CircuitBreaker, ResilientProvider } from '../lib/resilience';
import { LlmCompletion, LlmProvider, LlmStreamEvent } from '../lib/types';

const completion = (model = 'claude-opus-4-8'): LlmCompletion => ({
  model,
  stopReason: 'end_turn',
  content: [{ type: 'text', text: 'ok' }],
  text: 'ok',
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
});

const retryable = (msg = '503') => new LlmProviderError(msg, 'p', 503, 'api_error', true);
const nonRetryable = (msg = '400') =>
  new LlmProviderError(msg, 'p', 400, 'invalid_request_error', false);

function fakeProvider(
  name: string,
  complete: jest.Mock,
  streamImpl?: (req: unknown) => AsyncIterable<LlmStreamEvent>,
): LlmProvider & { complete: jest.Mock } {
  return {
    name,
    complete,
    stream:
      streamImpl ??
      // eslint-disable-next-line require-yield
      (async function* () {
        return;
      }),
  } as LlmProvider & { complete: jest.Mock };
}

const instant = { sleep: async () => undefined, jitter: false as const };
const req = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('ResilientProvider.complete — retry & failover', () => {
  it('retries a retryable failure then succeeds on the same provider', async () => {
    const complete = jest
      .fn()
      .mockRejectedValueOnce(retryable())
      .mockRejectedValueOnce(retryable())
      .mockResolvedValueOnce(completion());
    const sleep = jest.fn(async () => undefined);
    const provider = new ResilientProvider([fakeProvider('p1', complete)], {
      maxRetries: 2,
      jitter: false,
      sleep,
    });

    const out = await provider.complete(req);
    expect(out.text).toBe('ok');
    expect(complete).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry or failover on a non-retryable error', async () => {
    const p1 = jest.fn().mockRejectedValue(nonRetryable());
    const p2 = jest.fn().mockResolvedValue(completion('claude-sonnet-4-6'));
    const provider = new ResilientProvider(
      [fakeProvider('p1', p1), fakeProvider('p2', p2)],
      instant,
    );

    await expect(provider.complete(req)).rejects.toMatchObject({ status: 400 });
    expect(p1).toHaveBeenCalledTimes(1);
    expect(p2).not.toHaveBeenCalled();
  });

  it('fails over to the next provider after exhausting retries', async () => {
    const p1 = jest.fn().mockRejectedValue(retryable());
    const p2 = jest.fn().mockResolvedValue(completion('claude-sonnet-4-6'));
    const provider = new ResilientProvider([fakeProvider('p1', p1), fakeProvider('p2', p2)], {
      ...instant,
      maxRetries: 2,
    });

    const out = await provider.complete(req);
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(p1).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(p2).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when every provider fails', async () => {
    const p1 = jest.fn().mockRejectedValue(retryable('a'));
    const p2 = jest.fn().mockRejectedValue(retryable('b'));
    const provider = new ResilientProvider([fakeProvider('p1', p1), fakeProvider('p2', p2)], {
      ...instant,
      maxRetries: 0,
    });

    await expect(provider.complete(req)).rejects.toThrow('b');
  });
});

describe('ResilientProvider.complete — timeout', () => {
  it('rejects with LlmTimeoutError when a call exceeds the timeout', async () => {
    const hang = jest.fn(() => new Promise<LlmCompletion>(() => undefined)); // never resolves
    const provider = new ResilientProvider([fakeProvider('slow', hang)], {
      ...instant,
      maxRetries: 0,
      timeoutMs: 10,
    });

    await expect(provider.complete(req)).rejects.toBeInstanceOf(LlmTimeoutError);
  });
});

describe('ResilientProvider.complete — circuit breaker', () => {
  it('opens after the threshold and skips the provider until cooldown, then half-opens', async () => {
    let clock = 1000;
    const p1 = jest.fn().mockRejectedValue(retryable());
    const p2 = jest.fn().mockResolvedValue(completion('claude-sonnet-4-6'));
    const provider = new ResilientProvider([fakeProvider('p1', p1), fakeProvider('p2', p2)], {
      ...instant,
      maxRetries: 0,
      circuitBreaker: { failureThreshold: 2, cooldownMs: 30_000 },
      now: () => clock,
    });

    // Two failing calls open p1's circuit (failover to p2 each time).
    await provider.complete(req);
    await provider.complete(req);
    expect(p1).toHaveBeenCalledTimes(2);

    // Circuit open: p1 is skipped entirely.
    await provider.complete(req);
    expect(p1).toHaveBeenCalledTimes(2);

    // After cooldown, half-open trial lets p1 run again (now succeeding).
    p1.mockResolvedValueOnce(completion('claude-opus-4-8'));
    clock += 30_000;
    const out = await provider.complete(req);
    expect(p1).toHaveBeenCalledTimes(3);
    expect(out.model).toBe('claude-opus-4-8');
  });
});

describe('ResilientProvider.stream', () => {
  it('passes through stream events on success', async () => {
    const streamImpl = async function* () {
      yield { type: 'text', text: 'a' } as LlmStreamEvent;
      yield { type: 'text', text: 'b' } as LlmStreamEvent;
    };
    const provider = new ResilientProvider(
      [fakeProvider('p1', jest.fn(), streamImpl)],
      instant,
    );

    const events = [];
    for await (const e of provider.stream(req)) events.push(e);
    expect(events).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('fails over when the stream errors before emitting any chunk', async () => {
    const failing = async function* (): AsyncIterable<LlmStreamEvent> {
      throw retryable();
    };
    const working = async function* () {
      yield { type: 'text', text: 'ok' } as LlmStreamEvent;
    };
    const provider = new ResilientProvider(
      [fakeProvider('p1', jest.fn(), failing), fakeProvider('p2', jest.fn(), working)],
      { ...instant, maxRetries: 0 },
    );

    const events = [];
    for await (const e of provider.stream(req)) events.push(e);
    expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('propagates a mid-stream error without failover', async () => {
    const midFail = async function* () {
      yield { type: 'text', text: 'a' } as LlmStreamEvent;
      throw retryable('mid');
    };
    const p2 = jest.fn();
    const provider = new ResilientProvider(
      [fakeProvider('p1', jest.fn(), midFail), fakeProvider('p2', p2, async function* () {})],
      { ...instant, maxRetries: 0 },
    );

    const events: LlmStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const e of provider.stream(req)) events.push(e);
      })(),
    ).rejects.toThrow('mid');
    expect(events).toEqual([{ type: 'text', text: 'a' }]);
  });
});

describe('backoff & breaker units', () => {
  it('backoffDelay grows exponentially and caps (no jitter)', () => {
    const p = new ResilientProvider([fakeProvider('p', jest.fn())], {
      jitter: false,
      initialDelayMs: 100,
      backoffFactor: 2,
      maxDelayMs: 350,
    });
    expect([0, 1, 2, 3].map((a) => p.backoffDelay(a))).toEqual([100, 200, 350, 350]);
  });

  it('CircuitBreaker opens at threshold and recovers after cooldown', () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100 }, () => clock);
    expect(cb.allowRequest()).toBe(true);
    cb.recordFailure();
    cb.recordFailure(); // opens
    expect(cb.allowRequest()).toBe(false);
    clock = 100; // cooldown elapsed
    expect(cb.allowRequest()).toBe(true);
    cb.recordSuccess();
    expect(cb.allowRequest()).toBe(true);
  });

  it('requires at least one provider', () => {
    expect(() => new ResilientProvider([])).toThrow(/at least one provider/);
  });
});
