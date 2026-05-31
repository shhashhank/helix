import { getPricing, estimateCostUsd } from './pricing';
import {
  LlmCallContext,
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmStreamEvent,
  LlmUsage,
} from './types';

/**
 * One metered call: token usage, estimated USD cost, latency, and attribution.
 * A {@link UsageSink} persists these (the registry writes them to a table —
 * HELIX-57); `InMemoryUsageSink` is the in-process default for tests/dev.
 */
export interface UsageRecord {
  provider: string;
  model: string;
  usage: LlmUsage;
  /** Estimated cost; `null` when the model has no known pricing. */
  costUsd: number | null;
  latencyMs: number;
  streamed: boolean;
  context: LlmCallContext;
  at: Date;
}

export interface UsageSink {
  record(record: UsageRecord): void | Promise<void>;
}

/** Default in-process sink — keeps records in memory and can total spend. */
export class InMemoryUsageSink implements UsageSink {
  readonly records: UsageRecord[] = [];
  record(record: UsageRecord): void {
    this.records.push(record);
  }
  totalCostUsd(): number {
    return this.records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  }
}

export interface MeteredProviderOptions {
  /** Injectable clocks for deterministic tests. */
  monotonicMs?: () => number;
  now?: () => Date;
  /**
   * Called if the sink throws. Metering must never break a completion, so sink
   * errors are swallowed by default; override to log them.
   */
  onSinkError?: (err: unknown, record: UsageRecord) => void;
}

/**
 * Wraps a provider so every successful call (streaming or not) emits a
 * {@link UsageRecord} to a sink. Cost is derived from the returned model + token
 * usage via pricing.ts. Failed calls carry no token usage and are not recorded.
 * Sink failures never propagate to the caller.
 */
export class MeteredProvider implements LlmProvider {
  readonly name: string;
  private readonly monotonicMs: () => number;
  private readonly now: () => Date;

  constructor(
    private readonly inner: LlmProvider,
    private readonly sink: UsageSink,
    private readonly options: MeteredProviderOptions = {},
  ) {
    this.name = inner.name;
    this.monotonicMs = options.monotonicMs ?? (() => Date.now());
    this.now = options.now ?? (() => new Date());
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const start = this.monotonicMs();
    const completion = await this.inner.complete(request);
    await this.emit(request, completion.model, completion.usage, start, false);
    return completion;
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamEvent> {
    const start = this.monotonicMs();
    let final: LlmCompletion | undefined;
    for await (const event of this.inner.stream(request)) {
      if (event.type === 'done') final = event.completion;
      yield event;
    }
    if (final) await this.emit(request, final.model, final.usage, start, true);
  }

  private async emit(
    request: LlmCompletionRequest,
    model: string,
    usage: LlmUsage,
    startMs: number,
    streamed: boolean,
  ): Promise<void> {
    const record: UsageRecord = {
      provider: this.name,
      model,
      usage,
      costUsd: this.safeCost(model, usage),
      latencyMs: Math.max(0, Math.round(this.monotonicMs() - startMs)),
      streamed,
      context: request.context ?? {},
      at: this.now(),
    };
    try {
      await this.sink.record(record);
    } catch (err) {
      this.options.onSinkError?.(err, record);
    }
  }

  /** Cost when pricing is known, else null — never throws (don't break a call). */
  private safeCost(model: string, usage: LlmUsage): number | null {
    return getPricing(model) ? estimateCostUsd(model, usage) : null;
  }
}
