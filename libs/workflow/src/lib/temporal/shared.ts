/**
 * Shared, dependency-light pieces for the Temporal integration (HELIX-71) — safe
 * to import from both the deterministic workflow bundle and the Node-side worker
 * and client. Keeping these here (rather than in {@link ./worker}) means the
 * client doesn't have to pull in the heavyweight `@temporalio/worker` package.
 */
import { WorkflowStep } from '../types';
import { WorkflowRunContext } from '../runner';

/** Default Temporal task queue that Helix workflow workers poll. */
export const HELIX_TASK_QUEUE = 'helix-workflows';

/** Registered name of the DAG-executing workflow (the `executeWorkflow` function). */
export const EXECUTE_WORKFLOW_TYPE = 'executeWorkflow';

/** Query name a running DAG workflow answers with its live per-step {@link WorkflowProgress}. */
export const WORKFLOW_PROGRESS_QUERY = 'workflowProgress';

/** Input to the per-step activity: the step to run plus the prior-results context. */
export interface RunStepInput {
  step: WorkflowStep;
  ctx: WorkflowRunContext;
}
