// scripts/offline.mjs supplies cache and paths for this exact production build.
const previousBuilds = async () => {
  const names = await caches.keys(),
    current = names.indexOf(cache);
  return current < 0
    ? []
    : names
        .slice(0, current)
        .filter((name) => /^turnmill-[0-9a-f]{14}$/.test(name));
};
const entryScripts = new Map();

async function releaseUnusedBuilds() {
  const old = await previousBuilds();
  if (!old.length) return;
  const windows = (
    await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  ).filter((client) => client.url.startsWith(self.registration.scope));
  const missing = windows.filter((client) => !entryScripts.has(client.id));
  if (missing.length) {
    // An older tab can still need its original lazy modules and geometry workers.
    for (const client of missing)
      client.postMessage({ type: "turnmill-request-entry" });
    return;
  }
  const entries = new Set(windows.map((client) => entryScripts.get(client.id)));
  for (const name of old) {
    const oldCache = await caches.open(name);
    const matches = await Promise.all(
      [...entries].map((entry) => oldCache.match(entry)),
    );
    if (!matches.some(Boolean)) await caches.delete(name);
  }
  const live = new Set(windows.map((client) => client.id));
  for (const id of entryScripts.keys())
    if (!live.has(id)) entryScripts.delete(id);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cache)
      .then((c) => c.addAll(paths))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim().then(releaseUnusedBuilds));
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "turnmill-entry" || !event.source?.id) return;
  const entry = new URL(event.data.url, self.registration.scope);
  if (entry.origin !== self.location.origin || !entry.pathname.endsWith(".js"))
    return;
  entryScripts.set(event.source.id, entry.href);
  event.waitUntil(releaseUnusedBuilds());
});
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const active = await caches.open(cache);
      const hit = await active.match(req, { ignoreVary: true });
      if (hit) return hit;
      if (req.mode === "navigate")
        return (await active.match("./index.html")) || fetch(req);
      if (url.pathname.includes("/assets/")) {
        for (const name of await previousBuilds()) {
          const prior = await caches.match(req, {
            cacheName: name,
            ignoreVary: true,
          });
          if (prior) return prior;
        }
      }
      return fetch(req);
    })(),
  );
});
