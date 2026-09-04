import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const handlers = {}, stored = new Map();
let downloads = 0, writes = 0, failOpen = false, failWrite = false, offline = false, html = false;
const cache = {
  match: async (request) => stored.get(request.url)?.clone(),
  delete: async (request) => stored.delete(request.url),
  async put(request, response) {
    if (failWrite) throw new Error("Quota exceeded");
    writes++;
    stored.set(request.url, response.clone());
  }
};
vm.runInNewContext(source, {
  URL, Map,
  self: { location: { origin: "https://game.test" }, addEventListener: (name, fn) => { handlers[name] = fn; } },
  caches: { async open() { if (failOpen) throw new Error("Storage disabled"); return cache; } },
  async fetch() {
    downloads++;
    if (offline) throw new Error("Offline");
    return new Response(html ? "<html>fallback</html>" : "export const loaded = true;", { headers: { "content-type": html ? "text/html" : "text/javascript" } });
  }
});
function request(path = "/assets/game-abc123.js", options) {
  const waits = [];
  let response;
  handlers.fetch({ request: new Request(`https://game.test${path}`, options), respondWith: (p) => { response = p; }, waitUntil: (p) => waits.push(p) });
  return { response, done: () => Promise.all(waits) };
}

const first = request(), overlapping = request(undefined, { cache: "force-cache" });
assert.equal(await (await first.response).text(), await (await overlapping.response).text(), "overlapping preload/playback callers each receive readable bodies");
await first.done(); await overlapping.done();
assert.equal(downloads, 1, "overlapping default preloads and force-cache playback download the asset once");
offline = true;
const warm = request();
assert.match(await (await warm.response).text(), /loaded/, "a warm asset works offline");
await warm.done();
assert.equal(downloads, 1, "warm assets need no network request");
assert.equal(writes, 1, "cache hits do not rewrite the same disk entry");
offline = false;
const repair = request(undefined, { cache: "reload" });
await repair.response; await repair.done();
assert.equal(downloads, 2, "explicit repair bypasses the cached entry");

for (const failure of ["read", "write"]) {
  failOpen = failure === "read"; failWrite = failure === "write";
  const uncached = request(`/assets/${failure}-abc123.js`);
  assert.match(await (await uncached.response).text(), /loaded/, `${failure} failures do not block asset delivery`);
  await uncached.done();
}
failOpen = failWrite = false;
html = true;
const missing = request("/assets/missing-abc123.js");
await missing.response; await missing.done();
assert.equal(stored.has("https://game.test/assets/missing-abc123.js"), false, "HTML fallbacks cannot poison an immutable script cache");
html = false;
stored.set("https://game.test/assets/stale-abc123.js", new Response("<html>old fallback</html>", { headers: { "content-type": "text/html" } }));
const stale = request("/assets/stale-abc123.js");
assert.match(await (await stale.response).text(), /loaded/, "invalid old cache entries self-heal");
await stale.done();

for (const [path, options] of [["/", {}], ["/api/health", {}], ["/assets/game-abc123.js", { method: "POST" }], ["/assets/game-abc123.js", { cache: "no-store" }], ["/audio/music/battle-drum.wav?bank=orchestra-2", { headers: { range: "bytes=0-100" } }]]) {
  assert.equal(request(path, options).response, undefined, `${path} ${JSON.stringify(options)} stays outside the immutable cache`);
}
console.log("Asset cache deduplication, warm reuse, repair, and storage-failure checks passed.");
