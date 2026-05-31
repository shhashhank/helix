import Anthropic from '@anthropic-ai/sdk';
import { LlmProviderError, isRetryableStatus } from './errors';
import {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
  LlmToolChoice,
  LlmToolDef,
  LlmUsage,
  ModelTier,
} from './types';

/** Default tier → model id map (HELIX-54 ships Anthropic only). */
const DEFAULT_MODEL_BY_TIER: Record<ModelTier, string> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

const DEFAULT_MAX_TOKENS = 16_000; // non-streaming: stays under SDK HTTP timeout
const DEFAULT_STREAM_MAX_TOKENS = 64_000; // streaming: room to run

export interface AnthropicProviderOptions {
  /** Pre-built SDK client. Injected in tests; in production omit and pass `apiKey`/env. */
  client?: Anthropic;
  apiKey?: string;
  defaultMaxTokens?: number;
  defaultStreamMaxTokens?: number;
  /** Override individual tier → model mappings. */
  modelByTier?: Partial<Record<ModelTier, string>>;
}

/**
 * Anthropic adapter implementing the neutral {@link LlmProvider}: normalizes
 * messages, tool definitions, tool-use, streaming, and usage to/from the
 * `@anthropic-ai/sdk` Messages API. No sampling params or thinking are set here
 * — model policy (thinking/effort) is the routing layer's job (HELIX-55).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly maxTokens: number;
  private readonly streamMaxTokens: number;
  private readonly modelByTier: Record<ModelTier, string>;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.maxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    this.streamMaxTokens = options.defaultStreamMaxTokens ?? DEFAULT_STREAM_MAX_TOKENS;
    this.modelByTier = { ...DEFAULT_MODEL_BY_TIER, ...options.modelByTier };
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const body = this.buildParams(request, false);
    try {
      const message = await this.client.messages.create(body);
      return this.toCompletion(message);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamEvent> {
    const body = this.buildParams(request, true);
    let runner: ReturnType<Anthropic['messages']['stream']>;
    try {
      runner = this.client.messages.stream(body);
    } catch (err) {
      throw this.wrapError(err);
    }

    try {
      for await (const event of runner) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name };
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            yield { type: 'tool_use_input_delta', partialJson: event.delta.partial_json };
          }
        }
      }
      const finalMessage = await runner.finalMessage();
      yield { type: 'done', completion: this.toCompletion(finalMessage) };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  // ---- request building -------------------------------------------------

  resolveModel(request: LlmCompletionRequest): string {
    if (request.model) return request.model;
    return this.modelByTier[request.tier ?? 'opus'];
  }

  private buildParams(
    request: LlmCompletionRequest,
    streaming: boolean,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.resolveModel(request),
      max_tokens: request.maxTokens ?? (streaming ? this.streamMaxTokens : this.maxTokens),
      messages: request.messages.map(toAnthropicMessage),
    };
    if (request.system) {
      body.system = request.cacheSystemPrompt
        ? [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }]
        : request.system;
    }
    if (request.tools?.length) body.tools = request.tools.map(toAnthropicTool);
    if (request.toolChoice) body.tool_choice = toAnthropicToolChoice(request.toolChoice);
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;
    if (request.effort) body.output_config = { effort: request.effort };
    return body;
  }

  // ---- response normalization ------------------------------------------

  private toCompletion(message: Anthropic.Message): LlmCompletion {
    const content = normalizeContent(message.content);
    return {
      model: message.model,
      stopReason: message.stop_reason,
      content,
      text: content
        .filter((b): b is Extract<LlmContentPart, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      usage: normalizeUsage(message.usage),
      raw: message,
    };
  }

  private wrapError(err: unknown): LlmProviderError {
    if (err instanceof Anthropic.APIError) {
      const status = err.status;
      const type = (err as { type?: string }).type;
      const retryable = err instanceof Anthropic.APIConnectionError || isRetryableStatus(status);
      return new LlmProviderError(err.message, this.name, status, type, retryable, err);
    }
    return new LlmProviderError(
      err instanceof Error ? err.message : String(err),
      this.name,
      undefined,
      undefined,
      false,
      err,
    );
  }
}

// ---- pure mapping helpers (exported for unit testing) -------------------

export function toAnthropicMessage(message: LlmMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  const blocks = message.content.map((part): Anthropic.ContentBlockParam => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text };
      case 'tool_use':
        return { type: 'tool_use', id: part.id, name: part.name, input: part.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: part.toolUseId,
          content: part.content,
          ...(part.isError ? { is_error: true } : {}),
        };
    }
  });
  return { role: message.role, content: blocks };
}

export function toAnthropicTool(tool: LlmToolDef): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

export function toAnthropicToolChoice(choice: LlmToolChoice): Anthropic.ToolChoice {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'any') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  return { type: 'tool', name: choice.name };
}

export function normalizeContent(blocks: Anthropic.ContentBlock[]): LlmContentPart[] {
  const out: LlmContentPart[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      out.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      out.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    }
    // thinking / server_tool_use / other blocks are intentionally dropped here.
  }
  return out;
}

export function normalizeUsage(usage: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}
