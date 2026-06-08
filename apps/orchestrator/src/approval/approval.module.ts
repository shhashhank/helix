import { Module } from '@nestjs/common';
import {
  InAppInbox,
  InAppNotificationSender,
  InMemoryInAppInbox,
  InMemoryRecipientDirectory,
  NotificationDispatcher,
  RecordingNotificationSender,
} from '@helix/notifications';
import { AuditLog, InMemoryAuditLog } from '@helix/audit';
import { TemporalModule } from '../temporal/temporal.module';
import { ApprovalController } from './approval.controller';
import { APPROVAL_NOTIFIER, DispatchingApprovalNotifier } from './approval.notifier';
import { ApprovalService } from './approval.service';
import { TemporalWorkflowSignaler, WORKFLOW_SIGNALER } from './approval.signaler';
import { APPROVAL_REQUEST_STORE, InMemoryApprovalRequestStore } from './approval.store';
import { NotificationController } from './notification.controller';
import { IN_APP_INBOX, NOTIFICATION_DISPATCHER, RECIPIENT_DIRECTORY } from './notification.tokens';
import { AuditController } from './audit.controller';
import { AUDIT_LOG } from './audit.tokens';

@Module({
  imports: [TemporalModule],
  controllers: [ApprovalController, NotificationController, AuditController],
  providers: [
    ApprovalService,
    { provide: APPROVAL_REQUEST_STORE, useClass: InMemoryApprovalRequestStore },
    { provide: WORKFLOW_SIGNALER, useClass: TemporalWorkflowSignaler },
    // Notification plumbing: an in-app feed (real) + recording Slack/email senders
    // (stand-ins until the live transports land — see DEFERRED.md).
    { provide: IN_APP_INBOX, useFactory: (): InAppInbox => new InMemoryInAppInbox() },
    { provide: RECIPIENT_DIRECTORY, useFactory: () => new InMemoryRecipientDirectory() },
    {
      provide: NOTIFICATION_DISPATCHER,
      useFactory: (inbox: InAppInbox): NotificationDispatcher =>
        new NotificationDispatcher([
          new InAppNotificationSender(inbox),
          new RecordingNotificationSender('slack'),
          new RecordingNotificationSender('email'),
        ]),
      inject: [IN_APP_INBOX],
    },
    { provide: APPROVAL_NOTIFIER, useClass: DispatchingApprovalNotifier },
    // Append-only, hash-chained audit log (one shared instance; HELIX-136 reads it).
    { provide: AUDIT_LOG, useFactory: (): AuditLog => new InMemoryAuditLog() },
  ],
  exports: [ApprovalService, AUDIT_LOG],
})
export class ApprovalModule {}
