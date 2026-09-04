// Manual browser fault test: build, run this server, warm a match, then type
// "deny" and start/rematch again. HTML stays network-backed; cached assets must
// load without any denied origin requests. "stats" prints exact request counts.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createInterface } from "node:readline";
import worker from "../dist/server/index.js";

const root = resolve("dist/client");
const port = Number(process.env.CACHE_TEST_PORT || 5174);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wav": "audio/wav", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
let denied = false;
let counts = {};
const probe = `<output id="cache-test" style="position:fixed;left:2px;top:2px;z-index:99999;background:#000;color:#fff;font:10px monospace;pointer-events:none"></output><script>
const contexts = [];
if (window.AudioContext) window.AudioContext = class extends window.AudioContext { constructor(...args) { super(...args); contexts.push(this); } };
const report = () => document.querySelector('#cache-test').textContent = 'SW controller: ' + (navigator.serviceWorker.controller?.scriptURL || 'pending') + ' | audio: ' + contexts.map(c => c.state + '@' + c.currentTime.toFixed(1)).join(',');
navigator.serviceWorker.addEventListener('controllerchange', report); report();
setInterval(report, 1000);
</script>`;
const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, `http://127.0.0.1:${server.address().port}`);
  counts[url.pathname + url.search] = (counts[url.pathname + url.search] || 0) + 1;
  try {
    if (denied && /^\/(assets|audio)\//.test(url.pathname)) {
      console.log("DENIED", url.pathname + url.search);
      outgoing.writeHead(503); outgoing.end("Asset origin unavailable"); return;
    }
    const result = await worker.fetch(new Request(url), { ASSETS: {
      async fetch(request) {
        const path = resolve(root, "." + decodeURIComponent(new URL(request.url).pathname));
        if (!path.startsWith(root + sep)) return new Response("Not found", { status: 404 });
        try { return new Response(await readFile(path), { headers: { "content-type": types[extname(path)] || "application/octet-stream" } }); }
        catch { return new Response("Not found", { status: 404 }); }
      }
    } });
    const headers = Object.fromEntries(result.headers);
    // Disable the ordinary HTTP cache to prove service-worker reuse specifically.
    headers["cache-control"] = "no-store";
    const body = headers["content-type"]?.includes("text/html") ? (await result.text()).replace("</body>", probe + "</body>") : Buffer.from(await result.arrayBuffer());
    outgoing.writeHead(result.status, headers); outgoing.end(body);
  } catch (error) { outgoing.writeHead(500); outgoing.end(String(error)); }
});
createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "deny") { denied = true; counts = {}; console.log("Asset origin disabled; counters reset."); }
  if (line.trim() === "stats") console.log(JSON.stringify({ denied, counts }));
});
server.listen(port, "127.0.0.1", () => console.log(`Cache fault test: http://127.0.0.1:${server.address().port} (commands: stats, deny)`));
