import type { LlmCompletion, LlmContentPart, LlmProvider } from '@helix/llm';
import { runAgent } from '../lib/agent-loop';
import { extractJson, validateOutput } from '../lib/output';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'count'],
  properties: {
    title: { type: 'string' },
    count: { type: 'integer' },
  },
};

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a ```json fenced block', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nthanks')).toEqual({ a: 1 });
  });

  it('parses a bare ``` fenced block', () => {
    expect(extractJson('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('extracts JSON embedded in prose', () => {
    expect(extractJson('The answer is {"a": 1, "b": 2} as requested.')).toEqual({ a: 1, b: 2 });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/no parseable JSON/);
  });
});

describe('validateOutput', () => {
  it('returns valid + data for schema-conformant JSON', () => {
    const r = validateOutput('{"title":"hi","count":3}', schema);
    expect(r.valid).toBe(true);
    expect(r.data).toEqual({ title: 'hi', count: 3 });
  });

  it('coerces fenced JSON then validates', () => {
    const r = validateOutput('```json\n{"title":"hi","count":3}\n```', schema);
    expect(r.valid).toBe(true);
  });

  it('reports schema errors (missing required / wrong type)', () => {
    const r = validateOutput('{"title":"hi","count":"three"}', schema);
    expect(r.valid).toBe(false);
    expect(r.data).toEqual({ title: 'hi', count: 'three' }); // parsed, but invalid
    expect(r.errors?.join('\n')).toMatch(/count/);
  });

  it('reports a parse error for non-JSON', () => {
    const r = validateOutput('definitely not json', schema);
    expect(r.valid).toBe(false);
    expect(r.data).toBeUndefined();
    expect(r.errors?.[0]).toMatch(/no parseable JSON/);
  });
});

describe('runAgent output validation', () => {
  const completion = (text: string): LlmCompletion => ({
    model: 'claude-opus-4-8',
    stopReason: 'end_turn',
    content: [{ type: 'text', text } as LlmContentPart],
    text,
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  });
  const provider = (text: string): LlmProvider => ({
    name: 'fake',
    async complete() {
      return completion(text);
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('unused');
    },
  });

  it('attaches a valid parsed output when the agent has an outputSchema', async () => {
    const result = await runAgent({
      provider: provider('```json\n{"title":"done","count":2}\n```'),
      agent: { outputSchema: schema },
      input: 'go',
    });
    expect(result.output?.valid).toBe(true);
    expect(result.output?.data).toEqual({ title: 'done', count: 2 });
  });

  it('flags an invalid output without failing the run', async () => {
    const result = await runAgent({
      provider: provider('{"title":"done"}'), // missing required `count`
      agent: { outputSchema: schema },
      input: 'go',
    });
    expect(result.stopReason).toBe('end_turn');
    expect(result.output?.valid).toBe(false);
    expect(result.output?.errors?.join('\n')).toMatch(/count/);
  });

  it('omits output when no schema is configured', async () => {
    const result = await runAgent({ provider: provider('whatever'), agent: {}, input: 'go' });
    expect(result.output).toBeUndefined();
  });
});
