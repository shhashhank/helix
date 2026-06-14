import type { ExecutableStep, RoleDispatcher, StepExecutor } from './executor';
import type { RunContext } from './role-executor';

/**
 * The delivery role (HELIX-183): after testing, push the run's change-set to the
 * connected repo and open a **pull request**. Like deployment, this isn't an LLM loop —
 * it's a deterministic operation behind an injected {@link GitHubDeliveryRunner}. The real
 * runner (worker, HELIX-184/186) captures the sandbox change-set and pushes via the live
 * Octokit client; offline / unconfigured it's skipped. The step output carries the PR, so
 * the artifact views (HELIX-147/185) surface it.
 */

export interface DeliveryInput {
  step: ExecutableStep;
  ctx: RunContext;
}

export interface DeliveryOutcome {
  /** True when a PR was opened. */
  delivered: boolean;
  /** The opened pull request, when delivered. */
  pullRequest?: { number: number; url: string };
  /** Why nothing was delivered (e.g. no target repo / GitHub not connected) — a benign skip. */
  skippedReason?: string;
  /** A genuine delivery failure (the step fails). */
  error?: string;
}

/** Pushes the run's change-set + opens a PR. The injected seam (real impl at the worker). */
export interface GitHubDeliveryRunner {
  deliver(input: DeliveryInput): Promise<DeliveryOutcome>;
}

/**
 * A {@link StepExecutor} for the `delivery` role: run the injected
 * {@link GitHubDeliveryRunner} and map its outcome. A real failure (`error`) fails the
 * step; a **skip** (nothing to deliver / no repo configured) is a benign success so the
 * run still completes. On delivery the output is `{ pullRequest }` — the artifact shape.
 */
export function deliveryExecutor(deps: { runner: GitHubDeliveryRunner }): StepExecutor<RunContext> {
  return async (step, ctx) => {
    const outcome = await deps.runner.deliver({ step, ctx });
    if (outcome.error) {
      return { status: 'failure', error: outcome.error };
    }
    return {
      status: 'success',
      output: outcome.delivered ? { pullRequest: outcome.pullRequest } : { delivered: false, skippedReason: outcome.skippedReason },
    };
  };
}

/** Register the `delivery` role on a dispatcher. */
export function registerDeliveryRole(
  dispatcher: RoleDispatcher<RunContext>,
  deps: { runner: GitHubDeliveryRunner },
): RoleDispatcher<RunContext> {
  dispatcher.register('delivery', deliveryExecutor(deps));
  return dispatcher;
}
