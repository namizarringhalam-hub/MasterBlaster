import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/client", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await copyFile("dist/index.html", "dist/client/index.html");
await cp("dist/assets", "dist/client/assets", { recursive: true });
await cp("dist/audio", "dist/client/audio", { recursive: true });
for (const file of ["favicon.svg", "manifest.webmanifest", "menu-arena-v2.webp", "og.png", "sw.js"]) {
  await copyFile(`dist/${file}`, `dist/client/${file}`);
}
await writeFile(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      url.pathname = "/index.html";
      response = await env.ASSETS.fetch(new Request(url, request));
    }
    const headers = new Headers(response.headers);
    const pathname = new URL(response.url || request.url).pathname;
    if (pathname.startsWith("/assets/")) headers.set("cache-control", "public, max-age=31536000, immutable");
    else if (pathname.startsWith("/audio/") && new URL(request.url).searchParams.has("bank")) headers.set("cache-control", "public, max-age=31536000, immutable");
    else if (headers.get("content-type")?.includes("text/html")) headers.set("cache-control", "public, max-age=0, must-revalidate");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
`
);
