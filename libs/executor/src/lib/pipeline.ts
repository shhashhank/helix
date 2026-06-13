import { type DeploymentRunner, registerDeploymentRole } from './deployment-role';
import { RoleDispatcher, type StepExecutor } from './executor';
import { registerLlmRoles } from './pipeline-roles';
import type { RunContext } from './role-executor';
import { type WorkspaceRoleBaseDeps, registerWorkspaceRoles } from './workspace-roles';

/** Everything needed to wire the full standard pipeline (HELIX-158). */
export interface PipelineDeps extends WorkspaceRoleBaseDeps {
  /** Build/deploy runner for the deployment role. */
  runner: DeploymentRunner;
  /** Executor for any role outside the standard pipeline (e.g. the simulated stub). */
  fallback?: StepExecutor<RunContext>;
}

/**
 * Assemble a {@link RoleDispatcher} with **all five standard pipeline roles**
 * registered (HELIX-158): planning + code_review (LLM-only), coding + testing
 * (sandbox-backed), and deployment. The worker builds this from its config and hands
 * `dispatcher.run` to the Temporal worker as the step executor.
 */
export function buildPipelineDispatcher(deps: PipelineDeps): RoleDispatcher<RunContext> {
  const dispatcher = new RoleDispatcher<RunContext>(deps.fallback);
  registerLlmRoles(dispatcher, deps);
  registerWorkspaceRoles(dispatcher, deps);
  registerDeploymentRole(dispatcher, deps);
  return dispatcher;
}
