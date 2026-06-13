/**
 * W3C Trace Context propagation across Helix service boundaries (HELIX-139).
 *
 * A run gets ONE trace id the moment it enters the orchestrator: either continued
 * from an inbound `traceparent` header (so the run joins the caller's distributed
 * trace) or freshly minted. That id is then (a) handed back to the caller, (b)
 * attached to the Temporal run as a memo, and (c) used as the parent context for
 * this service's own spans — so an API request, its workflow run, and (once the
 * agent executor is wired) the agent spans it spawns all share a single trace id
 * you can paste into Grafana/Tempo to see the whole run.
 *
 * `@helix/agent`'s `correlation.ts` is the agent-span counterpart: it stamps this
 * same trace id onto per-run agent spans built from the `agent.*` event stream.
 *
 * @see https://www.w3.org/TR/trace-context/
 */
import { randomBytes } from 'node:crypto';
import { type Context, ROOT_CONTEXT, type SpanContext, TraceFlags, trace } from '@opentelemetry/api';

/** Correlation handle for one run: a trace id plus this service's root span id. */
export interface RunCorrelation {
  /** 16-byte W3C trace id (32 lowercase hex) — constant across the whole trace. */
  traceId: string;
  /** 8-byte span id (16 lowercase hex) — this service's root span for the run. */
  spanId: string;
  /** W3C sampled flag (trace-flags bit 0). */
  sampled: boolean;
  /** Ready-to-send `traceparent` header value carrying `{traceId, spanId}`. */
  traceparent: string;
}

/** The pieces of a parsed `traceparent` (a remote span on some trace). */
export interface ParsedTraceparent {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

/** Random W3C-valid trace id (32 hex chars). */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Random W3C-valid span id (16 hex chars). */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a W3C `traceparent` (version 00) header, or return `null` when it's
 * malformed or uses the all-zero (invalid) trace/span ids.
 */
export function parseTraceparent(header: string): ParsedTraceparent | null {
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, spanId, flags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 0x01) === 1 };
}

/** Format a W3C `traceparent` (version 00) header value. */
export function formatTraceparent(parts: { traceId: string; spanId: string; sampled?: boolean }): string {
  const flags = parts.sampled === false ? '00' : '01';
  return `00-${parts.traceId}-${parts.spanId}-${flags}`;
}

/**
 * Open (or continue) a run's correlation context. Pass the inbound `traceparent`
 * header if the caller sent one: a valid value continues that trace (same trace
 * id) under a fresh span id for this service's work; anything missing or malformed
 * starts a brand-new trace. Either way the returned {@link RunCorrelation} carries
 * a `traceparent` ready to hand to the next hop and a trace id to return to the
 * caller.
 */
export function runCorrelation(incoming?: string | null): RunCorrelation {
  const parsed = incoming ? parseTraceparent(incoming) : null;
  const traceId = parsed?.traceId ?? generateTraceId();
  const sampled = parsed?.sampled ?? true;
  const spanId = generateSpanId(); // this service's own root span for the run
  return { traceId, spanId, sampled, traceparent: formatTraceparent({ traceId, spanId, sampled }) };
}

/** The {@link SpanContext} a {@link RunCorrelation} represents (a remote parent). */
export function spanContextFor(correlation: RunCorrelation): SpanContext {
  return {
    traceId: correlation.traceId,
    spanId: correlation.spanId,
    traceFlags: correlation.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
}

/**
 * An OTel {@link Context} with the run's correlation set as the active span: start
 * a span in it (`tracer.startSpan(name, {}, ctx)`) and the new span inherits the
 * run's trace id, joining everything else under that one trace.
 */
export function contextWithCorrelation(correlation: RunCorrelation, base: Context = ROOT_CONTEXT): Context {
  return trace.setSpanContext(base, spanContextFor(correlation));
}
