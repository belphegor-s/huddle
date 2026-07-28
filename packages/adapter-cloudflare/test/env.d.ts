declare module 'cloudflare:test' {
  import type { ChannelRoom, RateCounter } from '@huddle/adapter-cloudflare';

  interface ProvidedEnv {
    DB: D1Database;
    KV: KVNamespace;
    BLOBS: R2Bucket;
    CHANNEL_ROOM: DurableObjectNamespace<ChannelRoom>;
    RATE_COUNTER: DurableObjectNamespace<RateCounter>;
    PUBLIC_URL: string;
  }

  export const env: ProvidedEnv;
  export function runInDurableObject<T, R>(
    stub: DurableObjectStub<T>,
    callback: (instance: T, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}
