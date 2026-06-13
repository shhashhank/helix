import type { AgentRunResult, AgentSpec, RunAgentOptions, ToolExecutor } from '@helix/agent';
import type { LlmCallContext, LlmMessage, LlmProvider } from '@helix/llm';
import type { AgentSpecResolver } from './agent-spec';
import type { ExecutableStep, StepExecutionResult, StepExecutor } from './executor';

/**
 * Generic role executor (HELIX-154): runs a workflow step by driving the agent loop.
 * Resolve the role's {@link AgentSpec}, build the agent input from the step + prior
 * step outputs (the step-to-step context flow), run it, and map the
 * {@link AgentRunResult} to a step success/failure.
 *
 * The agent loop is **injected** as {@link AgentRunner} (exactly `@helix/agent`'s
 * `runAgent`), so this lib stays runtime-dependency-free and fully testable with a
 * scripted runner — the real `runAgent` is wired in at the worker (HELIX-158).
 */
export type AgentRunner = (options: RunAgentOptions) => Promise<AgentRunResult>;

/** The run context an executor reads prior step outputs from (structurally `WorkflowRunContext`). */
export interface RunContext {
  results: Record<string, { status: string; output?: unknown; error?: string }>;
}

export interface RoleExecutorDeps {
  provider: LlmProvider;
  resolver: AgentSpecResolver;
  /** The agent loop — `@helix/agent`'s `runAgent`. */
  runAgent: AgentRunner;
  /** Tools available to a role's agent (default: none). */
  toolsFor?: (role: string) => Record<string, ToolExecutor>;
  /** Build the agent input from the step + prior results (default: {@link defaultBuildInput}). */
  buildInput?: (step: ExecutableStep, ctx: RunContext) => string | LlmMessage[];
  /** Run attribution merged into the LLM call context (e.g. `runId`); `agentRole` is added per step. */
  context?: Omit<LlmCallContext, 'agentRole'>;
  maxIterations?: number;
}

/** Stop reasons that count as the agent finishing its work (vs. hitting a limit / refusing). */
const SUCCESS_STOP: ReadonlySet<string> = new Set(['end_turn', 'stop_sequence']);

const stringify = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** A compact, human-readable digest of prior step outputs (the step-to-step context). */
export function priorOutputsDigest(ctx: RunContext): string {
  const prior = Object.entries(ctx.results ?? {})
    .filter(([, r]) => r.output !== undefined)
    .map(([id, r]) => `- ${id}: ${stringify(r.output)}`);
  return prior.join('\n');
}

/** Append the prior-outputs digest to a prompt (under a "Context from prior steps" header), if any. */
export function withPriorContext(prompt: string, ctx: RunContext): string {
  const digest = priorOutputsDigest(ctx);
  return digest ? `${prompt}\n\nContext from prior steps:\n${digest}` : prompt;
}

/**
 * Default input: the step's `config.prompt` (or a generic instruction) plus a compact
 * digest of prior step outputs — so e.g. the coding step sees the plan, review sees
 * the code, and so on.
 */
export function defaultBuildInput(step: ExecutableStep, ctx: RunContext): string {
  const prompt =
    typeof step.config?.['prompt'] === 'string'
      ? (step.config['prompt'] as string)
      : `Perform the "${step.agentRole}" step (${step.id}).`;
  return withPriorContext(prompt, ctx);
}

/** Map a finished agent run to a step outcome. */
export function mapResult(result: AgentRunResult): StepExecutionResult {
  const succeeded = !result.breach && SUCCESS_STOP.has(result.stopReason);
  const output = result.output?.valid ? result.output.data : result.finalText;
  if (succeeded) return { status: 'success', output };
  const error = result.breach ? `guardrail breach: ${result.breach.type}` : `agent stopped: ${result.stopReason}`;
  return { status: 'failure', output, error };
}

/**
 * Build a {@link StepExecutor} that runs a step's role agent via the injected
 * {@link AgentRunner}. An unrecognised role (no spec) is a business failure.
 */
export function createRoleExecutor(deps: RoleExecutorDeps): StepExecutor<RunContext> {
  const buildInput = deps.buildInput ?? defaultBuildInput;
  const toolsFor = deps.toolsFor ?? (() => ({}));

  return async (step, ctx) => {
    const agent: AgentSpec | undefined = await deps.resolver.resolve(step.agentRole);
    if (!agent) return { status: 'failure', error: `no agent spec for role "${step.agentRole}"` };

    const result = await deps.runAgent({
      provider: deps.provider,
      agent,
      input: buildInput(step, ctx),
      executors: toolsFor(step.agentRole),
      maxIterations: deps.maxIterations,
      context: { ...deps.context, agentRole: step.agentRole },
    });

    return mapResult(result);
  };
}
