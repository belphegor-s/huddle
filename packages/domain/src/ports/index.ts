export type { AiMessage, AiProvider } from './ai.js';
export type { BlobStore, UploadTicket } from './blobs.js';
export { systemClock } from './clock.js';
export type { Clock } from './clock.js';
export type { JobRunner } from './jobs.js';
export type { KeyValue } from './kv.js';
export type { Mailer, OutgoingEmail } from './mailer.js';
export type { MessagePage, MessageStore } from './messages.js';
export type { PushPayload, PushResult, PushSender, PushSubscription } from './push.js';
export type { RealtimeHub } from './realtime.js';
export type { SearchHit, SearchIndex, SearchQuery } from './search.js';

import type { AiProvider } from './ai.js';
import type { BlobStore } from './blobs.js';
import type { Clock } from './clock.js';
import type { JobRunner } from './jobs.js';
import type { KeyValue } from './kv.js';
import type { Mailer } from './mailer.js';
import type { MessageStore } from './messages.js';
import type { PushSender } from './push.js';
import type { RealtimeHub } from './realtime.js';
import type { SearchIndex } from './search.js';
import type { Database } from './database.js';

export type { Database } from './database.js';

/**
 * Everything the application needs from the outside world. An adapter builds
 * one of these and nothing above this line knows which platform produced it.
 */
export interface Ports {
  db: Database;
  messages: MessageStore;
  realtime: RealtimeHub;
  blobs: BlobStore;
  kv: KeyValue;
  mailer: Mailer;
  push: PushSender;
  search: SearchIndex;
  jobs: JobRunner;
  ai: AiProvider;
  clock: Clock;
}
