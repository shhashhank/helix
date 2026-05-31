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
import type { OutputValidationResult } from './output';

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
  /** JSON Schema the final output is coerced + validated against (HELIX-60). */
  outputSchema?: Record<string, unknown>;
}

export type AgentStopReason =
  | 'end_turn'
  | 'max_iterations'
  | 'max_steps'
  | 'token_budget'
  | 'cost_budget'
  | 'loop_detected'
  | 'stop_sequence'
  | 'refusal'
  | string;

/**
 * Run-level limits enforced by the loop (HELIX-59). Any breach stops the run
 * with the matching {@link AgentStopReason} and a {@link GuardrailBreach}.
 */
export interface Guardrails {
  /** Max model turns. Stops with `max_steps` (distinct from the loop's hard `maxIterations`). */
  maxSteps?: number;
  /** Cumulative token ceiling across the run (input + output + cache). */
  maxTokens?: number;
  /** Cumulative estimated USD-cost ceiling across the run. */
  maxCostUsd?: number;
  /** Stop if the model repeats the same tool call(s). `true` uses defaults. */
  loopDetection?: boolean | { windowSize?: number };
}

export type GuardrailBreach =
  | { type: 'max_steps'; limit: number; observed: number }
  | { type: 'token_budget'; limit: number; observed: number }
  | { type: 'cost_budget'; limit: number; observed: number }
  | { type: 'loop_detected'; signature: string; repeats: number };

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
  /** Run-level budgets/limits (HELIX-59); enforced on top of `maxIterations`. */
  guardrails?: Guardrails;
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
  /** Set when the run stopped because a guardrail tripped. */
  breach?: GuardrailBreach;
  /** Cumulative token + estimated cost totals for the run. */
  totals: { tokens: number; costUsd: number };
  /** Coerced + schema-validated final output, when `agent.outputSchema` is set (HELIX-60). */
  output?: OutputValidationResult;
}
