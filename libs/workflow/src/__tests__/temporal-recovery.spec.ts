import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime } from '@temporalio/worker';
import { WorkflowDefinition } from '../lib/types';
import { WorkflowStepRunner } from '../lib/runner';
import { createWorkflowWorker } from '../lib/temporal/worker';
import { startWorkflowRun } from '../lib/temporal/client';
import { currentActivityIdempotencyKey } from '../lib/temporal/idempotency-key';
import { IdempotencyGuard, InMemoryIdempotencyStore } from '../lib/idempotency';

/**
 * Chaos / crash-recovery (HELIX-73): close the Durable Execution story by proving
 * the AC — "killing a worker resumes from the last checkpoint; idempotent side
 * effects". Workflow state lives on the Temporal server (a real local server here,
 * so timing is deterministic), independent of any worker. We crash the worker
 * mid-run and bring up a fresh one, then assert:
 *   - the run finishes on the new worker (resumes),
 *   - an already-completed step is NOT re-executed (last-checkpoint resume),
 *   - a side effect performed before the crash is NOT repeated (HELIX-72 idempotency).
 *
 *   plan → code → review  (linear)
 */
const def: WorkflowDefinition = {
  name: 'plan-code-review',
  steps: [
    { id: 'plan', agentRole: 'planning' },
    { id: 'code', agentRole: 'coding' },
    { id: 'review', agentRole: 'code_review' },
  ],
  edges: [
    { from: 'plan', to: 'code', when: 'success' },
    { from: 'code', to: 'review', when: 'success' },
  ],
};

describe('Temporal durable recovery — killing a worker resumes the run', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    // Real-time local server: state persists server-side, so a worker can die and
    // a new one resumes. (Time-skipping won't fast-forward an in-flight activity's
    // timeout, so a real server gives deterministic retry timing.)
    testEnv = await TestWorkflowEnvironment.createLocal();
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
    // Release the native core-bridge runtime thread so jest exits cleanly.
    await Runtime.instance().shutdown();
  });

  it('resumes on a fresh worker without re-running completed steps or repeating side effects', async () => {
    const runCounts: Record<string, number> = {};
    let sideEffects = 0;
    // Shared store stands in for a durable (Prisma/Redis) store across the two
    // in-process workers — enough to prove the dedupe survives the crash/retry.
    const guard = new IdempotencyGuard(new InMemoryIdempotencyStore());
    const taskQueue = `recovery-${Date.now()}`;
    const workflowId = `rec-${Date.now()}`;

    // 'code' performs an idempotent side effect, then — on the crashing worker —
    // fails (a retryable error), so the activity is rescheduled for another worker.
    const makeExecutor =
      (crashOnCode: boolean): WorkflowStepRunner =>
      async (step) => {
        runCounts[step.id] = (runCounts[step.id] ?? 0) + 1;
        if (step.id === 'code') {
          const key = currentActivityIdempotencyKey('write');
          const { value } = await guard.runOnce(key, () => {
            sideEffects++;
            return 'wrote';
          });
          if (crashOnCode) throw new Error('worker crashed mid-code');
          return { status: 'success', output: value };
        }
        return { status: 'success', output: `${step.id}-out` };
      };

    // Worker #1 runs plan, starts code (does the side effect), then crashes on code.
    const worker1 = await createWorkflowWorker({
      connection: testEnv.nativeConnection,
      taskQueue,
      execute: makeExecutor(true),
    });
    const w1 = worker1.run();
    const handle = await startWorkflowRun(testEnv.client, def, { workflowId, taskQueue });

    // Wait until code has executed (and crashed) at least once on worker #1.
    for (let i = 0; i < 400 && (runCounts['code'] ?? 0) < 1; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(runCounts['plan']).toBe(1);
    expect(runCounts['code']).toBeGreaterThanOrEqual(1);

    // Kill worker #1 (before the activity's ~1s retry backoff elapses, so the
    // retry is left for a fresh worker rather than re-handled here).
    await worker1.shutdown();
    await w1.catch(() => undefined);

    // A brand-new worker #2 takes over the same task queue and finishes the run.
    const worker2 = await createWorkflowWorker({
      connection: testEnv.nativeConnection,
      taskQueue,
      execute: makeExecutor(false),
    });
    const result = await worker2.runUntil(handle.result());

    expect(result.completed.sort()).toEqual(['code', 'plan', 'review']);
    expect(result.steps.code.status).toBe('success');
    expect(runCounts['plan']).toBe(1); // completed step NOT re-run -> resumed from checkpoint
    expect(runCounts['review']).toBe(1); // ran once, on worker #2
    expect(runCounts['code']).toBeGreaterThanOrEqual(2); // crashed on #1, retried on #2
    expect(sideEffects).toBe(1); // idempotent across the crash/retry
  }, 90_000);
});
