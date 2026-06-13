import type { LlmCompletion, LlmCompletionRequest, LlmProvider, LlmStopReason, LlmStreamEvent } from './types';

/** What a {@link ScriptedLlmProvider} returns (all optional — sensible defaults). */
export interface ScriptedCompletion {
  text?: string;
  stopReason?: LlmStopReason;
  model?: string;
}

/**
 * A fake {@link LlmProvider} for dev/CI with no API key (HELIX-158): returns a fixed,
 * scripted completion instead of calling a model. Lets the full agent loop / executor
 * pipeline run **offline** — agents "think" and finish their turn, just with canned
 * text — so a worker can execute a run end-to-end without `ANTHROPIC_API_KEY`.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';

  constructor(private readonly scripted: ScriptedCompletion = {}) {}

  async complete(_request: LlmCompletionRequest): Promise<LlmCompletion> {
    const text = this.scripted.text ?? '(scripted completion — no LLM configured)';
    return {
      model: this.scripted.model ?? 'scripted',
      stopReason: this.scripted.stopReason ?? 'end_turn',
      content: [{ type: 'text', text }],
      text,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
  }

  /** Streams the same canned completion: one text event, then `done`. */
  async *stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamEvent> {
    const completion = await this.complete(request);
    yield { type: 'text', text: completion.text };
    yield { type: 'done', completion };
  }
}
