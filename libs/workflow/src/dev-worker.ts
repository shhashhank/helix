/**
 * Local dev worker (NOT for production). Lets you actually *execute* workflow runs
 * started via the orchestrator API, so you can watch a run progress end-to-end
 * (e.g. plan → code → review) over the SSE stream.
 *
 * It polls the shared Helix task queue and runs each step through the **agent
 * executor dispatcher** (`@helix/executor`, HELIX-152). Real per-role executors
 * register on the dispatcher as they land (HELIX-155..158); until then every role
 * falls back to the **simulated executor** so runs visibly progress. A step "fails"
 * if its config has `fail: true`, so you can also exercise the failure/branch path.
 *
 * Run it with a Temporal dev server on :7233:
 *   pnpm dev:worker
 * Tunables: TEMPORAL_ADDRESS (default localhost:7233), STEP_DELAY_MS (default 1500).
 */
import { RoleDispatcher, type StepExecutor, simulatedStepExecutor } from '@helix/executor';
import { NativeConnection } from '@temporalio/worker';
import { WorkflowRunContext } from './lib/runner';
import { createWorkflowWorker } from './lib/temporal/worker';
import { HELIX_TASK_QUEUE } from './lib/temporal/shared';

const STEP_DELAY_MS = Number(process.env.STEP_DELAY_MS ?? 1500);

// Every role simulates for now — the simulated executor is the dispatcher's fallback,
// wrapped to log each step. Real executors will `dispatcher.register(role, …)`.
const simulate = simulatedStepExecutor({ delayMs: STEP_DELAY_MS });
const logged: StepExecutor<WorkflowRunContext> = async (step, ctx) => {
  console.log(`[worker] ▶ running step "${step.id}" (role: ${step.agentRole})`);
  const result = await simulate(step, ctx);
  console.log(`[worker] ${result.status === 'success' ? '✓' : '✗'} step "${step.id}" ${result.status}`);
  return result;
};
const dispatcher = new RoleDispatcher<WorkflowRunContext>(logged);

async function bootstrap(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  console.log(`[worker] connecting to Temporal at ${address} …`);
  const connection = await NativeConnection.connect({ address });
  const worker = await createWorkflowWorker({ connection, taskQueue: HELIX_TASK_QUEUE, execute: dispatcher.run });
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
