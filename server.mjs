import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("dist");
const port = Number(process.env.PORT || 5173);

if (!existsSync(root)) {
  console.error("Missing dist/. Run npm.cmd run build first, or use npm.cmd start.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function fileForUrl(url) {
  const cleanUrl = new URL(url, "http://localhost").pathname;
  const decoded = decodeURIComponent(cleanUrl);
  const candidate = normalize(join(root, decoded));
  const resolved = resolve(candidate);

  if (!resolved.startsWith(root)) return null;
  if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;

  return join(root, "index.html");
}

const server = createServer((request, response) => {
  const file = fileForUrl(request.url || "/");
  if (!file || !existsSync(file)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache"
  });
  createReadStream(file).pipe(response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`Blaster Battle already appears to be running at http://127.0.0.1:${port}/`);
    process.exit(0);
  }

  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Blaster Battle is running at http://127.0.0.1:${port}/`);
});
