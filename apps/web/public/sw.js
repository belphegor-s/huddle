/*
 * The service worker exists for notifications, not for offline caching.
 *
 * A chat app that serves stale messages from a cache is worse than one that
 * says it is offline, and the reconnect delta already covers coming back from
 * a dead network. So there is no fetch handler here at all: every request goes
 * to the network exactly as it would without a worker.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'huddle', {
      body: payload.body ?? '',
      // One notification per channel: a burst of messages replaces itself
      // rather than stacking twenty entries on a lock screen.
      tag: payload.tag,
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/';

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Reuse a tab that already has the app rather than opening a second one.
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});
