import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * SQLite dialect only, deliberately. The same schema runs on D1, on libSQL and
 * on a local file, which is what keeps the Cloudflare and self hosted builds
 * from drifting apart. See CLAUDE.md.
 *
 * Messages are not here. They live in per channel storage behind the
 * MessageStore port, because that is what gives single writer `seq` ordering.
 */

const id = () => text('id').primaryKey();
const ms = (name: string) => integer(name, { mode: 'number' });

export const users = sqliteTable(
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

export const workspaces = sqliteTable(
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

export const memberships = sqliteTable(
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

export const channels = sqliteTable(
  'channels',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['channel', 'dm', 'group_dm'] }).notNull(),
    name: text('name'),
    topic: text('topic'),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: ms('created_at').notNull(),
    archivedAt: ms('archived_at'),
    /** Mirrored from the message store so channel lists sort without a fanout read. */
    lastMessageAt: ms('last_message_at'),
    lastSeq: integer('last_seq').notNull().default(0),
  },
  (t) => [
    index('channels_workspace_idx').on(t.workspaceId),
    uniqueIndex('channels_workspace_name_idx').on(t.workspaceId, t.name),
  ],
);

export const channelMembers = sqliteTable(
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

export const invites = sqliteTable(
  'invites',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Hashed, never stored in the clear, so a database leak cannot grant access. */
    tokenHash: text('token_hash').notNull(),
    role: text('role', { enum: ['admin', 'member', 'guest'] }).notNull().default('member'),
    createdBy: text('created_by').notNull(),
    createdAt: ms('created_at').notNull(),
    expiresAt: ms('expires_at').notNull(),
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: ms('revoked_at'),
  },
  (t) => [uniqueIndex('invites_token_idx').on(t.tokenHash)],
);

export const pushSubscriptions = sqliteTable(
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
  (t) => [
    uniqueIndex('push_endpoint_idx').on(t.endpoint),
    index('push_user_idx').on(t.userId),
  ],
);

export const files = sqliteTable(
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
    peaks: text('peaks', { mode: 'json' }).$type<number[] | null>(),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('files_workspace_idx').on(t.workspaceId)],
);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type ChannelMember = typeof channelMembers.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type FileRow = typeof files.$inferSelect;
