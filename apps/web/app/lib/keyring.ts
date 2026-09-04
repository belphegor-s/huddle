import {
  createChannelKey,
  decryptMessage,
  encryptMessage,
  openChannelKey,
  sealChannelKey,
  type DeviceRecord,
  type EncryptedPayload,
  type MessageBinding,
  type SealedChannelKey,
} from '@huddle/core';
import { api } from './api';
import { deviceIdentity } from './device';

/**
 * The channel keys this browser holds, and how they get here.
 *
 * A key arrives sealed to this device and is opened with the private half that
 * never left the machine. Once opened it stays in memory only: reloading the
 * page fetches and opens it again, so a key is never written anywhere it could
 * be read from.
 *
 * Distribution has no server side step, because the server has nothing to
 * seal. Anybody already holding a key seals it for whoever is missing it, and
 * that happens when a channel is opened.
 */

/** Opened keys, by channel and epoch. Never persisted. */
const opened = new Map<string, CryptoKey>();

const at = (channelId: string, epoch: number) => `${channelId}:${String(epoch)}`;

export class MissingKey extends Error {
  constructor(readonly channelId: string) {
    super('No key for this channel has reached this device yet.');
  }
}

/**
 * Loads every key this device can open for a channel, and seals the current
 * one for anybody still waiting.
 *
 * Called when a channel is opened. It is deliberately tolerant: a device that
 * cannot open anything yet is normal, and means somebody else has to be
 * looking at the channel before it can read.
 */
export async function syncChannelKeys(channelId: string, keyEpoch: number): Promise<void> {
  const identity = await deviceIdentity();
  const sealed = await api.channelKeys(channelId, identity.deviceId);
  if (sealed.length === 0) return;

  const senders = await api.channelDevices(channelId);
  const byId = new Map(senders.map((device) => [device.id, device]));

  for (const record of sealed) {
    if (opened.has(at(channelId, record.epoch))) continue;

    const sender = byId.get(record.sealedBy);
    if (!sender) continue;

    try {
      const key = await openChannelKey(
        JSON.parse(record.sealed) as SealedChannelKey,
        identity.keys,
        { encryptionKey: sender.encryptionKey, signingKey: sender.signingKey },
      );
      opened.set(at(channelId, record.epoch), key);
    } catch {
      // A key that will not open is one sealed by a device we cannot verify,
      // or to a device that is not this one. Neither is worth stopping for.
    }
  }

  await shareWithWaitingDevices(channelId, keyEpoch);
}

/**
 * Gets a channel to the point where it has a key here.
 *
 * A conversation reopened between the same two people is the same channel, so
 * this looks for an existing key before making one: minting a second would
 * leave everything said before it unreadable.
 */
export async function shareOrCreateKeyring(channelId: string, keyEpoch: number): Promise<void> {
  await syncChannelKeys(channelId, keyEpoch).catch(() => undefined);
  if (holdsKey(channelId, keyEpoch)) {
    await shareWithWaitingDevices(channelId, keyEpoch);
    return;
  }

  const identity = await deviceIdentity();
  const key = await createChannelKey();
  opened.set(at(channelId, keyEpoch), key);

  const devices = await api.channelDevices(channelId);
  await sealFor(channelId, keyEpoch, key, devices, identity.deviceId);
}

/** Seals the current key for any device in the channel that lacks one. */
export async function shareWithWaitingDevices(channelId: string, keyEpoch: number): Promise<void> {
  const key = opened.get(at(channelId, keyEpoch));
  if (!key) return;

  const waiting = await api.pendingKeyDevices(channelId);
  if (waiting.epoch !== keyEpoch || waiting.devices.length === 0) return;

  const identity = await deviceIdentity();
  await sealFor(channelId, keyEpoch, key, waiting.devices, identity.deviceId);
}

/**
 * A new key for a channel somebody has just left.
 *
 * The old one still opens what was said while they were there, which cannot be
 * helped: they could have kept the plaintext. What this buys is that anything
 * said afterwards is beyond it.
 */
export async function rotateKeyring(channelId: string, epoch: number): Promise<void> {
  const identity = await deviceIdentity();
  const key = await createChannelKey();
  opened.set(at(channelId, epoch), key);

  const devices = await api.channelDevices(channelId);
  await sealFor(channelId, epoch, key, devices, identity.deviceId);
}

export async function encryptBody(
  plaintext: string,
  binding: Omit<MessageBinding, 'epoch'> & { epoch: number },
): Promise<string> {
  const key = opened.get(at(binding.channelId, binding.epoch));
  if (!key) throw new MissingKey(binding.channelId);

  return JSON.stringify(await encryptMessage(key, plaintext, binding));
}

/**
 * Opens a body, or returns null when this device has no key for it.
 *
 * Null rather than a throw, because a message nobody here can read is a thing
 * the list has to draw rather than an error to swallow.
 */
export async function decryptBody(
  ciphertext: string,
  binding: MessageBinding,
): Promise<string | null> {
  const key = opened.get(at(binding.channelId, binding.epoch));
  if (!key) return null;

  try {
    return await decryptMessage(key, JSON.parse(ciphertext) as EncryptedPayload, binding);
  } catch {
    return null;
  }
}

export function holdsKey(channelId: string, epoch: number): boolean {
  return opened.has(at(channelId, epoch));
}

/** On sign out. The keys are gone until the next fetch, which needs a session. */
export function forgetKeys(): void {
  opened.clear();
}

async function sealFor(
  channelId: string,
  epoch: number,
  key: CryptoKey,
  devices: DeviceRecord[],
  sealedBy: string,
): Promise<void> {
  const identity = await deviceIdentity();

  const entries = await Promise.all(
    devices.map(async (device) => ({
      deviceId: device.id,
      sealed: JSON.stringify(
        await sealChannelKey(
          key,
          { encryptionKey: device.encryptionKey, signingKey: device.signingKey },
          identity.keys,
        ),
      ),
    })),
  );

  if (entries.length === 0) return;
  await api.publishChannelKeys(channelId, { epoch, sealedBy, entries });
}
