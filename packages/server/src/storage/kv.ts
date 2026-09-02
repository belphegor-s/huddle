import { ephemeral, type Database } from '@huddle/db';
import { and, eq, gt, lt, sql } from 'drizzle-orm';

/**
 * Sessions, magic link tokens and rate counters. Postgres rather than Redis,
 * because a second stateful service in the compose file buys nothing here: the
 * volumes are tiny and the durability requirements are lower than the message
 * table sitting next to it.
 */
export class KeyValue {
  constructor(
    private readonly db: Database,
    private readonly now: () => number,
  ) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: ephemeral.value })
      .from(ephemeral)
      .where(and(eq(ephemeral.key, key), gt(ephemeral.expiresAt, this.now())))
      .limit(1);

    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = this.now() + ttlSeconds * 1000;
    await this.db
      .insert(ephemeral)
      .values({ key, value, counter: 0, expiresAt })
      .onConflictDoUpdate({ target: ephemeral.key, set: { value, expiresAt } });
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(ephemeral).where(eq(ephemeral.key, key));
  }

  /**
   * One statement, so two requests racing on the same key cannot both read a
   * count of one and both decide they are under the limit.
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const now = this.now();
    const expiresAt = now + ttlSeconds * 1000;

    const rows = await this.db
      .insert(ephemeral)
      .values({ key, value: '', counter: 1, expiresAt })
      .onConflictDoUpdate({
        target: ephemeral.key,
        set: {
          counter: sql`CASE WHEN ${ephemeral.expiresAt} <= ${now} THEN 1 ELSE ${ephemeral.counter} + 1 END`,
          expiresAt: sql`CASE WHEN ${ephemeral.expiresAt} <= ${now} THEN ${expiresAt} ELSE ${ephemeral.expiresAt} END`,
        },
      })
      .returning({ counter: ephemeral.counter });

    return rows[0]?.counter ?? 1;
  }

  /** Called on a timer by the process. Expired rows are otherwise invisible. */
  async sweep(): Promise<number> {
    const removed = await this.db
      .delete(ephemeral)
      .where(lt(ephemeral.expiresAt, this.now()))
      .returning({ key: ephemeral.key });

    return removed.length;
  }
}
