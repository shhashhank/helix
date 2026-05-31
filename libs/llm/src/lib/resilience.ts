import { LlmProviderError, LlmTimeoutError, isRetryableError } from './errors';
import { LlmCompletion, LlmCompletionRequest, LlmProvider, LlmStreamEvent } from './types';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before a half-open trial. Default 30_000ms. */
  cooldownMs?: number;
}

/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive failures
 * the circuit opens and the provider is skipped until `cooldownMs` elapses,
 * after which a single half-open trial is allowed (success closes it, failure
 * re-opens it). Keeps a flapping provider from being hammered on every call.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(
    options: CircuitBreakerOptions = {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.threshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  /** True if a request may proceed (closed, or open past its cooldown → half-open trial). */
  allowRequest(): boolean {
    if (this.openedAt === null) return true;
    return this.now() - this.openedAt >= this.cooldownMs;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}

export interface ResilientProviderOptions {
  /** Retries per provider after the first try. Default 2 (→ up to 3 attempts). */
  maxRetries?: number;
  initialDelayMs?: number; // default 500
  maxDelayMs?: number; // default 8_000
  backoffFactor?: number; // default 2
  /** Apply random full-jitter to backoff delays. Default true. */
  jitter?: boolean;
  /** Per-attempt timeout in ms; 0 disables. Default 60_000. */
  timeoutMs?: number;
  /** Circuit breaker config, or `false` to disable. Default enabled with defaults. */
  circuitBreaker?: CircuitBreakerOptions | false;
  // Injectable for deterministic tests.
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wraps one or more {@link LlmProvider}s (a failover chain) with retry +
 * exponential backoff, per-attempt timeout, and a per-provider circuit breaker
 * (HELIX-56). Retryable failures (429/5xx/connection/timeout) are retried on a
 * provider, then failed over to the next; non-retryable errors (e.g. 400)
 * abort immediately. Streaming retries/fails over only before the first chunk
 * is emitted — once tokens flow, mid-stream errors propagate.
 */
export class ResilientProvider implements LlmProvider {
  readonly name = 'resilient';
  private readonly providers: LlmProvider[];
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffFactor: number;
  private readonly jitter: boolean;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly breakers: (CircuitBreaker | null)[];

  constructor(providers: LlmProvider[], options: ResilientProviderOptions = {}) {
    if (providers.length === 0) throw new Error('ResilientProvider requires at least one provider');
    this.providers = providers;
    this.maxRetries = options.maxRetries ?? 2;
    this.initialDelayMs = options.initialDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.backoffFactor = options.backoffFactor ?? 2;
    this.jitter = options.jitter ?? true;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    const now = options.now ?? (() => Date.now());
    this.breakers = providers.map(() =>
      options.circuitBreaker === false
        ? null
        : new CircuitBreaker(options.circuitBreaker ?? {}, now),
    );
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    let lastError: unknown;
    let skippedAll = true;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const breaker = this.breakers[i];
      if (breaker && !breaker.allowRequest()) {
        lastError = lastError ?? this.circuitOpenError(provider);
        continue;
      }
      skippedAll = false;

      try {
        const result = await this.attemptWithRetry(provider, () =>
          this.withTimeout(provider, provider.complete(request)),
        );
        breaker?.recordSuccess();
        return result;
      } catch (err) {
        if (!isRetryableError(err)) throw err; // caller error — failover won't help
        breaker?.recordFailure();
        lastError = err;
      }
    }

    throw this.exhaustedError(lastError, skippedAll);
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamEvent> {
    let lastError: unknown;
    let skippedAll = true;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const breaker = this.breakers[i];
      if (breaker && !breaker.allowRequest()) {
        lastError = lastError ?? this.circuitOpenError(provider);
        continue;
      }
      skippedAll = false;

      let attempt = 0;
      // Retry loop for *starting* the stream; once a chunk is emitted we commit.
      while (true) {
        let emitted = false;
        try {
          const iterator = provider.stream(request)[Symbol.asyncIterator]();
          let next = await this.withTimeout(provider, iterator.next());
          breaker?.recordSuccess();
          while (!next.done) {
            emitted = true;
            yield next.value;
            next = await iterator.next();
          }
          return;
        } catch (err) {
          if (emitted) throw err; // mid-stream: cannot safely retry
          if (!isRetryableError(err)) throw err;
          if (attempt < this.maxRetries) {
            await this.sleep(this.backoffDelay(attempt));
            attempt += 1;
            continue;
          }
          breaker?.recordFailure();
          lastError = err;
          break; // failover to next provider
        }
      }
    }

    throw this.exhaustedError(lastError, skippedAll);
  }

  // ---- internals --------------------------------------------------------

  private async attemptWithRetry<T>(provider: LlmProvider, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        if (!isRetryableError(err) || attempt >= this.maxRetries) throw err;
        await this.sleep(this.backoffDelay(attempt));
        attempt += 1;
      }
    }
  }

  private withTimeout<T>(provider: LlmProvider, promise: Promise<T>): Promise<T> {
    if (!this.timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new LlmTimeoutError(provider.name, this.timeoutMs)),
        this.timeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Full-jitter exponential backoff: base = initial * factor^attempt (capped). */
  backoffDelay(attempt: number): number {
    const base = Math.min(this.maxDelayMs, this.initialDelayMs * this.backoffFactor ** attempt);
    return this.jitter ? Math.round(base * this.random()) : base;
  }

  private circuitOpenError(provider: LlmProvider): LlmProviderError {
    return new LlmProviderError(
      `circuit open for provider "${provider.name}"`,
      provider.name,
      undefined,
      'circuit_open',
      true,
    );
  }

  private exhaustedError(lastError: unknown, skippedAll: boolean): unknown {
    if (lastError !== undefined) return lastError;
    return new LlmProviderError(
      skippedAll ? 'all providers unavailable (circuits open)' : 'all providers failed',
      this.name,
      undefined,
      undefined,
      true,
    );
  }
}
