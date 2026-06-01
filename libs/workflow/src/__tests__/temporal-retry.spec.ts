import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, Worker } from '@temporalio/worker';
import { StepRetryPolicy, WorkflowDefinition } from '../lib/types';
import { WorkflowStepRunner } from '../lib/runner';
import { createWorkflowWorker } from '../lib/temporal/worker';
import { executeWorkflowRun } from '../lib/temporal/client';

/**
 * Per-step retry policy (HELIX-77): the durable runner honors each step's
 * maxAttempts / backoff / non-retryable classification. A time-skipping server
 * fast-forwards the retry backoff timers, so these run fast and deterministically.
 *
 *   plan → code → review  ('code' carries the retry policy under test)
 */
function def(codeRetry: StepRetryPolicy): WorkflowDefinition {
  return {
    name: 'retry-wf',
    steps: [
      { id: 'plan', agentRole: 'planning' },
      { id: 'code', agentRole: 'coding', retry: codeRetry },
      { id: 'review', agentRole: 'code_review' },
    ],
    edges: [
      { from: 'plan', to: 'code', when: 'success' },
      { from: 'code', to: 'review', when: 'success' },
    ],
  };
}

const attempts: Record<string, number> = {};
let mode: 'always-fail' | 'flaky-2-then-ok' | 'non-retryable' = 'always-fail';

const execute: WorkflowStepRunner = (step) => {
  attempts[step.id] = (attempts[step.id] ?? 0) + 1;
  if (step.id !== 'code') return { status: 'success', output: `${step.id}-out` };
  switch (mode) {
    case 'flaky-2-then-ok':
      if (attempts['code'] < 3) throw new Error('transient boom');
      return { status: 'success', output: 'fixed' };
    case 'non-retryable':
      throw ApplicationFailure.create({ type: 'BadInput', message: 'bad input' });
    case 'always-fail':
    default:
      throw new Error('transient boom');
  }
};

const fastBackoff = { initialInterval: '1ms', maximumInterval: '10ms' } as const;
const taskQueue = 'retry-test';

describe('per-step retry policy', () => {
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
    await Runtime.instance().shutdown();
  });

  beforeEach(() => {
    for (const k of Object.keys(attempts)) delete attempts[k];
  });

  it('retries up to maximumAttempts, then fails the step', async () => {
    mode = 'always-fail';
    const r = await executeWorkflowRun(testEnv.client, def({ maximumAttempts: 3, ...fastBackoff }), {
      workflowId: 'retry-exhaust',
      taskQueue,
    });
    expect(attempts['code']).toBe(3); // tried 3 times
    expect(r.steps.code.status).toBe('failure');
    expect(r.skipped).toContain('review'); // success edge not taken
  }, 30_000);

  it('a flaky step succeeds within its retry budget', async () => {
    mode = 'flaky-2-then-ok';
    const r = await executeWorkflowRun(testEnv.client, def({ maximumAttempts: 5, ...fastBackoff }), {
      workflowId: 'retry-flaky',
      taskQueue,
    });
    expect(attempts['code']).toBe(3); // failed twice, succeeded on the 3rd
    expect(r.steps.code.status).toBe('success');
    expect(r.completed.sort()).toEqual(['code', 'plan', 'review']);
  }, 30_000);

  it('does not retry a non-retryable error type (classification)', async () => {
    mode = 'non-retryable';
    const r = await executeWorkflowRun(
      testEnv.client,
      def({ maximumAttempts: 5, nonRetryableErrorTypes: ['BadInput'], ...fastBackoff }),
      { workflowId: 'retry-nonretryable', taskQueue },
    );
    expect(attempts['code']).toBe(1); // failed once, not retried despite maxAttempts=5
    expect(r.steps.code.status).toBe('failure');
  }, 30_000);
});
