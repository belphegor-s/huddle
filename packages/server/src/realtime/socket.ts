import { decodeClientEvent, encodeEvent, ulid, WIRE_VERSION, type ServerEvent } from '@huddle/core';
import type { AppContext } from '../context.js';
import {
  deleteMessage,
  devicesAwaitingKeys,
  editMessage,
  heartbeatCall,
  joinCall,
  leaveCall,
  markRead,
  markTyping,
  relaySignal,
  requireChannel,
  roster,
  touchLastSeen,
  sendMessage,
  syncSince,
  toggleReaction,
  updateCallState,
} from '../services/index.js';
import type { Subscriber } from './hub.js';

/** The transport, narrowed to what this module uses. */
export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', handler: (data: unknown) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (error: unknown) => void): void;
}

/**
 * One socket per client, multiplexed across channels.
 *
 * A phone with twenty channels holds a single connection, so every frame
 * carries the channel it belongs to and the server never has to fan a person
 * out across sockets.
 *
 * Every frame that changes anything goes through the same service functions
 * the HTTP routes call, so there is exactly one place where permission is
 * decided and one place where a message is written.
 */
export function attachSocket(ctx: AppContext, socket: Socket, userId: string): void {
  const subscriber: Subscriber = {
    id: ulid(ctx.now()),
    userId,
    channels: new Set<string>(),
    send(event: ServerEvent) {
      try {
        socket.send(encodeEvent(event));
      } catch {
        // A socket that fails to write is already closing. The close handler
        // removes it from the hub.
      }
    },
  };

  ctx.hub.add(subscriber);
  // Presence is a timestamp on the row rather than a list in this process, so
  // several instances agree and a restart does not declare everybody offline.
  ctx.background('seen', () => touchLastSeen(ctx, userId));
  subscriber.send({
    type: 'ready',
    version: WIRE_VERSION,
    userId,
    sessionId: subscriber.id,
    serverTime: ctx.now(),
  });

  socket.on('message', (data) => {
    void handle(ctx, subscriber, String(data));
  });

  function disconnect() {
    ctx.hub.remove(subscriber);
    // Dropping the connection is how most calls end: a closed tab, a phone
    // going to sleep. Leaving the roster has to happen here rather than only
    // on an explicit frame, or the call keeps a ghost until it goes stale.
    ctx.background('call_leave', () => leaveCall(ctx, { sessionId: subscriber.id }));
  }

  socket.on('close', disconnect);
  socket.on('error', disconnect);
}

async function handle(ctx: AppContext, subscriber: Subscriber, raw: string): Promise<void> {
  const event = decodeClientEvent(raw);
  if (!event) {
    subscriber.send({ type: 'error', code: 'invalid', message: 'Unreadable frame' });
    return;
  }

  switch (event.type) {
    case 'ping':
      subscriber.send({ type: 'pong', ref: event.ref });
      ctx.background('seen', () => touchLastSeen(ctx, subscriber.userId));
      return;

    case 'subscribe': {
      const access = await requireChannel(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
      });
      if (!access.ok) {
        subscriber.send(fail(access.error, event.ref));
        return;
      }

      ctx.hub.subscribe(subscriber, event.channelId);

      // The delta first, then the acknowledgement, so a client that renders on
      // `synced` already holds everything the acknowledgement claims.
      const delta = await syncSince(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        afterSeq: event.lastSeq,
      });

      let seq = event.lastSeq;
      if (delta.ok) {
        for (const message of delta.value.messages) {
          subscriber.send({ type: 'message', channelId: event.channelId, message });
        }
        seq = delta.value.latestSeq;
      }

      subscriber.send({ type: 'synced', channelId: event.channelId, seq, ref: event.ref });

      // Whether a call is happening here cannot be left to the channel list,
      // which is a snapshot taken when the page loaded. Anyone opening the
      // channel is told the truth as part of arriving.
      subscriber.send({
        type: 'call_roster',
        channelId: event.channelId,
        participants: await roster(ctx, event.channelId),
      });

      ctx.hub.publish(event.channelId, {
        type: 'presence',
        channelId: event.channelId,
        userIds: ctx.hub.presence(event.channelId),
      });

      /*
       * Opening an encrypted channel with no key for it is the moment to ask
       * for one. Waiting for somebody who has it to happen to open the channel
       * themselves left people looking at a room full of messages they could
       * not read, which is the whole feature failing quietly.
       */
      if (access.value.channel.encrypted) {
        ctx.background('keys_needed', async () => {
          const waiting = await devicesAwaitingKeys(ctx, {
            channelId: event.channelId,
            userId: subscriber.userId,
          });
          if (!waiting.ok) return;

          const mine = waiting.value.devices.some((device) => device.userId === subscriber.userId);
          if (!mine) return;

          ctx.hub.publish(event.channelId, {
            type: 'keys_needed',
            channelId: event.channelId,
            epoch: waiting.value.epoch,
          });
        });
      }

      return;
    }

    case 'unsubscribe':
      ctx.hub.unsubscribe(subscriber, event.channelId);
      ctx.hub.publish(event.channelId, {
        type: 'presence',
        channelId: event.channelId,
        userIds: ctx.hub.presence(event.channelId),
      });
      return;

    case 'send': {
      const sent = await sendMessage(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        draft: event.draft,
      });
      if (!sent.ok) subscriber.send(fail(sent.error, event.ref));
      return;
    }

    case 'edit': {
      const edited = await editMessage(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        messageId: event.messageId,
        body: event.body,
        text: event.text,
      });
      if (!edited.ok) subscriber.send(fail(edited.error, event.ref));
      return;
    }

    case 'delete': {
      const removed = await deleteMessage(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        messageId: event.messageId,
      });
      if (!removed.ok) subscriber.send(fail(removed.error, event.ref));
      return;
    }

    case 'react': {
      const reacted = await toggleReaction(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        messageId: event.messageId,
        emoji: event.emoji,
        on: event.on,
      });
      if (!reacted.ok) subscriber.send(fail(reacted.error, event.ref));
      return;
    }

    case 'typing':
      await markTyping(ctx, { channelId: event.channelId, userId: subscriber.userId });
      return;

    case 'read':
      await markRead(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        seq: event.seq,
      });
      return;

    case 'call_join': {
      const joined = await joinCall(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        sessionId: subscriber.id,
        video: event.video,
      });
      if (!joined.ok) subscriber.send(fail(joined.error, event.ref));
      // The roster went out to the channel, but only subscribers of it. A
      // caller who joined without the channel open would otherwise never see
      // the answer to the frame it just sent.
      else {
        subscriber.send({
          type: 'call_roster',
          channelId: event.channelId,
          participants: joined.value,
        });
      }
      return;
    }

    case 'call_leave':
      await leaveCall(ctx, { sessionId: subscriber.id });
      return;

    case 'call_update':
      await updateCallState(ctx, {
        sessionId: subscriber.id,
        muted: event.muted,
        video: event.video,
        sharing: event.sharing,
      });
      return;

    case 'call_signal': {
      const relayed = await relaySignal(ctx, {
        channelId: event.channelId,
        userId: subscriber.userId,
        sessionId: subscriber.id,
        to: event.to,
        data: event.data,
      });
      if (!relayed.ok) subscriber.send(fail(relayed.error, undefined));
      return;
    }

    case 'call_heartbeat':
      await heartbeatCall(ctx, { sessionId: subscriber.id });
      return;
  }
}

/**
 * Service errors are string literals and the wire has a fixed error code set,
 * so the two are mapped in one place rather than at every call site.
 */
function fail(error: string, ref?: string): ServerEvent {
  const code =
    error === 'not_found' || error === 'not_a_member'
      ? 'not_found'
      : error === 'forbidden' || error === 'archived'
        ? 'forbidden'
        : error === 'rate_limited'
          ? 'rate_limited'
          : 'invalid';

  return { type: 'error', code, message: error, ref };
}
