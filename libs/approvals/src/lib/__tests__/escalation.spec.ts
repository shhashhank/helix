import { ResolvedRequirement } from '../policy';
import { ApprovalRequest, ApprovalTransitionError, createApprovalRequest, submitDecision } from '../request';
import { escalateRequest, escalationDue } from '../escalation';

const T0 = new Date('2026-06-08T10:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const make = (over: Partial<ResolvedRequirement> = {}): ApprovalRequest =>
  createApprovalRequest({
    id: 'req-1',
    requirement: {
      approverRoles: ['tech-lead'],
      minApprovals: 1,
      slaMinutes: 60,
      escalateTo: ['eng-manager'],
      ...over,
    },
    action: 'deploy prod',
    now: T0,
  });

describe('escalationDue', () => {
  it('is true inside the pre-expiry window with backups, not yet escalated', () => {
    const req = make(); // expires at +60
    expect(escalationDue(req, { beforeExpiryMinutes: 15, now: at(44) })).toBe(false); // before window
    expect(escalationDue(req, { beforeExpiryMinutes: 15, now: at(45) })).toBe(true); // window start
    expect(escalationDue(req, { beforeExpiryMinutes: 15, now: at(59) })).toBe(true); // still pending
  });

  it('is false at/after expiry (expiry takes over) and with a 0 window', () => {
    const req = make();
    expect(escalationDue(req, { beforeExpiryMinutes: 15, now: at(60) })).toBe(false); // at expiry
    expect(escalationDue(req, { beforeExpiryMinutes: 0, now: at(60) })).toBe(false); // zero window never fires
  });

  it('is false without backups, without an SLA, when already escalated, or when resolved', () => {
    expect(escalationDue(make({ escalateTo: [] }), { beforeExpiryMinutes: 15, now: at(50) })).toBe(false);
    expect(escalationDue(make({ slaMinutes: undefined }), { beforeExpiryMinutes: 15, now: at(50) })).toBe(false);
    expect(
      escalationDue({ ...make(), escalatedAt: at(46).toISOString() }, { beforeExpiryMinutes: 15, now: at(50) }),
    ).toBe(false);
    const approved = submitDecision(make(), { approver: 'a', role: 'tech-lead', vote: 'approve', now: at(1) });
    expect(escalationDue(approved, { beforeExpiryMinutes: 15, now: at(50) })).toBe(false);
  });
});

describe('escalateRequest', () => {
  it('stamps escalatedAt and widens approver roles with the backups', () => {
    const req = escalateRequest(make(), { now: at(45) });
    expect(req.escalatedAt).toBe(at(45).toISOString());
    expect(req.approverRoles).toEqual(['tech-lead', 'eng-manager']); // backups can now approve
    expect(escalationDue(req, { beforeExpiryMinutes: 15, now: at(50) })).toBe(false); // not again
  });

  it('lets an escalated backup approver sign off', () => {
    const escalated = escalateRequest(make(), { now: at(45) });
    const approved = submitDecision(escalated, { approver: 'm', role: 'eng-manager', vote: 'approve', now: at(46) });
    expect(approved.status).toBe('approved');
  });

  it('refuses to escalate a resolved request', () => {
    const approved = submitDecision(make(), { approver: 'a', role: 'tech-lead', vote: 'approve', now: at(1) });
    expect(() => escalateRequest(approved, { now: at(45) })).toThrow(ApprovalTransitionError);
  });
});
