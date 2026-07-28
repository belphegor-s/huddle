import { DurableObject } from 'cloudflare:workers';
import type { Attachment, DraftMessage, Message, Reaction } from '@huddle/core';
import type { MessagePage } from '@huddle/domain';

interface Row extends Record<string, SqlStorageValue> {
  id: string;
  seq: number;
  author_id: string;
  body: string;
  text: string;
  parent_id: string | null;
  attachments: string;
  reactions: string;
  mentions: string;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

function toMessage(channelId: string, row: Row): Message {
  return {
    id: row.id,
    channelId,
    seq: row.seq,
    authorId: row.author_id,
    body: row.body,
    text: row.text,
    parentId: row.parent_id,
    attachments: JSON.parse(row.attachments) as Attachment[],
    reactions: JSON.parse(row.reactions) as Reaction[],
    mentions: JSON.parse(row.mentions) as string[],
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * One Durable Object per channel, each with its own SQLite file.
 *
 * The point of putting messages here rather than in D1 is that a Durable
 * Object is a single writer by construction. That makes `seq` assignment
 * correct with no locking, no transactions across regions, and no way for two
 * concurrent sends to collide, which is the property the entire reconnect and
 * ordering design rests on.
 */
export class ChannelRoom extends DurableObject {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL UNIQUE,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        text TEXT NOT NULL,
        parent_id TEXT,
        attachments TEXT NOT NULL DEFAULT '[]',
        reactions TEXT NOT NULL DEFAULT '[]',
        mentions TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        edited_at INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS messages_seq_idx ON messages (seq);
      CREATE INDEX IF NOT EXISTS messages_parent_idx ON messages (parent_id, seq);
    `);
  }

  private latestSeq(): number {
    const row = this.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM messages').one();
    return row.seq ?? 0;
  }

  private rowById(id: string): Row | null {
    const rows = this.sql.exec<Row>('SELECT * FROM messages WHERE id = ?', id).toArray();
    return rows[0] ?? null;
  }

  async append(input: {
    channelId: string;
    authorId: string;
    draft: DraftMessage;
    now: number;
  }): Promise<Message> {
    // A resent client id is a retry from a flaky network, not a new message.
    const existing = this.rowById(input.draft.id);
    if (existing) return toMessage(input.channelId, existing);

    const seq = this.latestSeq() + 1;
    this.sql.exec(
      `INSERT INTO messages
        (id, seq, author_id, body, text, parent_id, attachments, reactions, mentions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      input.draft.id,
      seq,
      input.authorId,
      input.draft.body,
      input.draft.text,
      input.draft.parentId,
      JSON.stringify(input.draft.attachments),
      JSON.stringify(input.draft.mentions),
      input.now,
    );

    const row = this.rowById(input.draft.id);
    if (!row) throw new Error('Insert did not persist');
    return toMessage(input.channelId, row);
  }

  async edit(input: {
    channelId: string;
    messageId: string;
    authorId: string;
    body: string;
    text: string;
    now: number;
  }): Promise<Message | null> {
    const row = this.rowById(input.messageId);
    if (!row || row.deleted_at !== null || row.author_id !== input.authorId) return null;

    this.sql.exec(
      'UPDATE messages SET body = ?, text = ?, edited_at = ? WHERE id = ?',
      input.body,
      input.text,
      input.now,
      input.messageId,
    );

    const updated = this.rowById(input.messageId);
    return updated ? toMessage(input.channelId, updated) : null;
  }

  async softDelete(input: {
    messageId: string;
    now: number;
  }): Promise<{ messageId: string; seq: number } | null> {
    const row = this.rowById(input.messageId);
    if (!row || row.deleted_at !== null) return null;

    // Content is cleared rather than the row dropped, so `seq` stays dense and
    // a reconnecting client still learns the message is gone.
    this.sql.exec(
      `UPDATE messages
         SET deleted_at = ?, body = '""', text = '', attachments = '[]', reactions = '[]'
       WHERE id = ?`,
      input.now,
      input.messageId,
    );
    return { messageId: row.id, seq: row.seq };
  }

  async toggleReaction(input: {
    messageId: string;
    userId: string;
    emoji: string;
    on: boolean;
  }): Promise<Reaction[] | null> {
    const row = this.rowById(input.messageId);
    if (!row || row.deleted_at !== null) return null;

    const reactions = JSON.parse(row.reactions) as Reaction[];
    let reaction = reactions.find((r) => r.emoji === input.emoji);
    if (!reaction) {
      if (!input.on) return reactions;
      reaction = { emoji: input.emoji, userIds: [] };
      reactions.push(reaction);
    }

    const has = reaction.userIds.includes(input.userId);
    if (input.on && !has) reaction.userIds.push(input.userId);
    if (!input.on && has) {
      reaction.userIds = reaction.userIds.filter((u) => u !== input.userId);
    }

    const next = reactions.filter((r) => r.userIds.length > 0);
    this.sql.exec(
      'UPDATE messages SET reactions = ? WHERE id = ?',
      JSON.stringify(next),
      input.messageId,
    );
    return next;
  }

  async history(input: {
    channelId: string;
    before?: number;
    limit: number;
  }): Promise<MessagePage> {
    const before = input.before ?? Number.MAX_SAFE_INTEGER;
    const rows = this.sql
      .exec<Row>(
        'SELECT * FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?',
        before,
        input.limit + 1,
      )
      .toArray();

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      messages: page.reverse().map((row) => toMessage(input.channelId, row)),
      latestSeq: this.latestSeq(),
      hasMore,
    };
  }

  async since(input: { channelId: string; afterSeq: number; limit: number }): Promise<MessagePage> {
    const rows = this.sql
      .exec<Row>(
        'SELECT * FROM messages WHERE seq > ? ORDER BY seq ASC LIMIT ?',
        input.afterSeq,
        input.limit + 1,
      )
      .toArray();

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      messages: page.map((row) => toMessage(input.channelId, row)),
      latestSeq: this.latestSeq(),
      hasMore,
    };
  }

  async thread(input: {
    channelId: string;
    parentId: string;
    limit: number;
  }): Promise<MessagePage> {
    const rows = this.sql
      .exec<Row>(
        'SELECT * FROM messages WHERE parent_id = ? ORDER BY seq ASC LIMIT ?',
        input.parentId,
        input.limit + 1,
      )
      .toArray();

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      messages: page.map((row) => toMessage(input.channelId, row)),
      latestSeq: this.latestSeq(),
      hasMore,
    };
  }

  async get(input: { channelId: string; messageId: string }): Promise<Message | null> {
    const row = this.rowById(input.messageId);
    return row ? toMessage(input.channelId, row) : null;
  }
}
