import Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicProvider,
  normalizeUsage,
  toAnthropicMessage,
  toAnthropicToolChoice,
} from '../lib/anthropic.provider';
import { LlmProviderError, isRetryableStatus } from '../lib/errors';
import { LlmCompletionRequest } from '../lib/types';

const fakeMessage = (overrides: Partial<Anthropic.Message> = {}): Anthropic.Message =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-8',
    content: [{ type: 'text', text: 'hello' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  }) as unknown as Anthropic.Message;

/** Async-iterable + finalMessage(), matching what client.messages.stream() returns. */
function fakeStream(events: unknown[], finalMessage: Anthropic.Message) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    finalMessage: async () => finalMessage,
  };
}

function makeProvider() {
  const create = jest.fn();
  const stream = jest.fn();
  const client = { messages: { create, stream } } as unknown as Anthropic;
  return { provider: new AnthropicProvider({ client }), create, stream };
}

const baseReq = (overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest => ({
  messages: [{ role: 'user', content: 'Hi' }],
  ...overrides,
});

describe('AnthropicProvider.complete', () => {
  it('maps the request to the SDK body with defaults (opus, 16k max tokens)', async () => {
    const { provider, create } = makeProvider();
    create.mockResolvedValue(fakeMessage());

    await provider.complete(baseReq());

    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({
      model: 'claude-opus-4-8',
      max_tokens: 16_000,
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('normalizes content (text + tool_use), text, usage and stop reason', async () => {
    const { provider, create } = makeProvider();
    create.mockResolvedValue(
      fakeMessage({
        model: 'claude-opus-4-8',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'x' } },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 8,
          cache_read_input_tokens: 64,
        },
      } as unknown as Partial<Anthropic.Message>),
    );

    const out = await provider.complete(baseReq());

    expect(out.stopReason).toBe('tool_use');
    expect(out.text).toBe('let me check');
    expect(out.content).toEqual([
      { type: 'text', text: 'let me check' },
      { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'x' } },
    ]);
    expect(out.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 8,
      cacheReadInputTokens: 64,
    });
  });

  it('maps tier to a model id and lets explicit model win', async () => {
    const { provider, create } = makeProvider();
    create.mockResolvedValue(fakeMessage());

    await provider.complete(baseReq({ tier: 'haiku' }));
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');

    await provider.complete(baseReq({ tier: 'haiku', model: 'custom-model-x' }));
    expect(create.mock.calls[1][0].model).toBe('custom-model-x');
  });

  it('adds an ephemeral cache breakpoint on the system prompt only when requested', async () => {
    const { provider, create } = makeProvider();
    create.mockResolvedValue(fakeMessage());

    await provider.complete(baseReq({ system: 'You are X', cacheSystemPrompt: true }));
    expect(create.mock.calls[0][0].system).toEqual([
      { type: 'text', text: 'You are X', cache_control: { type: 'ephemeral' } },
    ]);

    await provider.complete(baseReq({ system: 'You are X' }));
    expect(create.mock.calls[1][0].system).toBe('You are X');
  });

  it('forwards tools and tool_choice', async () => {
    const { provider, create } = makeProvider();
    create.mockResolvedValue(fakeMessage());

    await provider.complete(
      baseReq({
        tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }],
        toolChoice: { name: 'search' },
      }),
    );

    const body = create.mock.calls[0][0];
    expect(body.tools).toEqual([
      { name: 'search', description: 'Search', input_schema: { type: 'object' } },
    ]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'search' });
  });
});

describe('AnthropicProvider.stream', () => {
  it('emits text, tool-use, and a final done event', async () => {
    const { provider, stream } = makeProvider();
    const finalMsg = fakeMessage({
      content: [{ type: 'text', text: 'done' }],
    } as unknown as Partial<Anthropic.Message>);
    stream.mockReturnValue(
      fakeStream(
        [
          { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_9', name: 'calc' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'he' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'llo' } },
          { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":' } },
          { type: 'message_stop' },
        ],
        finalMsg,
      ),
    );

    const events = [];
    for await (const e of provider.stream(baseReq())) events.push(e);

    expect(events).toEqual([
      { type: 'tool_use_start', id: 'tu_9', name: 'calc' },
      { type: 'text', text: 'he' },
      { type: 'text', text: 'llo' },
      { type: 'tool_use_input_delta', partialJson: '{"a":' },
      { type: 'done', completion: expect.objectContaining({ text: 'done' }) },
    ]);
  });
});

describe('AnthropicProvider error normalization', () => {
  it('wraps connection errors as retryable LlmProviderError', async () => {
    const { provider, create } = makeProvider();
    create.mockRejectedValue(new Anthropic.APIConnectionError({ message: 'network down' }));

    await expect(provider.complete(baseReq())).rejects.toMatchObject({
      name: 'LlmProviderError',
      provider: 'anthropic',
      retryable: true,
    });
  });

  it('wraps unknown errors as non-retryable', async () => {
    const { provider, create } = makeProvider();
    create.mockRejectedValue(new Error('boom'));

    await expect(provider.complete(baseReq())).rejects.toMatchObject({
      name: 'LlmProviderError',
      retryable: false,
    });
  });
});

describe('pure mappers', () => {
  it('isRetryableStatus marks 429/5xx/529 retryable only', () => {
    expect([429, 500, 503, 529].map(isRetryableStatus)).toEqual([true, true, true, true]);
    expect([400, 401, 404, undefined].map(isRetryableStatus)).toEqual([false, false, false, false]);
  });

  it('toAnthropicMessage maps tool_result parts', () => {
    expect(
      toAnthropicMessage({
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'tu_1', content: 'ok', isError: true }],
      }),
    ).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: true }],
    });
  });

  it('toAnthropicToolChoice maps every variant', () => {
    expect(toAnthropicToolChoice('auto')).toEqual({ type: 'auto' });
    expect(toAnthropicToolChoice('any')).toEqual({ type: 'any' });
    expect(toAnthropicToolChoice('none')).toEqual({ type: 'none' });
    expect(toAnthropicToolChoice({ name: 'search' })).toEqual({ type: 'tool', name: 'search' });
  });

  it('normalizeUsage defaults missing cache fields to 0', () => {
    expect(
      normalizeUsage({ input_tokens: 3, output_tokens: 1 } as unknown as Anthropic.Usage),
    ).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it('LlmProviderError carries provider/status/type/retryable', () => {
    const e = new LlmProviderError('x', 'anthropic', 429, 'rate_limit_error', true);
    expect([e.provider, e.status, e.type, e.retryable]).toEqual([
      'anthropic',
      429,
      'rate_limit_error',
      true,
    ]);
  });
});
