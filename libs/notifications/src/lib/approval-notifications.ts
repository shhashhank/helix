/**
 * Approval-event → notification builders (HELIX-133/134). Plain-field inputs (not a
 * `@helix/approvals` import) keep this lib decoupled; the orchestrator maps an
 * `ApprovalRequest` onto these.
 */
import { Notification, Recipient } from './notification';

export interface ApprovalNotificationInput {
  requestId: string;
  action: string;
  /** The gated run id. */
  runId?: string;
  approverRoles: string[];
  minApprovals: number;
  /** ISO deadline, if the gate has an SLA. */
  expiresAt?: string;
  reason?: string;
}

export interface BuildNotificationOptions {
  id?: string;
  now?: Date;
}

/** Build the "an approval is needed" notification for a freshly-opened request. */
export function approvalRequestedNotification(
  input: ApprovalNotificationInput,
  recipients: Recipient[],
  options: BuildNotificationOptions = {},
): Notification {
  const now = options.now ?? new Date();
  const quorum = `${input.minApprovals} approval${input.minApprovals === 1 ? '' : 's'}`;
  const body = [
    `${input.action} needs sign-off — ${quorum} from ${input.approverRoles.join(', ')}.`,
    input.runId ? `Run ${input.runId}.` : undefined,
    input.expiresAt ? `Respond by ${input.expiresAt}.` : undefined,
    input.reason ? `Reason: ${input.reason}.` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: options.id ?? `ntf-${input.requestId}-requested`,
    type: 'approval.requested',
    subject: `Approval needed: ${input.action}`,
    body,
    recipients,
    data: { requestId: input.requestId, runId: input.runId, action: input.action },
    createdAt: now.toISOString(),
  };
}

/**
 * Build the escalation notification for a request nearing its SLA — sent to the
 * backup approvers pulled in by {@link escalateRequest}.
 */
export function approvalEscalatedNotification(
  input: ApprovalNotificationInput,
  recipients: Recipient[],
  options: BuildNotificationOptions = {},
): Notification {
  const now = options.now ?? new Date();
  const body = [
    `${input.action} is nearing its approval deadline and needs backup sign-off.`,
    input.runId ? `Run ${input.runId}.` : undefined,
    input.expiresAt ? `Expires ${input.expiresAt}.` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: options.id ?? `ntf-${input.requestId}-escalated`,
    type: 'approval.escalated',
    subject: `Escalation: approval needed for ${input.action}`,
    body,
    recipients,
    data: { requestId: input.requestId, runId: input.runId, action: input.action },
    createdAt: now.toISOString(),
  };
}
