import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { surfaceTextureData } from "../src/surfaceTextureData.js";
import { prepareSurfaceTextures, surfaceTextures } from "../src/surfaceTextures.js";

const sha = data => createHash("sha256").update(data).digest("hex");
const origin = "https://game.test", handlers = {}, stores = new Map(), network = new Map();
let offline = false, quota = false, fetches = 0, navigationPolicy;
const key = request => typeof request === "string" ? request : request.url;
const storage = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const values = stores.get(name);
    return {
      async match(request) { return values.get(key(request))?.clone(); },
      async put(request, response) { if (quota) throw Error("Quota"); values.set(key(request), response.clone()); },
      async delete(request) { return values.delete(key(request)); }
    };
  }
};
vm.runInNewContext(await readFile("public/sw.js", "utf8"), {
  URL, Map, Set, Request, Response, AbortSignal, crypto: webcrypto, caches: storage,
  self: { location: { origin }, addEventListener(name, callback) { handlers[name] = callback; } },
  async fetch(request, options) {
    fetches++;
    if (options) navigationPolicy = options.cache;
    if (offline) throw Error("Offline");
    return network.get(key(request))?.clone() || new Response("Missing", { status: 404 });
  }
});
function release(number) {
  const version = String(number).repeat(64), script = `export const version = ${number};`;
  const entries = [
    { url: "/index.html", body: `<html><meta name="blaster-release" content="${version}"></html>`, type: "text/html" },
    { url: `/assets/game-${version}.js`, body: script, type: "text/javascript" },
    { url: `/resources/${sha(`font${number}`)}/font.ttf`, body: `font${number}`, type: "font/ttf" }
  ];
  for (const entry of entries) network.set(origin + entry.url, new Response(entry.body, { headers: { "content-type": entry.type } }));
  network.set(origin + `/resources-${version}.json`, new Response(JSON.stringify({ version,
    entries: entries.map(({ url, body }) => ({ url, bytes: Buffer.byteLength(body), sha256: sha(body) })) }), { headers: { "content-type": "application/json" } }));
  network.set(origin + "/resources.json", new Response(JSON.stringify({ version })));
  return { version, entries };
}
async function prepare(version) {
  const messages = [], waits = [];
  handlers.message({ data: { type: "PREPARE_RELEASE", version }, ports: [{ postMessage: message => messages.push(message) }], waitUntil: promise => waits.push(promise) });
  await Promise.all(waits);
  return messages;
}
async function active() {
  const response = await (await storage.open("blaster-releases")).match(origin + "/active-release");
  return response?.text();
}
const first = release(1);
let messages = await prepare(first.version);
assert.equal(messages.at(-1).type, "complete");
assert.equal(messages.at(-1).persistent, true);
assert.equal(await active(), first.version);
assert.equal(messages.at(-1).complete, messages.at(-1).total);
offline = true;
const before = fetches;
assert.equal((await prepare(first.version)).at(-1).type, "complete");
assert.equal(fetches, before, "a complete release can prepare entirely offline");
offline = false;
const second = release(2), missing = origin + second.entries[2].url;
network.set(origin + "/", network.get(origin + "/index.html").clone());
let refreshed;
handlers.fetch({ request: { url: origin + "/", method: "GET", mode: "navigate" }, respondWith: promise => { refreshed = promise; } });
assert.match(await (await refreshed).text(), new RegExp(second.version), "refresh selects the new release without an update button, even with an older offline shell");
assert.equal(navigationPolicy, "no-cache", "navigation revalidates the HTTP cache before selecting resources");
const saved = network.get(missing); network.delete(missing);
assert.equal((await prepare(second.version)).at(-1).type, "failed");
assert.equal(await active(), first.version, "an interrupted update preserves the complete offline release");
network.set(missing, saved);
await (await storage.open("blaster-immutable-v1")).put(origin + second.entries[1].url, new Response("stale", { headers: { "content-type": "text/javascript" } }));
assert.equal((await prepare(second.version)).at(-1).type, "complete", "wrong cached bytes are repaired against SHA-256");
assert.equal(await active(), second.version);
assert.equal((await prepare(first.version)).at(-1).type, "complete");
assert.equal(await active(), second.version, "an old tab cannot roll the offline release back");
const third = release(3);
network.set(origin + third.entries[1].url, new Response("wrong release", { headers: { "content-type": "text/javascript" } }));
assert.equal((await prepare(third.version)).at(-1).type, "failed", "wrong origin bytes cannot mark a release ready");
assert.equal(await active(), second.version);
const fourth = release(4); quota = true;
messages = await prepare(fourth.version);
assert.equal(messages.at(-1).type, "complete");
assert.equal(messages.at(-1).persistent, false, "storage failure never promises offline availability");
assert.equal(await active(), second.version);
quota = false; offline = true;
let navigation;
handlers.fetch({ request: { url: origin + "/", method: "GET", mode: "navigate" }, respondWith: promise => { navigation = promise; } });
assert.match(await (await navigation).text(), new RegExp(second.version), "offline navigation uses the last complete shell");

// The real boot controller must wait for load, fonts and two animation frames,
// even when the player clicks a navigation button immediately.
let loaded, fontsReady, clicked, imports = 0, setups = 0;
const frames = [], marks = [];
const boot = (await readFile("src/boot.js", "utf8")).replace(/^import .*;\r?\n/gm, "")
  .replace("export const menuReady", "const menuReady").replace('import("./main.js")', "loadGame()");
const game = { prepareResources: async () => {}, renderSetup() { setups++; } };
const menu = { querySelector: () => ({ textContent: "" }), addEventListener(name, callback) { clicked = callback; } };
vm.runInNewContext(boot, {
  console, setTimeout, clearTimeout, RESOURCE_VERSION: "development", TEXT: { boot: { preparation: {} } },
  preparationProgress() {}, backgroundYield: async () => {},
  performance: { now: () => 0, mark: name => marks.push(name) },
  requestAnimationFrame: callback => frames.push(callback),
  document: { readyState: "loading", fonts: { ready: new Promise(resolve => { fontsReady = resolve; }) },
    querySelector: selector => selector === "#ui-root" ? menu : null, addEventListener() {} },
  window: { addEventListener(name, callback) { if (name === "load") loaded = callback; } },
  async loadGame() { imports++; return { gameReady: Promise.resolve(game) }; }
});
const click = clicked({ target: { closest: () => ({ dataset: { bootMode: "quick" } }) } });
await Promise.resolve(); assert.equal(imports, 0);
loaded(); await Promise.resolve(); assert.equal(imports, 0);
fontsReady(); await new Promise(setImmediate);
assert.equal(imports, 0); frames.shift()(); assert.equal(imports, 0);
frames.shift()(); await click;
assert.equal(imports, 1); assert.equal(setups, 1);
assert.ok(marks.includes("blaster-menu-ready"));

// Completion hides the strip, while a later preparation or failure restores it.
const controls = new Map(["[data-resource-label]", "[data-resource-detail]", "[data-resource-retry]", "progress"]
  .map(selector => [selector, { removeAttribute() {} }]));
const strip = { dataset: {}, querySelector: selector => controls.get(selector) };
const progressContext = vm.createContext({ TEXT: { boot: { preparation: {} } }, document: { querySelector: () => strip } });
vm.runInContext((await readFile("src/resourceProgress.js", "utf8")).replace(/^import .*;\r?\n/gm, "").replace("export function", "function"), progressContext);
for (const [stage, hidden, retryHidden] of [["ready", true, true], ["checking", false, true], ["failed", false, false], ["update", false, false], ["ready", true, true]]) {
  progressContext.preparationProgress(stage);
  assert.equal(strip.hidden, hidden, `${stage}: strip visibility`);
  assert.equal(controls.get("[data-resource-retry]").hidden, retryHidden, `${stage}: recovery action visibility`);
}

// A newer deployment during an open session must not resurrect a completed bar.
// Only a failed preparation exposes recovery, and reconnect retries automatically.
for (const fail of [false, true]) {
  const stages = [], events = {};
  let attempts = 0;
  const context = vm.createContext({
    console: { warn() {} }, setTimeout, clearTimeout, AbortSignal,
    RESOURCE_VERSION: first.version, TEXT: { boot: { preparation: {} } },
    preparationProgress: stage => stages.push(stage), backgroundYield: async () => {},
    performance: { now: () => 0 }, navigator: {},
    requestAnimationFrame: callback => setImmediate(callback),
    document: { readyState: "complete", querySelector: selector => selector === "#ui-root" ? menu : null },
    window: { addEventListener(name, callback) { events[name] = callback; } },
    fetch: async () => new Response(JSON.stringify({ version: second.version })),
    loadGame: async () => ({ gameReady: { async prepareResources() { if (++attempts === 1 && fail) throw Error("Preparation failed"); } } })
  });
  vm.runInContext(boot, context);
  await vm.runInContext("prepare()", context);
  assert.equal(stages.at(-1), fail ? "update" : "ready");
  events.online();
  await vm.runInContext("prepare()", context);
  assert.equal(stages.at(-1), "ready", "successful preparation stays complete after reconnect");
  assert.equal(attempts, fail ? 2 : 1, "reconnect retries failures, not completed preparation");
}

await prepareSurfaceTextures(["PREPARED"]);
for (const [seed, machined, finish] of [["PREPARED-ground", false, "concrete"], ["machined-glass", true, "glass"]]) {
  const textures = surfaceTextures(seed, 4, machined, finish), expected = surfaceTextureData(seed, machined, finish);
  textures.forEach((texture, index) => { assert.deepEqual(texture.image.data, expected[index]); texture.dispose(); });
}
console.log("Release integrity, interrupted updates, offline rollback, storage failure, menu ordering and prepared texture equivalence passed.");

// Reuse identical generated inputs, invalidate both changed inputs and changed
// generator releases, and recover when optional storage is corrupt/unavailable.
const generatedSource = (await readFile("src/generatedResourceStore.js", "utf8")).replace(/^import .*;\r?\n/gm, "")
  .replace("export async function generatedResource", "async function generatedResource");
const records = new Map();
let storeFails = false;
const requestFor = value => {
  const request = { result: value };
  setImmediate(() => request.onsuccess?.());
  return request;
};
const db = { transaction() {
  const transaction = { objectStore: () => ({
    get: id => requestFor(records.get(id)),
    put(value, id) { if (storeFails) throw Error("Quota"); records.set(id, value); },
    getAllKeys: () => requestFor([...records.keys()]),
    delete: id => records.delete(id)
  }) };
  setImmediate(() => setImmediate(() => transaction.oncomplete?.()));
  return transaction;
} };
const generator = version => vm.runInNewContext(`${generatedSource}\ngeneratedResource`, {
  RESOURCE_VERSION: version, setTimeout, clearTimeout, indexedDB: { open: () => requestFor(db) }
});
let generations = 0;
const create = () => ({ pixels: ++generations }), valid = value => Number.isInteger(value.pixels);
const generateA = generator("release-a"), generateB = generator("release-b");
await generateA(["texture", "seed-a"], create, valid);
await generateA(["texture", "seed-a"], create, valid);
assert.equal(generations, 1);
await generateA(["texture", "seed-b"], create, valid);
await generateB(["texture", "seed-a"], create, valid);
assert.equal(generations, 3, "seed and source-version changes independently invalidate generated outputs");
assert.ok([...records.keys()].every(key => key.startsWith("release-b:")), "obsolete generated releases are pruned");
records.set('release-b:["texture","seed-a"]', { corrupt: true });
await generateB(["texture", "seed-a"], create, valid);
assert.equal(generations, 4, "invalid generated records are recreated");
storeFails = true;
assert.equal((await generateB(["texture", "uncached"], create, valid)).pixels, 5, "quota errors preserve in-memory generation");

const main = await readFile("src/main.js", "utf8");
const controller = main.slice(main.indexOf("class BlasterBattle"), main.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const Game = new Function("prepareSurfaceTextures", "preparationProgress", "clampBotCount", "console", `return ${controller}`)(
  async () => {}, () => {}, value => value, { warn() {} });
let resolvePreparation, rejectPreparation, builds = 0, menus = 0;
const launch = Object.assign(Object.create(Game.prototype), {
  mode: "training", settings: { botCount: 1 }, sound: {}, timeLimitMinutes: 3,
  clearMatch() { this.resourceLaunchToken = null; }, setMatchLoading() {},
  renderMain() { menus++; },
  prepareResources: () => new Promise((resolve, reject) => { resolvePreparation = resolve; rejectPreparation = reject; }),
  prepareGameplayResources: async () => {},
  renderPipeline: { setHighLoadMode() { builds++; throw Error("arena reached"); } }
});
const cancelled = launch.startMatch(null, true);
assert.equal(builds, 0, "launch waits for shared resource preparation");
launch.resourceLaunchToken = null;
resolvePreparation(); await cancelled;
assert.equal(builds, 0, "leaving setup during preparation cancels the queued match");
const failed = launch.startMatch(null, true);
rejectPreparation(Error("missing resource")); await failed;
assert.equal(menus, 1); assert.equal(builds, 0, "failed preparation cannot enter gameplay");
const readyLaunch = launch.startMatch(null, true);
resolvePreparation(); await assert.rejects(readyLaunch, /arena reached/);
assert.equal(builds, 1);
launch.seed = "OLD";
launch.renderPrivateLobby = () => launch.seed;
assert.equal(await launch.startMatch({ phase: "lobby", seed: "SERVER-SEED" }), "SERVER-SEED", "server seed changes replace the menu's prepared seed");
console.log("Generated cache identity/repair/quota and match-preparation cancellation/failure checks passed.");
