import { ApprovalRequest, InMemoryApprovalRequestSink } from '../lib/approval-request';
import { createApprovalActivities } from '../lib/temporal/approval-activities';

const baseReq: ApprovalRequest = {
  id: 'req-1',
  workflowId: 'wf-1',
  gateId: 'deploy-gate',
  summary: 'Deploy v2 to production',
  context: { cost: 1200 },
};

describe('createApprovalActivities.emitApprovalRequest', () => {
  it('publishes the request through the sink', async () => {
    const sink = new InMemoryApprovalRequestSink();
    await createApprovalActivities(sink).emitApprovalRequest(baseReq);

    expect(sink.published).toHaveLength(1);
    expect(sink.published[0]).toMatchObject({
      id: 'req-1',
      workflowId: 'wf-1',
      gateId: 'deploy-gate',
      summary: 'Deploy v2 to production',
      context: { cost: 1200 },
    });
  });

  it('stamps requestedAt when the caller omits it', async () => {
    const sink = new InMemoryApprovalRequestSink();
    await createApprovalActivities(sink).emitApprovalRequest(baseReq);
    expect(typeof sink.published[0].requestedAt).toBe('string');
    expect(Number.isNaN(Date.parse(sink.published[0].requestedAt as string))).toBe(false);
  });

  it('preserves a caller-supplied requestedAt', async () => {
    const sink = new InMemoryApprovalRequestSink();
    const when = '2026-01-02T03:04:05.000Z';
    await createApprovalActivities(sink).emitApprovalRequest({ ...baseReq, requestedAt: when });
    expect(sink.published[0].requestedAt).toBe(when);
  });
});
