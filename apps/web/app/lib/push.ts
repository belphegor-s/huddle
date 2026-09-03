import { api } from './api';

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

/**
 * Web Push, which needs no app store account on either side. The permission
 * prompt is never fired on page load: it is asked for only when someone turns
 * notifications on, because a prompt nobody asked for is a prompt everybody
 * denies, and a denial is permanent.
 */
export async function currentPushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';

  const { available } = await api.pushKey().catch(() => ({ available: false, publicKey: '' }));
  if (!available) return 'unavailable';

  if (Notification.permission === 'denied') return 'denied';

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';

  const { available, publicKey } = await api.pushKey();
  if (!available) return 'unavailable';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    // Web Push allows silent pushes, browsers do not. Every push this app
    // sends shows a notification, so declaring it is honest.
    userVisibleOnly: true,
    applicationServerKey: decodeKey(publicKey),
  });

  await api.subscribePush(subscription.toJSON() as PushSubscriptionJSON);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'off';

  await api.unsubscribePush(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
  return 'off';
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The VAPID key travels as base64url and the browser wants raw bytes. */
function decodeKey(base64Url: string): ArrayBuffer {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));

  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  return buffer;
}
