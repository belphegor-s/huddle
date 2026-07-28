import type { Ports } from '../ports/index.js';
import {
  FakeClock,
  ImmediateJobRunner,
  MemoryBlobStore,
  MemoryKeyValue,
  MemoryMailer,
  MemoryPushSender,
  MemoryRealtimeHub,
  MemorySearchIndex,
  noAi,
} from './fakes.js';
import { MemoryMessageStore } from './memory-message-store.js';
import { createTestDatabase } from './test-db.js';

export * from './fakes.js';
export { MemoryMessageStore } from './memory-message-store.js';
export { createTestDatabase } from './test-db.js';

export interface TestPorts extends Ports {
  clock: FakeClock;
  messages: MemoryMessageStore;
  realtime: MemoryRealtimeHub;
  mailer: MemoryMailer;
  push: MemoryPushSender;
  search: MemorySearchIndex;
  jobs: ImmediateJobRunner;
  blobs: MemoryBlobStore;
}

/**
 * A complete set of ports backed by fakes and an in memory SQLite database.
 * The whole domain suite runs on this: no cloud account, no containers, no
 * network.
 */
export async function createTestPorts(): Promise<TestPorts> {
  const clock = new FakeClock();
  return {
    db: await createTestDatabase(),
    messages: new MemoryMessageStore(),
    realtime: new MemoryRealtimeHub(),
    blobs: new MemoryBlobStore(clock),
    kv: new MemoryKeyValue(clock),
    mailer: new MemoryMailer(),
    push: new MemoryPushSender(),
    search: new MemorySearchIndex(),
    jobs: new ImmediateJobRunner(),
    ai: noAi,
    clock,
  };
}
