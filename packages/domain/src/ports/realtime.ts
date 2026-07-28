import type { ServerEvent } from '@huddle/core';

/**
 * Fanout only. The hub does not persist anything and does not decide who is
 * allowed to see what, that has already happened by the time an event reaches
 * it. Cloudflare implements this with Durable Object stubs, Node with an in
 * process emitter plus Redis when running more than one instance.
 */
export interface RealtimeHub {
  publish(channelId: string, event: ServerEvent): Promise<void>;

  /** Direct to one user across all their connected devices. */
  publishToUser(userId: string, event: ServerEvent): Promise<void>;

  markTyping(input: { channelId: string; userId: string; now: number }): Promise<void>;

  presence(channelId: string): Promise<string[]>;
}
