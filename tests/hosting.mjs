import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { MUSIC_ASSET_REVISION } from "../src/audio.js";
import { MUSIC_SAMPLE_MANIFEST } from "../src/musicScore.js";

const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".wav": "audio/wav"
};

const { default: worker } = await import(`../dist/server/index.js?test=${Date.now()}`);
const clientAssets = {
  async fetch(request) {
    try {
      const pathname = new URL(request.url).pathname;
      const data = await readFile(join("dist/client", pathname === "/" ? "__missing__" : pathname));
      return new Response(data, { headers: { "content-type": types[extname(pathname)] || "application/octet-stream" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
};
const response = await worker.fetch(new Request("https://example.test/"), { ASSETS: clientAssets });

assert.equal(response.status, 200, "the deployed root falls back to client/index.html");
assert.match(response.headers.get("cache-control"), /max-age=0/, "the HTML shell always revalidates so releases cannot become stale");
const deployedHtml = await response.text();
assert.match(deployedHtml, /<title>Blaster Battle<\/title>/, "the deployed root serves the game shell");
assert.match(deployedHtml, /data-boot-mode="quick"/, "the interactive menu shell is server-rendered before the deferred game engine executes");
assert.match(deployedHtml, /src="\/assets\//, "the production shell loads only its hashed boot module eagerly");

const assetNames = await readdir("dist/client/assets");
const jsAssets = assetNames.filter((name) => name.endsWith(".js"));
const cssAssets = assetNames.filter((name) => name.endsWith(".css"));
assert.ok(jsAssets.length >= 2, "the tiny boot module is split from the Three.js game engine");
const entryPath = deployedHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
assert.ok(entryPath, "the production shell references its hashed boot module");
const entryBytes = await readFile(join("dist/client", entryPath));
assert.ok(gzipSync(entryBytes).length < 12 * 1024, "the interactive boot module stays below a 12 KiB compressed budget");
const jsGzipSizes = await Promise.all(jsAssets.map(async (name) => gzipSync(await readFile(join("dist/client/assets", name))).length));
assert.ok(Math.max(...jsGzipSizes) < 380 * 1024, "the deferred engine stays below a 380 KiB compressed budget");
const cssGzipSizes = await Promise.all(cssAssets.map(async (name) => gzipSync(await readFile(join("dist/client/assets", name))).length));
assert.ok(Math.max(...cssGzipSizes) < 12 * 1024, "the complete visual treatment stays below a 12 KiB compressed CSS budget");
const assetResponse = await worker.fetch(new Request(`https://example.test${entryPath}`), { ASSETS: clientAssets });
assert.match(assetResponse.headers.get("cache-control"), /max-age=31536000, immutable/, "hashed engine assets remain local across fresh-renderer match reloads");

const audioNames = await readdir("dist/client/audio/music");
const audioBytes = (await Promise.all(audioNames.map((name) => readFile(join("dist/client/audio/music", name))))).reduce((sum, bytes) => sum + bytes.length, 0);
assert.ok(audioBytes < 4.7 * 1024 * 1024, "the lossless recorded score stays inside its network budget");

for (const file of Object.values(MUSIC_SAMPLE_MANIFEST).flatMap((role) => role.files)) {
  const musicResponse = await worker.fetch(new Request(`https://example.test${file.url}?bank=${MUSIC_ASSET_REVISION}`), { ASSETS: clientAssets });
  assert.equal(musicResponse.status, 200, `${file.url} is included in the deployed client`);
  assert.equal(musicResponse.headers.get("content-type"), "audio/wav", `${file.url} is served as audio instead of the SPA fallback`);
  assert.match(musicResponse.headers.get("cache-control"), /max-age=31536000, immutable/, `${file.url} is reused without a network revalidation on later matches`);
  assert.equal(Buffer.from(await musicResponse.arrayBuffer()).subarray(0, 4).toString("ascii"), "RIFF", `${file.url} contains WAV bytes`);
}
console.log("Blaster Battle hosting check passed.");
