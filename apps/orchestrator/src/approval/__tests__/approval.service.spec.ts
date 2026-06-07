import { ConflictException, NotFoundException } from '@nestjs/common';
import { ResolvedRequirement } from '@helix/approvals';
import { ApprovalService, OpenApprovalInput } from '../approval.service';
import { InMemoryApprovalRequestStore } from '../approval.store';
import { WorkflowSignaler } from '../approval.signaler';
import { ApprovalNotifier } from '../approval.notifier';

const requirement = (over: Partial<ResolvedRequirement> = {}): ResolvedRequirement => ({
  approverRoles: ['tech-lead', 'security'],
  minApprovals: 2,
  slaMinutes: 60,
  escalateTo: ['eng-manager'],
  ...over,
});

const openInput = (over: Partial<OpenApprovalInput> = {}): OpenApprovalInput => ({
  workflowId: 'run-7',
  requirement: requirement(),
  action: 'deploy prod',
  requestedBy: 'deployment-agent',
  ...over,
});

describe('ApprovalService', () => {
  let store: InMemoryApprovalRequestStore;
  let signaler: jest.Mocked<WorkflowSignaler>;
  let notifier: jest.Mocked<ApprovalNotifier>;
  let service: ApprovalService;

  beforeEach(() => {
    store = new InMemoryApprovalRequestStore();
    signaler = { signalDecision: jest.fn().mockResolvedValue(undefined) };
    notifier = { notifyRequested: jest.fn().mockResolvedValue(undefined) };
    service = new ApprovalService(store, signaler, notifier);
  });

  it('open() creates and stores a pending request linked to the run, and notifies approvers', async () => {
    const req = await service.open(openInput());
    expect(req.status).toBe('pending');
    expect(req.subjectId).toBe('run-7');
    expect(req.id).toMatch(/^appr-/);
    expect(await store.get(req.id)).toBeDefined();
    expect(notifier.notifyRequested).toHaveBeenCalledWith(expect.objectContaining({ id: req.id }));
  });

  it('open() still succeeds if notifying throws (best-effort)', async () => {
    notifier.notifyRequested.mockRejectedValueOnce(new Error('dispatch boom'));
    const req = await service.open(openInput());
    expect(await store.get(req.id)).toBeDefined();
  });

  it('decide() below quorum stays pending and does NOT signal the run', async () => {
    const req = await service.open(openInput());
    const after = await service.decide(req.id, { approver: 'alice', role: 'tech-lead', vote: 'approve' });

    expect(after.status).toBe('pending');
    expect(signaler.signalDecision).not.toHaveBeenCalled();
  });

  it('decide() that meets quorum approves and signals the run once', async () => {
    const req = await service.open(openInput());
    await service.decide(req.id, { approver: 'alice', role: 'tech-lead', vote: 'approve' });
    const approved = await service.decide(req.id, { approver: 'bob', role: 'security', vote: 'approve', comment: 'lgtm' });

    expect(approved.status).toBe('approved');
    expect(signaler.signalDecision).toHaveBeenCalledTimes(1);
    expect(signaler.signalDecision).toHaveBeenCalledWith('run-7', {
      decision: 'approved',
      decidedBy: 'bob',
      reason: 'lgtm',
    });
  });

  it('decide() with a rejection fails fast and signals a rejected decision', async () => {
    const req = await service.open(openInput());
    const rejected = await service.decide(req.id, { approver: 'alice', role: 'tech-lead', vote: 'reject', comment: 'no' });

    expect(rejected.status).toBe('rejected');
    expect(signaler.signalDecision).toHaveBeenCalledWith('run-7', {
      decision: 'rejected',
      decidedBy: 'alice',
      reason: 'no',
    });
  });

  it('decide() on an already-resolved request is a 409', async () => {
    const req = await service.open(openInput({ requirement: requirement({ minApprovals: 1 }) }));
    await service.decide(req.id, { approver: 'alice', role: 'tech-lead', vote: 'approve' });
    await expect(
      service.decide(req.id, { approver: 'bob', role: 'security', vote: 'approve' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('decide() with an out-of-policy role is a 409', async () => {
    const req = await service.open(openInput());
    await expect(
      service.decide(req.id, { approver: 'x', role: 'intern', vote: 'approve' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('decide() on an unknown request is a 404', async () => {
    await expect(service.decide('nope', { approver: 'a', role: 'tech-lead', vote: 'approve' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lazily expires a past-SLA request and refuses a late decision (409)', async () => {
    const req = await service.open(openInput());
    // age the stored request past its SLA
    await store.put({ ...req, expiresAt: new Date(Date.now() - 1000).toISOString() });

    await expect(
      service.decide(req.id, { approver: 'alice', role: 'tech-lead', vote: 'approve' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await store.get(req.id))?.status).toBe('expired'); // persisted
    expect(signaler.signalDecision).not.toHaveBeenCalled();
  });

  it('cancel() cancels a pending request without signalling', async () => {
    const req = await service.open(openInput());
    const cancelled = await service.cancel(req.id, 'run aborted');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.reason).toBe('run aborted');
    expect(signaler.signalDecision).not.toHaveBeenCalled();
  });

  it('list() filters by run id and status', async () => {
    await service.open(openInput({ workflowId: 'run-a' }));
    await service.open(openInput({ workflowId: 'run-b' }));

    expect(await service.list({ workflowId: 'run-a' })).toHaveLength(1);
    expect(await service.list({ status: 'pending' })).toHaveLength(2);
    expect(await service.list({ status: 'approved' })).toHaveLength(0);
  });

  describe('inbox()', () => {
    it('returns pending requests as rows, soonest-SLA first', async () => {
      await service.open(openInput({ requirement: requirement({ slaMinutes: 120 }), action: 'later' }));
      await service.open(openInput({ requirement: requirement({ slaMinutes: 15 }), action: 'soon' }));

      const inbox = await service.inbox();
      expect(inbox.map((i) => i.action)).toEqual(['soon', 'later']);
      expect(inbox[0]).toMatchObject({ required: 2, remaining: 2, approvals: 0 });
    });

    it('filters to a given role', async () => {
      await service.open(openInput({ requirement: requirement({ approverRoles: ['tech-lead'] }) }));
      await service.open(openInput({ requirement: requirement({ approverRoles: ['security'] }) }));

      const inbox = await service.inbox('security');
      expect(inbox).toHaveLength(1);
      expect(inbox[0].approverRoles).toEqual(['security']);
    });

    it('lazily expires a past-SLA request and drops it from the inbox', async () => {
      const stale = await service.open(openInput());
      await service.open(openInput({ action: 'fresh' }));
      await store.put({ ...stale, expiresAt: new Date(Date.now() - 1000).toISOString() });

      const inbox = await service.inbox();
      expect(inbox.map((i) => i.action)).toEqual(['fresh']);
      expect((await store.get(stale.id))?.status).toBe('expired'); // persisted
    });
  });
});
