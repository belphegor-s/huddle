import type { DraftMessage, Message, Reaction } from '@huddle/core';

export interface MessagePage {
  messages: Message[];
  /** Highest sequence in the channel, whether or not it is in this page. */
  latestSeq: number;
  hasMore: boolean;
}

/**
 * Per channel message persistence. On Cloudflare this is a `ChannelRoom`
 * Durable Object with its own SQLite file, which is what makes `seq`
 * assignment single writer and therefore correct without locking. On Node it
 * is a channel scoped set of rows in the shared database, serialised per
 * channel by the hub.
 */
export interface MessageStore {
  append(input: {
    channelId: string;
    authorId: string;
    draft: DraftMessage;
    now: number;
  }): Promise<Message>;

  edit(input: {
    channelId: string;
    messageId: string;
    authorId: string;
    body: string;
    text: string;
    now: number;
  }): Promise<Message | null>;

  softDelete(input: {
    channelId: string;
    messageId: string;
    actorId: string;
    now: number;
  }): Promise<{ messageId: string; seq: number } | null>;

  toggleReaction(input: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: string;
    on: boolean;
  }): Promise<Reaction[] | null>;

  /** Backwards page for scrollback. `before` is exclusive. */
  history(input: { channelId: string; before?: number; limit: number }): Promise<MessagePage>;

  /** Forwards replay for a reconnecting client. `afterSeq` is exclusive. */
  since(input: { channelId: string; afterSeq: number; limit: number }): Promise<MessagePage>;

  thread(input: { channelId: string; parentId: string; limit: number }): Promise<MessagePage>;

  get(input: { channelId: string; messageId: string }): Promise<Message | null>;
}
