// Messaging only. No fetch handler, offline cache, auth storage or client data.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const taskUrl = typeof data.url === 'string' && /^\/follow-ups\?task=[0-9a-f-]{36}$/.test(data.url) ? data.url : '/notifications';
  event.waitUntil(self.registration.showNotification('FIT Beyond Therapy Hub', {
    body: taskUrl.startsWith('/follow-ups') ? 'A scheduling follow-up needs attention' : 'Your Hub notification test',
    icon: '/icons/fit-hub-192.png', badge: '/icons/fit-hub-192.png',
    tag: typeof data.tag === 'string' ? data.tag : 'fit-scheduling', data: { url: taskUrl },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const u = new URL(event.notification.data?.url || '/notifications', self.location.origin);
  if (u.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(c => new URL(c.url).origin === self.location.origin);
    if (client) { await client.navigate(u.href); return client.focus(); }
    return self.clients.openWindow(u.href);
  })());
});
// Closing an OS notification never completes a Hub follow-up.