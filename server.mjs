import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const root = resolve("dist/client");
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
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const routes = new Map(readFileSync(join(root, "_redirects"), "utf8").split(/\r?\n/)
  .filter(line => line.trim() && !line.startsWith("#"))
  .map(line => { const [from, to, status] = line.trim().split(/\s+/); return [from, { to, status: Number(status) }]; }));

function fileForPath(pathname) {
  const resolved = resolve(root, `.${decodeURIComponent(pathname)}`);
  const fromRoot = relative(root, resolved);

  if (isAbsolute(fromRoot) || fromRoot.startsWith("..") || pathname.split("/").some(part => part.startsWith("_"))) return null;
  if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  const index = join(resolved, "index.html");
  return existsSync(index) && statSync(index).isFile() ? index : null;
}

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  const route = routes.get(url.pathname);
  if (route?.status === 301) {
    response.writeHead(301, { Location: `${route.to}${url.search}` });
    response.end();
    return;
  }
  let file;
  try { file = fileForPath(route?.status === 200 ? "/index.html" : url.pathname); }
  catch { response.writeHead(400); response.end("Invalid URL"); return; }
  const status = file ? 200 : 404;
  file ||= join(root, "404.html");

  response.writeHead(status, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache"
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`Master Blaster already appears to be running at http://127.0.0.1:${port}/`);
    process.exit(0);
  }

  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Master Blaster is running at http://127.0.0.1:${server.address().port}/`);
});
