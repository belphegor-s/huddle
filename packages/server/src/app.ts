import { connect, type Database } from '@huddle/db';
import type { Hono } from 'hono';
import { createApi } from './api/index.js';
import type { ApiEnv } from './api/env.js';
import { loadConfig, type Config } from './config.js';
import { runInBackground, type AppContext } from './context.js';
import { RealtimeHub } from './realtime/hub.js';
import { PostgresRelay } from './realtime/relay.js';
import { hydrateMessageEvent } from './services/messages.js';
import { createAiClient } from './storage/ai.js';
import { S3Blobs, type BlobStore } from './storage/blobs.js';
import { KeyValue } from './storage/kv.js';
import { createMailer } from './storage/mail.js';
import { createPushSender } from './storage/push.js';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export interface App {
  ctx: AppContext;
  api: Hono<ApiEnv>;
  config: Config;
  close(): Promise<void>;
}

export interface CreateAppOptions {
  config?: Config;
  /** Set when the deployment runs more than one instance behind a proxy. */
  clustered?: boolean;
  /** Supplied by the test suite, which brings its own database and bucket. */
  overrides?: { db?: Database; blobs?: BlobStore; close?: () => Promise<void> };
}

/**
 * Boots everything and hands back the pieces the process needs. Migrations run
 * here rather than as a separate deploy step, so `docker compose up` against an
 * empty volume produces a working install with no second command to remember.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const config = options.config ?? loadConfig();

  const connection = options.overrides?.db ? null : connect(config.databaseUrl);
  const db = options.overrides?.db ?? connection?.db;
  if (!db) throw new Error('No database');

  await connection?.migrate();

  const hub = new RealtimeHub();
  const kv = new KeyValue(db, Date.now);

  const ctx: AppContext = {
    db,
    kv,
    hub,
    blobs: options.overrides?.blobs ?? new S3Blobs(config.s3),
    mail: createMailer(config.mail),
    push: createPushSender(config.push),
    ai: createAiClient(config.ai),
    config,
    now: Date.now,
    background: runInBackground,
  };

  let relay: PostgresRelay | null = null;
  if (options.clustered === true) {
    relay = new PostgresRelay({
      hub,
      databaseUrl: config.databaseUrl,
      hydrate: (channelId, messageId) => hydrateMessageEvent(db, channelId, messageId, 'message'),
    });
    await relay.start();
    hub.useRelay(relay);
  }

  // Expired sessions and rate counters are invisible to reads already, so this
  // is housekeeping for disk rather than for correctness.
  const sweeper = setInterval(() => {
    void kv.sweep().catch(() => undefined);
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();

  return {
    ctx,
    api: createApi(ctx),
    config,
    async close() {
      clearInterval(sweeper);
      await hub.close();
      await options.overrides?.close?.();
      await connection?.close();
    },
  };
}
