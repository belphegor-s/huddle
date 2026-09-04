import { describe, expect, it } from 'vitest';
import {
  createChannelKey,
  createDeviceKeys,
  decryptMessage,
  encryptMessage,
  openChannelKey,
  publishDevice,
  safetyNumber,
  sealChannelKey,
  type MessageBinding,
} from './e2ee.js';

const binding: MessageBinding = {
  channelId: 'channel-one',
  messageId: 'message-one',
  authorId: 'ada',
  epoch: 1,
};

async function member() {
  const keys = await createDeviceKeys();
  return { keys, bundle: await publishDevice(keys) };
}

describe('channel keys', () => {
  it('reaches the device it was sealed to', async () => {
    const ada = await member();
    const grace = await member();
    const key = await createChannelKey();

    const sealed = await sealChannelKey(key, grace.bundle, ada.keys);
    const opened = await openChannelKey(sealed, grace.keys, ada.bundle);

    const message = await encryptMessage(key, 'the meeting is at four', binding);
    expect(await decryptMessage(opened, message, binding)).toBe('the meeting is at four');
  });

  it('is useless to anybody else it was not sealed to', async () => {
    const ada = await member();
    const grace = await member();
    const mallory = await member();

    const sealed = await sealChannelKey(await createChannelKey(), grace.bundle, ada.keys);
    await expect(openChannelKey(sealed, mallory.keys, ada.bundle)).rejects.toThrow();
  });

  it('refuses a key that is not signed by the device it claims to be from', async () => {
    // The attack this stops is the server handing a member a key of its own,
    // then reading everything written afterwards.
    const ada = await member();
    const grace = await member();
    const mallory = await member();

    const substituted = await sealChannelKey(await createChannelKey(), grace.bundle, mallory.keys);

    await expect(openChannelKey(substituted, grace.keys, ada.bundle)).rejects.toThrow(
      /not signed by the device/,
    );
  });

  it('refuses a sealed key whose ciphertext was altered', async () => {
    const ada = await member();
    const grace = await member();
    const sealed = await sealChannelKey(await createChannelKey(), grace.bundle, ada.keys);

    const tampered = { ...sealed, ciphertext: flip(sealed.ciphertext) };
    await expect(openChannelKey(tampered, grace.keys, ada.bundle)).rejects.toThrow();
  });

  it('seals differently every time, so two seals never look alike', async () => {
    const ada = await member();
    const grace = await member();
    const key = await createChannelKey();

    const first = await sealChannelKey(key, grace.bundle, ada.keys);
    const second = await sealChannelKey(key, grace.bundle, ada.keys);

    expect(first.ephemeralKey).not.toBe(second.ephemeralKey);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
});

describe('messages', () => {
  it('comes back as it went in', async () => {
    const key = await createChannelKey();
    const text = 'unicode survives: cafe, 東京, 🙂';

    expect(await decryptMessage(key, await encryptMessage(key, text, binding), binding)).toBe(text);
  });

  it('never produces the same ciphertext twice for the same words', async () => {
    const key = await createChannelKey();
    const one = await encryptMessage(key, 'same words', binding);
    const two = await encryptMessage(key, 'same words', binding);

    expect(one.ciphertext).not.toBe(two.ciphertext);
    expect(one.iv).not.toBe(two.iv);
  });

  it('refuses a ciphertext moved to another channel', async () => {
    const key = await createChannelKey();
    const payload = await encryptMessage(key, 'private', binding);

    await expect(
      decryptMessage(key, payload, { ...binding, channelId: 'somewhere-else' }),
    ).rejects.toThrow();
  });

  it('refuses a ciphertext replayed as a different message', async () => {
    const key = await createChannelKey();
    const payload = await encryptMessage(key, 'private', binding);

    await expect(
      decryptMessage(key, payload, { ...binding, messageId: 'another' }),
    ).rejects.toThrow();
  });

  it('refuses a ciphertext attributed to somebody else', async () => {
    const key = await createChannelKey();
    const payload = await encryptMessage(key, 'private', binding);

    await expect(decryptMessage(key, payload, { ...binding, authorId: 'grace' })).rejects.toThrow();
  });

  it('refuses a ciphertext claimed to be from another epoch', async () => {
    const key = await createChannelKey();
    const payload = await encryptMessage(key, 'private', binding);

    await expect(decryptMessage(key, payload, { ...binding, epoch: 2 })).rejects.toThrow();
  });

  it('refuses a ciphertext whose bytes were changed', async () => {
    const key = await createChannelKey();
    const payload = await encryptMessage(key, 'private', binding);

    await expect(
      decryptMessage(key, { ...payload, ciphertext: flip(payload.ciphertext) }, binding),
    ).rejects.toThrow();
  });

  it('refuses the wrong key entirely', async () => {
    const payload = await encryptMessage(await createChannelKey(), 'private', binding);
    await expect(decryptMessage(await createChannelKey(), payload, binding)).rejects.toThrow();
  });
});

describe('safety number', () => {
  it('reads the same to both people, whichever way round', async () => {
    const ada = await member();
    const grace = await member();

    expect(await safetyNumber(ada.bundle, grace.bundle)).toBe(
      await safetyNumber(grace.bundle, ada.bundle),
    );
  });

  it('changes when one of the devices does', async () => {
    const ada = await member();
    const grace = await member();
    const replaced = await member();

    expect(await safetyNumber(ada.bundle, grace.bundle)).not.toBe(
      await safetyNumber(ada.bundle, replaced.bundle),
    );
  });

  it('is short enough to read aloud', async () => {
    const ada = await member();
    const grace = await member();
    const number = await safetyNumber(ada.bundle, grace.bundle);

    expect(number).toMatch(/^[0-9]{5}( [0-9]{5}){2}$/);
  });
});

/** Changes one byte, which is all an authenticated cipher needs to notice. */
function flip(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
