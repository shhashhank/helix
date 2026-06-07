import { ResolvedRequirement } from '../policy';
import {
  ApprovalRequest,
  ApprovalTransitionError,
  approvalProgress,
  cancelRequest,
  createApprovalRequest,
  expireIfDue,
  isResolved,
  submitDecision,
} from '../request';

const T0 = new Date('2026-06-08T10:00:00.000Z');

const requirement = (over: Partial<ResolvedRequirement> = {}): ResolvedRequirement => ({
  approverRoles: ['tech-lead', 'security'],
  minApprovals: 2,
  slaMinutes: 60,
  escalateTo: ['eng-manager'],
  ...over,
});

const newRequest = (over: Partial<ResolvedRequirement> = {}): ApprovalRequest =>
  createApprovalRequest({
    id: 'req-1',
    requirement: requirement(over),
    action: 'deploy prod',
    subjectId: 'run-7',
    requestedBy: 'deployment-agent',
    reason: 'matched prod-deploy',
    now: T0,
  });

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe('createApprovalRequest', () => {
  it('opens a pending request and computes expiry from the SLA', () => {
    const req = newRequest();
    expect(req.status).toBe('pending');
    expect(req.minApprovals).toBe(2);
    expect(req.approverRoles).toEqual(['tech-lead', 'security']);
    expect(req.createdAt).toBe('2026-06-08T10:00:00.000Z');
    expect(req.expiresAt).toBe('2026-06-08T11:00:00.000Z');
    expect(req.decisions).toEqual([]);
  });

  it('omits expiry when no SLA is set', () => {
    const req = newRequest({ slaMinutes: undefined });
    expect(req.expiresAt).toBeUndefined();
  });

  it('rejects an empty role list or a sub-1 quorum', () => {
    expect(() => newRequest({ approverRoles: [] })).toThrow(ApprovalTransitionError);
    expect(() => newRequest({ minApprovals: 0 })).toThrow(/at least 1/);
  });
});

describe('submitDecision', () => {
  it('accumulates approvals and resolves once the quorum is met', () => {
    let req = newRequest();
    req = submitDecision(req, { approver: 'alice', role: 'tech-lead', vote: 'approve', now: at(1) });
    expect(req.status).toBe('pending'); // 1 of 2
    expect(approvalProgress(req)).toEqual({ approvals: 1, required: 2, remaining: 1, rejections: 0 });

    req = submitDecision(req, { approver: 'bob', role: 'security', vote: 'approve', now: at(2) });
    expect(req.status).toBe('approved');
    expect(req.resolvedAt).toBe(at(2).toISOString());
  });

  it('a single rejection fails the request fast', () => {
    let req = newRequest();
    req = submitDecision(req, { approver: 'alice', role: 'tech-lead', vote: 'reject', now: at(1) });
    expect(req.status).toBe('rejected');
    expect(approvalProgress(req)).toMatchObject({ approvals: 0, rejections: 1 });
  });

  it('rejects an out-of-policy role', () => {
    const req = newRequest();
    expect(() => submitDecision(req, { approver: 'x', role: 'intern', vote: 'approve', now: at(1) })).toThrow(
      /not an approver/,
    );
  });

  it('rejects a repeat approver', () => {
    let req = newRequest();
    req = submitDecision(req, { approver: 'alice', role: 'tech-lead', vote: 'approve', now: at(1) });
    expect(() =>
      submitDecision(req, { approver: 'alice', role: 'security', vote: 'approve', now: at(2) }),
    ).toThrow(/already decided/);
  });

  it('refuses to decide a resolved request', () => {
    let req = newRequest({ minApprovals: 1 });
    req = submitDecision(req, { approver: 'alice', role: 'tech-lead', vote: 'approve', now: at(1) });
    expect(req.status).toBe('approved');
    expect(() => submitDecision(req, { approver: 'bob', role: 'security', vote: 'approve', now: at(2) })).toThrow(
      /cannot decide a approved request/,
    );
  });

  it('refuses a decision after expiry', () => {
    const req = newRequest();
    expect(() =>
      submitDecision(req, { approver: 'alice', role: 'tech-lead', vote: 'approve', now: at(61) }),
    ).toThrow(/has expired/);
  });
});

describe('expireIfDue', () => {
  it('expires a pending request past its SLA', () => {
    const req = newRequest();
    const expired = expireIfDue(req, at(61));
    expect(expired.status).toBe('expired');
    expect(expired.resolvedAt).toBe(at(61).toISOString());
  });

  it('leaves a request alone before expiry, without an SLA, or when already resolved', () => {
    expect(expireIfDue(newRequest(), at(30)).status).toBe('pending');
    expect(expireIfDue(newRequest({ slaMinutes: undefined }), at(9999)).status).toBe('pending');
    const approved = submitDecision(newRequest({ minApprovals: 1 }), {
      approver: 'a',
      role: 'tech-lead',
      vote: 'approve',
      now: at(1),
    });
    expect(expireIfDue(approved, at(61))).toBe(approved); // unchanged reference
  });
});

describe('cancelRequest', () => {
  it('cancels a pending request', () => {
    const req = cancelRequest(newRequest(), { by: 'ops', reason: 'run aborted', now: at(5) });
    expect(req.status).toBe('cancelled');
    expect(req.reason).toBe('run aborted');
    expect(isResolved(req)).toBe(true);
  });

  it('refuses to cancel a resolved request', () => {
    const rejected = submitDecision(newRequest(), { approver: 'a', role: 'tech-lead', vote: 'reject', now: at(1) });
    expect(() => cancelRequest(rejected)).toThrow(/cannot cancel a rejected request/);
  });
});
