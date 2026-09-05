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

/**
 * Normalised before validation, so `  Ada@Example.COM ` and `ada@example.com`
 * are one account rather than two. Addresses are compared as opaque strings
 * everywhere else.
 */
export const Email = z
  .string()
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email());

/**
 * A picture, either hosted elsewhere or served by this deployment.
 *
 * An upload produces an app relative path, which a strict URL check rejects:
 * avatars were being refused with a validation error nobody surfaced, so the
 * picture appeared to change and never persisted.
 */
export const ImageRef = z
  .string()
  .max(2048)
  .refine(
    (value) => value.startsWith('/') || /^https?:\/\//.test(value),
    'Must be a link, or a path on this server',
  );
export type ImageRef = z.infer<typeof ImageRef>;

export const User = z.object({
  id: Id,
  email: z.email(),
  displayName: z.string().min(1).max(80),
  avatarUrl: ImageRef.nullable(),
  timezone: z.string().max(64).nullable(),
  presence: z.enum(['active', 'away', 'busy', 'invisible']),
  statusEmoji: z.string().nullable(),
  statusText: z.string().nullable(),
  createdAt: z.number().int(),
});
export type User = z.infer<typeof User>;

export const Slug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Lowercase letters, numbers and hyphens only');

export const Workspace = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1).max(80),
  iconUrl: z.url().nullable(),
  createdAt: z.number().int(),
});
export type Workspace = z.infer<typeof Workspace>;

/**
 * The slug is deliberately not here. Every link anybody has bookmarked or
 * pasted into a message carries it, and quietly breaking those is worse than
 * living with a name chosen in a hurry.
 */
/** A device's public halves, as the server stores and serves them. */
export const DeviceRecord = z.object({
  id: Id,
  userId: Id,
  encryptionKey: z.string().min(1).max(512),
  signingKey: z.string().min(1).max(512),
  label: z.string().max(120).nullable(),
});
export type DeviceRecord = z.infer<typeof DeviceRecord>;

export const RegisterDeviceInput = z.object({
  encryptionKey: z.string().min(1).max(512),
  signingKey: z.string().min(1).max(512),
  label: z.string().max(120).nullable().default(null),
});
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceInput>;

/** One channel key, sealed to one device. Opaque to the server. */
export const SealedKeyRecord = z.object({
  channelId: Id,
  epoch: z.number().int().nonnegative(),
  deviceId: Id,
  sealed: z.string().max(4096),
  sealedBy: Id,
});
export type SealedKeyRecord = z.infer<typeof SealedKeyRecord>;

export const PublishKeysInput = z.object({
  epoch: z.number().int().nonnegative(),
  /** The device doing the sealing, whose signature the recipients check. */
  sealedBy: Id,
  entries: z
    .array(z.object({ deviceId: Id, sealed: z.string().max(4096) }))
    .min(1)
    .max(200),
});
export type PublishKeysInput = z.infer<typeof PublishKeysInput>;

export const UpdateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  iconUrl: z.url().nullable().optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInput>;

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
  /** Bodies are ciphertext the server cannot read. Fixed at creation. */
  encrypted: z.boolean(),
  keyEpoch: z.number().int().nonnegative(),
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
  /**
   * The channel key the body was encrypted under, or null for plaintext. Self
   * describing, so an encrypted channel reads correctly beside anything
   * written before it was.
   */
  epoch: z.number().int().nonnegative().nullable(),
  /** Replies to this message. Zero for a reply itself: threads are one deep. */
  replyCount: z.number().int().nonnegative(),
  attachments: z.array(Attachment),
  reactions: z.array(Reaction),
  mentions: z.array(Id),
  createdAt: z.number().int(),
  editedAt: z.number().int().nullable(),
  deletedAt: z.number().int().nullable(),
});
export type Message = z.infer<typeof Message>;

/**
 * Where to land after signing in. Relative paths only, so a magic link cannot
 * be crafted to bounce someone to another site with their session freshly
 * minted.
 */
export const InternalPath = z
  .string()
  .max(512)
  .regex(/^\/(?!\/)[\w\-./?=&%#]*$/, 'Expected a path on this site');

export const RequestMagicLinkInput = z.object({
  email: Email,
  redirectTo: InternalPath.nullable().default(null),
});
export type RequestMagicLinkInput = z.infer<typeof RequestMagicLinkInput>;

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: Slug,
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInput>;

export const CreateInviteInput = z.object({
  role: z.enum(['admin', 'member', 'guest']).default('member'),
  expiresInHours: z.number().int().min(1).max(720).default(168),
  maxUses: z.number().int().min(1).max(1000).nullable().default(null),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInput>;

/**
 * What somebody chose to appear as, which is not the same as whether they are
 * connected. Invisible is a choice to look offline while being here.
 */
export const Presence = z.enum(['active', 'away', 'busy', 'invisible']);
export type Presence = z.infer<typeof Presence>;

export const UserStatus = z.object({
  presence: Presence,
  emoji: z.string().max(16).nullable(),
  text: z.string().max(80).nullable(),
});
export type UserStatus = z.infer<typeof UserStatus>;

export const UpdateProfileInput = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().max(64).nullable().optional(),
  avatarUrl: ImageRef.nullable().optional(),
  presence: Presence.optional(),
  statusEmoji: z.string().trim().max(16).nullable().optional(),
  statusText: z.string().trim().max(80).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

/**
 * Server side payloads held in the key value store. They are parsed on the
 * way out rather than trusted, because a store can be rolled back, migrated
 * or edited by an operator, and a malformed session should sign someone out
 * rather than crash the request.
 */
export const StoredMagicLink = z.object({
  email: z.email(),
  redirectTo: InternalPath.nullable(),
  createdAt: z.number().int(),
});
export type StoredMagicLink = z.infer<typeof StoredMagicLink>;

export const StoredSession = z.object({
  userId: Id,
  createdAt: z.number().int(),
  lastSeenAt: z.number().int(),
});
export type StoredSession = z.infer<typeof StoredSession>;

/** A workspace as it appears in the switcher, with the viewer's own role. */
export const WorkspaceMembership = z.object({
  workspace: Workspace,
  role: Role,
});
export type WorkspaceMembership = z.infer<typeof WorkspaceMembership>;

export const Me = z.object({
  user: User,
  workspaces: z.array(WorkspaceMembership),
});
export type Me = z.infer<typeof Me>;

export const DraftMessage = z.object({
  /** Client generated ULID, so an optimistic send can be reconciled on echo. */
  id: Id,
  body: JsonString,
  text: z.string().max(16_000),
  parentId: Id.nullable().default(null),
  attachments: z.array(Attachment).max(20).default([]),
  mentions: z.array(Id).max(64).default([]),
  /**
   * Set when the body is ciphertext. The server checks it against the
   * channel's current epoch and stores no searchable text for the message.
   */
  epoch: z.number().int().nonnegative().nullable().default(null),
});
export type DraftMessage = z.infer<typeof DraftMessage>;

export const ChannelName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Lowercase letters, numbers, hyphens and underscores only');

export const CreateChannelInput = z.object({
  name: ChannelName,
  topic: z.string().trim().max(280).nullable().default(null),
  isPrivate: z.boolean().default(false),
  /**
   * Only ever set here. Turning it on later would leave a scrollback of
   * plaintext behind a claim that the channel is private.
   */
  encrypted: z.boolean().default(false),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInput>;

export const UpdateChannelInput = z.object({
  name: ChannelName.optional(),
  topic: z.string().trim().max(280).nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateChannelInput = z.infer<typeof UpdateChannelInput>;

export const OpenDmInput = z.object({
  /** The other people. The caller is added implicitly and never listed twice. */
  userIds: z.array(Id).min(1).max(8),
});
export type OpenDmInput = z.infer<typeof OpenDmInput>;

/**
 * A channel as the sidebar needs it: the channel itself plus everything that
 * decides how its row is drawn, so the list renders from one request.
 */
export const ChannelSummary = z.object({
  channel: Channel,
  lastSeq: z.number().int().nonnegative(),
  lastMessageAt: z.number().int().nullable(),
  readSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  mentionCount: z.number().int().nonnegative(),
  notificationLevel: NotificationLevel,
  muted: z.boolean(),
  /** Filled for DMs only, where the name is the other people. */
  memberIds: z.array(Id),
  /** How many people are in a call here right now. Zero means no call. */
  callCount: z.number().int().nonnegative(),
});
export type ChannelSummary = z.infer<typeof ChannelSummary>;

/**
 * One person in a call, keyed by connection rather than by user, because the
 * same person joining from a laptop and a phone is two peers with two streams.
 */
export const CallParticipant = z.object({
  sessionId: Id,
  userId: Id,
  muted: z.boolean(),
  video: z.boolean(),
  sharing: z.boolean(),
  joinedAt: z.number().int(),
});
export type CallParticipant = z.infer<typeof CallParticipant>;

/**
 * Where the browser should look for a relay. Empty by default: a public STUN
 * server would be a third party request from the client, so a deployment that
 * wants calls to cross a strict NAT points this at its own.
 */
export const IceServer = z.object({
  urls: z.array(z.string()),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof IceServer>;

export const MemberProfile = z.object({
  id: Id,
  displayName: z.string(),
  avatarUrl: ImageRef.nullable(),
  role: Role,
  presence: Presence,
  statusEmoji: z.string().nullable(),
  statusText: z.string().nullable(),
  /** Connected recently. Always false for somebody who chose to be invisible. */
  online: z.boolean(),
});
export type MemberProfile = z.infer<typeof MemberProfile>;

export const UpdateChannelPrefsInput = z.object({
  notificationLevel: NotificationLevel.optional(),
  mutedUntil: z.number().int().nullable().optional(),
});
export type UpdateChannelPrefsInput = z.infer<typeof UpdateChannelPrefsInput>;

export const SearchInput = z.object({
  text: z.string().trim().min(1).max(200),
  channelId: Id.optional(),
  authorId: Id.optional(),
  hasFile: z.boolean().optional(),
  after: z.number().int().optional(),
  before: z.number().int().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchInput = z.infer<typeof SearchInput>;

export const EditMessageInput = z.object({
  body: JsonString,
  text: z.string().max(16_000),
});
export type EditMessageInput = z.infer<typeof EditMessageInput>;

export const ReactInput = z.object({
  emoji: z.string().min(1).max(32),
  on: z.boolean(),
});
export type ReactInput = z.infer<typeof ReactInput>;

export const MarkReadInput = z.object({
  seq: z.number().int().nonnegative(),
});
export type MarkReadInput = z.infer<typeof MarkReadInput>;

export const CreateUploadInput = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().positive(),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  peaks: z.array(z.number().min(0).max(1)).max(512).nullable().default(null),
});
export type CreateUploadInput = z.infer<typeof CreateUploadInput>;

/**
 * What the client needs to push the bytes, plus the attachment to put on the
 * message once it has. The URL is a route on this server rather than the
 * signed one, so a link in an old message still resolves years later.
 */
export const UploadTicket = z.object({
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.number().int(),
  attachment: Attachment,
});
export type UploadTicket = z.infer<typeof UploadTicket>;

/**
 * A link, read by the server so the client never touches the linked site.
 * `imageUrl` is always a path on this deployment, never the original host.
 */
export const LinkPreview = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  siteName: z.string(),
  imageUrl: z.string().nullable(),
});
export type LinkPreview = z.infer<typeof LinkPreview>;

export const SetMemberRoleInput = z.object({
  role: z.enum(['admin', 'member', 'guest']),
});
export type SetMemberRoleInput = z.infer<typeof SetMemberRoleInput>;

/**
 * An invite, with its link, so it can be copied again later. Readable by an
 * admin of the workspace and nobody else.
 */
export const InviteSummary = z.object({
  id: Id,
  token: z.string(),
  role: Role,
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  maxUses: z.number().int().nullable(),
  useCount: z.number().int(),
  expired: z.boolean(),
});
export type InviteSummary = z.infer<typeof InviteSummary>;
