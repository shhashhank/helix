/**
 * Provider-neutral LLM types for the Helix gateway (HELIX-54).
 *
 * MVP is Anthropic-only, but every shape here is deliberately vendor-agnostic
 * so the routing layer (HELIX-55) and future providers sit behind one
 * interface. Provider adapters translate between these shapes and their SDK.
 */

/** Model capability tier; mapped to a concrete model id by each provider. */
export type ModelTier = 'opus' | 'sonnet' | 'haiku';

/**
 * Reasoning effort (Anthropic `output_config.effort`). Opus-tier supports the
 * full range incl. `xhigh`/`max`; Sonnet supports up to `high`; Haiku does not
 * support effort at all. The routing policy is responsible for only emitting
 * effort on tiers that accept it.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type LlmRole = 'user' | 'assistant';

export interface LlmTextPart {
  type: 'text';
  text: string;
}

export interface LlmToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface LlmToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type LlmContentPart = LlmTextPart | LlmToolUsePart | LlmToolResultPart;

export interface LlmMessage {
  role: LlmRole;
  /** Plain string (shorthand for a single text part) or explicit parts. */
  content: string | LlmContentPart[];
}

export interface LlmToolDef {
  name: string;
  description?: string;
  /** JSON Schema object for the tool input. */
  inputSchema: Record<string, unknown>;
}

export type LlmToolChoice = 'auto' | 'any' | 'none' | { name: string };

/**
 * Optional attribution for a call — who/what it's on behalf of. Carried on the
 * request and recorded by the usage meter (HELIX-57) so spend can be attributed
 * to a run / org / agent. Ignored by providers themselves.
 */
export interface LlmCallContext {
  runId?: string;
  orgId?: string | null;
  agentRole?: string;
  taskClass?: string;
}

export interface LlmCompletionRequest {
  /** Capability tier; ignored when `model` is set. Defaults to `opus`. */
  tier?: ModelTier;
  /** Explicit model id override (wins over `tier`). */
  model?: string;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  toolChoice?: LlmToolChoice;
  maxTokens?: number;
  stopSequences?: string[];
  /** Reasoning effort. Only set on tiers that support it (opus/sonnet). */
  effort?: Effort;
  /** Add an ephemeral cache breakpoint on the system prompt (prompt caching). */
  cacheSystemPrompt?: boolean;
  /** Attribution for usage metering (HELIX-57); ignored by the provider itself. */
  context?: LlmCallContext;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export type LlmStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | string;

export interface LlmCompletion {
  model: string;
  stopReason: LlmStopReason | null;
  /** Normalized assistant output blocks (text and tool_use). */
  content: LlmContentPart[];
  /** Convenience: all text parts concatenated. */
  text: string;
  usage: LlmUsage;
  /** The untouched provider response, for debugging/tracing. */
  raw?: unknown;
}

/** Incremental events emitted while streaming a completion. */
export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input_delta'; partialJson: string }
  | { type: 'done'; completion: LlmCompletion };

export interface LlmProvider {
  /** Stable identifier, e.g. `"anthropic"`. */
  readonly name: string;
  /** Single-shot completion. */
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
  /** Streaming completion; final event is `{ type: 'done', completion }`. */
  stream(request: LlmCompletionRequest): AsyncIterable<LlmStreamEvent>;
}
