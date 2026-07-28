import type { SearchHit, SearchIndex, SearchQuery } from '@huddle/domain';

interface HitRow {
  message_id: string;
  channel_id: string;
  author_id: string;
  created_at: number;
  snippet: string;
  rank: number;
}

/**
 * FTS5 over D1. Messages live in per channel Durable Objects, which cannot be
 * queried across channels, so this table is the cross channel view. It is kept
 * current by the inline indexer rather than a queue, so it costs nothing.
 */
export class D1SearchIndex implements SearchIndex {
  constructor(private readonly db: D1Database) {}

  async index(input: {
    messageId: string;
    workspaceId: string;
    channelId: string;
    authorId: string;
    text: string;
    hasFile: boolean;
    createdAt: number;
  }): Promise<void> {
    await this.db
      .prepare('DELETE FROM message_search WHERE message_id = ?')
      .bind(input.messageId)
      .run();

    if (input.text.trim() === '') return;

    await this.db
      .prepare(
        `INSERT INTO message_search
           (message_id, workspace_id, channel_id, author_id, has_file, created_at, text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.messageId,
        input.workspaceId,
        input.channelId,
        input.authorId,
        input.hasFile ? 1 : 0,
        input.createdAt,
        input.text,
      )
      .run();
  }

  async remove(messageId: string): Promise<void> {
    await this.db.prepare('DELETE FROM message_search WHERE message_id = ?').bind(messageId).run();
  }

  async query(input: SearchQuery): Promise<SearchHit[]> {
    if (input.channelIds.length === 0) return [];

    const conditions = ['message_search MATCH ?', 'workspace_id = ?'];
    const bindings: unknown[] = [toMatchExpression(input.text), input.workspaceId];

    conditions.push(`channel_id IN (${input.channelIds.map(() => '?').join(', ')})`);
    bindings.push(...input.channelIds);

    if (input.authorId !== undefined) {
      conditions.push('author_id = ?');
      bindings.push(input.authorId);
    }
    if (input.hasFile !== undefined) {
      conditions.push('has_file = ?');
      bindings.push(input.hasFile ? 1 : 0);
    }
    if (input.after !== undefined) {
      conditions.push('created_at >= ?');
      bindings.push(input.after);
    }
    if (input.before !== undefined) {
      conditions.push('created_at <= ?');
      bindings.push(input.before);
    }

    bindings.push(input.limit);

    const result = await this.db
      .prepare(
        `SELECT message_id, channel_id, author_id, created_at,
                snippet(message_search, 6, '<mark>', '</mark>', '...', 24) AS snippet,
                bm25(message_search) AS rank
           FROM message_search
          WHERE ${conditions.join(' AND ')}
          ORDER BY rank
          LIMIT ?`,
      )
      .bind(...bindings)
      .all<HitRow>();

    return result.results.map((row) => ({
      messageId: row.message_id,
      channelId: row.channel_id,
      authorId: row.author_id,
      snippet: row.snippet,
      createdAt: row.created_at,
      // bm25 returns lower is better, so invert it into a score.
      score: -row.rank,
    }));
  }
}

/**
 * FTS5 treats a lot of punctuation as syntax, so user input is quoted term by
 * term. Without this a search for `foo:bar` is a syntax error rather than a
 * search.
 */
function toMatchExpression(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"`);
  return terms.length > 0 ? terms.join(' ') : '""';
}
