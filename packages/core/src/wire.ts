import { z } from 'zod';
import { DraftMessage, Id, JsonString, Message, Reaction } from './schemas.js';

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
  z.object({ type: z.literal('ping'), ...withRef }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    version: z.number().int(),
    userId: Id,
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
