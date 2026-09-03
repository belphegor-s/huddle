import { LIMITS, ulid, type Attachment, type Message, type ServerEvent } from '@huddle/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Realtime } from './realtime';
import { toDocument, toPlain } from './rich-text';

export interface ChannelStream {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  typing: string[];
  present: string[];
  loadOlder(): Promise<void>;
  loadThread(parentId: string): Promise<void>;
  send(input: {
    text: string;
    mentions: string[];
    attachments: Attachment[];
    parentId: string | null;
  }): Promise<void>;
  react(messageId: string, emoji: string, on: boolean): Promise<void>;
  edit(messageId: string, text: string): Promise<void>;
  remove(messageId: string): Promise<void>;
  notifyTyping(): void;
}

/** A message the server has not acknowledged yet sorts after everything real. */
const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

export function useMessages(realtime: Realtime, channelId: string, userId: string): ChannelStream {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [present, setPresent] = useState<string[]>([]);
  const lastTypingAt = useRef(0);

  const upsert = useCallback((incoming: Message) => {
    setMessages((current) => {
      const next = current.filter((message) => message.id !== incoming.id);
      next.push(incoming);
      next.sort(bySeq);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);

    void api
      .history(channelId)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setLoading(false);
        realtime.subscribe(channelId, page.latestSeq);
        if (page.latestSeq > 0) void api.markRead(channelId, page.latestSeq).catch(() => undefined);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      realtime.unsubscribe(channelId);
    };
  }, [channelId, realtime]);

  useEffect(() => {
    return realtime.on((event: ServerEvent) => {
      if (!('channelId' in event) || event.channelId !== channelId) return;

      switch (event.type) {
        case 'message':
        case 'message_updated':
          upsert(event.message);
          if (event.type === 'message' && event.message.authorId !== userId) {
            void api.markRead(channelId, event.message.seq).catch(() => undefined);
          }
          return;

        case 'message_deleted':
          setMessages((current) =>
            current.map((message) =>
              message.id === event.messageId
                ? { ...message, deletedAt: Date.now(), text: '', body: '""', attachments: [] }
                : message,
            ),
          );
          return;

        case 'reactions':
          setMessages((current) =>
            current.map((message) =>
              message.id === event.messageId ? { ...message, reactions: event.reactions } : message,
            ),
          );
          return;

        case 'typing':
          if (event.userId === userId) return;
          setTyping((current) => [...new Set([...current, event.userId])]);
          // The server sends one notice per window rather than one per
          // keystroke, so the client is what expires it.
          setTimeout(
            () => setTyping((current) => current.filter((id) => id !== event.userId)),
            LIMITS.typingTtlMs,
          );
          return;

        case 'presence':
          setPresent(event.userIds);
          return;

        default:
          return;
      }
    });
  }, [channelId, realtime, upsert, userId]);

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => message.seq > 0);
    if (!oldest) return;

    const page = await api.history(channelId, oldest.seq);
    setHasMore(page.hasMore);
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      return [...page.messages.filter((message) => !known.has(message.id)), ...current].sort(bySeq);
    });
  }, [channelId, messages]);

  /**
   * Replies are not in the channel page, so opening a thread fetches it. Live
   * replies still arrive over the socket, which is why this only ever adds.
   */
  const loadThread = useCallback(
    async (parentId: string) => {
      const thread = await api.thread(channelId, parentId);
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        const added = [thread.parent, ...thread.page.messages].filter(
          (message) => !known.has(message.id),
        );
        return added.length === 0 ? current : [...current, ...added].sort(bySeq);
      });
    },
    [channelId],
  );

  const send = useCallback<ChannelStream['send']>(
    async (input) => {
      const draft = {
        id: ulid(),
        body: toDocument(input.text),
        text: toPlain(input.text),
        parentId: input.parentId,
        attachments: input.attachments,
        mentions: input.mentions,
      };

      // Drawn immediately with the id the server will keep, so the echo
      // replaces this row rather than adding a second one.
      upsert({
        ...draft,
        channelId,
        seq: PENDING_SEQ,
        authorId: userId,
        replyCount: 0,
        reactions: [],
        createdAt: Date.now(),
        editedAt: null,
        deletedAt: null,
      });

      try {
        const saved = await api.send(channelId, draft);
        upsert(saved);
      } catch {
        setMessages((current) => current.filter((message) => message.id !== draft.id));
        throw new Error('send_failed');
      }
    },
    [channelId, upsert, userId],
  );

  const react = useCallback(
    async (messageId: string, emoji: string, on: boolean) => {
      const reactions = await api.react(channelId, messageId, emoji, on);
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? { ...message, reactions } : message)),
      );
    },
    [channelId],
  );

  const edit = useCallback(
    async (messageId: string, text: string) => {
      upsert(await api.edit(channelId, messageId, { body: toDocument(text), text: toPlain(text) }));
    },
    [channelId, upsert],
  );

  const remove = useCallback(
    async (messageId: string) => {
      await api.deleteMessage(channelId, messageId);
    },
    [channelId],
  );

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingAt.current < LIMITS.typingTtlMs / 2) return;
    lastTypingAt.current = now;
    realtime.send({ type: 'typing', channelId });
  }, [channelId, realtime]);

  return {
    messages,
    loading,
    hasMore,
    typing,
    present,
    loadOlder,
    loadThread,
    send,
    react,
    edit,
    remove,
    notifyTyping,
  };
}

function bySeq(a: Message, b: Message): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.createdAt - b.createdAt;
}
