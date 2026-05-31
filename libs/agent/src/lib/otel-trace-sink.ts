import {
  ROOT_CONTEXT,
  type Attributes,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import type { TraceSink, TraceSpan } from './trace';

// Parents must be created before children. Our completed-span list has tool/model
// spans before their step (steps end last), so emit by kind rank instead.
const KIND_RANK: Record<TraceSpan['kind'], number> = {
  run: 0,
  step: 1,
  model_call: 2,
  tool_call: 2,
};

/** Flatten span attributes to OTel-safe primitives, namespaced under `helix.`. */
function toOtelAttributes(span: TraceSpan): Attributes {
  const attrs: Attributes = { 'helix.span.kind': span.kind };
  for (const [key, value] of Object.entries(span.attributes)) {
    if (value === null || value === undefined) continue;
    attrs[`helix.${key}`] =
      typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean);
  }
  return attrs;
}

/**
 * Exports {@link TraceSpan}s to OpenTelemetry (HELIX-66). Each Helix span becomes
 * an OTel span under the same root, preserving parent/child links and timing, so
 * runs show up in any OTel backend (Tempo, Jaeger, console). The caller supplies
 * a configured `Tracer`; this sink just translates and emits.
 */
export class OtelTraceSink implements TraceSink {
  constructor(private readonly tracer: Tracer) {}

  write(spans: TraceSpan[]): void {
    const ordered = [...spans].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
    const otelById = new Map<string, Span>();

    for (const s of ordered) {
      const parent = s.parentId ? otelById.get(s.parentId) : undefined;
      const ctx = parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT;

      const span = this.tracer.startSpan(
        s.name,
        { startTime: new Date(s.startedAt), attributes: toOtelAttributes(s) },
        ctx,
      );
      span.setStatus({ code: s.status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      span.end(s.endedAt ? new Date(s.endedAt) : undefined);
      otelById.set(s.id, span);
    }
  }
}
