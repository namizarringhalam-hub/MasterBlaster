import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(`${dir}/${entry.name}`) : `${dir}/${entry.name}`))).flat().sort();
}

// Source dependencies, generators, configuration and public bytes all participate.
// No manually bumped audio/texture version can be forgotten during a release.
export async function resourceBuild() {
  const inputs = [...await filesIn("src"), ...await filesIn("public"), ...await filesIn("scripts"),
    "GAME_CONFIG.js", "PLAYER_TEXT.js", "index.html", "vite.config.js", "package.json", "package-lock.json"];
  const version = hash((await Promise.all(inputs.sort().map(async path => `${path}:${hash(await readFile(path))}`))).join("\n"));
  const publicFiles = await filesIn("public");
  const copies = new Map(), urls = {};
  for (const path of publicFiles.filter(path => !/\.(?:css|webmanifest)$/.test(path) && !path.endsWith("/sw.js") && !basename(path).startsWith("_"))) {
    const bytes = await readFile(path);
    const url = `/resources/${hash(bytes)}/${basename(path)}`;
    urls[path.slice(6)] = url;
    copies.set(url, bytes);
  }
  const rewrite = text => text.replace(/\/(?:fonts\/[^\s"')]+|menu-arena-v2\.webp|favicon\.svg)/g, path => urls[path] || path);
  // Font CSS names the content-addressed font files, not mutable public aliases.
  for (const path of publicFiles.filter(path => path.endsWith(".css"))) {
    const bytes = Buffer.from(rewrite(await readFile(path, "utf8")));
    const url = `/resources/${hash(bytes)}/${basename(path)}`;
    urls[path.slice(6)] = url;
    copies.set(url, bytes);
  }
  return { version, urls, rewrite, copies };
}

export async function writeResourceRelease(dir, build) {
  for (const [url, bytes] of build.copies) {
    const path = resolve(dir, `.${url}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const paths = [...await filesIn(`${dir}/assets`), ...await filesIn(`${dir}/resources`),
    ...await filesIn(`${dir}/how-to-play`), `${dir}/index.html`, `${dir}/manifest.webmanifest`];
  const entries = await Promise.all(paths.map(async path => {
    const bytes = await readFile(path);
    return { url: `/${path.slice(dir.length + 1).replaceAll("\\", "/")}`, bytes: bytes.length, sha256: hash(bytes) };
  }));
  const manifest = JSON.stringify({ version: build.version, entries });
  await writeFile(`${dir}/resources-${build.version}.json`, manifest);
  await writeFile(`${dir}/resources.json`, manifest);
}
