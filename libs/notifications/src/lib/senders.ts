/**
 * Notification senders (HELIX-133). `InAppNotificationSender` is a real delivery
 * channel — it appends to a per-address {@link InAppInbox} feed that a UI/API can
 * read (pairs with the approval inbox, HELIX-132). `RecordingNotificationSender`
 * records what *would* be sent on any channel — it stands in for the deferred live
 * Slack/email transports (webhooks/SMTP need network + secrets; see DEFERRED.md)
 * and is handy in tests.
 */
import {
  DeliveryResult,
  Notification,
  NotificationChannel,
  NotificationSender,
  Recipient,
} from './notification';

/** One delivered in-app message, as a recipient would see it in their feed. */
export interface InAppMessage {
  notificationId: string;
  type: string;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
  deliveredAt: string;
}

/** Per-address store of delivered in-app notifications. */
export interface InAppInbox {
  append(address: string, message: InAppMessage): Promise<void>;
  list(address: string): Promise<InAppMessage[]>;
}

/** Process-local in-app inbox. Swap for a durable store later (see DEFERRED.md). */
export class InMemoryInAppInbox implements InAppInbox {
  private readonly byAddress = new Map<string, InAppMessage[]>();

  async append(address: string, message: InAppMessage): Promise<void> {
    const list = this.byAddress.get(address) ?? [];
    list.push(message);
    this.byAddress.set(address, list);
  }

  async list(address: string): Promise<InAppMessage[]> {
    return [...(this.byAddress.get(address) ?? [])];
  }
}

/** Delivers to the in-app feed. */
export class InAppNotificationSender implements NotificationSender {
  readonly channel: NotificationChannel = 'in_app';

  constructor(private readonly inbox: InAppInbox) {}

  async send(notification: Notification, recipient: Recipient): Promise<DeliveryResult> {
    await this.inbox.append(recipient.address, {
      notificationId: notification.id,
      type: notification.type,
      subject: notification.subject,
      body: notification.body,
      data: notification.data,
      deliveredAt: new Date().toISOString(),
    });
    return { channel: this.channel, address: recipient.address, ok: true };
  }
}

/** One recorded send attempt. */
export interface RecordedDelivery {
  notification: Notification;
  recipient: Recipient;
}

/**
 * Records every send for a channel instead of transmitting it — the stand-in for the
 * deferred live Slack/email senders, and an assertion target in tests.
 */
export class RecordingNotificationSender implements NotificationSender {
  readonly sent: RecordedDelivery[] = [];

  constructor(readonly channel: NotificationChannel) {}

  async send(notification: Notification, recipient: Recipient): Promise<DeliveryResult> {
    this.sent.push({ notification, recipient });
    return { channel: this.channel, address: recipient.address, ok: true };
  }
}
