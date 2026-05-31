/**
 * Normalized provider error. Adapters wrap their SDK's typed errors in this so
 * the routing/retry layer (HELIX-56) can make provider-agnostic decisions —
 * notably `retryable`, which marks transient failures (429/5xx) safe to retry.
 */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status: number | undefined,
    public readonly type: string | undefined,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

/** HTTP statuses that are safe to retry: rate limit, server, overloaded. */
export function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 529 || (status !== undefined && status >= 500);
}

/** Raised when a provider call exceeds its per-attempt timeout. Always retryable. */
export class LlmTimeoutError extends Error {
  constructor(
    public readonly provider: string,
    public readonly timeoutMs: number,
  ) {
    super(`provider "${provider}" timed out after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

/**
 * Whether an error is safe to retry: a timeout, or a provider error explicitly
 * flagged retryable (429/5xx/529/connection). Everything else (e.g. a 400 bad
 * request) is a caller problem and is not retried.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof LlmTimeoutError) return true;
  if (err instanceof LlmProviderError) return err.retryable;
  return false;
}
