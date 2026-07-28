import type { DraftMessage, Message, Reaction } from '@huddle/core';
import type { MessagePage, MessageStore } from '@huddle/domain';
import type { ChannelRoom } from './channel-room.js';

type ChannelRoomNamespace = DurableObjectNamespace<ChannelRoom>;

/**
 * Routes MessageStore calls to the Durable Object that owns the channel.
 * Every method is a single RPC hop, which matters because Durable Object
 * requests are the metered unit on the free plan.
 */
export class DurableObjectMessageStore implements MessageStore {
  constructor(private readonly namespace: ChannelRoomNamespace) {}

  private room(channelId: string): DurableObjectStub<ChannelRoom> {
    return this.namespace.get(this.namespace.idFromName(channelId));
  }

  append(input: {
    channelId: string;
    authorId: string;
    draft: DraftMessage;
    now: number;
  }): Promise<Message> {
    return this.room(input.channelId).append(input);
  }

  edit(input: {
    channelId: string;
    messageId: string;
    authorId: string;
    body: unknown;
    text: string;
    now: number;
  }): Promise<Message | null> {
    return this.room(input.channelId).edit(input);
  }

  softDelete(input: {
    channelId: string;
    messageId: string;
    actorId: string;
    now: number;
  }): Promise<{ messageId: string; seq: number } | null> {
    return this.room(input.channelId).softDelete({
      messageId: input.messageId,
      now: input.now,
    });
  }

  toggleReaction(input: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: string;
    on: boolean;
  }): Promise<Reaction[] | null> {
    return this.room(input.channelId).toggleReaction(input);
  }

  history(input: { channelId: string; before?: number; limit: number }): Promise<MessagePage> {
    return this.room(input.channelId).history(input);
  }

  since(input: { channelId: string; afterSeq: number; limit: number }): Promise<MessagePage> {
    return this.room(input.channelId).since(input);
  }

  thread(input: { channelId: string; parentId: string; limit: number }): Promise<MessagePage> {
    return this.room(input.channelId).thread(input);
  }

  get(input: { channelId: string; messageId: string }): Promise<Message | null> {
    return this.room(input.channelId).get(input);
  }
}
