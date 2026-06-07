/**
 * Approval request state machine (HELIX-130): turns a {@link ResolvedRequirement}
 * (from {@link evaluatePolicy}) into a live approval request and drives its
 * lifecycle — `pending → approved | rejected | expired | cancelled` — while tracking
 * individual approver decisions against the quorum and enforcing the SLA.
 *
 * Every function is **pure and immutable**: it returns a new request rather than
 * mutating, and refuses illegal transitions (deciding a resolved request, a
 * duplicate approver, an out-of-policy role, an expired request) with an
 * {@link ApprovalTransitionError}. Timestamps are ISO strings so a request is
 * directly serializable for the storage + workflow-signal layer (HELIX-131).
 */
import type { ResolvedRequirement } from './policy';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type DecisionVote = 'approve' | 'reject';

const TERMINAL: ReadonlySet<ApprovalStatus> = new Set(['approved', 'rejected', 'expired', 'cancelled']);

/** Thrown when a transition isn't legal for the request's current state. */
export class ApprovalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalTransitionError';
  }
}

/** One approver's recorded vote. */
export interface ApproverDecision {
  /** Identity of the approver (distinct people are what the quorum counts). */
  approver: string;
  /** The role they acted as; must be one of the request's `approverRoles`. */
  role: string;
  vote: DecisionVote;
  comment?: string;
  /** ISO timestamp. */
  decidedAt: string;
}

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatus;
  /** Roles permitted to approve (from the policy requirement). */
  approverRoles: string[];
  /** Distinct approvals needed to pass (quorum). */
  minApprovals: number;
  /** Roles to escalate to on SLA breach (carried for HELIX-134). */
  escalateTo: string[];
  /** What's being gated (descriptive, e.g. `deploy prod`). */
  action: string;
  /** The thing the gate is attached to, e.g. a run/step id. */
  subjectId?: string;
  /** Who/what raised the request. */
  requestedBy?: string;
  /** Why approval is needed (e.g. the matched rule ids). */
  reason?: string;
  createdAt: string;
  /** Respond-within window, if the policy set one. */
  slaMinutes?: number;
  /** `createdAt + slaMinutes`, if an SLA applies. */
  expiresAt?: string;
  decisions: ApproverDecision[];
  /** Set when the request leaves `pending`. */
  resolvedAt?: string;
}

export interface CreateApprovalRequestInput {
  id: string;
  /** The folded requirement from {@link evaluatePolicy}. */
  requirement: ResolvedRequirement;
  action: string;
  subjectId?: string;
  requestedBy?: string;
  reason?: string;
  /** Defaults to the current time. */
  now?: Date;
}

/** Open a new `pending` request from a policy requirement. */
export function createApprovalRequest(input: CreateApprovalRequestInput): ApprovalRequest {
  const { requirement } = input;
  if (requirement.approverRoles.length === 0) {
    throw new ApprovalTransitionError('cannot create an approval request with no approver roles');
  }
  if (requirement.minApprovals < 1) {
    throw new ApprovalTransitionError('minApprovals must be at least 1');
  }
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt =
    requirement.slaMinutes !== undefined
      ? new Date(now.getTime() + requirement.slaMinutes * 60_000).toISOString()
      : undefined;

  return {
    id: input.id,
    status: 'pending',
    approverRoles: [...requirement.approverRoles],
    minApprovals: requirement.minApprovals,
    escalateTo: [...requirement.escalateTo],
    action: input.action,
    subjectId: input.subjectId,
    requestedBy: input.requestedBy,
    reason: input.reason,
    createdAt,
    slaMinutes: requirement.slaMinutes,
    expiresAt,
    decisions: [],
    resolvedAt: undefined,
  };
}

export interface DecisionInput {
  approver: string;
  role: string;
  vote: DecisionVote;
  comment?: string;
  now?: Date;
}

/**
 * Record an approver's decision. A single `reject` resolves the request as
 * `rejected` (fail-fast); `approve` votes accumulate until `minApprovals` distinct
 * approvers have approved, then the request is `approved`. Throws on a non-pending
 * request, an expired request, an out-of-policy role, or a repeat approver.
 */
export function submitDecision(request: ApprovalRequest, decision: DecisionInput): ApprovalRequest {
  if (request.status !== 'pending') {
    throw new ApprovalTransitionError(`cannot decide a ${request.status} request`);
  }
  const now = decision.now ?? new Date();
  if (request.expiresAt && now.getTime() >= Date.parse(request.expiresAt)) {
    throw new ApprovalTransitionError('approval request has expired');
  }
  if (!request.approverRoles.includes(decision.role)) {
    throw new ApprovalTransitionError(
      `role "${decision.role}" is not an approver for this request (allowed: ${request.approverRoles.join(', ')})`,
    );
  }
  if (request.decisions.some((d) => d.approver === decision.approver)) {
    throw new ApprovalTransitionError(`approver "${decision.approver}" has already decided`);
  }

  const decisions = [
    ...request.decisions,
    {
      approver: decision.approver,
      role: decision.role,
      vote: decision.vote,
      comment: decision.comment,
      decidedAt: now.toISOString(),
    },
  ];

  if (decision.vote === 'reject') {
    return { ...request, decisions, status: 'rejected', resolvedAt: now.toISOString() };
  }
  const approvals = decisions.filter((d) => d.vote === 'approve').length;
  if (approvals >= request.minApprovals) {
    return { ...request, decisions, status: 'approved', resolvedAt: now.toISOString() };
  }
  return { ...request, decisions };
}

/** Expire a pending request whose SLA has elapsed; otherwise return it unchanged. */
export function expireIfDue(request: ApprovalRequest, now: Date = new Date()): ApprovalRequest {
  if (request.status !== 'pending' || !request.expiresAt) return request;
  if (now.getTime() < Date.parse(request.expiresAt)) return request;
  return { ...request, status: 'expired', resolvedAt: now.toISOString() };
}

export interface CancelInput {
  by?: string;
  reason?: string;
  now?: Date;
}

/** Cancel a pending request (e.g. the underlying run was aborted). */
export function cancelRequest(request: ApprovalRequest, input: CancelInput = {}): ApprovalRequest {
  if (request.status !== 'pending') {
    throw new ApprovalTransitionError(`cannot cancel a ${request.status} request`);
  }
  const now = input.now ?? new Date();
  return {
    ...request,
    status: 'cancelled',
    resolvedAt: now.toISOString(),
    reason: input.reason ?? request.reason,
  };
}

export interface ApprovalProgress {
  approvals: number;
  required: number;
  remaining: number;
  rejections: number;
}

/** Quorum progress: distinct approve/reject counts and how many approvals remain. */
export function approvalProgress(request: ApprovalRequest): ApprovalProgress {
  const approvals = request.decisions.filter((d) => d.vote === 'approve').length;
  const rejections = request.decisions.filter((d) => d.vote === 'reject').length;
  return {
    approvals,
    required: request.minApprovals,
    remaining: Math.max(0, request.minApprovals - approvals),
    rejections,
  };
}

export const isResolved = (request: ApprovalRequest): boolean => TERMINAL.has(request.status);
export const isPending = (request: ApprovalRequest): boolean => request.status === 'pending';
