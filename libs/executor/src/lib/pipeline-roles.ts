import type { ExecutableStep, RoleDispatcher } from './executor';
import { type RoleExecutorDeps, type RunContext, createRoleExecutor, withPriorContext } from './role-executor';

/**
 * The LLM-only pipeline roles (HELIX-155): planning and code review. Both run on the
 * generic {@link createRoleExecutor} — the role-specific part is how the input is
 * framed (planning turns the request into a plan; review looks at the prior steps'
 * changes). They need no sandbox/tools, so they're registered together here; the
 * sandbox-backed roles (coding/testing) land in HELIX-156 and deployment in HELIX-157.
 */

/** Planning input: turn the submitted request into an implementation plan. */
export function planningInput(step: ExecutableStep, ctx: RunContext): string {
  const request =
    (typeof step.config?.['prompt'] === 'string' && (step.config['prompt'] as string)) ||
    (typeof step.config?.['request'] === 'string' && (step.config['request'] as string)) ||
    '(no request text provided)';
  return withPriorContext(`Produce a concrete implementation plan for this request:\n\n${request}`, ctx);
}

/** Review input: review the changes the prior steps produced. */
export function reviewInput(_step: ExecutableStep, ctx: RunContext): string {
  return withPriorContext(
    'Review the changes produced by the prior steps for correctness, security, style, and adherence to ' +
      'the plan. Report findings with severities and a merge recommendation.',
    ctx,
  );
}

/** Deps for a pipeline role — the generic executor deps minus the per-role input builder. */
export type PipelineRoleDeps = Omit<RoleExecutorDeps, 'buildInput'>;

/** A StepExecutor for the `planning` role. */
export const planningExecutor = (deps: PipelineRoleDeps) => createRoleExecutor({ ...deps, buildInput: planningInput });

/** A StepExecutor for the `code_review` role. */
export const codeReviewExecutor = (deps: PipelineRoleDeps) => createRoleExecutor({ ...deps, buildInput: reviewInput });

/** Register the LLM-only roles (`planning`, `code_review`) on a dispatcher. */
export function registerLlmRoles(
  dispatcher: RoleDispatcher<RunContext>,
  deps: PipelineRoleDeps,
): RoleDispatcher<RunContext> {
  dispatcher.register('planning', planningExecutor(deps));
  dispatcher.register('code_review', codeReviewExecutor(deps));
  return dispatcher;
}
