import { err, ok, ulid, type Channel, type Message, type Result } from '@huddle/core';
import { channelMembers, pushSubscriptions, users, workspaces } from '@huddle/db';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import type { PushSubscription } from '../storage/push.js';

export type PushError = 'unavailable';

export interface SavePushInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * One row per browser, keyed by its endpoint, so the same person on a laptop
 * and a phone gets both. A re-subscribe from the same browser updates the row
 * rather than adding a second one.
 */
export async function savePushSubscription(
  ctx: AppContext,
  input: SavePushInput,
): Promise<Result<null, PushError>> {
  if (!ctx.push.available) return err('unavailable');

  const now = ctx.now();
  await ctx.db
    .insert(pushSubscriptions)
    .values({
      id: ulid(now),
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        lastSeenAt: now,
      },
    });

  return ok(null);
}

export async function removePushSubscription(ctx: AppContext, endpoint: string): Promise<void> {
  await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/**
 * Decides who hears about a message and tells their browsers.
 *
 * Anyone with the channel open on a live socket is deliberately skipped: they
 * already have the message on screen, and a notification for something you are
 * looking at is the fastest way to make people turn notifications off. With
 * several instances running, presence is only known locally, so a second
 * instance may notify someone who is reading. The alternative is a presence
 * round trip on the send path, which is not worth it.
 */
export async function notifyNewMessage(
  ctx: AppContext,
  input: { channel: Channel; message: Message },
): Promise<void> {
  if (!ctx.push.available) return;

  const watching = new Set(ctx.hub.presence(input.channel.id));
  const mentioned = new Set(input.message.mentions);

  const recipients = await ctx.db
    .select({
      userId: channelMembers.userId,
      level: channelMembers.notificationLevel,
      mutedUntil: channelMembers.mutedUntil,
    })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, input.channel.id),
        ne(channelMembers.userId, input.message.authorId),
      ),
    );

  const now = ctx.now();
  const targets = recipients
    .filter((row) => !watching.has(row.userId))
    .filter((row) => (row.mutedUntil ?? 0) <= now)
    .filter((row) => row.level !== 'none')
    .filter((row) => row.level === 'all' || mentioned.has(row.userId))
    .map((row) => row.userId);

  if (targets.length === 0) return;

  const [author] = await ctx.db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.message.authorId))
    .limit(1);

  const [workspace] = await ctx.db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, input.channel.workspaceId))
    .limit(1);

  if (!workspace) return;

  const title = titleFor(input.channel, author?.displayName ?? 'Someone');
  const body = previewOf(input.message);
  const url = `/w/${workspace.slug}/c/${input.channel.name ?? input.channel.id}`;

  const subscriptions = await ctx.db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, targets));

  const dead: string[] = [];

  await Promise.all(
    subscriptions.map(async (row) => {
      const subscription: PushSubscription = {
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
      };

      const result = await ctx.push.send(subscription, {
        title,
        body,
        tag: input.channel.id,
        url,
      });

      if (!result.ok && result.expired) dead.push(row.endpoint);
    }),
  );

  if (dead.length > 0) {
    await ctx.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead));
  }
}

/** A DM says who it is from. A channel message says where it landed too. */
function titleFor(channel: Channel, authorName: string): string {
  return channel.kind === 'channel' && channel.name !== null
    ? `${authorName} in #${channel.name}`
    : authorName;
}

/**
 * The flattened text, not the rich body. A notification is read in a strip on
 * a lock screen, and an attachment only message still has to say something.
 */
function previewOf(message: Message): string {
  const text = message.text.trim();
  if (text !== '') return text.length > 140 ? `${text.slice(0, 139)}…` : text;

  const first = message.attachments[0];
  if (!first) return 'Sent a message';
  if (first.kind === 'audio') return 'Sent a voice note';
  if (first.kind === 'image') return 'Sent an image';
  return `Sent ${first.name}`;
}
