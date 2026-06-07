import { Notification, Recipient } from '../notification';
import { InAppNotificationSender, InMemoryInAppInbox, RecordingNotificationSender } from '../senders';

const notification: Notification = {
  id: 'ntf-1',
  type: 'approval.requested',
  subject: 'Approval needed: deploy prod',
  body: 'please review',
  recipients: [],
  data: { requestId: 'appr-1' },
  createdAt: '2026-06-08T10:00:00.000Z',
};

const to = (channel: Recipient['channel'], address: string): Recipient => ({ channel, address });

describe('InAppNotificationSender', () => {
  it('appends to the addressed feed and reports ok', async () => {
    const inbox = new InMemoryInAppInbox();
    const sender = new InAppNotificationSender(inbox);

    const result = await sender.send(notification, to('in_app', 'user-7'));
    expect(result).toEqual({ channel: 'in_app', address: 'user-7', ok: true });

    const feed = await inbox.list('user-7');
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      notificationId: 'ntf-1',
      type: 'approval.requested',
      subject: 'Approval needed: deploy prod',
      data: { requestId: 'appr-1' },
    });
    expect(await inbox.list('someone-else')).toEqual([]);
  });
});

describe('RecordingNotificationSender', () => {
  it('records sends for its channel and reports ok', async () => {
    const sender = new RecordingNotificationSender('slack');
    const result = await sender.send(notification, to('slack', '#deploys'));

    expect(result).toEqual({ channel: 'slack', address: '#deploys', ok: true });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].recipient.address).toBe('#deploys');
  });
});
