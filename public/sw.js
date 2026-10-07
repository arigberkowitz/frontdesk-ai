/*
 * FrontDesk portal service worker — phone notifications only.
 *
 * Deliberately no fetch handler and no caching: the portal is live business
 * data behind a sign-in, and a cached page is a stale (or another user's)
 * page. This worker only shows notifications the server pushes and opens the
 * right portal page when one is tapped. Registered with scope /portal from
 * Settings → Alerts. Served with Cache-Control: no-cache (next.config.ts) so
 * an update reaches phones on the next visit.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safePortalUrl(raw) {
  try {
    const url = new URL(raw || "/portal", self.location.origin);
    if (url.origin !== self.location.origin) return "/portal";
    if (url.pathname !== "/portal" && !url.pathname.startsWith("/portal/")) return "/portal";
    return url.pathname + url.search;
  } catch {
    return "/portal";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "FrontDesk", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "FrontDesk";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: safePortalUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safePortalUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        const url = new URL(client.url);
        if (url.origin === self.location.origin && url.pathname.startsWith("/portal")) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The browser can rotate a subscription on its own. The old endpoint stops
// working; the owner re-enables from Settings → Alerts (the card notices the
// mismatch). Nothing to do here without an authenticated endpoint to call.
self.addEventListener("pushsubscriptionchange", () => {});
