/**
 * Idempotency for side effects (HELIX-72). When the durable engine retries a step
 * (e.g. Temporal re-runs an activity after a crash), any *side effect* it performs
 * — a tool call, an external API write — must not happen twice. An
 * {@link IdempotencyGuard} runs a side effect **at most once per key**: the first
 * call executes it and records the result; later calls with the same key replay
 * the stored result instead of re-running.
 *
 * The key is supplied by the caller and must be **stable across retries** of the
 * same logical action — see {@link import('./temporal/idempotency-key')} for the
 * Temporal-activity key derivation.
 *
 * Limit (documented, not a bug): the result is recorded only *after* `fn`
 * succeeds, so a crash between the side effect and the record can still repeat it.
 * For true at-most-once, pass the same key down to an external API that itself
 * dedupes on an idempotency key (the Stripe model) — this guard makes that key
 * available and dedupes everything within reach of the store.
 */

/** A recorded result for an idempotency key. */
export interface IdempotencyRecord {
  value: unknown;
}

/** Persists results of side-effecting actions, keyed by idempotency key. */
export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | undefined>;
  set(key: string, record: IdempotencyRecord): Promise<void>;
}

/** Outcome of a guarded action. */
export interface IdempotentResult<T> {
  value: T;
  /** True if `fn` actually ran now; false if a stored/in-flight result was replayed. */
  executed: boolean;
}

/** Process-local idempotency store. Swap for a Prisma/Redis-backed store for cross-process dedupe. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    return this.records.get(key);
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    this.records.set(key, record);
  }

  /** Test/inspection helper: how many results are recorded. */
  get size(): number {
    return this.records.size;
  }
}

/**
 * Runs side effects at most once per idempotency key, backed by a pluggable
 * {@link IdempotencyStore}. Also single-flights concurrent calls for the same key
 * (the second caller joins the first rather than double-executing), and does
 * **not** cache failures — a throwing `fn` leaves the key unrecorded so a later
 * attempt can retry.
 */
export class IdempotencyGuard {
  /** Same-key calls in progress, so concurrent callers share one execution. */
  private readonly inflight = new Map<string, Promise<IdempotentResult<unknown>>>();

  constructor(private readonly store: IdempotencyStore) {}

  /** True if a result is already recorded for `key`. */
  async has(key: string): Promise<boolean> {
    return (await this.store.get(key)) !== undefined;
  }

  /**
   * Execute `fn` only if `key` hasn't been run before; otherwise replay the
   * stored (or in-flight) result. `executed` tells you which happened.
   */
  async runOnce<T>(key: string, fn: () => Promise<T> | T): Promise<IdempotentResult<T>> {
    // Join a concurrent in-flight execution for the same key (never re-runs fn).
    const pending = this.inflight.get(key) as Promise<IdempotentResult<T>> | undefined;
    if (pending) return { value: (await pending).value, executed: false };

    // Register the work promise synchronously (before any await) so concurrent
    // callers see it. It's awaited below, so a rejection is always handled.
    const work = this.execute<T>(key, fn);
    this.inflight.set(key, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async execute<T>(key: string, fn: () => Promise<T> | T): Promise<IdempotentResult<T>> {
    const cached = await this.store.get(key);
    if (cached !== undefined) return { value: cached.value as T, executed: false };

    const value = await fn();
    await this.store.set(key, { value });
    return { value, executed: true };
  }
}
