import { ServerEvent } from '@huddle/core';
import { Client } from 'pg';
import { z } from 'zod';
import type { Relay, RealtimeHub, RelayTarget } from './hub.js';

const CHANNEL = 'huddle_events';

/**
 * Postgres NOTIFY truncates well before a long message would fit, so an
 * oversized event travels as a pointer and the receiving instance reads the
 * row it already has. Everything small enough goes inline, which is every
 * typing, read, presence and reaction event.
 */
const MAX_INLINE_BYTES = 6_000;

const Envelope = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('inline'),
    origin: z.string(),
    target: z.object({ kind: z.enum(['channel', 'user']), id: z.string() }),
    event: ServerEvent,
  }),
  z.object({
    mode: z.literal('ref'),
    origin: z.string(),
    target: z.object({ kind: z.enum(['channel', 'user']), id: z.string() }),
    channelId: z.string(),
    messageId: z.string(),
    kind: z.enum(['message', 'message_updated']),
  }),
]);

export interface RelayDeps {
  hub: RealtimeHub;
  databaseUrl: string;
  /** Reads a message back when it was too large to travel inline. */
  hydrate(channelId: string, messageId: string): Promise<ServerEvent | null>;
}

/**
 * Cross instance fanout without adding Redis. Two Postgres connections, one
 * listening and one notifying, which is the smallest thing that makes a second
 * app replica correct.
 */
export class PostgresRelay implements Relay {
  private readonly origin = crypto.randomUUID();
  private readonly listener: Client;
  private readonly notifier: Client;
  private closed = false;

  constructor(private readonly deps: RelayDeps) {
    this.listener = new Client({ connectionString: deps.databaseUrl });
    this.notifier = new Client({ connectionString: deps.databaseUrl });
  }

  async start(): Promise<void> {
    await this.listener.connect();
    await this.notifier.connect();

    this.listener.on('notification', (notification) => {
      void this.receive(notification.payload ?? '');
    });

    await this.listener.query(`LISTEN ${CHANNEL}`);
  }

  publish(target: RelayTarget, event: ServerEvent): void {
    if (this.closed) return;

    const inline = JSON.stringify({ mode: 'inline', origin: this.origin, target, event });
    const payload = inline.length <= MAX_INLINE_BYTES ? inline : this.asReference(target, event);
    if (payload === null) return;

    void this.notifier
      .query(`SELECT pg_notify($1, $2)`, [CHANNEL, payload])
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'relay_publish_failed',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([this.listener.end(), this.notifier.end()]);
  }

  private asReference(target: RelayTarget, event: ServerEvent): string | null {
    if (event.type !== 'message' && event.type !== 'message_updated') return null;

    return JSON.stringify({
      mode: 'ref',
      origin: this.origin,
      target,
      channelId: event.channelId,
      messageId: event.message.id,
      kind: event.type,
    });
  }

  private async receive(raw: string): Promise<void> {
    const parsed = Envelope.safeParse(safeJson(raw));
    if (!parsed.success) return;

    const envelope = parsed.data;
    // Our own notifications come back to us. The local fanout already ran.
    if (envelope.origin === this.origin) return;

    if (envelope.mode === 'inline') {
      this.deps.hub.acceptRemote(envelope.target, envelope.event);
      return;
    }

    const event = await this.deps.hydrate(envelope.channelId, envelope.messageId);
    if (event) this.deps.hub.acceptRemote(envelope.target, event);
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
