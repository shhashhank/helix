import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, Worker } from '@temporalio/worker';
import { createWorkflowWorker } from '../lib/temporal/worker';
import { approvalSignal } from '../lib/temporal/approval';
import { approvalGateWorkflow } from '../lib/temporal/workflows';

/**
 * Human-in-the-loop pause/resume (HELIX-74). The approval gate durably pauses on
 * a Temporal `condition`; a real (time-skipping) server lets the timeout case
 * fast-forward instantly since the wait is a workflow timer.
 */
describe('approvalGateWorkflow — durable pause/resume', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let runPromise: Promise<void>;
  const taskQueue = 'approval-test';

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    worker = await createWorkflowWorker({
      connection: testEnv.nativeConnection,
      taskQueue,
      execute: () => ({ status: 'success' }), // no activities used by this workflow
    });
    runPromise = worker.run();
  }, 120_000);

  afterAll(async () => {
    worker?.shutdown();
    await runPromise?.catch(() => undefined);
    await testEnv?.teardown();
    await Runtime.instance().shutdown();
  });

  it('pauses, then resumes when a human approves', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h', onTimeout: 'rejected' }],
      taskQueue,
      workflowId: 'appr-approve',
    });
    await handle.signal(approvalSignal, { decision: 'approved', decidedBy: 'alice', reason: 'lgtm' });

    await expect(handle.result()).resolves.toEqual({
      decision: 'approved',
      timedOut: false,
      decidedBy: 'alice',
      reason: 'lgtm',
    });
  }, 30_000);

  it('resumes when a human rejects', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h' }],
      taskQueue,
      workflowId: 'appr-reject',
    });
    await handle.signal(approvalSignal, { decision: 'rejected', decidedBy: 'bob' });

    await expect(handle.result()).resolves.toEqual({
      decision: 'rejected',
      timedOut: false,
      decidedBy: 'bob',
      reason: undefined,
    });
  }, 30_000);

  it('applies the fail-safe timeout policy (rejected) when no decision arrives', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h' }], // time-skipping fast-forwards the 24h timer
      taskQueue,
      workflowId: 'appr-timeout-default',
    });

    await expect(handle.result()).resolves.toEqual({ decision: 'rejected', timedOut: true });
  }, 30_000);

  it('honors a custom onTimeout policy (auto-approve)', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '1h', onTimeout: 'approved' }],
      taskQueue,
      workflowId: 'appr-timeout-approve',
    });

    await expect(handle.result()).resolves.toEqual({ decision: 'approved', timedOut: true });
  }, 30_000);

  it('the first decision wins — a late second signal is ignored', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h' }],
      taskQueue,
      workflowId: 'appr-first-wins',
    });
    await handle.signal(approvalSignal, { decision: 'approved', decidedBy: 'alice' });
    // The second signal may land after the gate already resolved on the first —
    // tolerate "workflow already completed"; either way the decision is alice's.
    await handle.signal(approvalSignal, { decision: 'rejected', decidedBy: 'mallory' }).catch(() => undefined);

    const result = await handle.result();
    expect(result.decision).toBe('approved');
    expect(result.decidedBy).toBe('alice');
  }, 30_000);
});
