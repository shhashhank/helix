/**
 * Typed `fetch` client for the orchestrator API (HELIX-175).
 *
 * One thin wrapper every screen reuses: it prefixes the API base URL, attaches the
 * session bearer token (read lazily so it always sends the current one), parses JSON,
 * and turns non-2xx responses into an {@link ApiError} carrying the status. SSE streams
 * (the run dashboard) are handled separately — this covers the request/response calls.
 */

declare global {
  interface Window {
    /** Optional runtime override for the API base URL (set by a deployment / index.html). */
    __HELIX_API_BASE__?: string;
  }
}

/** Default orchestrator base; override at runtime via `window.__HELIX_API_BASE__`. */
export const DEFAULT_API_BASE = 'http://localhost:3100';

/** Resolve the API base URL (runtime override, else the dev default). */
export function resolveApiBase(): string {
  return (typeof window !== 'undefined' && window.__HELIX_API_BASE__) || DEFAULT_API_BASE;
}

/** An error from a non-2xx API response, carrying the HTTP status. */
export interface ApiError extends Error {
  status: number;
}

export class ApiClient {
  constructor(
    private readonly getToken: () => string | undefined,
    private readonly baseUrl: string = resolveApiBase(),
  ) {}

  /** The base URL this client targets (handy for building SSE EventSource URLs). */
  get base(): string {
    return this.baseUrl;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const error = new Error(detail || `${res.status} ${res.statusText}`) as ApiError;
      error.status = res.status;
      throw error;
    }

    if (res.status === 204) return undefined as T;
    const contentType = res.headers.get('content-type') ?? '';
    return (contentType.includes('application/json') ? await res.json() : await res.text()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /**
   * Consume a Server-Sent Events stream, calling `onEvent` with each parsed `data:`
   * payload. Uses `fetch` (not `EventSource`) so it can send the `Authorization` header.
   * Resolves when the stream ends; pass an `AbortSignal` to stop early.
   */
  async streamEvents<T>(path: string, onEvent: (data: T) => void, signal?: AbortSignal): Promise<void> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal,
    });
    if (!res.ok || !res.body) {
      const error = new Error(`stream ${path} failed: ${res.status} ${res.statusText}`) as ApiError;
      error.status = res.status;
      throw error;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) continue; // keepalive / comment frames
        try {
          onEvent(JSON.parse(data) as T);
        } catch {
          /* ignore non-JSON frames */
        }
      }
    }
  }
}
