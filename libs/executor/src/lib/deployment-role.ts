import type { ExecutableStep, RoleDispatcher, StepExecutor } from './executor';
import type { RunContext } from './role-executor';

/**
 * The deployment role (HELIX-157). Unlike the other roles this isn't an LLM loop —
 * it's a **deterministic build → deploy → live URL** operation (matching how
 * `@helix/deployment-agent` is built: pure synthesis + a runner-backed command
 * seam). So it runs through an injected {@link DeploymentRunner}; the real build /
 * ECR / CDK execution against AWS is the deferred binding, wired at the worker
 * (HELIX-158). The step output carries the `liveUrl`, so the artifact views
 * (HELIX-147) surface the deployment.
 */

export interface DeploymentInput {
  step: ExecutableStep;
  ctx: RunContext;
}

export interface DeploymentOutcome {
  ok: boolean;
  /** The deployed app's live URL, when the deploy succeeded. */
  liveUrl?: string;
  environment?: string;
  error?: string;
}

/** Builds + deploys the run's artifact, returning the live URL. The deferred seam. */
export interface DeploymentRunner {
  deploy(input: DeploymentInput): Promise<DeploymentOutcome>;
}

/**
 * A {@link StepExecutor} for the `deployment` role: run the injected
 * {@link DeploymentRunner} and map its outcome. On success the output is
 * `{ liveUrl, environment }` — the shape the artifact extractor reads.
 */
export function deploymentExecutor(deps: { runner: DeploymentRunner }): StepExecutor<RunContext> {
  return async (step, ctx) => {
    const outcome = await deps.runner.deploy({ step, ctx });
    if (!outcome.ok) {
      return { status: 'failure', error: outcome.error ?? 'deployment failed' };
    }
    return { status: 'success', output: { liveUrl: outcome.liveUrl, environment: outcome.environment } };
  };
}

/** Register the `deployment` role on a dispatcher. */
export function registerDeploymentRole(
  dispatcher: RoleDispatcher<RunContext>,
  deps: { runner: DeploymentRunner },
): RoleDispatcher<RunContext> {
  dispatcher.register('deployment', deploymentExecutor(deps));
  return dispatcher;
}
