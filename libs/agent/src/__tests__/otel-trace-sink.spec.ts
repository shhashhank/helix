import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OtelTraceSink } from '../lib/otel-trace-sink';
import type { TraceSpan } from '../lib/trace';

function setup() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const sink = new OtelTraceSink(provider.getTracer('test'));
  return { exporter, sink };
}

const t0 = '2026-05-31T10:00:00.000Z';
const t1 = '2026-05-31T10:00:00.050Z';

const spans: TraceSpan[] = [
  {
    id: 'r:run',
    traceId: 'r',
    name: 'agent.run',
    kind: 'run',
    startedAt: t0,
    endedAt: t1,
    durationMs: 50,
    status: 'ok',
    attributes: { stopReason: 'end_turn', iterations: 1, breach: { type: 'none' } },
  },
  {
    id: 'r:step:0',
    traceId: 'r',
    parentId: 'r:run',
    name: 'step 0',
    kind: 'step',
    startedAt: t0,
    endedAt: t1,
    durationMs: 50,
    status: 'ok',
    attributes: { index: 0 },
  },
  {
    id: 'r:step:0:model',
    traceId: 'r',
    parentId: 'r:step:0',
    name: 'model_call',
    kind: 'model_call',
    startedAt: t0,
    endedAt: t1,
    durationMs: 50,
    status: 'ok',
    attributes: { model: 'claude-opus-4-8', inputTokens: 5 },
  },
  {
    id: 'r:step:0:tool:tu1',
    traceId: 'r',
    parentId: 'r:step:0',
    name: 'search',
    kind: 'tool_call',
    startedAt: t0,
    endedAt: t1,
    durationMs: 50,
    status: 'error',
    attributes: { tool: 'search', isError: true },
  },
];

describe('OtelTraceSink', () => {
  it('exports one OTel span per Helix span under a single trace', () => {
    const { exporter, sink } = setup();
    sink.write(spans);

    const finished = exporter.getFinishedSpans();
    expect(finished).toHaveLength(4);
    const traceIds = new Set(finished.map((s) => s.spanContext().traceId));
    expect(traceIds.size).toBe(1); // all share one OTel trace
  });

  it('preserves parent/child links', () => {
    const { exporter, sink } = setup();
    sink.write(spans);
    const byName = Object.fromEntries(exporter.getFinishedSpans().map((s) => [s.name, s]));

    expect(byName['agent.run'].parentSpanContext?.spanId).toBeUndefined(); // root
    expect(byName['step 0'].parentSpanContext?.spanId).toBe(byName['agent.run'].spanContext().spanId);
    expect(byName['model_call'].parentSpanContext?.spanId).toBe(byName['step 0'].spanContext().spanId);
    expect(byName['search'].parentSpanContext?.spanId).toBe(byName['step 0'].spanContext().spanId);
  });

  it('maps timing, status, and flattened attributes', () => {
    const { exporter, sink } = setup();
    sink.write(spans);
    const byName = Object.fromEntries(exporter.getFinishedSpans().map((s) => [s.name, s]));

    const model = byName['model_call'];
    expect(model.attributes['helix.span.kind']).toBe('model_call');
    expect(model.attributes['helix.model']).toBe('claude-opus-4-8');
    expect(model.attributes['helix.inputTokens']).toBe(5);

    // error status propagates; object attributes are JSON-stringified
    expect(byName['search'].status.code).toBe(2); // SpanStatusCode.ERROR
    expect(byName['search'].attributes['helix.isError']).toBe(true);
    expect(byName['agent.run'].attributes['helix.breach']).toBe('{"type":"none"}');

    // duration derived from start/end timestamps
    const [secs, nanos] = byName['agent.run'].duration;
    expect(secs * 1000 + nanos / 1e6).toBeCloseTo(50, 3);
  });
});
