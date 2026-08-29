import { defineConfig } from "vite";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLAYER_TEXT } from "./PLAYER_TEXT.js";

function textAt(path) {
  return path.split(".").reduce((value, key) => value?.[key], PLAYER_TEXT);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPlayerText(html) {
  return html.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (token, path) => {
    const value = textAt(path);
    if (value === undefined || typeof value === "object") throw new Error(`Unknown player-text token: ${token}`);
    return escapeHtml(value);
  });
}

function manifest() {
  return JSON.stringify({
    name: PLAYER_TEXT.site.title,
    short_name: PLAYER_TEXT.site.title,
    description: PLAYER_TEXT.site.description,
    start_url: "/",
    display: "fullscreen",
    background_color: "#07111d",
    theme_color: "#07111d",
    orientation: "landscape",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
  }, null, 2);
}

export default defineConfig({
  plugins: [{
    name: "master-blaster-player-text",
    transformIndexHtml: { order: "pre", handler: renderPlayerText },
    configureServer(server) {
      server.watcher.add("PLAYER_TEXT.js");
      server.watcher.on("change", (path) => {
        if (path.endsWith("PLAYER_TEXT.js")) server.ws.send({ type: "full-reload", path: "*" });
      });
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/manifest.webmanifest") return next();
        response.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        response.end(manifest());
      });
    },
    generateBundle(_options, bundle) {
      const asset = bundle["manifest.webmanifest"];
      if (asset?.type === "asset") asset.source = manifest();
    },
    async writeBundle(options) {
      await writeFile(resolve(options.dir || "dist", "manifest.webmanifest"), manifest());
    }
  }]
});
