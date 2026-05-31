import type {
  Effort,
  LlmCallContext,
  LlmCompletion,
  LlmContentPart,
  LlmMessage,
  LlmProvider,
  LlmToolDef,
  ModelTier,
} from '@helix/llm';

/** A tool the model asked to call (normalized from a `tool_use` block). */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** The outcome of running a tool — fed back to the model as a `tool_result`. */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/** Executes one tool call. Async or sync; throwing is caught and surfaced as an error result. */
export type ToolExecutor = (call: ToolCall) => Promise<ToolResult> | ToolResult;

/**
 * The slice of an agent definition the loop needs to drive a turn. Mirrors the
 * registry's agent-definition fields relevant to execution; the loop is given a
 * resolved system prompt + tool schemas (rendering/validation live elsewhere).
 */
export interface AgentSpec {
  system?: string;
  tier?: ModelTier;
  effort?: Effort;
  maxTokens?: number;
  tools?: LlmToolDef[];
}

export type AgentStopReason = 'end_turn' | 'max_iterations' | 'stop_sequence' | 'refusal' | string;

/** One iteration of the loop: the model turn plus any tools run from it. */
export interface AgentStep {
  index: number;
  completion: LlmCompletion;
  toolCalls: ToolCall[];
  toolResults: { call: ToolCall; result: ToolResult }[];
}

export interface RunAgentOptions {
  provider: LlmProvider;
  agent: AgentSpec;
  /** Initial user input — a string or a full message list. */
  input: string | LlmMessage[];
  /** Tool handlers keyed by tool name. Missing handlers yield an error result. */
  executors?: Record<string, ToolExecutor>;
  /** Hard cap on model turns before stopping. Default 10. */
  maxIterations?: number;
  /** Attribution forwarded to the provider (and its usage meter). */
  context?: LlmCallContext;
  /** Observation hook, called once per completed step (seam for HELIX-61). */
  onStep?: (step: AgentStep) => void;
}

export interface AgentRunResult {
  /** Concatenated text of the final model turn. */
  finalText: string;
  /** Content blocks of the final model turn. */
  finalContent: LlmContentPart[];
  /** Full transcript (user, assistant, and tool_result turns) for replay/tracing. */
  messages: LlmMessage[];
  steps: AgentStep[];
  iterations: number;
  stopReason: AgentStopReason;
}
