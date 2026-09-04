/**
 * The cryptography for end to end encrypted channels.
 *
 * Nothing here talks to a network or a database, and nothing here decides
 * policy. It is the set of operations the rest of the app builds on, kept in
 * one file so the security of the thing can be read in one sitting.
 *
 * The shape is sender keys, which is what suits a channel: one symmetric key
 * per channel per epoch, sealed once to each member's device, and every
 * message encrypted under it. The alternative, a pairwise ratchet to every
 * member, costs a copy of every message per recipient and buys forward secrecy
 * that a channel with scrollback cannot keep anyway.
 *
 * What this deliberately does not do is decide when to rekey, where to put a
 * private key, or what to show somebody whose device cannot read a message.
 * Those are the app's problems and they live with the app.
 *
 * Primitives are WebCrypto only, so this runs in a browser and in Node with no
 * dependency of any kind:
 *   identity      ECDH P-256 for sealing, ECDSA P-256 for signing
 *   key agreement ephemeral ECDH, so a stolen device key cannot open keys
 *                 sealed to it in the past
 *   derivation    HKDF-SHA-256
 *   content       AES-256-GCM, with the message's identity as associated data
 */

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** Twelve bytes is the size AES-GCM is defined for. Anything else is a footgun. */
const IV_BYTES = 12;

/** Domain separation, so a derived key can never be mistaken for another use. */
const SEAL_INFO = 'huddle/channel-key/v1';

/**
 * Declared here rather than taken from the DOM library, because this module is
 * imported by the server too and that has no DOM types. WebCrypto itself is
 * present in both.
 */
export interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

type Usage = 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'deriveKey' | 'deriveBits';

export interface DeviceKeys {
  /** Sealing. Other people encrypt channel keys to this. */
  encryption: KeyPair;
  /** Signing. Proves a sealed key came from who it claims. */
  signing: KeyPair;
}

/** What the server stores and hands to anybody who needs to reach this device. */
export interface DevicePublicBundle {
  encryptionKey: string;
  signingKey: string;
}

/** A channel key encrypted to exactly one device. Opaque to the server. */
export interface SealedChannelKey {
  /** The ephemeral public key the sender used, so the recipient can agree. */
  ephemeralKey: string;
  iv: string;
  ciphertext: string;
  /** Over everything above, by the sender's signing key. */
  signature: string;
}

/** An encrypted message body. The server stores this and never more. */
export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

/**
 * What a payload is bound to. Changing any of it makes the message refuse to
 * decrypt, which is what stops a ciphertext being lifted out of one message
 * and replayed as another.
 */
export interface MessageBinding {
  channelId: string;
  messageId: string;
  authorId: string;
  /** Which channel key this was encrypted under. Bumped on every rekey. */
  epoch: number;
}

/** An elliptic curve generateKey always yields a pair, but the type is a union. */
function asKeyPair(value: CryptoKey | KeyPair): KeyPair {
  if ('privateKey' in value) return value;
  throw new Error('Expected a key pair from generateKey.');
}

const subtle = () => {
  const web = globalThis.crypto?.subtle;
  if (!web) throw new Error('This environment has no WebCrypto, so encryption cannot be used.');
  return web;
};

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index);
  return out;
}

/**
 * Text as bytes over a buffer of their own. WebCrypto wants a plain
 * ArrayBuffer behind every view it is handed, and an encoder's output is not
 * guaranteed to have one.
 */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy;
}

/**
 * A device's long lived identity. The private halves are marked
 * non extractable, so even code running on the page cannot read them back out
 * once they are stored.
 */
export async function createDeviceKeys(): Promise<DeviceKeys> {
  const web = subtle();

  return {
    encryption: asKeyPair(await web.generateKey(CURVE, false, ['deriveKey', 'deriveBits'])),
    signing: asKeyPair(await web.generateKey(SIGNING, false, ['sign', 'verify'])),
  };
}

export async function publishDevice(keys: DeviceKeys): Promise<DevicePublicBundle> {
  const web = subtle();

  return {
    encryptionKey: toBase64(await web.exportKey('raw', keys.encryption.publicKey)),
    signingKey: toBase64(await web.exportKey('raw', keys.signing.publicKey)),
  };
}

async function importEncryptionKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromBase64(raw), CURVE, true, []);
}

async function importSigningKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromBase64(raw), SIGNING, true, ['verify']);
}

/** A fresh channel key. Everything in the channel for this epoch uses it. */
export async function createChannelKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * Shared secret to wrapping key. An ephemeral key pair is used for every seal,
 * so a device key that leaks later does not open the channel keys that were
 * sealed to it before.
 */
async function wrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  usage: Usage[],
): Promise<CryptoKey> {
  const web = subtle();
  const shared = await web.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);

  const material = await web.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return web.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(new ArrayBuffer(0)),
      info: bytesOf(SEAL_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export async function sealChannelKey(
  channelKey: CryptoKey,
  recipient: DevicePublicBundle,
  sender: DeviceKeys,
): Promise<SealedChannelKey> {
  const web = subtle();
  const ephemeral = asKeyPair(await web.generateKey(CURVE, true, ['deriveBits']));

  const wrapping = await wrappingKey(
    ephemeral.privateKey,
    await importEncryptionKey(recipient.encryptionKey),
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const raw = await web.exportKey('raw', channelKey);
  const ciphertext = await web.encrypt({ name: 'AES-GCM', iv }, wrapping, raw);
  const ephemeralKey = toBase64(await web.exportKey('raw', ephemeral.publicKey));

  const signature = await web.sign(
    SIGN_PARAMS,
    sender.signing.privateKey,
    signedBytes(ephemeralKey, toBase64(iv), toBase64(ciphertext)),
  );

  return {
    ephemeralKey,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    signature: toBase64(signature),
  };
}

/**
 * Opens a sealed channel key, refusing anything not signed by the device it
 * claims to come from. Without that check the server could hand a member a key
 * of its own choosing and read everything written afterwards.
 */
export async function openChannelKey(
  sealed: SealedChannelKey,
  recipient: DeviceKeys,
  sender: DevicePublicBundle,
): Promise<CryptoKey> {
  const web = subtle();

  const genuine = await web.verify(
    SIGN_PARAMS,
    await importSigningKey(sender.signingKey),
    fromBase64(sealed.signature),
    signedBytes(sealed.ephemeralKey, sealed.iv, sealed.ciphertext),
  );
  if (!genuine) throw new Error('This channel key was not signed by the device it claims.');

  const wrapping = await wrappingKey(
    recipient.encryption.privateKey,
    await importEncryptionKey(sealed.ephemeralKey),
    ['decrypt'],
  );

  const raw = await web.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
    wrapping,
    fromBase64(sealed.ciphertext),
  );

  return web.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
  binding: MessageBinding,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));

  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: bindingBytes(binding) },
    key,
    bytesOf(plaintext),
  );

  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptMessage(
  key: CryptoKey,
  payload: EncryptedPayload,
  binding: MessageBinding,
): Promise<string> {
  const plaintext = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(payload.iv),
      additionalData: bindingBytes(binding),
    },
    key,
    fromBase64(payload.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * The number two people read to each other to check nobody is in the middle.
 * Order independent, so both ends see the same thing without agreeing who
 * goes first.
 */
export async function safetyNumber(
  one: DevicePublicBundle,
  two: DevicePublicBundle,
): Promise<string> {
  const ordered = [fingerprintSource(one), fingerprintSource(two)].sort();
  const digest = await subtle().digest('SHA-256', bytesOf(ordered.join('|')));

  const digits = [...new Uint8Array(digest)]
    .slice(0, 15)
    .map((byte) => String(byte % 10))
    .join('');

  return (digits.match(/.{1,5}/g) ?? []).join(' ');
}

function fingerprintSource(bundle: DevicePublicBundle): string {
  return `${bundle.encryptionKey}.${bundle.signingKey}`;
}

function signedBytes(
  ephemeralKey: string,
  iv: string,
  ciphertext: string,
): Uint8Array<ArrayBuffer> {
  return bytesOf(`${SEAL_INFO}|${ephemeralKey}|${iv}|${ciphertext}`);
}

function bindingBytes(binding: MessageBinding): Uint8Array<ArrayBuffer> {
  // Every field that identifies the message, so a ciphertext cannot be moved
  // to another channel, another message, or another author and still open.
  return bytesOf(
    `${binding.channelId}|${binding.messageId}|${binding.authorId}|${String(binding.epoch)}`,
  );
}
