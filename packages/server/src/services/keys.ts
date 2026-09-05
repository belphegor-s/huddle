import { err, ok, ulid, type DeviceRecord, type Result, type SealedKeyRecord } from '@huddle/core';
import { channelKeys, channelMembers, channels, devices, memberships } from '@huddle/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { requireChannel, type ChannelError } from './channels.js';

/**
 * Devices and the sealed channel keys that reach them.
 *
 * Everything here is storage and delivery. The server never sees a channel key
 * or a private key, and it cannot: a sealed key is opaque and the signature on
 * it is checked by the recipient, so handing somebody a key of the server's
 * own choosing does not work.
 *
 * What the server does enforce is who may ask for what. A sealed key is only
 * ever served to the device it was sealed to, and only sealed keys for
 * channels the owner can reach are served at all.
 */

export type KeyError = ChannelError | 'unknown_device' | 'stale_epoch';

export async function registerDevice(
  ctx: AppContext,
  input: { userId: string; encryptionKey: string; signingKey: string; label: string | null },
): Promise<DeviceRecord> {
  const now = ctx.now();

  // A device is identified by its keys. The same browser signing in again is
  // the same device, and registering twice must not scatter duplicates that
  // every future channel key then has to be sealed to.
  const existing = await ctx.db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.userId, input.userId),
        eq(devices.encryptionKey, input.encryptionKey),
        eq(devices.signingKey, input.signingKey),
      ),
    )
    .limit(1);

  const found = existing[0];
  if (found) {
    await ctx.db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, found.id));
    return toDevice(found);
  }

  const created = await ctx.db
    .insert(devices)
    .values({
      id: ulid(now),
      userId: input.userId,
      encryptionKey: input.encryptionKey,
      signingKey: input.signingKey,
      label: input.label,
      createdAt: now,
      lastSeenAt: now,
    })
    .returning();

  const row = created[0];
  if (!row) throw new Error('The device was not stored');

  return toDevice(row);
}

/**
 * Who may hold this channel's key, as a query over devices.
 *
 * It follows read access rather than membership. A public channel is readable
 * by everyone in the workspace, who can join it with one click and be handed
 * the key anyway, so withholding it from a person reading the channel buys
 * nothing and leaves them looking at a wall of ciphertext. A private channel
 * and a direct message are the opposite: only the people actually in them.
 */
function readersOf(
  ctx: AppContext,
  channel: { id: string; workspaceId: string; isPrivate: boolean; kind: string },
) {
  if (channel.isPrivate || channel.kind !== 'channel') {
    return ctx.db
      .select({ device: devices })
      .from(channelMembers)
      .innerJoin(devices, eq(devices.userId, channelMembers.userId))
      .where(eq(channelMembers.channelId, channel.id));
  }

  return ctx.db
    .select({ device: devices })
    .from(memberships)
    .innerJoin(devices, eq(devices.userId, memberships.userId))
    .where(eq(memberships.workspaceId, channel.workspaceId));
}

/** Every device that may hold this channel's key, so keys can be sealed. */
export async function channelDevices(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<DeviceRecord[], KeyError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const rows = await readersOf(ctx, access.value.channel);

  return ok(rows.map((row) => toDevice(row.device)));
}

/**
 * Devices that may read this channel and have no key for the current epoch.
 *
 * Anybody already holding the key can seal it for them, which is how a person
 * who joins after a channel was made ever gets in. There is no server side
 * step: it cannot help, because it has nothing to seal.
 */
export async function devicesAwaitingKeys(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<{ epoch: number; devices: DeviceRecord[] }, KeyError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const epoch = access.value.channel.keyEpoch;

  const held = await ctx.db
    .select({ id: channelKeys.deviceId })
    .from(channelKeys)
    .where(and(eq(channelKeys.channelId, input.channelId), eq(channelKeys.epoch, epoch)));

  const heldBy = new Set(held.map((row) => row.id));

  const rows = await readersOf(ctx, access.value.channel);
  const waiting = rows.filter((row) => !heldBy.has(row.device.id));

  return ok({ epoch, devices: waiting.map((row) => toDevice(row.device)) });
}

/**
 * Stores sealed keys. The caller must be in the channel, and every device
 * sealed for must be too: without that check anybody in a workspace could have
 * a key delivered to a device of their own choosing.
 */
export async function publishChannelKeys(
  ctx: AppContext,
  input: {
    channelId: string;
    userId: string;
    epoch: number;
    sealedBy: string;
    entries: { deviceId: string; sealed: string }[];
  },
): Promise<Result<number, KeyError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  // Sealing for an epoch that is no longer current would hand out a key to a
  // conversation that has already moved past it.
  if (input.epoch !== access.value.channel.keyEpoch) return err('stale_epoch');

  const allowed = await channelDevices(ctx, { channelId: input.channelId, userId: input.userId });
  if (!allowed.ok) return err(allowed.error);

  const inChannel = new Set(allowed.value.map((device) => device.id));
  const mine = allowed.value.find((device) => device.id === input.sealedBy);

  if (!mine || mine.userId !== input.userId) return err('unknown_device');
  if (input.entries.some((entry) => !inChannel.has(entry.deviceId))) return err('forbidden');

  const now = ctx.now();
  await ctx.db
    .insert(channelKeys)
    .values(
      input.entries.map((entry) => ({
        channelId: input.channelId,
        epoch: input.epoch,
        deviceId: entry.deviceId,
        sealed: entry.sealed,
        sealedBy: input.sealedBy,
        createdAt: now,
      })),
    )
    // Two people can seal for the same newcomer at once. Either key opens the
    // channel, so the first to land wins and the second is not an error.
    .onConflictDoNothing();

  return ok(input.entries.length);
}

/** Every sealed key this device can open, for one channel. */
export async function fetchChannelKeys(
  ctx: AppContext,
  input: { channelId: string; userId: string; deviceId: string },
): Promise<Result<SealedKeyRecord[], KeyError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const owns = await ctx.db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, input.deviceId), eq(devices.userId, input.userId)))
    .limit(1);

  if (!owns[0]) return err('unknown_device');

  const rows = await ctx.db
    .select()
    .from(channelKeys)
    .where(
      and(eq(channelKeys.channelId, input.channelId), eq(channelKeys.deviceId, input.deviceId)),
    );

  return ok(
    rows.map((row) => ({
      channelId: row.channelId,
      epoch: row.epoch,
      deviceId: row.deviceId,
      sealed: row.sealed,
      sealedBy: row.sealedBy,
    })),
  );
}

/**
 * Moves the channel to a new key.
 *
 * Called when somebody leaves or is removed. Old messages stay readable by
 * whoever already had the old key, which is unavoidable: they could have kept
 * a copy of the plaintext anyway. What this buys is that everything said
 * afterwards is beyond the key they hold.
 */
export async function rotateChannelKey(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<number, KeyError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (!access.value.channel.encrypted) return ok(access.value.channel.keyEpoch);

  const updated = await ctx.db
    .update(channels)
    .set({ keyEpoch: sql`${channels.keyEpoch} + 1` })
    .where(eq(channels.id, input.channelId))
    .returning({ keyEpoch: channels.keyEpoch });

  const epoch = updated[0]?.keyEpoch;
  if (epoch === undefined) return err('not_found');

  return ok(epoch);
}

/** Drops the keys of devices that are no longer in the channel. */
export async function revokeKeysForUser(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<void> {
  const theirs = ctx.db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.userId, input.userId));

  await ctx.db
    .delete(channelKeys)
    .where(and(eq(channelKeys.channelId, input.channelId), inArray(channelKeys.deviceId, theirs)));
}

function toDevice(row: {
  id: string;
  userId: string;
  encryptionKey: string;
  signingKey: string;
  label: string | null;
}): DeviceRecord {
  return {
    id: row.id,
    userId: row.userId,
    encryptionKey: row.encryptionKey,
    signingKey: row.signingKey,
    label: row.label,
  };
}
