import {
  LIMITS,
  ulid,
  type Attachment,
  type Channel,
  type Message,
  type ServerEvent,
} from '@huddle/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { decryptBody, encryptBody, holdsKey, syncChannelKeys } from './keyring';
import type { Realtime } from './realtime';
import { toDocument, toLines, toPlain } from './rich-text';

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
  /**
   * Messages this device holds no key for. They exist, they are somebody's
   * words, and this browser cannot read them, which the list says plainly
   * rather than drawing an empty row.
   */
  locked: ReadonlySet<string>;
  /** True while an encrypted channel has no key here yet. */
  waitingForKey: boolean;
}

/** A message the server has not acknowledged yet sorts after everything real. */
const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

export function useMessages(
  realtime: Realtime,
  channel: Pick<Channel, 'id' | 'encrypted' | 'keyEpoch'>,
  userId: string,
): ChannelStream {
  const channelId = channel.id;
  const { encrypted, keyEpoch } = channel;

  const [messages, setMessages] = useState<Message[]>([]);
  /*
   * The same list, readable without being a dependency. Editing needs to know
   * which key a message was written under, and taking `messages` as a
   * dependency would rebuild the callback on every arriving message and
   * re-render every row in the channel.
   */
  const seen = useRef<Message[]>([]);
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [hasKey, setHasKey] = useState(() => !encrypted || holdsKey(channelId, keyEpoch));
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [present, setPresent] = useState<string[]>([]);
  const lastTypingAt = useRef(0);

  /**
   * Opens a message if it needs opening. Every message enters state through
   * here, so there is one place where ciphertext becomes readable and one
   * place that decides a message cannot be read on this device.
   */
  const open = useCallback(async (incoming: Message): Promise<Message> => {
    if (incoming.epoch === null) return incoming;

    const plaintext = await decryptBody(incoming.body, {
      channelId: incoming.channelId,
      messageId: incoming.id,
      authorId: incoming.authorId,
      epoch: incoming.epoch,
    });

    if (plaintext === null) {
      setLocked((current) => new Set(current).add(incoming.id));
      return { ...incoming, body: toDocument(''), text: '' };
    }

    setLocked((current) => {
      if (!current.has(incoming.id)) return current;
      const next = new Set(current);
      next.delete(incoming.id);
      return next;
    });

    /*
     * What was sealed is the document itself, so it goes back as it is.
     * Wrapping it a second time put the serialised document inside a
     * paragraph, and the message drew as a line of JSON.
     */
    const lines = toLines(plaintext);
    const isDocument = lines.length > 0;
    const source = document ? lines.join('\n') : plaintext;

    return {
      ...incoming,
      body: isDocument ? plaintext : toDocument(plaintext),
      text: toPlain(source),
    };
  }, []);

  useEffect(() => {
    seen.current = messages;
  }, [messages]);

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

    setLocked(new Set());

    void (async () => {
      try {
        // Keys before history. Fetching the other way round would draw every
        // message as unreadable for a moment and then correct itself.
        if (encrypted) {
          await syncChannelKeys(channelId, keyEpoch).catch(() => undefined);
          if (!cancelled) setHasKey(holdsKey(channelId, keyEpoch));
        }

        const page = await api.history(channelId);
        if (cancelled) return;

        setMessages(await Promise.all(page.messages.map(open)));
        setHasMore(page.hasMore);
        setLoading(false);
        realtime.subscribe(channelId, page.latestSeq);

        if (page.latestSeq > 0) {
          void api.markRead(channelId, page.latestSeq).catch(() => undefined);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      realtime.unsubscribe(channelId);
    };
  }, [channelId, encrypted, keyEpoch, open, realtime]);

  useEffect(() => {
    return realtime.on((event: ServerEvent) => {
      if (!('channelId' in event) || event.channelId !== channelId) return;

      switch (event.type) {
        case 'message':
        case 'message_updated':
          void open(event.message).then(upsert);
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

        case 'keys_ready': {
          /*
           * Somebody sealed a key across while this channel was open. The
           * messages already on screen were stored without their ciphertext,
           * so the history is fetched again rather than reopened in place.
           */
          if (event.epoch !== keyEpoch || holdsKey(channelId, keyEpoch)) return;

          void (async () => {
            await syncChannelKeys(channelId, keyEpoch).catch(() => undefined);
            if (!holdsKey(channelId, keyEpoch)) return;

            setHasKey(true);
            const page = await api.history(channelId);
            setMessages(await Promise.all(page.messages.map(open)));
          })();
          return;
        }

        default:
          return;
      }
    });
  }, [channelId, keyEpoch, open, realtime, upsert, userId]);

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => message.seq > 0);
    if (!oldest) return;

    const page = await api.history(channelId, oldest.seq);
    const older = await Promise.all(page.messages.map(open));
    setHasMore(page.hasMore);
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      return [...older.filter((message) => !known.has(message.id)), ...current].sort(bySeq);
    });
  }, [channelId, messages, open]);

  /**
   * Replies are not in the channel page, so opening a thread fetches it. Live
   * replies still arrive over the socket, which is why this only ever adds.
   */
  const loadThread = useCallback(
    async (parentId: string) => {
      const thread = await api.thread(channelId, parentId);
      const opened = await Promise.all([thread.parent, ...thread.page.messages].map(open));

      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        const added = opened.filter((message) => !known.has(message.id));
        return added.length === 0 ? current : [...current, ...added].sort(bySeq);
      });
    },
    [channelId, open],
  );

  const send = useCallback<ChannelStream['send']>(
    async (input) => {
      const id = ulid();
      const plain = toPlain(input.text);

      /*
       * A reload empties the keyring in memory, and it is filled again from
       * the sealed copies on the way into the channel. Somebody who types
       * straight after a refresh can get there first, and the send used to
       * fail with nothing to show for it.
       */
      if (encrypted && !holdsKey(channelId, keyEpoch)) {
        await syncChannelKeys(channelId, keyEpoch).catch(() => undefined);
      }

      /*
       * In an encrypted channel the body leaves as ciphertext and no plain
       * text goes with it. The binding ties it to this message in this
       * channel by this author under this key, so it cannot be lifted out and
       * replayed as something else.
       */
      const body = encrypted
        ? await encryptBody(toDocument(input.text), {
            channelId,
            messageId: id,
            authorId: userId,
            epoch: keyEpoch,
          })
        : toDocument(input.text);

      const draft = {
        id,
        body,
        text: encrypted ? '' : plain,
        parentId: input.parentId,
        attachments: input.attachments,
        mentions: input.mentions,
        epoch: encrypted ? keyEpoch : null,
      };

      // Drawn immediately with the id the server will keep, so the echo
      // replaces this row rather than adding a second one. The local copy
      // carries the plain text: this device wrote it and can read it.
      upsert({
        ...draft,
        body: toDocument(input.text),
        text: plain,
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
        upsert({ ...saved, body: toDocument(input.text), text: plain });
      } catch {
        setMessages((current) => current.filter((message) => message.id !== draft.id));
        throw new Error('send_failed');
      }
    },
    [channelId, encrypted, keyEpoch, upsert, userId],
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
      /*
       * Sealed the same way a send is, under the key the message was written
       * with rather than the channel's current one: an edit does not move a
       * message to a newer epoch, so encrypting it there would leave it
       * unreadable to everybody, the author included.
       */
      const epoch = seen.current.find((message) => message.id === messageId)?.epoch ?? null;

      const body =
        epoch === null
          ? toDocument(text)
          : await encryptBody(toDocument(text), {
              channelId,
              messageId,
              authorId: userId,
              epoch,
            });

      const saved = await api.edit(channelId, messageId, {
        body,
        text: epoch === null ? toPlain(text) : '',
      });

      // The local copy carries the plain text: this device wrote it.
      upsert({ ...saved, body: toDocument(text), text: toPlain(text) });
    },
    [channelId, upsert, userId],
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
    locked,
    waitingForKey: encrypted && !hasKey,
  };
}

function bySeq(a: Message, b: Message): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.createdAt - b.createdAt;
}
