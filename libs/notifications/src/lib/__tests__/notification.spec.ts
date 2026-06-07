import {
  DeliveryResult,
  Notification,
  NotificationDispatcher,
  NotificationSender,
  Recipient,
} from '../notification';
import { RecordingNotificationSender } from '../senders';

const notification = (recipients: Recipient[]): Notification => ({
  id: 'ntf-1',
  type: 'approval.requested',
  subject: 'Approval needed',
  body: 'please review',
  recipients,
  createdAt: '2026-06-08T10:00:00.000Z',
});

describe('NotificationDispatcher', () => {
  it('routes each recipient to the sender for its channel and aggregates ok', async () => {
    const slack = new RecordingNotificationSender('slack');
    const email = new RecordingNotificationSender('email');
    const dispatcher = new NotificationDispatcher([slack, email]);

    const result = await dispatcher.dispatch(
      notification([
        { channel: 'slack', address: '#deploys' },
        { channel: 'email', address: 'lead@acme.test' },
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      { channel: 'slack', address: '#deploys', ok: true },
      { channel: 'email', address: 'lead@acme.test', ok: true },
    ]);
    expect(slack.sent).toHaveLength(1);
    expect(email.sent[0].recipient.address).toBe('lead@acme.test');
  });

  it('returns a failed result (not an exception) for an unregistered channel', async () => {
    const dispatcher = new NotificationDispatcher([new RecordingNotificationSender('slack')]);
    const result = await dispatcher.dispatch(notification([{ channel: 'email', address: 'x@y.z' }]));

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({ channel: 'email', ok: false });
    expect(result.results[0].error).toMatch(/no sender registered/);
  });

  it('captures a throwing sender as a failed result without sinking siblings', async () => {
    const boom: NotificationSender = {
      channel: 'email',
      async send(): Promise<DeliveryResult> {
        throw new Error('smtp down');
      },
    };
    const slack = new RecordingNotificationSender('slack');
    const dispatcher = new NotificationDispatcher([boom, slack]);

    const result = await dispatcher.dispatch(
      notification([
        { channel: 'email', address: 'x@y.z' },
        { channel: 'slack', address: '#ops' },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({ channel: 'email', ok: false, error: 'smtp down' });
    expect(result.results[1]).toMatchObject({ channel: 'slack', ok: true }); // sibling still delivered
  });

  it('register() replaces a channel sender', async () => {
    const dispatcher = new NotificationDispatcher();
    const slack = new RecordingNotificationSender('slack');
    dispatcher.register(slack);

    await dispatcher.dispatch(notification([{ channel: 'slack', address: '#a' }]));
    expect(slack.sent).toHaveLength(1);
  });
});
