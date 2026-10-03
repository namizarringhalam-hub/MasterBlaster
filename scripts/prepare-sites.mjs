import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/client", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await copyFile("dist/index.html", "dist/client/index.html");
await cp("dist/assets", "dist/client/assets", { recursive: true });
await cp("dist/audio", "dist/client/audio", { recursive: true });
await cp("dist/fonts", "dist/client/fonts", { recursive: true });
await cp("dist/resources", "dist/client/resources", { recursive: true });
await cp("dist/how-to-play", "dist/client/how-to-play", { recursive: true });
await cp("dist/press", "dist/client/press", { recursive: true });
const { version } = JSON.parse(await readFile("dist/resources.json", "utf8"));
await copyFile("dist/resources.json", "dist/client/resources.json");
await copyFile(`dist/resources-${version}.json`, `dist/client/resources-${version}.json`);
for (const file of ["favicon.svg", "manifest.webmanifest", "menu-arena-v2.webp", "og.png", "sw.js", "robots.txt", "sitemap.xml", "indexnow.txt", "404.html", "_headers", "_redirects"]) {
  await copyFile(`dist/${file}`, `dist/client/${file}`);
}
const routes = (await readFile("public/_redirects", "utf8")).split(/\r?\n/)
  .filter(line => line.trim() && !line.startsWith("#"))
  .map(line => line.trim().split(/\s+/));
await writeFile(
  "dist/server/index.js",
`const routes = new Map(${JSON.stringify(routes.map(([from, to, status]) => [from, { to, status: Number(status) }]))});
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = routes.get(url.pathname);
    if (url.hostname === "www.masterblaster.se" ||
        (url.hostname === "masterblaster.se" && url.protocol !== "https:")) {
      url.hostname = "masterblaster.se";
      url.protocol = "https:";
      if (route?.status === 301) url.pathname = route.to;
      return Response.redirect(url.href, 301);
    }
    if (route?.status === 301) {
      url.pathname = route.to;
      return Response.redirect(url.href, 301);
    }
    let response;
    if (url.pathname === "/" || route?.status === 200) {
      url.pathname = "/index.html";
      response = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }));
    } else if (["/_headers", "/_redirects"].includes(url.pathname)) {
      response = new Response(null, { status: 404 });
    } else {
      if (url.pathname.endsWith("/")) url.pathname += "index.html";
      response = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }));
    }
    if (response.status === 404) {
      url.pathname = "/404.html";
      const page = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }));
      response = new Response(page.body, { status: 404, headers: page.headers });
    }
    const headers = new Headers(response.headers);
    const pathname = new URL(request.url).pathname;
    if (!response.ok || headers.get("content-type")?.includes("text/html") || pathname === "/sw.js") headers.set("cache-control", "public, max-age=0, must-revalidate");
    else if (pathname.startsWith("/assets/") || pathname.startsWith("/resources/") || /^\\/resources-[a-f0-9]+\\.json$/.test(pathname)) headers.set("cache-control", "public, max-age=31536000, immutable");
    else headers.set("cache-control", "public, max-age=0, must-revalidate");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
`
);
