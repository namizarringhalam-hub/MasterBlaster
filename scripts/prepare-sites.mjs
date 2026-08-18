import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/client", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await copyFile("dist/index.html", "dist/client/index.html");
await cp("dist/assets", "dist/client/assets", { recursive: true });
await cp("dist/audio", "dist/client/audio", { recursive: true });
for (const file of ["manifest.webmanifest", "og.png", "sw.js"]) {
  await copyFile(`dist/${file}`, `dist/client/${file}`);
}
await writeFile(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const url = new URL(request.url);
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  }
};
`
);
