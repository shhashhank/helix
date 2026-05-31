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
