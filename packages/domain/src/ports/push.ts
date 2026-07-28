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
  iconUrl?: string;
  badgeCount?: number;
}

export type PushResult = { ok: true } | { ok: false; expired: boolean; reason: string };

export interface PushSender {
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}
