import {
  createDeviceKeys,
  publishDevice,
  type DeviceKeys,
  type DevicePublicBundle,
} from '@huddle/core';
import { api } from './api';

/**
 * This browser's encryption identity.
 *
 * The private halves are generated non extractable and stored in IndexedDB as
 * CryptoKey objects rather than as bytes. Even code running on this page
 * cannot read them back out: it can ask the browser to use them, and that is
 * all. Nothing here is ever sent anywhere, and the server only learns the
 * public halves.
 *
 * Losing them means losing the ability to read encrypted channels on this
 * machine, which is the deal end to end encryption makes. Another device that
 * still holds the key seals it again for a new one.
 */

const DATABASE = 'huddle-keys';
const STORE = 'device';
const RECORD = 'identity';

interface StoredIdentity {
  keys: DeviceKeys;
  /** What the server called this device once it was registered. */
  deviceId: string;
}

let cached: Promise<StoredIdentity> | null = null;

export function deviceIdentity(): Promise<StoredIdentity> {
  cached ??= loadOrCreate();
  return cached;
}

/** For a sign out: the next person at this machine gets their own identity. */
export async function forgetDevice(): Promise<void> {
  cached = null;
  const database = await open();
  await request(database.transaction(STORE, 'readwrite').objectStore(STORE).delete(RECORD));
  database.close();
}

async function loadOrCreate(): Promise<StoredIdentity> {
  const database = await open();

  const existing = await request<StoredIdentity | undefined>(
    database.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD),
  );

  if (existing) {
    database.close();
    // Registering again is how the server learns this device is still around,
    // and it returns the same id because a device is its keys.
    await register(existing.keys);
    return existing;
  }

  const keys = await createDeviceKeys();
  const deviceId = await register(keys);
  const identity: StoredIdentity = { keys, deviceId };

  await request(database.transaction(STORE, 'readwrite').objectStore(STORE).put(identity, RECORD));
  database.close();

  return identity;
}

async function register(keys: DeviceKeys): Promise<string> {
  const bundle = await publishDevice(keys);
  const device = await api.registerDevice({ ...bundle, label: describeBrowser() });
  return device.id;
}

export async function publicBundleOf(keys: DeviceKeys): Promise<DevicePublicBundle> {
  return publishDevice(keys);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);

    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE)) opening.result.createObjectStore(STORE);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('IndexedDB refused to open'));
  });
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB request failed'));
  });
}

/** Enough for somebody to recognise a device in a list, and nothing more. */
function describeBrowser(): string {
  const agent = navigator.userAgent;
  const browser = /Firefox|Edg|Chrome|Safari/.exec(agent)?.[0] ?? 'Browser';
  const platform = /Windows|Macintosh|Linux|Android|iPhone|iPad/.exec(agent)?.[0] ?? 'device';

  return `${browser} on ${platform}`;
}
