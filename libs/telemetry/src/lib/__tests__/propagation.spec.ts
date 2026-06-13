import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { initTelemetry } from '../telemetry';
import {
  contextWithCorrelation,
  formatTraceparent,
  parseTraceparent,
  runCorrelation,
  spanContextFor,
} from '../propagation';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

describe('parseTraceparent / formatTraceparent', () => {
  it('round-trips a valid traceparent', () => {
    const header = `00-${TRACE_ID}-${SPAN_ID}-01`;
    const parsed = parseTraceparent(header);
    expect(parsed).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, sampled: true });
    expect(formatTraceparent(parsed!)).toBe(header);
  });

  it('reads the sampled flag and is case-insensitive / trim-tolerant', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)?.sampled).toBe(false);
    expect(parseTraceparent(`  00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01  `)?.traceId).toBe(TRACE_ID);
  });

  it('rejects malformed or all-zero ids', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(parseTraceparent('00-zzz-zzz-01')).toBeNull();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${SPAN_ID}-01`)).toBeNull();
    expect(parseTraceparent(`00-${TRACE_ID}-${'0'.repeat(16)}-01`)).toBeNull();
  });

  it('formats an unsampled traceparent when sampled is false', () => {
    expect(formatTraceparent({ traceId: TRACE_ID, spanId: SPAN_ID, sampled: false })).toBe(
      `00-${TRACE_ID}-${SPAN_ID}-00`,
    );
  });
});

describe('runCorrelation', () => {
  it('mints a fresh trace when there is no inbound header', () => {
    const corr = runCorrelation();
    expect(corr.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(corr.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(corr.sampled).toBe(true);
    expect(corr.traceparent).toBe(`00-${corr.traceId}-${corr.spanId}-01`);
  });

  it('continues an inbound trace under a fresh span id', () => {
    const corr = runCorrelation(`00-${TRACE_ID}-${SPAN_ID}-01`);
    expect(corr.traceId).toBe(TRACE_ID); // same distributed trace
    expect(corr.spanId).not.toBe(SPAN_ID); // but our own root span
    expect(corr.traceparent).toBe(`00-${TRACE_ID}-${corr.spanId}-01`);
  });

  it('preserves an inbound unsampled flag', () => {
    expect(runCorrelation(`00-${TRACE_ID}-${SPAN_ID}-00`).sampled).toBe(false);
  });

  it('falls back to a fresh trace when the inbound header is malformed', () => {
    expect(runCorrelation('garbage').traceId).not.toBe(TRACE_ID);
    expect(runCorrelation('garbage').traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('contextWithCorrelation', () => {
  it('marks the correlation as a remote parent span', () => {
    const corr = runCorrelation();
    expect(spanContextFor(corr)).toEqual({
      traceId: corr.traceId,
      spanId: corr.spanId,
      traceFlags: 1,
      isRemote: true,
    });
  });

  it('a span started in the context inherits the run trace id (end-to-end)', async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = initTelemetry({ serviceName: 'orchestrator', exporter, simple: true });
    const corr = runCorrelation(`00-${TRACE_ID}-${SPAN_ID}-01`);

    telemetry.tracer.startSpan('start-run', {}, contextWithCorrelation(corr)).end();

    const [span] = exporter.getFinishedSpans();
    expect(span.spanContext().traceId).toBe(TRACE_ID); // same trace as the caller
    expect(span.parentSpanContext?.spanId).toBe(corr.spanId); // parented at our root span
    await telemetry.shutdown();
  });
});
