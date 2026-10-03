const IMMUTABLE_CACHE = "blaster-immutable-v1";
const SHELL_CACHE = "blaster-shell-v1";
const inFlight = new Map();

function isImmutable(request) {
  if (request.method !== "GET" || request.cache === "no-store" || request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/resources/")
    || /^\/resources-[a-f0-9]+\.json$/.test(url.pathname);
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
  const guide = /^\/how-to-play(?:\/index\.html|\/)?$/.test(new URL(request.url).pathname);
  const page = guide ? "/how-to-play/index.html" : "/index.html";
  const key = new Request(`${self.location.origin}${guide ? page : "/"}`);
  try {
    // Refresh always revalidates the shell, which selects the current release.
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok && /text\/html/i.test(response.headers.get("content-type") || "")) {
      // A versioned shell becomes an offline fallback only with a complete release.
      if (!(await response.clone().text()).includes('name="blaster-release"')) {
        try { await (await caches.open(SHELL_CACHE)).put(key, response.clone()); } catch {}
      }
    }
    return response;
  } catch (error) {
    try {
      const pointer = await (await caches.open("blaster-releases")).match(`${self.location.origin}/active-release`);
      const version = pointer && await pointer.text();
      if (version) {
        const shell = await (await caches.open(`blaster-release-${version}`)).match(`${self.location.origin}${page}`);
        if (shell) return shell;
      }
    } catch {}
    const cached = await (await caches.open(SHELL_CACHE)).match(key);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Activation cannot delete resources still in use by an older tab.
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "GET" && event.request.mode === "navigate" &&
      url.origin === self.location.origin) {
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

const preparations = new Map();
let promotion = Promise.resolve();
self.addEventListener("message", event => {
  if (event.data?.type !== "PREPARE_RELEASE" || !/^[a-f0-9]{64}$/.test(event.data.version)) return;
  const { version } = event.data, port = event.ports[0];
  if (!port) return;
  let task = preparations.get(version);
  if (!task) {
    task = { ports: new Set(), state: { type: "progress", complete: 0, total: 0 } };
    preparations.set(version, task);
    task.promise = prepareRelease(version, state => {
      task.state = state;
      for (const listener of task.ports) listener.postMessage(state);
    }).finally(() => preparations.delete(version));
  }
  task.ports.add(port);
  port.postMessage(task.state);
  event.waitUntil(task.promise);
});

async function prepareRelease(version, report) {
  let persistent = true, staging;
  try {
    const manifestRequest = new Request(`${self.location.origin}/resources-${version}.json`);
    let manifestResponse, manifest;
    // Repair cached metadata as well as resource bytes. Never retry a broken
    // entry from the same cache, and bound recovery to one fresh download.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt) report({ type: "progress", complete: 0, total: 0 });
        const request = new Request(manifestRequest, { cache: attempt ? "reload" : "default", signal: AbortSignal.timeout(45000) });
        manifestResponse = (await loadAsset(request)).response;
        if (!manifestResponse.ok) throw new Error(`Release manifest unavailable (HTTP ${manifestResponse.status})`);
        manifest = await manifestResponse.clone().json();
        if (manifest.version !== version || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error("Invalid release manifest");
        break;
      } catch (error) { if (attempt) throw error; }
    }
    try {
      staging = await caches.open(`blaster-release-${version}`);
      await (await caches.open(IMMUTABLE_CACHE)).put(manifestRequest, manifestResponse.clone());
    } catch { persistent = false; }
    let complete = 0;
    const total = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    report({ type: "progress", complete, total });
    const queue = [...manifest.entries];
    const digest = async data => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), byte => byte.toString(16).padStart(2, "0")).join("");
    async function save() {
      while (queue.length) {
        const entry = queue.shift();
        if (!entry.url.startsWith("/") || entry.url.startsWith("//") || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid resource entry");
        const request = new Request(`${self.location.origin}${entry.url}`);
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt) report({ type: "progress", complete, total });
            const download = new Request(request, { cache: attempt ? "reload" : "default", signal: AbortSignal.timeout(45000) });
            response = attempt ? await fetch(download) : isImmutable(request) ? (await loadAsset(download)).response
              : await staging?.match(request) || await fetch(new Request(download, { cache: "reload" }));
            if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
            const bytes = await response.clone().arrayBuffer();
            if (bytes.byteLength !== entry.bytes || await digest(bytes) !== entry.sha256) throw new Error("Resource version mismatch");
            break;
          } catch (error) {
            if (attempt) throw new Error(`${entry.url.split("/").pop()}: ${error.message}`);
          }
        }
        try {
          const target = isImmutable(request) ? await caches.open(IMMUTABLE_CACHE) : staging;
          if (!target) throw new Error("Storage unavailable");
          await target.put(request, response);
        } catch { persistent = false; }
        complete += entry.bytes;
        report({ type: "progress", complete, total });
      }
    }
    const results = await Promise.allSettled([save(), save()]);
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    if (!manifest.entries.some(entry => entry.url === "/index.html")) throw new Error("Missing release shell");
    if (persistent) {
      try {
        await (promotion = promotion.catch(() => {}).then(async () => {
          const metadata = await caches.open("blaster-releases");
          const previous = await metadata.match(`${self.location.origin}/active-release`);
          const previousVersion = previous && await previous.text();
          let promote = !previousVersion || previousVersion === version;
          if (!promote) {
            try {
              const latest = await fetch(new Request(`${self.location.origin}/resources.json`, { cache: "no-store", signal: AbortSignal.timeout(10000) }));
              promote = latest.ok && (await latest.json()).version === version;
            } catch { /* An old/offline tab cannot roll the active release back. */ }
          }
          if (promote) await metadata.put(`${self.location.origin}/active-release`, new Response(version));
        }));
      } catch { persistent = false; }
    }
    report({ type: "complete", persistent, complete, total });
  } catch (error) { report({ type: "failed", error: error.message || "Resource download incomplete" }); }
}
