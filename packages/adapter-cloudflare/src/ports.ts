import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@huddle/db/schema';
import type { Ports } from '@huddle/domain';
import { systemClock } from '@huddle/domain';
import { disabledAi, WorkersAiProvider } from './ai.js';
import { R2BlobStore } from './blobs.js';
import type { ChannelRoom } from './channel-room.js';
import { WaitUntilJobRunner } from './jobs.js';
import { WorkersKeyValue, type RateCounter } from './kv.js';
import { ConsoleMailer, ResendMailer } from './mail.js';
import { DurableObjectMessageStore } from './message-store.js';
import { pendingPush, pendingRealtime } from './pending.js';
import { D1SearchIndex } from './search.js';

/**
 * The bindings this adapter needs. The Worker passes these in from its own
 * generated `Env`, so no `Env` interface is hand written anywhere.
 */
export interface CloudflareBindings {
  DB: D1Database;
  KV: KVNamespace;
  BLOBS: R2Bucket;
  CHANNEL_ROOM: DurableObjectNamespace<ChannelRoom>;
  RATE_COUNTER: DurableObjectNamespace<RateCounter>;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  PUBLIC_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export function createCloudflarePorts(env: CloudflareBindings, ctx: ExecutionContext): Ports {
  const blobs = new R2BlobStore(env.BLOBS, env.PUBLIC_URL);

  return {
    db: drizzle(env.DB, { schema }),
    messages: new DurableObjectMessageStore(env.CHANNEL_ROOM),
    realtime: pendingRealtime,
    blobs,
    kv: new WorkersKeyValue(env.KV, env.RATE_COUNTER),
    mailer: createMailer(env),
    push: pendingPush,
    search: new D1SearchIndex(env.DB),
    jobs: new WaitUntilJobRunner(ctx),
    ai: env.AI ? new WorkersAiProvider(env.AI) : disabledAi,
    clock: systemClock,
  };
}

function createMailer(env: CloudflareBindings) {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  return new ConsoleMailer();
}
