import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, Worker } from '@temporalio/worker';
import { createWorkflowWorker } from '../lib/temporal/worker';
import { approvalGateWorkflow } from '../lib/temporal/workflows';
import { getApprovalStatus, submitApprovalDecision } from '../lib/temporal/decision';

/**
 * HELIX-76: the resume-on-decision handler. A paused workflow reports `pending`;
 * submitting a decision resumes it; afterwards its status reads `decided`.
 */
describe('resume-on-decision — deliver a human decision into a paused workflow', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let runPromise: Promise<void>;
  const taskQueue = 'decision-test';

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    worker = await createWorkflowWorker({
      connection: testEnv.nativeConnection,
      taskQueue,
      execute: () => ({ status: 'success' }),
    });
    runPromise = worker.run();
  }, 120_000);

  afterAll(async () => {
    worker?.shutdown();
    await runPromise?.catch(() => undefined);
    await testEnv?.teardown();
    await Runtime.instance().shutdown();
  });

  it('reports pending, then resumes when an approval is submitted', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h' }],
      taskQueue,
      workflowId: 'dec-approve',
    });

    await expect(getApprovalStatus(testEnv.client, 'dec-approve')).resolves.toEqual({ state: 'pending' });

    await submitApprovalDecision(testEnv.client, 'dec-approve', { decision: 'approved', decidedBy: 'alice' });

    await expect(handle.result()).resolves.toMatchObject({
      decision: 'approved',
      timedOut: false,
      decidedBy: 'alice',
    });
    await expect(getApprovalStatus(testEnv.client, 'dec-approve')).resolves.toEqual({
      state: 'decided',
      decision: 'approved',
      decidedBy: 'alice',
      timedOut: false,
    });
  }, 30_000);

  it('delivers a rejection', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h' }],
      taskQueue,
      workflowId: 'dec-reject',
    });

    await submitApprovalDecision(testEnv.client, 'dec-reject', { decision: 'rejected', decidedBy: 'bob' });

    await expect(handle.result()).resolves.toMatchObject({ decision: 'rejected', timedOut: false });
    await expect(getApprovalStatus(testEnv.client, 'dec-reject')).resolves.toMatchObject({
      state: 'decided',
      decision: 'rejected',
      decidedBy: 'bob',
    });
  }, 30_000);

  it('throws when a decision is submitted after the run already resolved', async () => {
    const handle = await testEnv.client.workflow.start(approvalGateWorkflow, {
      args: [{ timeout: '24h' }],
      taskQueue,
      workflowId: 'dec-late',
    });
    await submitApprovalDecision(testEnv.client, 'dec-late', { decision: 'approved', decidedBy: 'alice' });
    await handle.result();

    await expect(
      submitApprovalDecision(testEnv.client, 'dec-late', { decision: 'rejected', decidedBy: 'mallory' }),
    ).rejects.toThrow();
  }, 30_000);
});
