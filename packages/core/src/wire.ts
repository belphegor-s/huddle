import { z } from 'zod';
import { CallParticipant, DraftMessage, Id, JsonString, Message, Reaction } from './schemas.js';

export const WIRE_VERSION = 1;

/**
 * One multiplexed WebSocket per client, not one per channel. A phone with
 * twenty channels holds a single connection, so every frame carries the
 * channel it belongs to.
 */

const withRef = { ref: z.string().max(64).optional() };

export const ClientEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    channelId: Id,
    /** Last sequence the client already has. The server replays the delta. */
    lastSeq: z.number().int().nonnegative(),
    ...withRef,
  }),
  z.object({ type: z.literal('unsubscribe'), channelId: Id, ...withRef }),
  z.object({ type: z.literal('send'), channelId: Id, draft: DraftMessage, ...withRef }),
  z.object({
    type: z.literal('edit'),
    channelId: Id,
    messageId: Id,
    body: JsonString,
    text: z.string().max(16_000),
    ...withRef,
  }),
  z.object({ type: z.literal('delete'), channelId: Id, messageId: Id, ...withRef }),
  z.object({
    type: z.literal('react'),
    channelId: Id,
    messageId: Id,
    emoji: z.string().min(1).max(32),
    on: z.boolean(),
    ...withRef,
  }),
  z.object({ type: z.literal('typing'), channelId: Id }),
  z.object({ type: z.literal('read'), channelId: Id, seq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('call_join'), channelId: Id, video: z.boolean(), ...withRef }),
  z.object({ type: z.literal('call_leave'), channelId: Id }),
  z.object({
    type: z.literal('call_update'),
    channelId: Id,
    muted: z.boolean(),
    video: z.boolean(),
    sharing: z.boolean(),
  }),
  /**
   * Session description and candidates, opaque to the server. It checks that
   * the sender is in the call and forwards, and never parses the payload:
   * the negotiation is between the two browsers.
   */
  z.object({
    type: z.literal('call_signal'),
    channelId: Id,
    to: Id,
    data: z.string().max(64_000),
  }),
  z.object({ type: z.literal('call_heartbeat'), channelId: Id }),
  z.object({ type: z.literal('ping'), ...withRef }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    version: z.number().int(),
    userId: Id,
    /** This connection, so a caller can tell itself apart on a call roster. */
    sessionId: Id,
    serverTime: z.number().int(),
  }),
  z.object({
    type: z.literal('synced'),
    channelId: Id,
    /** Highest sequence the client now holds after replay. */
    seq: z.number().int().nonnegative(),
    ref: z.string().optional(),
  }),
  z.object({
    type: z.literal('message'),
    channelId: Id,
    message: Message,
    ref: z.string().optional(),
  }),
  z.object({ type: z.literal('message_updated'), channelId: Id, message: Message }),
  z.object({
    type: z.literal('message_deleted'),
    channelId: Id,
    messageId: Id,
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('reactions'),
    channelId: Id,
    messageId: Id,
    reactions: z.array(Reaction),
  }),
  z.object({
    type: z.literal('typing'),
    channelId: Id,
    userId: Id,
    expiresAt: z.number().int(),
  }),
  z.object({ type: z.literal('presence'), channelId: Id, userIds: z.array(Id) }),
  z.object({
    type: z.literal('read'),
    channelId: Id,
    userId: Id,
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('unread'),
    channelId: Id,
    count: z.number().int().nonnegative(),
    mentionCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['unauthorized', 'forbidden', 'not_found', 'rate_limited', 'invalid', 'internal']),
    message: z.string(),
    ref: z.string().optional(),
  }),
  z.object({
    type: z.literal('call_roster'),
    channelId: Id,
    participants: z.array(CallParticipant),
  }),
  z.object({
    type: z.literal('call_signal'),
    channelId: Id,
    from: Id,
    fromUserId: Id,
    to: Id,
    data: z.string(),
  }),
  /**
   * Somebody in this channel has a device with no key for it.
   *
   * Sent to everybody in the channel, because the server cannot help: it holds
   * no key and could not seal one if it wanted to. Whichever client is
   * connected and already holds the key answers this by sealing it across.
   */
  z.object({
    type: z.literal('keys_needed'),
    channelId: Id,
    epoch: z.number().int().nonnegative(),
  }),
  /**
   * The answer to that: somebody sealed a key across. Anyone in the channel
   * who could not read it tries again, because the one that just landed may
   * be theirs.
   */
  z.object({
    type: z.literal('keys_ready'),
    channelId: Id,
    epoch: z.number().int().nonnegative(),
  }),
  /**
   * The set of channels this person can see has moved: one was made, joined,
   * left, renamed, archived, restored or deleted. It carries no channel,
   * because what changed is the list itself, and the client that gets it
   * fetches the list again rather than trying to patch it.
   */
  z.object({ type: z.literal('channels_changed'), workspaceId: Id }),
  /** The sidebar dot. Sent to members who are not looking at the channel. */
  z.object({
    type: z.literal('call_activity'),
    channelId: Id,
    count: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('pong'), ref: z.string().optional() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

export function encodeEvent(event: ClientEvent | ServerEvent): string {
  return JSON.stringify(event);
}

export function decodeClientEvent(raw: string): ClientEvent | null {
  try {
    const parsed = ClientEvent.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function decodeServerEvent(raw: string): ServerEvent | null {
  try {
    const parsed = ServerEvent.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
