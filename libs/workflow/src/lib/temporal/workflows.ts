/**
 * Temporal workflow definitions (HELIX-71). This module is bundled into the
 * Temporal **workflow sandbox**, so it must stay deterministic: it may only
 * import pure code (our DAG compiler/runner + types) and the `@temporalio/workflow`
 * API — no I/O, no `Date.now`, no randomness. The actual step work happens in
 * activities (see {@link ./activities}), which run in the normal Node runtime.
 */
import { proxyActivities } from '@temporalio/workflow';
import type { StepActivities } from './activities';
import type { ApprovalActivities } from './approval-activities';
import { WorkflowDefinition } from '../types';
import { ApprovalRequest } from '../approval-request';
import { runWorkflow, WorkflowRunResult } from '../runner';
import { ApprovalResult, AwaitApprovalOptions, awaitApproval } from './approval';

/**
 * Activity proxy. `startToCloseTimeout` bounds a single step; the retry policy
 * covers transient/technical failures. A *business* failure is returned (not
 * thrown) by the activity, so it isn't retried — see {@link createStepActivities}.
 */
const { runStep } = proxyActivities<StepActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

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
  return runWorkflow(def, (step, ctx) => runStep({ step, ctx }));
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
