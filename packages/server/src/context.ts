import type { Database } from '@huddle/db';
import type { Config } from './config.js';
import type { RealtimeHub } from './realtime/hub.js';
import type { AiClient } from './storage/ai.js';
import type { BlobStore } from './storage/blobs.js';
import type { KeyValue } from './storage/kv.js';
import type { Mailer } from './storage/mail.js';

/**
 * Everything a service needs, assembled once at boot and passed down. These
 * are concrete collaborators rather than an abstraction layer: there is one
 * database, one hub, one bucket, and swapping any of them is a code change,
 * not a configuration surface.
 */
export interface AppContext {
  db: Database;
  kv: KeyValue;
  hub: RealtimeHub;
  blobs: BlobStore;
  mail: Mailer;
  ai: AiClient;
  config: Config;
  now(): number;
  /**
   * Work that must not delay the response: search indexing, push delivery.
   * It runs on this process, so a failure is logged and never retried, which
   * is the right trade for work that can be rebuilt from the message table.
   */
  background(name: string, work: () => Promise<void>): void;
}

export function runInBackground(name: string, work: () => Promise<void>): void {
  void work().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'background_failed',
        job: name,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
}
