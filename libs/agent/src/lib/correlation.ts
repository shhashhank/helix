import { randomBytes } from 'node:crypto';

/**
 * W3C Trace Context propagation (HELIX-66). Lets a run's trace id flow across
 * service boundaries via the standard `traceparent` header, so spans emitted by
 * different services correlate into one distributed trace.
 *
 * @see https://www.w3.org/TR/trace-context/
 */
export interface TraceContext {
  /** 16-byte trace id as 32 lowercase hex chars. */
  traceId: string;
  /** 8-byte span id as 16 lowercase hex chars. */
  spanId: string;
  /** Sampled flag (trace-flags bit 0). Defaults to true. */
  sampled?: boolean;
}

/** Random W3C-valid trace id (32 hex chars). */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Random W3C-valid span id (16 hex chars). */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** Format a `traceparent` header value (version 00). */
export function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.sampled === false ? '00' : '01';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a `traceparent` header into a {@link TraceContext}, or return `null` if
 * it's malformed or uses the all-zero (invalid) trace/span ids.
 */
export function parseTraceparent(header: string): TraceContext | null {
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, spanId, flags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 0x01) === 1 };
}
