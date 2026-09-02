import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Postgres, one schema, no dialect switch. Everything the app needs is a table
 * here: messages, sessions, magic links and rate counters included, so the
 * only external services a deploy needs are Postgres and an S3 bucket.
 *
 * Times are epoch milliseconds in bigint rather than timestamptz, because the
 * wire protocol and the client both speak milliseconds and a single
 * representation removes a class of timezone bugs.
 */

const id = () => text('id').primaryKey();
const ms = (name: string) => bigint(name, { mode: 'number' });

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    timezone: text('timezone'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    iconUrl: text('icon_url'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [uniqueIndex('workspaces_slug_idx').on(t.slug)],
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'guest'] }).notNull(),
    joinedAt: ms('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const channels = pgTable(
  'channels',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['channel', 'dm', 'group_dm'] }).notNull(),
    name: text('name'),
    topic: text('topic'),
    isPrivate: boolean('is_private').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: ms('created_at').notNull(),
    archivedAt: ms('archived_at'),
    lastMessageAt: ms('last_message_at'),
    /**
     * The ordering authority for the channel. Incremented inside the same
     * statement that claims it, so two concurrent sends cannot take the same
     * number no matter how many app instances are running.
     */
    lastSeq: integer('last_seq').notNull().default(0),
  },
  (t) => [
    index('channels_workspace_idx').on(t.workspaceId),
    uniqueIndex('channels_workspace_name_idx').on(t.workspaceId, t.name),
  ],
);

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: ms('joined_at').notNull(),
    /** Highest sequence this user has read. Drives every unread badge. */
    readSeq: integer('read_seq').notNull().default(0),
    mentionCount: integer('mention_count').notNull().default(0),
    notificationLevel: text('notification_level', { enum: ['all', 'mentions', 'none'] })
      .notNull()
      .default('all'),
    mutedUntil: ms('muted_until'),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('channel_members_user_idx').on(t.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    authorId: text('author_id').notNull(),
    /** TipTap JSON, never parsed by the server. */
    body: text('body').notNull(),
    /** Flattened text for search, notifications and accessibility. */
    text: text('text').notNull(),
    parentId: text('parent_id'),
    attachments: jsonb('attachments')
      .notNull()
      .default(sql`'[]'::jsonb`),
    reactions: jsonb('reactions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    mentions: jsonb('mentions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: ms('created_at').notNull(),
    editedAt: ms('edited_at'),
    deletedAt: ms('deleted_at'),
  },
  (t) => [
    uniqueIndex('messages_channel_seq_idx').on(t.channelId, t.seq),
    index('messages_thread_idx').on(t.channelId, t.parentId, t.seq),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Hashed, never stored in the clear, so a database leak cannot grant access. */
    tokenHash: text('token_hash').notNull(),
    role: text('role', { enum: ['admin', 'member', 'guest'] })
      .notNull()
      .default('member'),
    createdBy: text('created_by').notNull(),
    createdAt: ms('created_at').notNull(),
    expiresAt: ms('expires_at').notNull(),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: ms('revoked_at'),
  },
  (t) => [uniqueIndex('invites_token_idx').on(t.tokenHash)],
);

/**
 * Sessions, magic links and rate counters share one keyed table. They are all
 * short lived values with an expiry, and a dedicated store for each would mean
 * another service in the compose file for no benefit.
 */
export const ephemeral = pgTable(
  'ephemeral',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    counter: integer('counter').notNull().default(0),
    expiresAt: ms('expires_at').notNull(),
  },
  (t) => [index('ephemeral_expiry_idx').on(t.expiresAt)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: ms('created_at').notNull(),
    lastSeenAt: ms('last_seen_at').notNull(),
  },
  (t) => [uniqueIndex('push_endpoint_idx').on(t.endpoint), index('push_user_idx').on(t.userId)],
);

export const files = pgTable(
  'files',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id').notNull(),
    storageKey: text('storage_key').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    peaks: jsonb('peaks').$type<number[] | null>(),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('files_workspace_idx').on(t.workspaceId)],
);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type ChannelMember = typeof channelMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type FileRow = typeof files.$inferSelect;
