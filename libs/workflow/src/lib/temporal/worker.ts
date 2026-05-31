/**
 * Temporal worker factory (HELIX-71). A worker hosts both the deterministic
 * workflow code (bundled from {@link ./workflows}) and the step activities, and
 * polls a task queue for work. Run one or more of these processes to execute
 * workflows durably; the run survives any single worker crashing.
 */
import { NativeConnection, Worker } from '@temporalio/worker';
import { WorkflowStepRunner } from '../runner';
import { createStepActivities } from './activities';
import { HELIX_TASK_QUEUE } from './shared';

export interface WorkflowWorkerOptions {
  /** Executes a single workflow step (e.g. the agent loop). Injected to keep the engine decoupled. */
  execute: WorkflowStepRunner;
  /** Task queue to poll. Defaults to {@link HELIX_TASK_QUEUE}. */
  taskQueue?: string;
  /** A pre-built native connection (e.g. from a test environment). Omit for the default localhost connection. */
  connection?: NativeConnection;
  /** Temporal namespace. Defaults to `default`. */
  namespace?: string;
}

/**
 * Create (but do not start) a Temporal worker. Call `.run()` to start polling
 * and `.shutdown()` to stop. The workflow bundle is resolved from the
 * {@link ./workflows} module path so Temporal can compile it into its sandbox.
 */
export function createWorkflowWorker(opts: WorkflowWorkerOptions): Promise<Worker> {
  return Worker.create({
    connection: opts.connection,
    namespace: opts.namespace,
    taskQueue: opts.taskQueue ?? HELIX_TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: createStepActivities(opts.execute),
  });
}
