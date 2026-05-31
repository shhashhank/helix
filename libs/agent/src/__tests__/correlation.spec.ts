import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from '../lib/correlation';

describe('trace id generators', () => {
  it('produce W3C-valid hex ids', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(generateTraceId()).not.toBe(generateTraceId()); // random
  });
});

describe('traceparent format/parse', () => {
  it('round-trips a context', () => {
    const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: true };
    const header = formatTraceparent(ctx);
    expect(header).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    expect(parseTraceparent(header)).toEqual(ctx);
  });

  it('encodes the sampled flag', () => {
    expect(formatTraceparent({ traceId: '1'.repeat(32), spanId: '2'.repeat(16), sampled: false })).toMatch(/-00$/);
    expect(parseTraceparent(`00-${'1'.repeat(32)}-${'2'.repeat(16)}-00`)?.sampled).toBe(false);
  });

  it('rejects malformed or all-zero ids', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-tooshort-2222-01')).toBeNull();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${'2'.repeat(16)}-01`)).toBeNull(); // zero trace id
    expect(parseTraceparent(`00-${'1'.repeat(32)}-${'0'.repeat(16)}-01`)).toBeNull(); // zero span id
  });

  it('accepts a generated context end to end', () => {
    const ctx = { traceId: generateTraceId(), spanId: generateSpanId(), sampled: true };
    expect(parseTraceparent(formatTraceparent(ctx))).toEqual(ctx);
  });
});
