import { createServer as createHttpServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { WEAPONS } from "../src/gameData.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:5174";
const maxBytes = 2 * 1024 * 1024;

export function webpSize(bytes) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw Error("Invalid WebP container");
  let size, image = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw Error("Incomplete WebP chunk");
    const kind = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length + (length % 2) > bytes.length) throw Error("Incomplete WebP payload");
    if (kind === "VP8X" && length >= 10) size = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1];
    if (kind === "VP8 " && length >= 10 && bytes.toString("hex", start + 3, start + 6) === "9d012a") {
      image = true;
      size ||= [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
    }
    if (kind === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
      image = true;
      const bits = bytes.readUInt32LE(start + 1);
      size ||= [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    offset = start + length + (length % 2);
  }
  if (!image || !size?.every(value => value > 0)) throw Error("Missing WebP image");
  return size;
}

if (process.argv.includes("--check")) {
  const { default: assert } = await import("node:assert/strict");
  const sample = await readFile(resolve(root, "public/menu-arena-v2.webp"));
  assert.ok(webpSize(sample).every(value => value > 0));
  assert.throws(() => webpSize(sample.subarray(0, 20)), /Invalid WebP/);
  assert.throws(() => webpSize(Buffer.from("not a webp")), /Invalid WebP/);
  console.log("Weapon preview WebP validation passed.");
} else {
  const vite = await createViteServer({ root, configFile: false, cacheDir: "node_modules/.vite-weapon-previews", appType: "custom", server: { middlewareMode: true, host: "127.0.0.1" } });
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url, origin), pathname = url.pathname;
    const save = /^\/__save-weapon-preview\/([a-z0-9_]+)$/.exec(pathname);
    try {
      if (pathname.startsWith("/__save-weapon-preview/")) {
        if (request.method !== "POST") { response.writeHead(405).end("Use POST"); return; }
        if (!save || !Object.hasOwn(WEAPONS, save[1])) { response.writeHead(404).end("Unknown weapon"); return; }
        if (request.headers.origin && request.headers.origin !== origin) { response.writeHead(403).end("Local origin required"); return; }
        if (request.headers["content-type"] !== "image/webp") { response.writeHead(415).end("WebP required"); return; }
        if (Number(request.headers["content-length"]) > maxBytes) { response.writeHead(413).end("Image too large"); return; }
        const chunks = []; let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > maxBytes) { response.writeHead(413).end("Image too large"); return; }
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks), [width, height] = webpSize(bytes);
        if (width !== 512 || height !== 320) { response.writeHead(422).end("Expected 512 × 320"); return; }
        await mkdir(resolve(root, "public/weapons"), { recursive: true });
        await writeFile(resolve(root, `public/weapons/${save[1]}.webp`), bytes);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: save[1], bytes: bytes.length }));
        return;
      }
      if (request.method === "GET" && pathname === "/") {
        response.writeHead(302, { location: "/scripts/weapon-previews.html" }).end();
        return;
      }
      if (request.method === "GET" && pathname === "/scripts/weapon-previews.html" && !url.searchParams.has("html-proxy")) {
        const html = await readFile(resolve(root, "scripts/weapon-previews.html"), "utf8");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(await vite.transformIndexHtml(pathname, html));
        return;
      }
      vite.middlewares(request, response, () => response.writeHead(404).end("Not found"));
    } catch (error) {
      console.error(`Preview request failed: ${error.message}`);
      if (!response.headersSent) response.writeHead(400).end(error.message);
      else response.end();
    }
  });
  server.requestTimeout = 15_000;
  server.on("error", async error => { console.error(error.message); await stop(); process.exitCode = 1; });
  const stop = async () => {
    clearTimeout(deadline);
    server.closeAllConnections();
    server.close();
    await vite.close();
  };
  // ponytail: this one-use local exporter stops after ten minutes; relaunch for another batch.
  const deadline = setTimeout(() => { console.log("Preview exporter reached its ten-minute limit."); void stop(); }, 600_000);
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  server.listen(5174, "127.0.0.1", () => console.log(`Weapon preview exporter: ${origin}\nPress Render all 47 weapon previews in the page. Server stops after ten minutes.`));
}
