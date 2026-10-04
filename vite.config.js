import { defineConfig } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLAYER_TEXT } from "./PLAYER_TEXT.js";
import { hash, resourceBuild, writeResourceRelease } from "./scripts/resource-build.mjs";

const resources = await resourceBuild();

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
  const rendered = html.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (token, path) => {
    const value = textAt(path);
    if (value === undefined || typeof value === "object") throw new Error(`Unknown player-text token: ${token}`);
    return escapeHtml(value);
  });
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": "https://masterblaster.se/#website", url: "https://masterblaster.se/", name: PLAYER_TEXT.site.title, inLanguage: "en" },
      {
        "@type": "VideoGame", "@id": "https://masterblaster.se/#game",
        name: PLAYER_TEXT.site.title, url: "https://masterblaster.se/",
        description: PLAYER_TEXT.site.description, image: "https://masterblaster.se/og.png",
        genre: ["Arena shooter", "Action"], gamePlatform: "Web browser",
        playMode: ["https://schema.org/SinglePlayer", "https://schema.org/MultiPlayer"], isAccessibleForFree: true, inLanguage: "en"
      }
    ]
  };
  // Escape script delimiters independently of HTML attribute escaping.
  return rendered.replace("</head>", `<script type="application/ld+json">${JSON.stringify(structuredData).replaceAll("<", "\\u003c")}</script>\n  </head>`);
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
  define: {
    __RESOURCE_VERSION__: JSON.stringify(process.env.NODE_ENV === "production" ? resources.version : "development"),
    __PUBLIC_RESOURCES__: JSON.stringify(process.env.NODE_ENV === "production" ? resources.urls : {})
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }] }
      }
    }
  },
  plugins: [{
    name: "master-blaster-player-text",
    enforce: "pre",
    transform(code, id) {
      if (process.env.NODE_ENV === "production" && id.endsWith(".css")) return resources.rewrite(code);
      // ponytail: derive the small boot copy here; the full arsenal text loads with the engine.
      if (/[\\/]src[\\/](boot|resourceProgress)\.js$/.test(id)) {
        return code.replace('import TEXT from "./playerText.js";', `const TEXT = ${JSON.stringify({ boot: PLAYER_TEXT.boot })};`);
      }
    },
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
      const dir = options.dir || "dist";
      const appManifest = resources.rewrite(manifest());
      await writeFile(resolve(dir, "manifest.webmanifest"), appManifest);
      const manifestURL = `/resources/${hash(appManifest)}/manifest.webmanifest`;
      resources.copies.set(manifestURL, Buffer.from(appManifest));
      const htmlPath = resolve(dir, "index.html");
      let html = resources.rewrite(await readFile(htmlPath, "utf8"))
        .replace('href="/manifest.webmanifest"', `href="${manifestURL}"`)
        .replace("</head>", `<meta name="blaster-release" content="${resources.version}"></head>`);
      // ponytail: inline the small compressed stylesheet to avoid two blocking
      // mobile round trips; keep emitted assets available for offline releases.
      const fontCss = resources.rewrite(await readFile("public/fonts/fonts.css", "utf8"));
      html = html.replace(/<link[^>]+rel="stylesheet"[^>]+href="[^\"]*fonts\.css"[^>]*>/, `<style data-fonts>${fontCss}</style>`);
      for (const link of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[^\"]+\.css)"[^>]*>/g)) {
        const css = await readFile(resolve(dir, `.${link[1]}`), "utf8");
        html = html.replace(link[0], `<style data-app-styles>${css}</style>`);
      }
      await writeFile(htmlPath, html);
      await writeResourceRelease(dir, resources);
    }
  }]
});
