import type { DraftMessage, Message, Reaction } from '@huddle/core';
import type { MessagePage, MessageStore } from '../ports/messages.js';

interface ChannelState {
  seq: number;
  messages: Message[];
}

function page(messages: Message[], latestSeq: number, hasMore: boolean): MessagePage {
  return { messages, latestSeq, hasMore };
}

export class MemoryMessageStore implements MessageStore {
  private readonly channels = new Map<string, ChannelState>();

  private state(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      state = { seq: 0, messages: [] };
      this.channels.set(channelId, state);
    }
    return state;
  }

  private find(channelId: string, messageId: string): Message | undefined {
    return this.state(channelId).messages.find((m) => m.id === messageId);
  }

  async append(input: {
    channelId: string;
    authorId: string;
    draft: DraftMessage;
    now: number;
  }): Promise<Message> {
    const state = this.state(input.channelId);

    // Resending the same client id is a retry, not a new message.
    const existing = this.find(input.channelId, input.draft.id);
    if (existing) return existing;

    state.seq += 1;
    const message: Message = {
      id: input.draft.id,
      channelId: input.channelId,
      seq: state.seq,
      authorId: input.authorId,
      body: input.draft.body,
      text: input.draft.text,
      parentId: input.draft.parentId,
      attachments: input.draft.attachments,
      reactions: [],
      mentions: input.draft.mentions,
      createdAt: input.now,
      editedAt: null,
      deletedAt: null,
    };
    state.messages.push(message);
    return message;
  }

  async edit(input: {
    channelId: string;
    messageId: string;
    authorId: string;
    body: unknown;
    text: string;
    now: number;
  }): Promise<Message | null> {
    const message = this.find(input.channelId, input.messageId);
    if (!message || message.deletedAt !== null) return null;
    if (message.authorId !== input.authorId) return null;
    message.body = input.body;
    message.text = input.text;
    message.editedAt = input.now;
    return message;
  }

  async softDelete(input: {
    channelId: string;
    messageId: string;
    actorId: string;
    now: number;
  }): Promise<{ messageId: string; seq: number } | null> {
    const message = this.find(input.channelId, input.messageId);
    if (!message || message.deletedAt !== null) return null;
    message.deletedAt = input.now;
    message.text = '';
    message.body = null;
    message.attachments = [];
    return { messageId: message.id, seq: message.seq };
  }

  async toggleReaction(input: {
    channelId: string;
    messageId: string;
    userId: string;
    emoji: string;
    on: boolean;
  }): Promise<Reaction[] | null> {
    const message = this.find(input.channelId, input.messageId);
    if (!message || message.deletedAt !== null) return null;

    let reaction = message.reactions.find((r) => r.emoji === input.emoji);
    if (!reaction) {
      if (!input.on) return message.reactions;
      reaction = { emoji: input.emoji, userIds: [] };
      message.reactions.push(reaction);
    }

    const has = reaction.userIds.includes(input.userId);
    if (input.on && !has) reaction.userIds.push(input.userId);
    if (!input.on && has) reaction.userIds = reaction.userIds.filter((u) => u !== input.userId);

    message.reactions = message.reactions.filter((r) => r.userIds.length > 0);
    return message.reactions;
  }

  async history(input: { channelId: string; before?: number; limit: number }): Promise<MessagePage> {
    const state = this.state(input.channelId);
    const before = input.before ?? Number.POSITIVE_INFINITY;
    const matching = state.messages.filter((m) => m.seq < before);
    const slice = matching.slice(-input.limit);
    return page(slice, state.seq, matching.length > slice.length);
  }

  async since(input: {
    channelId: string;
    afterSeq: number;
    limit: number;
  }): Promise<MessagePage> {
    const state = this.state(input.channelId);
    const matching = state.messages.filter((m) => m.seq > input.afterSeq);
    const slice = matching.slice(0, input.limit);
    return page(slice, state.seq, matching.length > slice.length);
  }

  async thread(input: {
    channelId: string;
    parentId: string;
    limit: number;
  }): Promise<MessagePage> {
    const state = this.state(input.channelId);
    const matching = state.messages.filter((m) => m.parentId === input.parentId);
    return page(matching.slice(0, input.limit), state.seq, matching.length > input.limit);
  }

  async get(input: { channelId: string; messageId: string }): Promise<Message | null> {
    return this.find(input.channelId, input.messageId) ?? null;
  }
}
