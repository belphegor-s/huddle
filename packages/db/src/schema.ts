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
    /** What somebody chose to appear as. Not whether they are connected. */
    presence: text('presence', { enum: ['active', 'away', 'busy', 'invisible'] })
      .notNull()
      .default('active'),
    statusEmoji: text('status_emoji'),
    statusText: text('status_text'),
    /**
     * Refreshed by the socket. Online is derived from this rather than from
     * the hub's memory, so several instances agree and a restart does not
     * declare everybody offline.
     */
    lastSeenAt: ms('last_seen_at'),
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
    /**
     * Bodies are ciphertext the server cannot read. Set when the channel is
     * made and never afterwards: turning it on later would leave a scrollback
     * of plaintext behind claiming to be private.
     */
    encrypted: boolean('encrypted').notNull().default(false),
    /** Which channel key is current. Bumped when somebody is removed. */
    keyEpoch: integer('key_epoch').notNull().default(0),
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
    /*
     * Only among the live ones. An archived channel keeps its name in the
     * scrollback but stops holding it against a new one, or archiving #launch
     * would mean nobody can ever call a channel that again.
     */
    uniqueIndex('channels_workspace_name_idx')
      .on(t.workspaceId, t.name)
      .where(sql`${t.archivedAt} is null`),
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
    /**
     * The channel key this body was encrypted under, or null for plaintext.
     * Self describing, so a channel that was encrypted from the start still
     * reads correctly beside anything written before the feature existed.
     */
    epoch: integer('epoch'),
    /**
     * Kept on the parent rather than counted on read, because the channel view
     * loads top level messages only and would otherwise have to count rows it
     * deliberately did not fetch.
     */
    replyCount: integer('reply_count').notNull().default(0),
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

/**
 * Who is in a call, right now.
 *
 * In Postgres rather than in the hub's memory because every instance has to
 * agree on the roster: a caller connected to one instance must see somebody
 * connected to another, and a crash must not leave a room that looks occupied
 * forever. Rows are heartbeated and swept, so the worst case is a ghost for a
 * few seconds rather than a call nobody can rejoin.
 *
 * Keyed by session, not by user, because the same person on a laptop and a
 * phone is two participants with two peer connections.
 */
export const callParticipants = pgTable(
  'call_participants',
  {
    sessionId: text('session_id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    muted: boolean('muted').notNull().default(false),
    videoOn: boolean('video_on').notNull().default(false),
    sharing: boolean('sharing').notNull().default(false),
    joinedAt: ms('joined_at').notNull(),
    lastSeenAt: ms('last_seen_at').notNull(),
  },
  (t) => [index('call_participants_channel_idx').on(t.channelId)],
);

/**
 * A browser that holds encryption keys. Keyed by device rather than by user
 * because the private half never leaves the machine that made it: a laptop and
 * a phone are two devices and a channel key is sealed to each of them.
 */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Raw ECDH P-256 public key, base64. Others seal channel keys to this. */
    encryptionKey: text('encryption_key').notNull(),
    /** Raw ECDSA P-256 public key, base64. Proves a sealed key came from here. */
    signingKey: text('signing_key').notNull(),
    label: text('label'),
    createdAt: ms('created_at').notNull(),
    lastSeenAt: ms('last_seen_at').notNull(),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

/**
 * One channel key, sealed to one device, for one epoch.
 *
 * The server stores these and cannot open any of them. A new epoch is a new
 * key: removing somebody bumps it so that what is said afterwards is beyond
 * the key they still hold.
 */
export const channelKeys = pgTable(
  'channel_keys',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    /** An opaque SealedChannelKey. The server never parses it. */
    sealed: text('sealed').notNull(),
    /** Whose device sealed it, so the recipient can check the signature. */
    sealedBy: text('sealed_by')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.epoch, t.deviceId] }),
    index('channel_keys_device_idx').on(t.deviceId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * Stored as it is, unlike a session token, so an admin can copy the link
     * again rather than making a new one every time somebody loses it.
     *
     * The trade is deliberate. This grants membership at one role, expires,
     * can be capped by use count and can be revoked, and it is meant to be
     * pasted into a group chat and read back later. A session token is none of
     * those things, which is why that one is still only ever hashed.
     */
    token: text('token').notNull(),
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
  (t) => [uniqueIndex('invites_token_idx').on(t.token)],
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
export type CallParticipantRow = typeof callParticipants.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type ChannelKeyRow = typeof channelKeys.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type FileRow = typeof files.$inferSelect;
