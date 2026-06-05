import { REDACTED, Redactor } from '@helix/secrets';
import { RedactingTraceSink } from '../redacting-trace-sink';
import { InMemoryTraceSink, TraceSpan } from '../trace';

function span(overrides: Partial<TraceSpan>): TraceSpan {
  return {
    id: 't1:step:0:tool:c1',
    traceId: 't1',
    name: 'tool_call',
    kind: 'tool_call',
    startedAt: '2026-06-05T00:00:00.000Z',
    status: 'ok',
    attributes: {},
    ...overrides,
  };
}

describe('RedactingTraceSink', () => {
  it('scrubs secrets from span attributes before writing to the inner sink', () => {
    const inner = new InMemoryTraceSink();
    const sink = new RedactingTraceSink(inner);

    sink.write([
      span({
        attributes: {
          tool: 'github',
          request: { authorization: 'Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
          inputTokens: 42,
        },
      }),
    ]);

    const written = inner.spans[0];
    const attrs = written.attributes as {
      tool: string;
      request: { authorization: string };
      inputTokens: number;
    };
    expect(attrs.request.authorization).toBe(`Bearer ${REDACTED}`);
    expect(JSON.stringify(written)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    // non-secret structure is preserved
    expect(attrs.tool).toBe('github');
    expect(attrs.inputTokens).toBe(42);
  });

  it('leaves structural fields (id, timing, kind, status) untouched', () => {
    const inner = new InMemoryTraceSink();
    new RedactingTraceSink(inner).write([span({ name: 'model_call', durationMs: 12 })]);

    const written = inner.spans[0];
    expect(written.id).toBe('t1:step:0:tool:c1');
    expect(written.traceId).toBe('t1');
    expect(written.startedAt).toBe('2026-06-05T00:00:00.000Z');
    expect(written.kind).toBe('tool_call');
    expect(written.status).toBe('ok');
    expect(written.durationMs).toBe(12);
  });

  it('uses a provided redactor (e.g. one seeded with resolved credential values)', () => {
    const inner = new InMemoryTraceSink();
    const redactor = new Redactor({ values: ['resolved-secret-value-123'] });
    new RedactingTraceSink(inner, redactor).write([
      span({ attributes: { note: 'leaked resolved-secret-value-123 here' } }),
    ]);

    expect((inner.spans[0].attributes as { note: string }).note).toBe(`leaked ${REDACTED} here`);
  });
});
