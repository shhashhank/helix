import { type DeploymentRunner, registerDeploymentRole } from './deployment-role';
import { type GitHubDeliveryRunner, registerDeliveryRole } from './delivery-role';
import { RoleDispatcher, type StepExecutor } from './executor';
import { registerLlmRoles } from './pipeline-roles';
import type { RunContext } from './role-executor';
import { type WorkspaceRoleBaseDeps, registerWorkspaceRoles } from './workspace-roles';

/** Everything needed to wire the full standard pipeline (HELIX-158). */
export interface PipelineDeps extends WorkspaceRoleBaseDeps {
  /** Build/deploy runner for the deployment role. */
  runner: DeploymentRunner;
  /** GitHub delivery runner for the `delivery` role; omit to leave delivery unregistered (HELIX-183). */
  deliveryRunner?: GitHubDeliveryRunner;
  /** Executor for any role outside the standard pipeline (e.g. the simulated stub). */
  fallback?: StepExecutor<RunContext>;
}

/**
 * Assemble a {@link RoleDispatcher} with the standard pipeline roles registered
 * (HELIX-158): planning + code_review (LLM-only), coding + testing (sandbox-backed), and
 * deployment — plus the `delivery` role when a {@link GitHubDeliveryRunner} is provided
 * (HELIX-183). The worker builds this from its config and hands `dispatcher.run` to the
 * Temporal worker as the step executor.
 */
export function buildPipelineDispatcher(deps: PipelineDeps): RoleDispatcher<RunContext> {
  const dispatcher = new RoleDispatcher<RunContext>(deps.fallback);
  registerLlmRoles(dispatcher, deps);
  registerWorkspaceRoles(dispatcher, deps);
  registerDeploymentRole(dispatcher, deps);
  if (deps.deliveryRunner) registerDeliveryRole(dispatcher, { runner: deps.deliveryRunner });
  return dispatcher;
}
