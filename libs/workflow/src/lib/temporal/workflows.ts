/**
 * Temporal workflow definitions (HELIX-71). This module is bundled into the
 * Temporal **workflow sandbox**, so it must stay deterministic: it may only
 * import pure code (our DAG compiler/runner + types) and the `@temporalio/workflow`
 * API — no I/O, no `Date.now`, no randomness. The actual step work happens in
 * activities (see {@link ./activities}), which run in the normal Node runtime.
 */
import { ActivityOptions, defineQuery, proxyActivities, setHandler } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type { StepActivities } from './activities';
import type { ApprovalActivities } from './approval-activities';
import { WorkflowDefinition, WorkflowStep } from '../types';
import { ApprovalRequest } from '../approval-request';
import { runWorkflow, WorkflowProgress, WorkflowRunResult } from '../runner';
import { ApprovalResult, AwaitApprovalOptions, awaitApproval } from './approval';
import { WORKFLOW_PROGRESS_QUERY } from './shared';

/** Live per-step progress, queryable on a running (or completed) DAG workflow (HELIX-79). */
export const workflowProgressQuery = defineQuery<WorkflowProgress>(WORKFLOW_PROGRESS_QUERY);

/**
 * Activity proxy. `startToCloseTimeout` bounds a single step; the retry policy
 * covers transient/technical failures. A *business* failure is returned (not
 * thrown) by the activity, so it isn't retried — see {@link createStepActivities}.
 */
/**
 * Build the Temporal activity options for a step from its {@link WorkflowStep.retry}
 * policy (HELIX-77): max attempts, backoff, and retryable-error classification.
 * Defaults to 3 attempts and a 10-minute per-attempt timeout when unset.
 */
function stepActivityOptions(step: WorkflowStep): ActivityOptions {
  return {
    startToCloseTimeout: (step.startToCloseTimeout ?? '10 minutes') as Duration,
    retry: {
      maximumAttempts: step.retry?.maximumAttempts ?? 3,
      initialInterval: step.retry?.initialInterval as Duration | undefined,
      backoffCoefficient: step.retry?.backoffCoefficient,
      maximumInterval: step.retry?.maximumInterval as Duration | undefined,
      nonRetryableErrorTypes: step.retry?.nonRetryableErrorTypes,
    },
  };
}

/** Publishing the approval request is a quick, retryable side effect. */
const { emitApprovalRequest } = proxyActivities<ApprovalActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 5 },
});

/**
 * Durably execute a {@link WorkflowDefinition} DAG. Reuses the HELIX-69
 * orchestration (compile to topological levels, conditional edge gating,
 * skip-cascade, per-level parallelism) unchanged — the only difference is that
 * each step runs as a Temporal activity rather than in-process, so the run is
 * checkpointed and resumes from the last completed step after a crash/restart.
 */
export async function executeWorkflow(def: WorkflowDefinition): Promise<WorkflowRunResult> {
  // Live progress, updated as each step settles and served via a query (HELIX-79).
  let progress: WorkflowProgress = { steps: {}, completed: [], skipped: [], levels: [], done: false };
  setHandler(workflowProgressQuery, () => progress);

  const result = await runWorkflow(
    def,
    (step, ctx) => {
      // Each step gets an activity proxy configured with its own retry policy.
      const { runStep } = proxyActivities<StepActivities>(stepActivityOptions(step));
      return runStep({ step, ctx });
    },
    (p) => {
      progress = p;
    },
  );

  progress = { ...result, done: true };
  return result;
}

/**
 * Minimal human-in-the-loop workflow (HELIX-74): durably pauses for an approval
 * decision (via {@link approvalSignal}) and returns the outcome. Useful on its
 * own as an approval gate, and the unit under test for {@link awaitApproval}.
 */
export async function approvalGateWorkflow(opts: AwaitApprovalOptions): Promise<ApprovalResult> {
  return awaitApproval(opts);
}

export interface RequestApprovalInput {
  /** The request to publish so a human knows sign-off is needed. */
  request: ApprovalRequest;
  /** Wait/timeout policy for the pause. */
  options?: AwaitApprovalOptions;
}

/**
 * Approval gate that **emits an approval request, then pauses** (HELIX-75 + HELIX-74):
 * publishes the request via the `emitApprovalRequest` activity so a person/UI is
 * notified, then durably waits for the decision. The emit is durable + retried,
 * so the notification isn't lost across a crash.
 */
export async function requestApprovalWorkflow(input: RequestApprovalInput): Promise<ApprovalResult> {
  await emitApprovalRequest(input.request);
  return awaitApproval(input.options);
}
