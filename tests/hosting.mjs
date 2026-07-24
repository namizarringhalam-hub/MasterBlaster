import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png"
};

const { default: worker } = await import(`../dist/server/index.js?test=${Date.now()}`);
const response = await worker.fetch(new Request("https://example.test/"), {
  ASSETS: {
    async fetch(request) {
      try {
        const pathname = new URL(request.url).pathname;
        const data = await readFile(join("dist/client", pathname === "/" ? "__missing__" : pathname));
        return new Response(data, { headers: { "content-type": types[extname(pathname)] || "application/octet-stream" } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  }
});

assert.equal(response.status, 200, "the deployed root falls back to client/index.html");
assert.match(await response.text(), /<title>Blaster Battle<\/title>/, "the deployed root serves the game shell");
console.log("Blaster Battle hosting check passed.");
