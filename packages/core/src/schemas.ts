import { z } from 'zod';
import { isUlid } from './ids.js';

export const Id = z.string().refine(isUlid, { message: 'Expected a ULID' });

/**
 * Rich text travels as serialized TipTap JSON rather than a parsed object.
 *
 * The server never inspects a message body, so keeping it opaque removes a
 * parse and a re-serialize on every hop, and avoids handing a recursive type
 * to the Durable Object RPC boundary, which cannot prove such a type is
 * serializable.
 */
export const JsonString = z
  .string()
  .max(64_000)
  .refine(
    (value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Expected serialized JSON' },
  );

export const Role = z.enum(['owner', 'admin', 'member', 'guest']);
export type Role = z.infer<typeof Role>;

export const ChannelKind = z.enum(['channel', 'dm', 'group_dm']);
export type ChannelKind = z.infer<typeof ChannelKind>;

export const NotificationLevel = z.enum(['all', 'mentions', 'none']);
export type NotificationLevel = z.infer<typeof NotificationLevel>;

export const User = z.object({
  id: Id,
  email: z.email(),
  displayName: z.string().min(1).max(80),
  avatarUrl: z.url().nullable(),
  timezone: z.string().max(64).nullable(),
  createdAt: z.number().int(),
});
export type User = z.infer<typeof User>;

export const Workspace = z.object({
  id: Id,
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Lowercase letters, numbers and hyphens only'),
  name: z.string().min(1).max(80),
  iconUrl: z.url().nullable(),
  createdAt: z.number().int(),
});
export type Workspace = z.infer<typeof Workspace>;

export const Membership = z.object({
  workspaceId: Id,
  userId: Id,
  role: Role,
  joinedAt: z.number().int(),
});
export type Membership = z.infer<typeof Membership>;

export const Channel = z.object({
  id: Id,
  workspaceId: Id,
  kind: ChannelKind,
  name: z.string().min(1).max(80).nullable(),
  topic: z.string().max(280).nullable(),
  isPrivate: z.boolean(),
  createdBy: Id,
  createdAt: z.number().int(),
  archivedAt: z.number().int().nullable(),
});
export type Channel = z.infer<typeof Channel>;

export const Attachment = z.object({
  id: Id,
  kind: z.enum(['image', 'video', 'audio', 'file']),
  name: z.string().min(1).max(255),
  mimeType: z.string().max(127),
  size: z.number().int().nonnegative(),
  url: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  // Precomputed waveform peaks for voice notes, so playback never decodes audio.
  peaks: z.array(z.number().min(0).max(1)).max(512).nullable(),
});
export type Attachment = z.infer<typeof Attachment>;

export const Reaction = z.object({
  emoji: z.string().min(1).max(32),
  userIds: z.array(Id),
});
export type Reaction = z.infer<typeof Reaction>;

export const Message = z.object({
  id: Id,
  channelId: Id,
  /** Monotonic per channel, assigned by the server. The only ordering authority. */
  seq: z.number().int().nonnegative(),
  authorId: Id,
  /** TipTap JSON. Rendered by the client, never trusted as HTML. */
  body: JsonString,
  /** Flattened text for search, notifications and accessibility. */
  text: z.string(),
  parentId: Id.nullable(),
  attachments: z.array(Attachment),
  reactions: z.array(Reaction),
  mentions: z.array(Id),
  createdAt: z.number().int(),
  editedAt: z.number().int().nullable(),
  deletedAt: z.number().int().nullable(),
});
export type Message = z.infer<typeof Message>;

export const DraftMessage = z.object({
  /** Client generated ULID, so an optimistic send can be reconciled on echo. */
  id: Id,
  body: JsonString,
  text: z.string().max(16_000),
  parentId: Id.nullable().default(null),
  attachments: z.array(Attachment).max(20).default([]),
  mentions: z.array(Id).max(64).default([]),
});
export type DraftMessage = z.infer<typeof DraftMessage>;
