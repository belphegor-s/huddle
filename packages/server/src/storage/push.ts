import webpush, { WebPushError } from 'web-push';
import type { Config } from '../config.js';

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Collapses a burst of messages in one channel into a single notification. */
  tag: string;
  url: string;
}

export type PushResult = { ok: true } | { ok: false; expired: boolean; reason: string };

export interface PushSender {
  readonly available: boolean;
  /** The key the browser needs to create a subscription. Public by design. */
  readonly publicKey: string;
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}

/**
 * Web Push, which is the only push that works without an app store account on
 * either side. Chrome, Firefox, Edge and iOS Safari 16.4 and later all speak
 * it, and the payload is encrypted to the subscription's own key, so the push
 * service that relays it cannot read the message.
 */
export class WebPushSender implements PushSender {
  readonly available = true;

  constructor(private readonly config: Config['push']) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }

  get publicKey(): string {
    return this.config.publicKey;
  }

  async send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );
      return { ok: true };
    } catch (error) {
      // 404 and 410 mean the browser threw the subscription away. Anything
      // else is worth retrying later, so only these delete the row.
      const status = error instanceof WebPushError ? error.statusCode : 0;
      return {
        ok: false,
        expired: status === 404 || status === 410,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** The default. Push is off until a VAPID pair is configured. */
export const disabledPush: PushSender = {
  available: false,
  publicKey: '',
  async send() {
    return { ok: false, expired: false, reason: 'push_not_configured' };
  },
};

export function createPushSender(config: Config['push']): PushSender {
  return config.publicKey === '' || config.privateKey === ''
    ? disabledPush
    : new WebPushSender(config);
}
