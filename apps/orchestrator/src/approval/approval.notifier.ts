import { Inject, Injectable } from '@nestjs/common';
import { ApprovalRequest } from '@helix/approvals';
import {
  NotificationDispatcher,
  RecipientDirectory,
  approvalEscalatedNotification,
  approvalRequestedNotification,
  recipientsForRoles,
} from '@helix/notifications';
import { NOTIFICATION_DISPATCHER, RECIPIENT_DIRECTORY } from './notification.tokens';

/** DI token for the {@link ApprovalNotifier}. */
export const APPROVAL_NOTIFIER = Symbol('APPROVAL_NOTIFIER');

/** Emits notifications for approval lifecycle events (best-effort, never blocks the gate). */
export interface ApprovalNotifier {
  notifyRequested(request: ApprovalRequest): Promise<void>;
  /** Notify the backup approvers (the request's `escalateTo` roles) on escalation. */
  notifyEscalated(request: ApprovalRequest): Promise<void>;
}

/** Resolves approver roles → recipients via the directory and fans out via the dispatcher. */
@Injectable()
export class DispatchingApprovalNotifier implements ApprovalNotifier {
  constructor(
    @Inject(NOTIFICATION_DISPATCHER) private readonly dispatcher: NotificationDispatcher,
    @Inject(RECIPIENT_DIRECTORY) private readonly directory: RecipientDirectory,
  ) {}

  async notifyRequested(request: ApprovalRequest): Promise<void> {
    const recipients = await recipientsForRoles(this.directory, request.approverRoles);
    if (recipients.length === 0) return; // nobody configured for these roles
    const notification = approvalRequestedNotification(
      {
        requestId: request.id,
        action: request.action,
        runId: request.subjectId,
        approverRoles: request.approverRoles,
        minApprovals: request.minApprovals,
        expiresAt: request.expiresAt,
        reason: request.reason,
      },
      recipients,
    );
    await this.dispatcher.dispatch(notification);
  }

  async notifyEscalated(request: ApprovalRequest): Promise<void> {
    const recipients = await recipientsForRoles(this.directory, request.escalateTo);
    if (recipients.length === 0) return; // no backups configured
    const notification = approvalEscalatedNotification(
      {
        requestId: request.id,
        action: request.action,
        runId: request.subjectId,
        approverRoles: request.approverRoles,
        minApprovals: request.minApprovals,
        expiresAt: request.expiresAt,
        reason: request.reason,
      },
      recipients,
    );
    await this.dispatcher.dispatch(notification);
  }
}

/** No-op notifier (notifications disabled / not under test). */
export class NoopApprovalNotifier implements ApprovalNotifier {
  async notifyRequested(): Promise<void> {
    /* intentionally empty */
  }

  async notifyEscalated(): Promise<void> {
    /* intentionally empty */
  }
}
