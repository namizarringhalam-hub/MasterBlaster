import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hash, writeResourceRelease } from "../scripts/resource-build.mjs";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const handlers = {}, stored = new Map();
let downloads = 0, writes = 0, failOpen = false, failWrite = false, offline = false, html = false;
let htmlContent = "<html>fallback</html>";
const cacheKey = request => typeof request === "string" ? request : request.url;
const cache = {
  match: async (request) => stored.get(cacheKey(request))?.clone(),
  delete: async (request) => stored.delete(cacheKey(request)),
  async put(request, response) {
    if (failWrite) throw new Error("Quota exceeded");
    writes++;
    stored.set(cacheKey(request), response.clone());
  }
};
vm.runInNewContext(source, {
  URL, Map, Request,
  self: { location: { origin: "https://game.test" }, addEventListener: (name, fn) => { handlers[name] = fn; } },
  caches: { async open() { if (failOpen) throw new Error("Storage disabled"); return cache; } },
  async fetch() {
    downloads++;
    if (offline) throw new Error("Offline");
    return new Response(html ? htmlContent : "export const loaded = true;", { headers: { "content-type": html ? "text/html" : "text/javascript" } });
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

function navigate(path = "/") {
  let response;
  handlers.fetch({ request: { url: `https://game.test${path}`, method: "GET", mode: "navigate" }, respondWith: (p) => { response = p; } });
  return response;
}
html = true;
assert.match(await (await navigate()).text(), /<html>/);
offline = true;
assert.match(await (await navigate()).text(), /<html>/, "cached navigation supports offline launch and rematches");
assert.match(await (await navigate("/quick-play")).text(), /<html>/, "journey paths keep the same offline shell fallback");
offline = false;
html = false;
await navigate();
offline = true;
assert.match(await (await navigate()).text(), /<html>/, "non-HTML responses never replace the offline page");
console.log("Offline shell fallback and online navigation refresh passed.");

// The linked guide belongs to the complete offline release at its navigation URL.
const guideHtml = await readFile("public/how-to-play/index.html", "utf8");
const releaseDir = await mkdtemp(join(tmpdir(), "blaster-guide-cache-"));
try {
  await Promise.all(["assets", "resources", "how-to-play"].map(path => mkdir(join(releaseDir, path))));
  await writeFile(join(releaseDir, "how-to-play/index.html"), guideHtml);
  await writeFile(join(releaseDir, "index.html"), "<html>Game release</html>");
  await writeFile(join(releaseDir, "manifest.webmanifest"), "{}");
  const version = "a".repeat(64);
  await writeResourceRelease(releaseDir, { version, copies: new Map() });
  const manifest = JSON.parse(await readFile(join(releaseDir, "resources.json"), "utf8"));
  const guideEntry = manifest.entries.find(entry => entry.url === "/how-to-play/index.html");
  assert.ok(guideEntry, "offline release includes the guide at its stable URL");
  assert.equal(guideEntry.bytes, Buffer.byteLength(guideHtml));
  assert.equal(guideEntry.sha256, hash(guideHtml), "offline guide bytes are integrity checked with the release");

  offline = false; html = true; htmlContent = guideHtml;
  await navigate("/how-to-play/");
  offline = true;
  assert.equal(await (await navigate()).text(), "<html>fallback</html>", "visiting the guide never replaces the legacy game fallback");
  stored.set("https://game.test/active-release", new Response(version));
  stored.set("https://game.test/index.html", new Response("<html>Game release</html>"));
  stored.set(`https://game.test${guideEntry.url}`, new Response(guideHtml));
  for (const path of ["/how-to-play/", "/how-to-play", "/how-to-play/index.html"]) {
    assert.equal(await (await navigate(path)).text(), guideHtml, `${path} returns the real guide offline`);
  }
  assert.equal(await (await navigate("/game")).text(), "<html>Game release</html>", "game screen journeys retain the complete offline game shell");
} finally {
  await rm(releaseDir, { recursive: true, force: true });
}
console.log("Guide release URL/hash, offline guide navigation and preserved game fallback passed.");
