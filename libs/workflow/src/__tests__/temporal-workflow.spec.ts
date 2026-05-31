import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, Worker } from '@temporalio/worker';
import { WorkflowDefinition } from '../lib/types';
import { WorkflowStepRunner } from '../lib/runner';
import { createWorkflowWorker } from '../lib/temporal/worker';
import { executeWorkflowRun } from '../lib/temporal/client';

/**
 * End-to-end durable execution against a real (in-memory, time-skipping) Temporal
 * server: each DAG step runs as a Temporal activity, driven by the same HELIX-69
 * orchestration. A step "fails" when its config has `fail: true`.
 *
 *   plan → code; code --success--> review; code --failure--> fix; fix --always--> review
 */
function branching(failIds: string[] = []): WorkflowDefinition {
  const cfg = (id: string) => (failIds.includes(id) ? { config: { fail: true } } : {});
  return {
    name: 'plan-code-review',
    steps: [
      { id: 'plan', agentRole: 'planning', ...cfg('plan') },
      { id: 'code', agentRole: 'coding', ...cfg('code') },
      { id: 'fix', agentRole: 'coding', ...cfg('fix') },
      { id: 'review', agentRole: 'code_review', ...cfg('review') },
    ],
    edges: [
      { from: 'plan', to: 'code', when: 'success' },
      { from: 'code', to: 'review', when: 'success' },
      { from: 'code', to: 'fix', when: 'failure' },
      { from: 'fix', to: 'review', when: 'always' },
    ],
  };
}

const execute: WorkflowStepRunner = (step) =>
  step.config?.['fail']
    ? { status: 'failure', error: `${step.id} failed` }
    : { status: 'success', output: `${step.id}-out` };

const taskQueue = 'helix-test';

describe('Temporal workflow — durable DAG execution', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let runPromise: Promise<void>;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    worker = await createWorkflowWorker({ connection: testEnv.nativeConnection, taskQueue, execute });
    runPromise = worker.run();
  }, 120_000);

  afterAll(async () => {
    worker?.shutdown();
    await runPromise?.catch(() => undefined);
    await testEnv?.teardown();
    // Release the native core-bridge runtime thread so jest exits cleanly.
    await Runtime.instance().shutdown();
  });

  it('takes the success path and skips the failure branch', async () => {
    const r = await executeWorkflowRun(testEnv.client, branching(), {
      workflowId: 'wf-success',
      taskQueue,
    });
    expect(r.completed.sort()).toEqual(['code', 'plan', 'review']);
    expect(r.skipped).toEqual(['fix']);
    expect(r.steps.review.ran).toBe(true);
    expect(r.steps.code.output).toBe('code-out');
  }, 30_000);

  it('routes the failure edge: code fails → fix runs → review via the always edge', async () => {
    const r = await executeWorkflowRun(testEnv.client, branching(['code']), {
      workflowId: 'wf-failure',
      taskQueue,
    });
    expect(r.completed.sort()).toEqual(['code', 'fix', 'plan', 'review']);
    expect(r.skipped).toEqual([]);
    expect(r.steps.code.status).toBe('failure');
    expect(r.steps.fix.ran).toBe(true);
  }, 30_000);
});
