import { createApprovalRequest } from '@helix/approvals';
import {
  InAppNotificationSender,
  InMemoryInAppInbox,
  InMemoryRecipientDirectory,
  NotificationDispatcher,
  RecordingNotificationSender,
} from '@helix/notifications';
import { DispatchingApprovalNotifier } from '../approval.notifier';

const request = createApprovalRequest({
  id: 'appr-1',
  requirement: { approverRoles: ['tech-lead', 'security'], minApprovals: 2, slaMinutes: 60, escalateTo: [] },
  action: 'deploy prod',
  subjectId: 'run-7',
  now: new Date('2026-06-08T10:00:00.000Z'),
});

describe('DispatchingApprovalNotifier', () => {
  it('resolves approver roles to recipients and delivers across channels', async () => {
    const inbox = new InMemoryInAppInbox();
    const slack = new RecordingNotificationSender('slack');
    const dispatcher = new NotificationDispatcher([new InAppNotificationSender(inbox), slack]);
    const directory = new InMemoryRecipientDirectory({
      'tech-lead': [{ channel: 'in_app', address: 'alice' }],
      security: [{ channel: 'slack', address: '#sec' }],
    });

    await new DispatchingApprovalNotifier(dispatcher, directory).notifyRequested(request);

    const feed = await inbox.list('alice');
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ type: 'approval.requested', data: { requestId: 'appr-1', runId: 'run-7' } });
    expect(slack.sent[0].recipient.address).toBe('#sec');
  });

  it('is a no-op when no recipients are configured for the roles', async () => {
    const slack = new RecordingNotificationSender('slack');
    const dispatcher = new NotificationDispatcher([slack]);
    await new DispatchingApprovalNotifier(dispatcher, new InMemoryRecipientDirectory()).notifyRequested(request);
    expect(slack.sent).toHaveLength(0);
  });

  it('notifyEscalated targets the backup (escalateTo) recipients', async () => {
    const email = new RecordingNotificationSender('email');
    const dispatcher = new NotificationDispatcher([email]);
    const directory = new InMemoryRecipientDirectory({
      'eng-manager': [{ channel: 'email', address: 'mgr@acme.test' }],
      'tech-lead': [{ channel: 'email', address: 'lead@acme.test' }],
    });
    // request.escalateTo is empty in the fixture; escalate it first to populate backups
    const escalated = { ...request, escalateTo: ['eng-manager'] };

    await new DispatchingApprovalNotifier(dispatcher, directory).notifyEscalated(escalated);

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].recipient.address).toBe('mgr@acme.test'); // the backup, not the lead
    expect(email.sent[0].notification.type).toBe('approval.escalated');
  });
});
