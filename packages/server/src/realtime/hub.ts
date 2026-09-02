import { LIMITS, type ServerEvent } from '@huddle/core';

/**
 * One connected client. A person with a laptop and a phone has two of these,
 * and each tracks its own channel subscriptions, because the phone may be
 * looking at a different channel than the laptop.
 */
export interface Subscriber {
  readonly id: string;
  readonly userId: string;
  readonly channels: Set<string>;
  send(event: ServerEvent): void;
}

export type RelayTarget = { kind: 'channel'; id: string } | { kind: 'user'; id: string };

export interface Relay {
  publish(target: RelayTarget, event: ServerEvent): void;
  close(): Promise<void>;
}

/**
 * Fanout for this process, plus an optional relay so several app instances
 * behind a load balancer see each other's traffic.
 *
 * The hub decides nothing about permission. By the time an event reaches it,
 * the service layer has already established who is allowed to see it, and the
 * subscription list is the record of that decision.
 */
export class RealtimeHub {
  private readonly byChannel = new Map<string, Set<Subscriber>>();
  private readonly byUser = new Map<string, Set<Subscriber>>();
  private readonly typing = new Map<string, Map<string, number>>();
  private relay: Relay | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Set once at boot when the deployment runs more than one instance. */
  useRelay(relay: Relay): void {
    this.relay = relay;
  }

  add(subscriber: Subscriber): void {
    addTo(this.byUser, subscriber.userId, subscriber);
  }

  remove(subscriber: Subscriber): void {
    removeFrom(this.byUser, subscriber.userId, subscriber);
    for (const channelId of subscriber.channels) {
      removeFrom(this.byChannel, channelId, subscriber);
    }
    subscriber.channels.clear();
  }

  subscribe(subscriber: Subscriber, channelId: string): void {
    subscriber.channels.add(channelId);
    addTo(this.byChannel, channelId, subscriber);
  }

  unsubscribe(subscriber: Subscriber, channelId: string): void {
    subscriber.channels.delete(channelId);
    removeFrom(this.byChannel, channelId, subscriber);
  }

  publish(channelId: string, event: ServerEvent): void {
    this.deliverToChannel(channelId, event);
    this.relay?.publish({ kind: 'channel', id: channelId }, event);
  }

  publishToUser(userId: string, event: ServerEvent): void {
    this.deliverToUser(userId, event);
    this.relay?.publish({ kind: 'user', id: userId }, event);
  }

  /** Entry point for events arriving from another instance. Never re-relayed. */
  acceptRemote(target: RelayTarget, event: ServerEvent): void {
    if (target.kind === 'channel') this.deliverToChannel(target.id, event);
    else this.deliverToUser(target.id, event);
  }

  /**
   * Rebroadcast only once the previous notice is more than half spent. Holding
   * a key down would otherwise be one fanout per keystroke.
   */
  markTyping(channelId: string, userId: string): void {
    const now = this.now();
    const channel = this.typing.get(channelId) ?? new Map<string, number>();
    const current = channel.get(userId) ?? 0;
    const expiresAt = now + LIMITS.typingTtlMs;

    channel.set(userId, expiresAt);
    this.typing.set(channelId, channel);

    if (current > now + LIMITS.typingTtlMs / 2) return;
    this.publish(channelId, { type: 'typing', channelId, userId, expiresAt });
  }

  /** Everyone with the channel open right now, on any device. */
  presence(channelId: string): string[] {
    const subscribers = this.byChannel.get(channelId);
    if (!subscribers) return [];
    return [...new Set([...subscribers].map((s) => s.userId))];
  }

  typingIn(channelId: string): string[] {
    const now = this.now();
    const channel = this.typing.get(channelId);
    if (!channel) return [];

    const live: string[] = [];
    for (const [userId, expiresAt] of channel) {
      if (expiresAt > now) live.push(userId);
      else channel.delete(userId);
    }
    return live;
  }

  async close(): Promise<void> {
    await this.relay?.close();
  }

  private deliverToChannel(channelId: string, event: ServerEvent): void {
    for (const subscriber of this.byChannel.get(channelId) ?? []) {
      subscriber.send(event);
    }
  }

  private deliverToUser(userId: string, event: ServerEvent): void {
    for (const subscriber of this.byUser.get(userId) ?? []) {
      subscriber.send(event);
    }
  }
}

function addTo<T>(map: Map<string, Set<T>>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.add(value);
  else map.set(key, new Set([value]));
}

function removeFrom<T>(map: Map<string, Set<T>>, key: string, value: T): void {
  const existing = map.get(key);
  if (!existing) return;
  existing.delete(value);
  if (existing.size === 0) map.delete(key);
}
