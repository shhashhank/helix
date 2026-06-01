/**
 * Local dev worker (NOT for production). Lets you actually *execute* workflow runs
 * started via the orchestrator API, so you can watch a run progress end-to-end
 * (e.g. plan → code → review) over the SSE stream.
 *
 * It polls the shared Helix task queue and runs each step with a **stub executor**
 * that simulates work — real per-role agent execution arrives with the agent epics
 * (HELIX-4..8). A step "fails" if its config has `fail: true`, so you can also
 * exercise the failure/branch path from the API.
 *
 * Run it with a Temporal dev server on :7233:
 *   pnpm dev:worker
 * Tunables: TEMPORAL_ADDRESS (default localhost:7233), STEP_DELAY_MS (default 1500).
 */
import { NativeConnection } from '@temporalio/worker';
import { WorkflowStepRunner } from './lib/runner';
import { createWorkflowWorker } from './lib/temporal/worker';
import { HELIX_TASK_QUEUE } from './lib/temporal/shared';

const STEP_DELAY_MS = Number(process.env.STEP_DELAY_MS ?? 1500);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stub step executor — simulates work so runs visibly progress. */
const execute: WorkflowStepRunner = async (step) => {
  console.log(`[worker] ▶ running step "${step.id}" (role: ${step.agentRole})`);
  await sleep(STEP_DELAY_MS);
  if (step.config?.['fail']) {
    console.log(`[worker] ✗ step "${step.id}" failed (config.fail)`);
    return { status: 'failure', error: `${step.id} failed` };
  }
  console.log(`[worker] ✓ step "${step.id}" done`);
  return { status: 'success', output: `${step.id} output` };
};

async function bootstrap(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  console.log(`[worker] connecting to Temporal at ${address} …`);
  const connection = await NativeConnection.connect({ address });
  const worker = await createWorkflowWorker({ connection, taskQueue: HELIX_TASK_QUEUE, execute });
  console.log(`[worker] polling task queue "${HELIX_TASK_QUEUE}" — Ctrl-C to stop`);

  const stop = async () => {
    console.log('\n[worker] shutting down …');
    worker.shutdown();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await worker.run();
  await connection.close();
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('[worker] fatal:', err);
    process.exit(1);
  });
}
