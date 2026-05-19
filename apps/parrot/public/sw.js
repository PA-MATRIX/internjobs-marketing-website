// v1.2 Phase 13 Wave 1: Parrot service worker.
//
// Scope: push event handling + notificationclick navigation.
// INTENTIONALLY does not intercept fetch events or cache any assets.
// React Router / Vite handle their own asset versioning; hijacking
// their cache strategy would cause stale-bundle pain.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
	let data = { title: 'Parrot', body: 'New activity in your workspace', url: '/' };
	try {
		if (event.data) data = { ...data, ...event.data.json() };
	} catch {
		/* malformed payload — use defaults */
	}

	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body,
			icon: '/favicon.ico',
			badge: '/favicon.ico',
			data: { url: data.url },
			tag: data.event_type || 'parrot',
			renotify: true,
		}),
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data && event.notification.data.url) || '/';
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((windowClients) => {
				for (const client of windowClients) {
					if (client.url.includes(self.location.origin) && 'focus' in client) {
						if ('navigate' in client) client.navigate(url);
						return client.focus();
					}
				}
				if (self.clients.openWindow) return self.clients.openWindow(url);
			}),
	);
});
