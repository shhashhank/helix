/**
 * SLA escalation (HELIX-134): when a pending approval is running down its SLA, pull
 * in the **backup approvers** (the policy's `escalateTo` roles) before it lapses.
 *
 * `escalationDue` is the pure predicate — true while a request sits in the window
 * `[expiresAt - beforeExpiryMinutes, expiresAt)`, has backups, and hasn't escalated
 * yet. `escalateRequest` records the escalation and **widens** the approver roles to
 * include the backups (so they can now sign off), once. Strictly a *pre-expiry*
 * nudge — once past `expiresAt`, {@link expireIfDue} takes over. The periodic timer
 * that drives the sweep is deferred (see DEFERRED.md); the logic here is real.
 */
import { ApprovalRequest, ApprovalTransitionError } from './request';

export interface EscalationOptions {
  /** How many minutes before the SLA deadline to escalate (default 0 → never). */
  beforeExpiryMinutes?: number;
  /** Evaluation time (defaults to now). */
  now?: Date;
}

/** Is a pending request inside its pre-expiry escalation window, with backups, not yet escalated? */
export function escalationDue(request: ApprovalRequest, options: EscalationOptions = {}): boolean {
  if (request.status !== 'pending') return false;
  if (request.escalatedAt) return false; // escalate at most once
  if (request.escalateTo.length === 0) return false; // nobody to escalate to
  if (!request.expiresAt) return false; // no SLA → no escalation
  const now = (options.now ?? new Date()).getTime();
  const expiry = Date.parse(request.expiresAt);
  const windowStart = expiry - (options.beforeExpiryMinutes ?? 0) * 60_000;
  return now >= windowStart && now < expiry;
}

/**
 * Escalate a pending request: stamp `escalatedAt` and add the `escalateTo` roles to
 * `approverRoles` so the backups can approve. Throws on a non-pending request.
 */
export function escalateRequest(request: ApprovalRequest, options: EscalationOptions = {}): ApprovalRequest {
  if (request.status !== 'pending') {
    throw new ApprovalTransitionError(`cannot escalate a ${request.status} request`);
  }
  const now = options.now ?? new Date();
  const approverRoles = [...new Set([...request.approverRoles, ...request.escalateTo])];
  return { ...request, approverRoles, escalatedAt: now.toISOString() };
}
