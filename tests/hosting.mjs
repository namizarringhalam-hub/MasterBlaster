import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { MUSIC_ASSET_REVISION } from "../src/audio.js";
import { MUSIC_SAMPLE_MANIFEST } from "../src/musicScore.js";
import { PLAYER_TEXT } from "../PLAYER_TEXT.js";

const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".txt": "text/plain",
  ".xml": "application/xml"
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
assert.ok(deployedHtml.includes(`<title>${PLAYER_TEXT.site.searchTitle}</title>`), "the search title describes the game without changing its installed name");
assert.match(deployedHtml, /<meta property="og:title" content="Master Blaster — Neon Arena Shooter"/, "shared links use the Master Blaster title");
assert.match(deployedHtml, /<link rel="canonical" href="https:\/\/masterblaster\.se\/"/, "the public domain is canonical");
assert.match(deployedHtml, /<meta property="og:url" content="https:\/\/masterblaster\.se\/"/, "shared links identify the public domain");
assert.match(deployedHtml, /<meta property="og:image" content="https:\/\/masterblaster\.se\/og\.png"/, "social crawlers receive an absolute preview image URL");
assert.ok(deployedHtml.includes(`<meta name="description" content="${PLAYER_TEXT.site.description}"`), "search and social metadata use the editable description");
assert.match(deployedHtml, /<span>MASTER<\/span><b>BLASTER<\/b>/, "the server-rendered menu uses the Master Blaster brand");
assert.doesNotMatch(deployedHtml, /Blaster Battle/i, "the deployed shell contains no retired title");
assert.match(deployedHtml, /data-boot-mode="quick"/, "the interactive menu shell is server-rendered before the deferred game engine executes");
assert.match(deployedHtml, /src="\/assets\//, "the production shell loads only its hashed boot module eagerly");
assert.doesNotMatch(deployedHtml, /\{\{[a-zA-Z0-9_.]+\}\}|noindex/, "crawlers receive rendered, indexable HTML");
assert.ok(deployedHtml.includes(`<p class="lead">${PLAYER_TEXT.landing.lead}</p>`), "the game description is readable without JavaScript");
const schema = JSON.parse(deployedHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]);
assert.equal(schema["@context"], "https://schema.org");
const game = schema["@graph"].find(item => item["@type"] === "VideoGame");
assert.equal(game.name, PLAYER_TEXT.site.title);
assert.equal(game.description, PLAYER_TEXT.site.description);
assert.equal(game.url, "https://masterblaster.se/");
assert.equal(game.isAccessibleForFree, true);
for (const [file, type, content] of [
  ["robots.txt", "text/plain", /Sitemap: https:\/\/masterblaster\.se\/sitemap\.xml/],
  ["sitemap.xml", "application/xml", /<loc>https:\/\/masterblaster\.se\/<\/loc>/]
]) {
  const crawlerResponse = await worker.fetch(new Request(`https://example.test/${file}`), { ASSETS: clientAssets });
  assert.equal(crawlerResponse.status, 200, `${file} is deployed`);
  assert.equal(crawlerResponse.headers.get("content-type"), type, `${file} is not an HTML fallback`);
  const body = await crawlerResponse.text();
  assert.match(body, content);
  assert.equal(body, await readFile(`dist/${file}`, "utf8"), `${file} matches in both hosting layouts`);
}

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
assert.ok(jsAssets.some((name) => name.startsWith("three-")), "the rendering library has its own reusable versioned chunk");
assert.doesNotMatch(deployedHtml, /modulepreload[^>]*three-/, "the rendering library remains deferred behind the lightweight menu shell");
const redirectedAsset = await worker.fetch(new Request(`https://example.test${entryPath}`), { ASSETS: {
  async fetch() {
    const response = new Response("export {}", { headers: { "content-type": "text/javascript" } });
    Object.defineProperty(response, "url", { value: "https://assets.internal/storage-object" });
    return response;
  }
} });
assert.match(redirectedAsset.headers.get("cache-control"), /immutable/, "asset cache policy uses the public request path even when storage reports an internal response URL");
const missingAsset = await worker.fetch(new Request("https://example.test/assets/missing-release.js"), { ASSETS: clientAssets });
assert.equal(missingAsset.status, 404, "missing engine chunks never become successful HTML fallbacks");
assert.doesNotMatch(missingAsset.headers.get("cache-control"), /immutable/, "missing release assets remain repairable");
const serviceWorker = await worker.fetch(new Request("https://example.test/sw.js"), { ASSETS: clientAssets });
assert.match(serviceWorker.headers.get("cache-control"), /max-age=0/, "the service worker checks for cache-policy updates");

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
const manifest = JSON.parse(await readFile("dist/client/manifest.webmanifest", "utf8"));
assert.equal(manifest.name, "Master Blaster", "the installable app uses the Master Blaster name");
assert.equal(manifest.short_name, "Master Blaster", "the installed app label uses the Master Blaster name");
assert.equal(manifest.description, PLAYER_TEXT.site.description, "installed-game metadata uses the editable description");
assert.ok(manifest.icons.some((icon) => icon.src === "/favicon.svg"), "the installable app publishes its brand icon");

const previewResponse = await worker.fetch(new Request("https://example.test/og.png"), { ASSETS: clientAssets });
assert.equal(previewResponse.status, 200, "the social preview image is deployed");
assert.equal(previewResponse.headers.get("content-type"), "image/png", "the social preview is served as a PNG");
assert.equal(Buffer.from(await previewResponse.arrayBuffer()).subarray(1, 4).toString("ascii"), "PNG", "the social preview contains PNG bytes");

const faviconResponse = await worker.fetch(new Request("https://example.test/favicon.svg"), { ASSETS: clientAssets });
assert.equal(faviconResponse.status, 200, "the favicon is deployed");
assert.equal(faviconResponse.headers.get("content-type"), "image/svg+xml", "the favicon has the SVG MIME type");
assert.match(await faviconResponse.text(), /<svg/, "the favicon contains SVG markup");

const arenaResponse = await worker.fetch(new Request("https://example.test/menu-arena-v2.webp"), { ASSETS: clientAssets });
assert.equal(arenaResponse.status, 200, "the cinematic menu arena is deployed");
assert.equal(arenaResponse.headers.get("content-type"), "image/webp", "the menu arena is served as WebP instead of the SPA fallback");
assert.equal(Buffer.from(await arenaResponse.arrayBuffer()).subarray(8, 12).toString("ascii"), "WEBP", "the menu arena contains WebP bytes");
console.log("Master Blaster hosting check passed.");
