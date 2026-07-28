import type { ServerEvent } from '@huddle/core';
import type { AiProvider } from '../ports/ai.js';
import type { BlobStore, UploadTicket } from '../ports/blobs.js';
import type { Clock } from '../ports/clock.js';
import type { JobRunner } from '../ports/jobs.js';
import type { KeyValue } from '../ports/kv.js';
import type { Mailer, OutgoingEmail } from '../ports/mailer.js';
import type { PushPayload, PushResult, PushSender, PushSubscription } from '../ports/push.js';
import type { RealtimeHub } from '../ports/realtime.js';
import type { SearchHit, SearchIndex, SearchQuery } from '../ports/search.js';

export class FakeClock implements Clock {
  constructor(private current = 1_760_000_000_000) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
  set(ms: number): void {
    this.current = ms;
  }
}

export class MemoryKeyValue implements KeyValue {
  private readonly entries = new Map<string, { value: string; expiresAt: number | null }>();

  constructor(private readonly clock: Clock) {}

  private live(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key);
  }

  async set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
    const ttl = options?.ttlSeconds;
    this.entries.set(key, {
      value,
      expiresAt: ttl === undefined ? null : this.clock.now() + ttl * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const next = Number(this.live(key) ?? 0) + 1;
    const existing = this.entries.get(key);
    this.entries.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? this.clock.now() + ttlSeconds * 1000,
    });
    return next;
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { size: number; contentType: string }>();

  constructor(private readonly clock: Clock) {}

  async createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket> {
    this.objects.set(input.key, { size: input.contentLength, contentType: input.contentType });
    return {
      uploadUrl: `memory://${input.key}`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      key: input.key,
      expiresAt: this.clock.now() + 600_000,
    };
  }

  async createDownloadUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class MemoryRealtimeHub implements RealtimeHub {
  readonly channelEvents: Array<{ channelId: string; event: ServerEvent }> = [];
  readonly userEvents: Array<{ userId: string; event: ServerEvent }> = [];
  private readonly typing = new Map<string, Map<string, number>>();

  async publish(channelId: string, event: ServerEvent): Promise<void> {
    this.channelEvents.push({ channelId, event });
  }

  async publishToUser(userId: string, event: ServerEvent): Promise<void> {
    this.userEvents.push({ userId, event });
  }

  async markTyping(input: { channelId: string; userId: string; now: number }): Promise<void> {
    const channel = this.typing.get(input.channelId) ?? new Map<string, number>();
    channel.set(input.userId, input.now);
    this.typing.set(input.channelId, channel);
  }

  async presence(channelId: string): Promise<string[]> {
    return [...(this.typing.get(channelId)?.keys() ?? [])];
  }

  eventsFor(channelId: string): ServerEvent[] {
    return this.channelEvents.filter((e) => e.channelId === channelId).map((e) => e.event);
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }
  last(): OutgoingEmail | undefined {
    return this.sent.at(-1);
  }
}

export class MemoryPushSender implements PushSender {
  readonly sent: Array<{ subscription: PushSubscription; payload: PushPayload }> = [];
  expiredEndpoints = new Set<string>();

  async send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult> {
    if (this.expiredEndpoints.has(subscription.endpoint)) {
      return { ok: false, expired: true, reason: 'gone' };
    }
    this.sent.push({ subscription, payload });
    return { ok: true };
  }
}

interface IndexedRow {
  messageId: string;
  workspaceId: string;
  channelId: string;
  authorId: string;
  text: string;
  hasFile: boolean;
  createdAt: number;
}

export class MemorySearchIndex implements SearchIndex {
  private readonly rows = new Map<string, IndexedRow>();

  async index(row: IndexedRow): Promise<void> {
    this.rows.set(row.messageId, row);
  }

  async remove(messageId: string): Promise<void> {
    this.rows.delete(messageId);
  }

  async query(input: SearchQuery): Promise<SearchHit[]> {
    const needle = input.text.toLowerCase();
    const allowed = new Set(input.channelIds);
    return [...this.rows.values()]
      .filter((row) => row.workspaceId === input.workspaceId)
      .filter((row) => allowed.has(row.channelId))
      .filter((row) => (input.authorId ? row.authorId === input.authorId : true))
      .filter((row) => (input.hasFile === undefined ? true : row.hasFile === input.hasFile))
      .filter((row) => (input.after === undefined ? true : row.createdAt >= input.after))
      .filter((row) => (input.before === undefined ? true : row.createdAt <= input.before))
      .filter((row) => row.text.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, input.limit)
      .map((row) => ({
        messageId: row.messageId,
        channelId: row.channelId,
        authorId: row.authorId,
        snippet: row.text,
        createdAt: row.createdAt,
        score: 1,
      }));
  }
}

/**
 * Runs jobs immediately and remembers failures, so a test can assert that
 * background work actually happened instead of hoping it did.
 */
export class ImmediateJobRunner implements JobRunner {
  readonly pending: Promise<void>[] = [];
  readonly failures: Array<{ name: string; error: unknown }> = [];

  run(name: string, work: () => Promise<void>): void {
    this.pending.push(
      work().catch((error: unknown) => {
        this.failures.push({ name, error });
      }),
    );
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending);
  }
}

export const noAi: AiProvider = {
  available: false,
  async complete() {
    throw new Error('AI is not configured');
  },
  async embed() {
    throw new Error('AI is not configured');
  },
};
