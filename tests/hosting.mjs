import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
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
assert.match(await response.text(), /<title>Blaster Battle<\/title>/, "the deployed root serves the game shell");

for (const file of Object.values(MUSIC_SAMPLE_MANIFEST).flatMap((role) => role.files)) {
  const musicResponse = await worker.fetch(new Request(`https://example.test${file.url}?bank=${MUSIC_ASSET_REVISION}`), { ASSETS: clientAssets });
  assert.equal(musicResponse.status, 200, `${file.url} is included in the deployed client`);
  assert.equal(musicResponse.headers.get("content-type"), "audio/wav", `${file.url} is served as audio instead of the SPA fallback`);
  assert.equal(Buffer.from(await musicResponse.arrayBuffer()).subarray(0, 4).toString("ascii"), "RIFF", `${file.url} contains WAV bytes`);
}
console.log("Blaster Battle hosting check passed.");
