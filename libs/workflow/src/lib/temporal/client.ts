/**
 * Temporal client helpers (HELIX-71) for starting and awaiting durable workflow
 * runs. Kept free of any `@temporalio/worker` import so callers that only need to
 * *start* runs (e.g. an API service) don't pull in the worker runtime. The
 * workflow is referenced by its registered name (`executeWorkflow`) — and only
 * by `type` — so importing this module never loads the workflow bundle.
 */
import { Client, WorkflowHandle } from '@temporalio/client';
import type { executeWorkflow } from './workflows';
import { WorkflowDefinition } from '../types';
import { WorkflowRunResult } from '../runner';
import { HELIX_TASK_QUEUE } from './shared';

export interface StartWorkflowOptions {
  /** Unique id for this run — Temporal dedupes/identifies runs by it. */
  workflowId: string;
  /** Task queue to dispatch to. Defaults to {@link HELIX_TASK_QUEUE}. */
  taskQueue?: string;
}

/** Start a durable workflow run and return its handle (does not wait for completion). */
export function startWorkflowRun(
  client: Client,
  def: WorkflowDefinition,
  opts: StartWorkflowOptions,
): Promise<WorkflowHandle<typeof executeWorkflow>> {
  return client.workflow.start<typeof executeWorkflow>('executeWorkflow', {
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
