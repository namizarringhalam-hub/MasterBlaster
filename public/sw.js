const IMMUTABLE_CACHE = "blaster-immutable-v1";

function isImmutable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/assets/")
    || (url.pathname.startsWith("/audio/") && url.searchParams.has("bank"));
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys())
      .filter((key) => key.startsWith("blaster-") && key !== IMMUTABLE_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (!isImmutable(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(IMMUTABLE_CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  })());
});
