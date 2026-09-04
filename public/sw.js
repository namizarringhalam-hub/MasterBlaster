const IMMUTABLE_CACHE = "blaster-immutable-v1";
const inFlight = new Map();

function isImmutable(request) {
  if (request.method !== "GET" || request.cache === "no-store" || request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/assets/")
    || (url.pathname.startsWith("/audio/") && url.searchParams.has("bank"));
}

function isAssetResponse(request, response) {
  if (response.status !== 200) return false;
  const type = response.headers.get("content-type") || "";
  const path = new URL(request.url).pathname;
  if (path.endsWith(".js")) return /(?:javascript|ecmascript)/i.test(type);
  if (path.endsWith(".css")) return /text\/css/i.test(type);
  if (path.startsWith("/audio/")) return /^audio\//i.test(type);
  return !/text\/html/i.test(type);
}

async function loadAsset(request) {
  let cache;
  try {
    cache = await caches.open(IMMUTABLE_CACHE);
    if (request.cache !== "reload" && request.cache !== "no-cache") {
      const cached = await cache.match(request);
      if (cached && isAssetResponse(request, cached)) return { response: cached };
      if (cached) await cache.delete(request);
    }
  } catch { /* Cache storage is optional, including in private browsing. */ }
  return { response: await fetch(request), cache };
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
  const mode = ["reload", "no-cache"].includes(event.request.cache) ? event.request.cache : "reuse";
  const key = `${mode}:${event.request.url}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = loadAsset(event.request);
    inFlight.set(key, pending);
    // Keep one download alive until its cache write finishes; every consumer
    // receives its own response body. A failed cache write never blocks play.
    event.waitUntil(pending.then(async ({ response, cache }) => {
      if (cache && isAssetResponse(event.request, response)) await cache.put(event.request, response.clone());
    }).catch(() => {}).finally(() => inFlight.delete(key)));
  }
  event.respondWith(pending.then(({ response }) => response.clone()));
});
