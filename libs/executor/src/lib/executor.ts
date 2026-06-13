/**
 * Agent executor — the dispatch seam (HELIX-152). A workflow run executes each step
 * through a {@link StepExecutor}; this routes a step to the executor registered for
 * its `agentRole` (planning, coding, code_review, testing, deployment, …). The
 * real per-role executors — built on `@helix/agent`'s `runAgent` — register here in
 * later sub-tasks; for now the only executor is the {@link simulatedStepExecutor}
 * the dev worker uses.
 *
 * Deliberately **dependency-free**: it works on the minimal step/result shapes it
 * needs (structurally compatible with `@helix/workflow`'s `WorkflowStep` /
 * `StepRunResult`), so the workflow engine can depend on this without a cycle.
 */

/** The slice of a workflow step an executor dispatches on / acts on. */
export interface ExecutableStep {
  id: string;
  /** Which agent role runs this step — the dispatch key. */
  agentRole: string;
  /** Optional static config carried on the step. */
  config?: Record<string, unknown>;
}

/** What an executor returns — a business success/failure outcome for the step. */
export interface StepExecutionResult {
  status: 'success' | 'failure';
  output?: unknown;
  error?: string;
}

/**
 * Runs one workflow step. `Ctx` is the run context (prior step outputs) the engine
 * threads through; the dispatcher passes it opaquely to the chosen executor.
 */
export type StepExecutor<Ctx = unknown> = (step: ExecutableStep, ctx: Ctx) => Promise<StepExecutionResult>;

/**
 * Routes each step to the {@link StepExecutor} registered for its `agentRole`.
 * Unknown roles fall back to the optional `fallback` executor, or — with none — a
 * **business failure** (returned, not thrown) so the run fails visibly and the
 * workflow can route a `failure` edge rather than crashing the activity.
 */
export class RoleDispatcher<Ctx = unknown> {
  private readonly byRole = new Map<string, StepExecutor<Ctx>>();

  constructor(private readonly fallback?: StepExecutor<Ctx>) {}

  /** Register the executor for a role (chainable). A later registration wins. */
  register(role: string, executor: StepExecutor<Ctx>): this {
    this.byRole.set(role, executor);
    return this;
  }

  /** True if a role has a registered executor. */
  has(role: string): boolean {
    return this.byRole.has(role);
  }

  /** The {@link StepExecutor} to hand the workflow worker — dispatches by `agentRole`. */
  run: StepExecutor<Ctx> = async (step, ctx) => {
    const executor = this.byRole.get(step.agentRole) ?? this.fallback;
    if (!executor) {
      return { status: 'failure', error: `no executor registered for agent role "${step.agentRole}"` };
    }
    return executor(step, ctx);
  };
}

export interface SimulatedExecutorOptions {
  /** Artificial per-step delay so a run visibly progresses in dev (default 0). */
  delayMs?: number;
}

/**
 * A stand-in executor that simulates work (HELIX-152) — the dev worker's old inline
 * stub, now a registered executor. Succeeds with a placeholder output, or fails the
 * step when `config.fail` is set (to exercise failure/branch paths). Replaced
 * role-by-role as the real agent executors land.
 */
export function simulatedStepExecutor(options: SimulatedExecutorOptions = {}): StepExecutor {
  const delayMs = options.delayMs ?? 0;
  return async (step) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (step.config?.['fail']) return { status: 'failure', error: `${step.id} failed` };
    return { status: 'success', output: `${step.id} output` };
  };
}
