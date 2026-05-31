/**
 * Temporal activities for the workflow engine (HELIX-71). Each workflow step is
 * executed as a Temporal **activity** — durable and retryable — so a run's
 * progress is checkpointed and survives a worker crash.
 */
import { StepRunResult, WorkflowStepRunner } from '../runner';
import { RunStepInput } from './shared';

/** The activity surface the workflow invokes — one activity per workflow step. */
export interface StepActivities {
  runStep(input: RunStepInput): Promise<StepRunResult>;
}

/**
 * Build the step activities from an injected executor (e.g. the agent loop), so
 * the engine stays decoupled from *what* a step actually does.
 *
 * Failure semantics map onto Temporal cleanly:
 * - Returning `{ status: 'failure' }` is a **business** failure — the step ran and
 *   decided it failed (e.g. tests didn't pass). The activity completes normally,
 *   so Temporal does **not** retry it, and the workflow routes the `failure` edge.
 * - **Throwing** is a **technical** error (crash, network blip). Temporal retries
 *   per the activity retry policy; once attempts are exhausted the activity error
 *   surfaces to the workflow, which records it as a failure outcome.
 */
export function createStepActivities(execute: WorkflowStepRunner): StepActivities {
  return {
    async runStep({ step, ctx }: RunStepInput): Promise<StepRunResult> {
      return await execute(step, ctx);
    },
  };
}
