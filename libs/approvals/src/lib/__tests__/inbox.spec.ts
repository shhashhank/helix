import { ResolvedRequirement } from '../policy';
import { createApprovalRequest, submitDecision, cancelRequest, ApprovalRequest } from '../request';
import { buildInbox, toInboxItem } from '../inbox';

const T0 = new Date('2026-06-08T10:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const make = (id: string, over: Partial<ResolvedRequirement> = {}, now = T0): ApprovalRequest =>
  createApprovalRequest({
    id,
    requirement: {
      approverRoles: ['tech-lead', 'security'],
      minApprovals: 2,
      slaMinutes: 60,
      escalateTo: [],
      ...over,
    },
    action: `action-${id}`,
    subjectId: `run-${id}`,
    now,
  });

describe('toInboxItem', () => {
  it('projects progress, age, SLA-remaining, and decided/awaiting roles', () => {
    let req = make('1');
    req = submitDecision(req, { approver: 'alice', role: 'tech-lead', vote: 'approve', now: at(1) });

    const item = toInboxItem(req, at(10));
    expect(item).toMatchObject({
      id: '1',
      action: 'action-1',
      subjectId: 'run-1',
      approvals: 1,
      required: 2,
      remaining: 1,
      rejections: 0,
      ageSeconds: 600, // 10 min
      slaRemainingSeconds: 3000, // 50 min left of a 60-min SLA
      rolesDecided: ['tech-lead'],
      awaitingRoles: ['security'],
    });
  });

  it('omits slaRemaining when the request has no SLA', () => {
    const item = toInboxItem(make('x', { slaMinutes: undefined }), at(5));
    expect(item.slaRemainingSeconds).toBeUndefined();
    expect(item.expiresAt).toBeUndefined();
  });
});

describe('buildInbox', () => {
  it('keeps only pending requests', () => {
    const pending = make('p');
    const approved = submitDecision(make('a', { minApprovals: 1 }), {
      approver: 'u',
      role: 'tech-lead',
      vote: 'approve',
      now: at(1),
    });
    const cancelled = cancelRequest(make('c'), { now: at(1) });

    const inbox = buildInbox([pending, approved, cancelled], { now: at(2) });
    expect(inbox.map((i) => i.id)).toEqual(['p']);
  });

  it('filters to requests a given role may approve', () => {
    const forLeads = make('lead-only', { approverRoles: ['tech-lead'] });
    const forSec = make('sec-only', { approverRoles: ['security'] });

    const inbox = buildInbox([forLeads, forSec], { role: 'security', now: at(1) });
    expect(inbox.map((i) => i.id)).toEqual(['sec-only']);
  });

  it('orders most-urgent-first: soonest SLA, SLA before no-SLA, oldest as tiebreak', () => {
    const soon = make('soon', { slaMinutes: 30 }); // expires at +30
    const later = make('later', { slaMinutes: 120 }); // expires at +120
    const noSla = make('no-sla', { slaMinutes: undefined });

    const inbox = buildInbox([later, noSla, soon], { now: at(5) });
    expect(inbox.map((i) => i.id)).toEqual(['soon', 'later', 'no-sla']);
  });

  it('breaks no-SLA ties by oldest first', () => {
    const older = make('older', { slaMinutes: undefined }, T0);
    const newer = make('newer', { slaMinutes: undefined }, at(10));

    const inbox = buildInbox([newer, older], { now: at(20) });
    expect(inbox.map((i) => i.id)).toEqual(['older', 'newer']);
  });
});
