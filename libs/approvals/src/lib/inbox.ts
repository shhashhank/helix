/**
 * Approval inbox read-model (HELIX-132): derive the "what's waiting on me" view an
 * approver needs to act — for each pending request, its progress toward quorum, who
 * has decided, how long until the SLA lapses, and how old it is. Pure + deterministic.
 *
 * This is the data behind an inbox; the *rendered* UI is deferred to the SaaS epic
 * (HELIX-11) — see DEFERRED.md. The orchestrator exposes this over HTTP (HELIX-131
 * module). Most-urgent-first ordering so the soonest-to-expire surfaces at the top.
 */
import { ApprovalRequest } from './request';

export interface InboxItem {
  id: string;
  action: string;
  /** The gated run id. */
  subjectId?: string;
  requestedBy?: string;
  reason?: string;
  approverRoles: string[];
  /** Distinct approvals so far. */
  approvals: number;
  /** Quorum required. */
  required: number;
  /** Approvals still needed. */
  remaining: number;
  rejections: number;
  createdAt: string;
  /** Seconds since the request opened. */
  ageSeconds: number;
  slaMinutes?: number;
  expiresAt?: string;
  /** Seconds until the SLA lapses (negative if already past — clamped at read time). */
  slaRemainingSeconds?: number;
  /** Distinct roles that have cast any decision. */
  rolesDecided: string[];
  /** Approver roles that nobody has voted as yet (informational). */
  awaitingRoles: string[];
}

export interface BuildInboxOptions {
  /** Only include requests this role is permitted to approve. */
  role?: string;
  /** Evaluation time (defaults to now). */
  now?: Date;
}

/** Project a single pending request into its inbox row. */
export function toInboxItem(request: ApprovalRequest, now: Date = new Date()): InboxItem {
  const nowMs = now.getTime();
  const approvals = request.decisions.filter((d) => d.vote === 'approve').length;
  const rejections = request.decisions.filter((d) => d.vote === 'reject').length;
  const rolesDecided = [...new Set(request.decisions.map((d) => d.role))];
  const awaitingRoles = request.approverRoles.filter((r) => !rolesDecided.includes(r));

  return {
    id: request.id,
    action: request.action,
    subjectId: request.subjectId,
    requestedBy: request.requestedBy,
    reason: request.reason,
    approverRoles: request.approverRoles,
    approvals,
    required: request.minApprovals,
    remaining: Math.max(0, request.minApprovals - approvals),
    rejections,
    createdAt: request.createdAt,
    ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(request.createdAt)) / 1000)),
    slaMinutes: request.slaMinutes,
    expiresAt: request.expiresAt,
    slaRemainingSeconds:
      request.expiresAt !== undefined
        ? Math.floor((Date.parse(request.expiresAt) - nowMs) / 1000)
        : undefined,
    rolesDecided,
    awaitingRoles,
  };
}

/**
 * Build an inbox from a set of requests: keep only the pending ones (optionally those
 * a given role may approve), project each, and order most-urgent-first — soonest SLA
 * deadline before later ones, requests with an SLA before those without, then oldest
 * first as a tiebreak.
 */
export function buildInbox(requests: ApprovalRequest[], options: BuildInboxOptions = {}): InboxItem[] {
  const now = options.now ?? new Date();
  const items = requests
    .filter((r) => r.status === 'pending')
    .filter((r) => options.role === undefined || r.approverRoles.includes(options.role))
    .map((r) => toInboxItem(r, now));

  return items.sort((a, b) => {
    // Requests with an SLA are more urgent than those without.
    if (a.slaRemainingSeconds === undefined && b.slaRemainingSeconds === undefined) {
      return a.ageSeconds === b.ageSeconds ? a.id.localeCompare(b.id) : b.ageSeconds - a.ageSeconds;
    }
    if (a.slaRemainingSeconds === undefined) return 1;
    if (b.slaRemainingSeconds === undefined) return -1;
    // Soonest deadline first; tiebreak by older request.
    return a.slaRemainingSeconds === b.slaRemainingSeconds
      ? b.ageSeconds - a.ageSeconds
      : a.slaRemainingSeconds - b.slaRemainingSeconds;
  });
}
