/**
 * Temporal client helpers (HELIX-71) for starting and awaiting durable workflow
 * runs. Kept free of any `@temporalio/worker` import so callers that only need to
 * *start* runs (e.g. an API service) don't pull in the worker runtime. The
 * workflow is referenced by its registered name (`executeWorkflow`) — and only
 * by `type` — so importing this module never loads the workflow bundle.
 */
import { Client, WorkflowHandleWithFirstExecutionRunId, WorkflowIdReusePolicy } from '@temporalio/client';
import type { executeWorkflow } from './workflows';
import { WorkflowDefinition } from '../types';
import { WorkflowProgress, WorkflowRunResult } from '../runner';
import { EXECUTE_WORKFLOW_TYPE, HELIX_TASK_QUEUE, WORKFLOW_PROGRESS_QUERY } from './shared';

export interface StartWorkflowOptions {
  /** Unique id for this run — Temporal dedupes/identifies runs by it. */
  workflowId: string;
  /** Task queue to dispatch to. Defaults to {@link HELIX_TASK_QUEUE}. */
  taskQueue?: string;
}

/** A run's lifecycle status, mapped from Temporal's describe() (no Temporal types leak out). */
export interface RunStatus {
  workflowId: string;
  runId: string;
  /** RUNNING | COMPLETED | FAILED | CANCELLED | TERMINATED | TIMED_OUT | CONTINUED_AS_NEW | … */
  status: string;
  startTime?: string;
  closeTime?: string;
}

/** Start a durable workflow run and return its handle (does not wait for completion). */
export function startWorkflowRun(
  client: Client,
  def: WorkflowDefinition,
  opts: StartWorkflowOptions,
): Promise<WorkflowHandleWithFirstExecutionRunId<typeof executeWorkflow>> {
  return client.workflow.start<typeof executeWorkflow>(EXECUTE_WORKFLOW_TYPE, {
    args: [def],
    taskQueue: opts.taskQueue ?? HELIX_TASK_QUEUE,
    workflowId: opts.workflowId,
  });
}

/** Start a run and await its final result. */
export async function executeWorkflowRun(
  client: Client,
  def: WorkflowDefinition,
  opts: StartWorkflowOptions,
): Promise<WorkflowRunResult> {
  const handle = await startWorkflowRun(client, def, opts);
  return handle.result();
}

/** Look up a run's current lifecycle status. */
export async function describeWorkflowRun(client: Client, workflowId: string): Promise<RunStatus> {
  const d = await client.workflow.getHandle(workflowId).describe();
  return {
    workflowId: d.workflowId,
    runId: d.runId,
    status: d.status.name,
    startTime: d.startTime?.toISOString(),
    closeTime: d.closeTime?.toISOString(),
  };
}

/** Request cancellation of a running workflow (graceful — the workflow observes it). */
export async function cancelWorkflowRun(client: Client, workflowId: string): Promise<void> {
  await client.workflow.getHandle(workflowId).cancel();
}

/**
 * Read a run's live per-step progress (HELIX-79). Queries by name (no workflow-code
 * import) so this stays worker-free; queryable on a running or completed workflow.
 */
export function getWorkflowProgress(client: Client, workflowId: string): Promise<WorkflowProgress> {
  return client.workflow.getHandle(workflowId).query<WorkflowProgress, []>(WORKFLOW_PROGRESS_QUERY);
}

/**
 * Retry a **failed** run: start it again under the same `workflowId`, allowed only
 * if the previous run with that id failed (Temporal rejects retrying a running or
 * successful run). Returns the new run's handle.
 */
export function retryWorkflowRun(
  client: Client,
  def: WorkflowDefinition,
  opts: StartWorkflowOptions,
): Promise<WorkflowHandleWithFirstExecutionRunId<typeof executeWorkflow>> {
  return client.workflow.start<typeof executeWorkflow>(EXECUTE_WORKFLOW_TYPE, {
    args: [def],
    taskQueue: opts.taskQueue ?? HELIX_TASK_QUEUE,
    workflowId: opts.workflowId,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  });
}
