/**
 * Secret-scrubbing trace sink (HELIX-92).
 *
 * A decorator that wraps any {@link TraceSink} and deep-redacts each span's
 * free-form fields — its `name` and `attributes` — through a `@helix/secrets`
 * {@link Redactor} before handing them to the real sink (in-memory, OTel, …).
 * Structural fields (ids, timing, kind, status) are left untouched. Wrapping a
 * sink with this is how "secrets are scrubbed from all telemetry" is enforced at
 * the export boundary, regardless of which sink is underneath.
 *
 *   const sink = new RedactingTraceSink(new OtelTraceSink(...));
 */
import { createDefaultRedactor, Redactor } from '@helix/secrets';
import type { TraceSink, TraceSpan } from './trace';

export class RedactingTraceSink implements TraceSink {
  constructor(
    private readonly inner: TraceSink,
    private readonly redactor: Redactor = createDefaultRedactor(),
  ) {}

  write(spans: TraceSpan[]): Promise<void> | void {
    return this.inner.write(spans.map((span) => this.redactSpan(span)));
  }

  private redactSpan(span: TraceSpan): TraceSpan {
    return {
      ...span,
      name: this.redactor.redact(span.name),
      attributes: this.redactor.redactDeep(span.attributes),
    };
  }
}
