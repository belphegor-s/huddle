import { DurableObject } from 'cloudflare:workers';
import type { KeyValue } from '@huddle/domain';

/**
 * Workers KV is eventually consistent, so it is used for sessions and magic
 * link tokens where a stale read is harmless, and never as a lock.
 *
 * `increment` is the exception: rate limiting needs atomicity that KV cannot
 * give, so it is delegated to a Durable Object counter.
 */
export class WorkersKeyValue implements KeyValue {
  constructor(
    private readonly kv: KVNamespace,
    private readonly counters: DurableObjectNamespace<RateCounter>,
  ) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key, 'text');
  }

  async set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void> {
    // KV rejects TTLs under 60 seconds.
    const ttl = options?.ttlSeconds;
    await this.kv.put(key, value, ttl === undefined ? {} : { expirationTtl: Math.max(60, ttl) });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const stub = this.counters.get(this.counters.idFromName(key));
    return stub.bump(ttlSeconds * 1000);
  }
}

/**
 * A tiny counter used only for rate limiting. Separate from ChannelRoom so a
 * burst of login attempts cannot contend with message traffic.
 */
export class RateCounter extends DurableObject {
  private count = 0;
  private resetAt = 0;

  async bump(windowMs: number): Promise<number> {
    const now = Date.now();
    if (now >= this.resetAt) {
      this.count = 0;
      this.resetAt = now + windowMs;
      await this.ctx.storage.setAlarm(this.resetAt);
    }
    this.count += 1;
    return this.count;
  }

  override async alarm(): Promise<void> {
    this.count = 0;
    this.resetAt = 0;
  }
}
