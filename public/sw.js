const IMMUTABLE_CACHE = "blaster-immutable-v1";
const SHELL_CACHE = "blaster-shell-v1";
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

async function loadShell(request) {
  const key = new Request(`${self.location.origin}/`);
  try {
    const response = await fetch(request);
    if (response.ok && /text\/html/i.test(response.headers.get("content-type") || "")) {
      try { await (await caches.open(SHELL_CACHE)).put(key, response.clone()); } catch {}
    }
    return response;
  } catch (error) {
    const cached = await (await caches.open(SHELL_CACHE)).match(key);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(loadShell(new Request(`${self.location.origin}/`)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys())
      .filter((key) => key.startsWith("blaster-") && key !== IMMUTABLE_CACHE && key !== SHELL_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "GET" && event.request.mode === "navigate" &&
      url.origin === self.location.origin && ["/", "/index.html"].includes(url.pathname)) {
    event.respondWith(loadShell(event.request));
    return;
  }
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
