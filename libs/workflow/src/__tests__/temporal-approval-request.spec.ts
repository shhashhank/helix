import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, Worker } from '@temporalio/worker';
import { createWorkflowWorker } from '../lib/temporal/worker';
import { approvalSignal } from '../lib/temporal/approval';
import { requestApprovalWorkflow } from '../lib/temporal/workflows';
import { ApprovalRequest, InMemoryApprovalRequestSink } from '../lib/approval-request';

/**
 * HELIX-75: the approval gate emits an approval request (publish to the sink /
 * "approval service") and then pauses for the decision (HELIX-74).
 */
describe('requestApprovalWorkflow — emit request, then pause/resume', () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let runPromise: Promise<void>;
  let sink: InMemoryApprovalRequestSink;
  const taskQueue = 'approval-request-test';

  const request: ApprovalRequest = {
    id: 'req-42',
    workflowId: 'appr-req-1',
    gateId: 'deploy',
    summary: 'Deploy v2 to production',
    context: { cost: 1200 },
  };

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    sink = new InMemoryApprovalRequestSink();
    worker = await createWorkflowWorker({
      connection: testEnv.nativeConnection,
      taskQueue,
      execute: () => ({ status: 'success' }),
      approvalSink: sink,
    });
    runPromise = worker.run();
  }, 120_000);

  afterAll(async () => {
    worker?.shutdown();
    await runPromise?.catch(() => undefined);
    await testEnv?.teardown();
    await Runtime.instance().shutdown();
  });

  it('publishes the approval request, then resumes on the human decision', async () => {
    const handle = await testEnv.client.workflow.start(requestApprovalWorkflow, {
      args: [{ request, options: { timeout: '24h' } }],
      taskQueue,
      workflowId: 'appr-req-1',
    });

    // The request is published before the gate resolves (poll briefly).
    for (let i = 0; i < 200 && sink.published.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(sink.published).toHaveLength(1);
    expect(sink.published[0]).toMatchObject({ id: 'req-42', summary: 'Deploy v2 to production' });
    expect(typeof sink.published[0].requestedAt).toBe('string'); // stamped by the activity

    await handle.signal(approvalSignal, { decision: 'approved', decidedBy: 'alice' });
    await expect(handle.result()).resolves.toMatchObject({ decision: 'approved', timedOut: false });
  }, 30_000);

  it('still publishes the request even when the decision times out', async () => {
    const handle = await testEnv.client.workflow.start(requestApprovalWorkflow, {
      args: [{ request: { ...request, id: 'req-timeout', workflowId: 'appr-req-2' }, options: { timeout: '24h' } }],
      taskQueue,
      workflowId: 'appr-req-2',
    });

    // time-skipping fast-forwards the 24h timeout; fail-safe policy => rejected
    await expect(handle.result()).resolves.toMatchObject({ decision: 'rejected', timedOut: true });
    expect(sink.published.some((r) => r.id === 'req-timeout')).toBe(true);
  }, 30_000);
});
