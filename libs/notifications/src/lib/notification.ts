/**
 * Notification dispatch (HELIX-133): a small, channel-agnostic system for getting a
 * message to people across **Slack / email / in-app**. The {@link NotificationDispatcher}
 * routes each recipient to the {@link NotificationSender} registered for its channel
 * and collects a per-recipient {@link DeliveryResult} — it never throws, so one bad
 * channel can't sink the rest.
 *
 * The senders are a seam: an in-app sender is real (HELIX-132's inbox-style feed), and
 * the live Slack/email transports (webhooks / SMTP — network + secrets) are deferred
 * (see DEFERRED.md); a recording sender stands in for them and for tests.
 */

export type NotificationChannel = 'slack' | 'email' | 'in_app';

/** A single destination: which channel, and the address on it (email / slack id / user id). */
export interface Recipient {
  channel: NotificationChannel;
  address: string;
}

/** A message to deliver to one or more recipients. */
export interface Notification {
  id: string;
  /** Event type, e.g. `approval.requested`, `approval.escalated`. */
  type: string;
  subject: string;
  body: string;
  recipients: Recipient[];
  /** Structured context (e.g. requestId, runId, action) for richer channels. */
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface DeliveryResult {
  channel: NotificationChannel;
  address: string;
  ok: boolean;
  error?: string;
}

/** Delivers a notification to one recipient on a specific channel. */
export interface NotificationSender {
  readonly channel: NotificationChannel;
  send(notification: Notification, recipient: Recipient): Promise<DeliveryResult>;
}

export interface DispatchResult {
  notificationId: string;
  /** True only if every recipient was delivered to. */
  ok: boolean;
  results: DeliveryResult[];
}

/**
 * Fans a notification out to its recipients, each via the sender registered for that
 * recipient's channel. A recipient on an unregistered channel yields a failed result
 * rather than an exception, and a sender that throws is captured the same way.
 */
export class NotificationDispatcher {
  private readonly senders = new Map<NotificationChannel, NotificationSender>();

  constructor(senders: NotificationSender[] = []) {
    for (const sender of senders) this.register(sender);
  }

  /** Register (or replace) the sender for a channel. */
  register(sender: NotificationSender): void {
    this.senders.set(sender.channel, sender);
  }

  async dispatch(notification: Notification): Promise<DispatchResult> {
    const results: DeliveryResult[] = [];
    for (const recipient of notification.recipients) {
      results.push(await this.deliver(notification, recipient));
    }
    return {
      notificationId: notification.id,
      ok: results.every((r) => r.ok),
      results,
    };
  }

  private async deliver(notification: Notification, recipient: Recipient): Promise<DeliveryResult> {
    const sender = this.senders.get(recipient.channel);
    if (!sender) {
      return {
        channel: recipient.channel,
        address: recipient.address,
        ok: false,
        error: `no sender registered for channel "${recipient.channel}"`,
      };
    }
    try {
      return await sender.send(notification, recipient);
    } catch (err) {
      return {
        channel: recipient.channel,
        address: recipient.address,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
