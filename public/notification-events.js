/* Loaded by the generated offline worker. No timers: browsers may stop workers at any time. */
self.addEventListener('notificationclick', (event) => {
  if (event.notification.tag !== 'ironpath-rest-finished') return;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const requested = new URL(
        event.notification.data?.url || './#/workout',
        self.registration.scope,
      );
      const scope = new URL(self.registration.scope);
      const url =
        requested.origin === scope.origin && requested.pathname.startsWith(scope.pathname)
          ? requested.href
          : new URL('./#/workout', scope).href;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) {
        existing.postMessage({ type: 'IRONPATH_REST_NOTIFICATION', url });
        await existing.focus();
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
