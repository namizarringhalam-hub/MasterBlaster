import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resourceBuild } from "../scripts/resource-build.mjs";
const resources = await resourceBuild();
import { MUSIC_SAMPLE_MANIFEST } from "../src/musicScore.js";
import { PLAYER_TEXT } from "../PLAYER_TEXT.js";
import { WEAPONS } from "../src/gameData.js";

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
  ".xml": "application/xml",
  ".woff2": "font/woff2"
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
const release = JSON.parse(await readFile("dist/resources.json", "utf8"));
assert.equal(release.version, resources.version, "release identity includes all current source, dependency and public inputs");
assert.ok(deployedHtml.includes(`name="blaster-release" content="${release.version}"`));
const { createHash } = await import("node:crypto");
for (const entry of release.entries) {
  const bytes = await readFile(join("dist/client", entry.url));
  assert.equal(bytes.length, entry.bytes, `${entry.url} has a truthful progress weight`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `${entry.url} matches the deployed release hash`);
}
assert.ok(release.entries.some(entry => entry.url.endsWith(".woff2")), "offline release includes compressed menu fonts");
assert.ok(release.entries.some(entry => entry.url.includes("surfaceTextures.worker-")), "offline release includes generator workers");
assert.ok(deployedHtml.includes(`<title>${PLAYER_TEXT.site.searchTitle}</title>`), "the search title describes the game without changing its installed name");
assert.match(deployedHtml, /<meta property="og:title" content="Master Blaster — Neon Arena Shooter"/, "shared links use the Master Blaster title");
assert.match(deployedHtml, /<link rel="canonical" href="https:\/\/masterblaster\.se\/"/, "the public domain is canonical");
assert.match(deployedHtml, /<meta property="og:url" content="https:\/\/masterblaster\.se\/"/, "shared links identify the public domain");
assert.match(deployedHtml, /<meta property="og:image" content="https:\/\/masterblaster\.se\/og\.png"/, "social crawlers receive an absolute preview image URL");
assert.ok(deployedHtml.includes(`<meta name="description" content="${PLAYER_TEXT.site.description}"`), "search and social metadata use the editable description");
assert.match(deployedHtml, /<span>MASTER<\/span><b>BLASTER<\/b>/, "the server-rendered menu uses the Master Blaster brand");
assert.doesNotMatch(deployedHtml, /Blaster Battle/i, "the deployed shell contains no retired title");
assert.match(deployedHtml, /data-boot-mode="quick"/, "the interactive menu shell is server-rendered before the deferred game engine executes");
assert.equal((deployedHtml.match(/<h1(?:\s|>)/g) || []).length, 1, "the homepage has one primary heading, including hidden markup");
assert.match(deployedHtml, /href="\/how-to-play\/"/, "the static guide is linked from the rendered homepage");
assert.doesNotMatch(deployedHtml, /<link[^>]*rel="stylesheet"/, "the first menu paint does not wait for separate stylesheet downloads");
const fontPreloads = [...deployedHtml.matchAll(/<link\b[^>]*>/g)].map(([tag]) => tag)
  .filter(tag => tag.includes('rel="preload"') && tag.includes('as="font"'))
  .map(tag => tag.match(/href="([^"]+)"/)?.[1]);
assert.equal(fontPreloads.length, 3, "the three critical menu fonts are preloaded from versioned resources");
for (const fontPath of fontPreloads) {
  assert.match(fontPath, /^\/resources\/[a-f0-9]+\/[^/]+\.woff2$/);
  assert.ok(release.entries.some(entry => entry.url === fontPath), "each preload belongs to the complete offline release");
  assert.ok(deployedHtml.includes(`url(${fontPath})`), "inline font CSS points at the same content-addressed font as its preload");
}
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
  ["sitemap.xml", "application/xml", /<loc>https:\/\/masterblaster\.se\/<\/loc>/],
  ["indexnow.txt", "text/plain", /^[a-f0-9]{32}\s*$/]
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
const deployedJs = (await Promise.all(jsAssets.map(name => readFile(join("dist/client/assets", name), "utf8")))).join("\n");
for (const id of Object.keys(WEAPONS)) {
  const weaponURL = resources.urls[`/weapons/${id}.webp`];
  assert.match(weaponURL || "", new RegExp(`^/resources/[a-f0-9]{64}/${id}\\.webp$`), `${id} has a fingerprinted weapon render URL`);
  assert.ok(release.entries.some(entry => entry.url === weaponURL), `${id} is included in the offline release manifest`);
  assert.ok(deployedJs.includes(weaponURL), `${id} is addressed by its fingerprinted URL in the deployed engine`);
}
assert.ok(jsAssets.length >= 2, "the tiny boot module is split from the Three.js game engine");
const entryPath = deployedHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
assert.ok(entryPath, "the production shell references its hashed boot module");
const entryBytes = await readFile(join("dist/client", entryPath));
assert.ok(gzipSync(entryBytes).length < 12 * 1024, "the interactive boot module stays below a 12 KiB compressed budget");
assert.ok(entryBytes.includes(Buffer.from(PLAYER_TEXT.boot.loading)), "the startup module retains editable loading copy");
assert.ok(!entryBytes.includes(Buffer.from(PLAYER_TEXT.setup.loadout.weaponRoles.blaster)), "armory weapon roles remain deferred outside the startup module");
const jsGzipSizes = await Promise.all(jsAssets.map(async (name) => gzipSync(await readFile(join("dist/client/assets", name))).length));
assert.ok(Math.max(...jsGzipSizes) < 380 * 1024, "the deferred engine stays below a 380 KiB compressed budget");
const cssGzipSizes = await Promise.all(cssAssets.map(async (name) => gzipSync(await readFile(join("dist/client/assets", name))).length));
const deployedCss = (await Promise.all(cssAssets.map(name => readFile(join("dist/client/assets", name), "utf8")))).join("\n");
assert.ok(deployedCss.includes(resources.urls["/menu-arena-v2.webp"]), "CSS menu art uses its content hash, including offline launches");
assert.doesNotMatch(deployedCss, /url\(["']?\/menu-arena-v2\.webp/, "CSS never bypasses the versioned resource address");
// Includes the accessible home-menu preparation strip and hashed artwork URL.
assert.ok(Math.max(...cssGzipSizes) < 14 * 1024, "each stylesheet stays below a 14 KiB compressed CSS budget");
assert.ok(cssGzipSizes.reduce((sum, bytes) => sum + bytes, 0) < 15 * 1024, "menus, live graphics and deferred multiplayer styles stay below 15 KiB combined, including background preparation status");
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
const rules = (await readFile("public/_redirects", "utf8")).split(/\r?\n/)
  .filter(line => line.trim() && !line.startsWith("#"))
  .map(line => line.trim().split(/\s+/));
assert.equal(await readFile("dist/client/_redirects", "utf8"), await readFile("public/_redirects", "utf8"), "Pages and alternate hosting use the same exact route policy");
for (const [from, to, status] of rules) {
  const result = await worker.fetch(new Request(`https://example.test${from}?ref=hosting-check`), { ASSETS: clientAssets });
  assert.equal(result.status, Number(status), `${from} preserves page aliases and game refreshes`);
  if (status === "301") assert.equal(result.headers.get("location"), `https://example.test${to}?ref=hosting-check`, "canonical redirects preserve attribution");
  else assert.equal(await result.text(), deployedHtml, "only listed game screen paths receive the home shell");
}
for (const address of ["http://masterblaster.se/index.html", "https://www.masterblaster.se/index.html", "http://www.masterblaster.se/index.html"]) {
  const result = await worker.fetch(new Request(`${address}?ref=hosting-check`), { ASSETS: clientAssets });
  assert.equal(result.status, 301);
  assert.equal(result.headers.get("location"), "https://masterblaster.se/?ref=hosting-check", "alternate hosting normalizes host, scheme and page alias in one hop");
}
const guide = await worker.fetch(new Request("https://example.test/how-to-play/"), { ASSETS: clientAssets });
assert.equal(guide.status, 200, "the linked game guide is served as a separate static page");
assert.match(await guide.text(), /rel="canonical" href="https:\/\/masterblaster\.se\/how-to-play\/"/);
for (const path of ["/missing-page", "/assets/missing-release.js", "/resources/missing/style.css", "/global-multiplayer/missing-room", "/_headers", "/_redirects"]) {
  const navigation = new Request(`https://example.test${path}`);
  Object.defineProperty(navigation, "mode", { value: "navigate" });
  const result = await worker.fetch(navigation, { ASSETS: clientAssets });
  assert.equal(result.status, 404, `${path} is still a real 404 when opened directly in a browser`);
  assert.match(await result.text(), /<h1>Page not found<\/h1>/, "missing URLs offer useful recovery links");
}
const serviceWorker = await worker.fetch(new Request("https://example.test/sw.js"), { ASSETS: clientAssets });
assert.match(serviceWorker.headers.get("cache-control"), /max-age=0/, "the service worker checks for cache-policy updates");

const audioNames = await readdir("dist/client/audio/music");
const audioBytes = (await Promise.all(audioNames.map((name) => readFile(join("dist/client/audio/music", name))))).reduce((sum, bytes) => sum + bytes.length, 0);
assert.ok(audioBytes < 4.7 * 1024 * 1024, "the lossless recorded score stays inside its network budget");

for (const file of Object.values(MUSIC_SAMPLE_MANIFEST).flatMap((role) => role.files)) {
  const musicResponse = await worker.fetch(new Request(`https://example.test${resources.urls[file.url]}`), { ASSETS: clientAssets });
  assert.equal(musicResponse.status, 200, `${file.url} is included in the deployed client`);
  assert.equal(musicResponse.headers.get("content-type"), "audio/wav", `${file.url} is served as audio instead of the SPA fallback`);
  assert.match(musicResponse.headers.get("cache-control"), /max-age=31536000, immutable/, `${file.url} is reused without a network revalidation on later matches`);
  assert.equal(Buffer.from(await musicResponse.arrayBuffer()).subarray(0, 4).toString("ascii"), "RIFF", `${file.url} contains WAV bytes`);
}
const manifest = JSON.parse(await readFile("dist/client/manifest.webmanifest", "utf8"));
assert.equal(manifest.name, "Master Blaster", "the installable app uses the Master Blaster name");
assert.equal(manifest.short_name, "Master Blaster", "the installed app label uses the Master Blaster name");
assert.equal(manifest.description, PLAYER_TEXT.site.description, "installed-game metadata uses the editable description");
assert.ok(manifest.icons.some((icon) => icon.src === resources.urls["/favicon.svg"]), "the installable app publishes its brand icon");

const previewResponse = await worker.fetch(new Request("https://example.test/og.png"), { ASSETS: clientAssets });
assert.ok(release.entries.every(entry => !entry.url.endsWith("/og.png")), "the mandatory game download excludes the crawler-only social image");
assert.equal(previewResponse.status, 200, "the social preview image is deployed");
assert.equal(previewResponse.headers.get("content-type"), "image/png", "the social preview is served as a PNG");
assert.equal(Buffer.from(await previewResponse.arrayBuffer()).subarray(1, 4).toString("ascii"), "PNG", "the social preview contains PNG bytes");
assert.deepEqual(await readFile("dist/client/og.png"), await readFile("public/og.png"), "social crawlers receive the original preview bytes outside the game cache");

const faviconResponse = await worker.fetch(new Request("https://example.test/favicon.svg"), { ASSETS: clientAssets });
assert.equal(faviconResponse.status, 200, "the favicon is deployed");
assert.equal(faviconResponse.headers.get("content-type"), "image/svg+xml", "the favicon has the SVG MIME type");
assert.match(await faviconResponse.text(), /<svg/, "the favicon contains SVG markup");

const arenaResponse = await worker.fetch(new Request("https://example.test/menu-arena-v2.webp"), { ASSETS: clientAssets });
assert.equal(arenaResponse.status, 200, "the cinematic menu arena is deployed");
assert.equal(arenaResponse.headers.get("content-type"), "image/webp", "the menu arena is served as WebP instead of the SPA fallback");
assert.equal(Buffer.from(await arenaResponse.arrayBuffer()).subarray(8, 12).toString("ascii"), "WEBP", "the menu arena contains WebP bytes");

// Check the preview HTTP server itself, not just the alternate cloud adapter.
const preview = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: "0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let startupTimeout;
try {
  const [output] = await Promise.race([
    once(preview.stdout, "data"),
    once(preview, "exit").then(([code]) => { throw new Error(`Preview server exited before listening (${code})`); }),
    new Promise((_, reject) => { startupTimeout = setTimeout(() => reject(new Error("Preview server startup timed out")), 10000); })
  ]);
  clearTimeout(startupTimeout);
  const origin = String(output).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(origin, "preview server reports its listening address");
  for (const [path, expectedStatus, contentType] of [
    ["/", 200, "text/html"], ["/game", 200, "text/html"],
    ["/how-to-play/", 200, "text/html"], ["/missing-page", 404, "text/html"],
    ["/assets/missing.js", 404, "text/html"], ["/robots.txt", 200, "text/plain"],
    ["/sitemap.xml", 200, "application/xml"], ["/_headers", 404, "text/html"],
    ["/server/index.js", 404, "text/html"]
  ]) {
    const result = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(result.status, expectedStatus, `${path} is correct in local previews`);
    assert.ok(result.headers.get("content-type")?.includes(contentType), `${path} uses its real MIME type`);
    await result.arrayBuffer();
  }
  const alias = await fetch(`${origin}/index.html?ref=test`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get("location"), "/?ref=test");
  const head = await fetch(`${origin}/missing-page`, { method: "HEAD", signal: AbortSignal.timeout(3000) });
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "", "HEAD preserves the real status without a response body");
} finally {
  clearTimeout(startupTimeout);
  preview.kill();
}
console.log("Master Blaster hosting check passed.");
