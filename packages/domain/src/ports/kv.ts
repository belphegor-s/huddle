export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Atomic increment used for rate limiting. Returns the new count.
   * Must be atomic on every adapter or rate limits are decorative.
   */
  increment(key: string, ttlSeconds: number): Promise<number>;
}
