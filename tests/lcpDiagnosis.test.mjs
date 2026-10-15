import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { LCP_DIAGNOSIS_PATH, LCP_DIAGNOSTIC_VARIANTS, lcpDiagnosticVariant, writeLcpDiagnosis } from "../scripts/lcp-diagnosis.mjs";

const fontsCss = (await readFile(new URL("../public/fonts/fonts.css", import.meta.url), "utf8")).replaceAll("/fonts/", "/resources/body/");
const html = `<!doctype html><html lang="en"><head>
<meta charset="UTF-8" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="https://masterblaster.se/" />
<meta name="blaster-release" content="same-built-release" />
<link rel="preload" as="font" href="/resources/heading/regular.woff2" />
<link rel="preload" as="font" href="/resources/heading/italic.woff2" />
<link rel="preload" as="image" href="/resources/image/menu.webp" />
<link rel="preload" as="font" href="/resources/body/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg-latin.woff2" crossorigin />
<style data-fonts>${fontsCss}</style>
<style>.arena-towers { background-image: url("/resources/image/menu.webp"); }</style>
<style>:root { font-family: Inter, "Inter Fallback", system-ui, sans-serif; } .hero-panel h1 { font-family: "Barlow Condensed", "Barlow Condensed Fallback", sans-serif; }</style>
<script defer src="https://cloud.umami.is/script.js" data-auto-pageview="false"></script>
<script type="module" crossorigin src="/assets/index-boot.js"></script>
</head><body><div id="resource-progress"></div><main class="menu-shell" data-menu-scene="landing"><section class="hero-panel"><h1>SWING WILD.<br><em>BREAK EVERYTHING.</em></h1></section><div class="menu-atmosphere"><span></span></div></main>
<script>/* inline initial settings retained */</script></body></html>`;
const baseline = lcpDiagnosticVariant(html, "priority");
assert.equal(baseline.replace(' data-lcp-variant="priority"', "").replace('content="noindex, follow"', 'content="index, follow, max-image-preview:large"'), html);
assert.throws(() => lcpDiagnosticVariant(html, "unknown"), /Unknown/);
assert.throws(() => lcpDiagnosticVariant(html.replace('type="module"', 'type="text/plain"'), "shell"), /one production boot module/);
assert.throws(() => lcpDiagnosticVariant(html.replace('defer src="https://cloud.umami.is', 'async src="https://cloud.umami.is'), "analytics-async"), /deferred, non-async/);
assert.throws(() => lcpDiagnosticVariant(html.replace('type="module"', 'type="module" fetchpriority="high"'), "boot-low"), /without an existing priority/);
for (const variant of ["image-low", "image-css"]) {
  assert.throws(() => lcpDiagnosticVariant(html.replace('as="image"', 'as="image" fetchpriority="high"'), variant), /without an existing priority/);
  assert.throws(() => lcpDiagnosticVariant(html.replace('as="image"', 'as="fetch"'), variant), /one background image preload/);
  assert.throws(() => lcpDiagnosticVariant(html.replace('as="image"', 'as="image" /><link rel="preload" as="image"'), variant), /one background image preload/);
}

for (const variant of LCP_DIAGNOSTIC_VARIANTS) {
  const page = lcpDiagnosticVariant(html, variant);
  assert.ok(page.includes('content="noindex, follow"'));
  assert.ok(page.includes('rel="canonical" href="https://masterblaster.se/"'));
  assert.ok(page.includes('<h1>SWING WILD.<br><em>BREAK EVERYTHING.</em></h1>'));
  assert.ok(page.includes('content="same-built-release"'));
  assert.equal(page.includes('src="https://cloud.umami.is/script.js"'), variant !== "no-analytics");
  assert.ok(page.includes('/* inline initial settings retained */'));
  assert.equal(page.includes('src="/assets/index-boot.js"'), variant !== "shell");
  assert.equal(page.includes('data-lcp-diagnostic="no-blur"'), variant === "no-blur");
  assert.equal(page.includes('data-lcp-diagnostic="still"'), variant === "still");
  assert.equal(page.includes('href="/resources/body/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg-latin.woff2"'), variant === "body-preload");
  assert.ok(!page.includes("lcp-probe-results"));
  assert.equal(page.includes('fetchpriority="low"'), ["image-low", "boot-low"].includes(variant));
  assert.equal(page.includes('as="image"'), !["image-css", "no-art"].includes(variant));
  assert.equal(page.includes('data-lcp-diagnostic="art-exclusion"'), ["no-art", "unused-art"].includes(variant));
  assert.ok(page.includes('background-image: url("/resources/image/menu.webp")'));
}
const normalizeVariant = page => page.replace(/data-lcp-variant="[^"]+"/, 'data-lcp-variant="priority"');
assert.equal(normalizeVariant(lcpDiagnosticVariant(html, "image-low")).replace(' fetchpriority="low"', ""), baseline);
assert.equal(normalizeVariant(lcpDiagnosticVariant(html, "image-css")), baseline.replace('<link rel="preload" as="image" href="/resources/image/menu.webp" />', ""));
assert.equal(normalizeVariant(lcpDiagnosticVariant(html, "analytics-async")), baseline.replace('defer src="https://cloud.umami.is', 'async src="https://cloud.umami.is'));
assert.equal(normalizeVariant(lcpDiagnosticVariant(html, "boot-low")), baseline.replace('src="/assets/index-boot.js">', 'src="/assets/index-boot.js" fetchpriority="low">'));
const artOverride = '<style data-lcp-diagnostic="art-exclusion">.menu-shell[data-menu-scene="landing"] .arena-towers { background-image: none !important; }</style>\n';
assert.equal(normalizeVariant(lcpDiagnosticVariant(html, "unused-art")).replace(artOverride, ""), baseline);
assert.equal(normalizeVariant(lcpDiagnosticVariant(html, "no-art")).replace(artOverride, ""), baseline.replace('<link rel="preload" as="image" href="/resources/image/menu.webp" />', ""));
for (const variant of ["no-art", "unused-art"]) assert.throws(() => lcpDiagnosticVariant(html.replace('as="image"', 'as="fetch"'), variant), /art exclusion control/);
const bodyFallback = lcpDiagnosticVariant(html, "body-fallback");
const fontRules = fontsCss.match(/@font-face\s*\{[^{}]*\}/gi);
const interRules = fontRules.filter(rule => /font-family:\s*'Inter';/.test(rule));
assert.equal(interRules.length, 6);
for (const rule of interRules) assert.ok(!bodyFallback.includes(rule));
for (const rule of fontRules.filter(rule => !interRules.includes(rule))) assert.ok(bodyFallback.includes(rule));
assert.equal((bodyFallback.match(/font-family:\s*'Inter Fallback';/g) || []).length, 3);
assert.ok(!bodyFallback.includes('href="/resources/body/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg-latin.woff2"'));
assert.ok(bodyFallback.includes('href="/resources/heading/regular.woff2"'));
assert.ok(bodyFallback.includes('href="/resources/heading/italic.woff2"'));
assert.ok(bodyFallback.includes('font-family: Inter, "Inter Fallback", system-ui, sans-serif;'));
const expectedFallback = interRules.reduce((page, rule) => page.replace(rule, ""), baseline).replace('<link rel="preload" as="font" href="/resources/body/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg-latin.woff2" crossorigin />', "");
assert.equal(normalizeVariant(bodyFallback), expectedFallback);
assert.throws(() => lcpDiagnosticVariant(html.replace(interRules[0], ""), "body-fallback"), /six external Inter/);
assert.throws(() => lcpDiagnosticVariant(html.replace("</style>", `${interRules[0]}</style>`), "body-fallback"), /six external Inter/);
assert.throws(() => lcpDiagnosticVariant(html.replace('LyfMZg-latin.woff2" crossorigin', 'Missing-latin.woff2" crossorigin'), "body-fallback"), /one Inter 400 Latin preload/);
assert.throws(() => lcpDiagnosticVariant(html.replace('<style data-fonts>', '<style data-fonts></style><style data-fonts>'), "body-fallback"), /one inlined data-fonts style/);
assert.throws(() => lcpDiagnosticVariant(html.replace('<style data-fonts>', '<link rel="preload" as="font" href="/resources/duplicate/LyfMZg-latin.woff2" /><style data-fonts>'), "body-fallback"), /one Inter 400 Latin preload/);
const withBody = lcpDiagnosticVariant(html, "body-preload");
assert.ok(withBody.indexOf('href="/resources/heading/italic.woff2"') < withBody.indexOf('href="/resources/body/'));
assert.ok(withBody.indexOf('href="/resources/body/') < withBody.indexOf('as="image"'));

const dir = await mkdtemp(join(tmpdir(), "master-blaster-lcp-diagnosis-"));
try {
  await writeFile(join(dir, "index.html"), html);
  const result = await writeLcpDiagnosis(dir);
  assert.equal(result.variants.length, 13);
  assert.equal(await readFile(join(dir, "index.html"), "utf8"), html);
  for (const variant of LCP_DIAGNOSTIC_VARIANTS) {
    const scored = await readFile(join(dir, LCP_DIAGNOSIS_PATH, variant, "index.html"), "utf8");
    const diagnostic = await readFile(join(dir, LCP_DIAGNOSIS_PATH, "diagnostic", variant, "index.html"), "utf8");
    assert.equal(scored, lcpDiagnosticVariant(html, variant));
    assert.ok(!scored.includes("data-lcp-diagnostic-probe"));
    assert.ok(diagnostic.includes("lcp-probe-results"));
    assert.equal(diagnostic.replace(/\n<script data-lcp-diagnostic-probe>[\s\S]*?<\/script>/, ""), scored);
    assert.ok(diagnostic.indexOf("data-lcp-diagnostic-probe") < diagnostic.indexOf('<meta name="robots"'));
    assert.ok(diagnostic.indexOf('charset="UTF-8"') < diagnostic.indexOf("data-lcp-diagnostic-probe"));
  }
} finally {
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + "/") || resolve(dir).startsWith(resolve(tmpdir()) + "\\"));
  assert.ok(dir.includes("master-blaster-lcp-diagnosis-"));
  await rm(dir, { recursive: true, force: true });
}

let timer, output, now = 0;
let nextFrame = 0, focused = true;
const frameCallbacks = new Map();
const documentEvents = new Map();
const measurements = [];
const entries = {
  "largest-contentful-paint": [{ startTime: 2100, renderTime: 2100, loadTime: 0, size: 12000, element: null, url: "" }],
  paint: [{ name: "first-contentful-paint", startTime: 1300 }],
  "layout-shift": [{ startTime: 100, value: .02, hadRecentInput: false, sources: [] }, { startTime: 500, value: .03, hadRecentInput: false, sources: [] }, { startTime: 1600, value: .04, hadRecentInput: false, sources: [] }, { startTime: 1800, value: .9, hadRecentInput: true, sources: [] }],
  longtask: [{ startTime: 1800, duration: 80, name: "self" }],
  "long-animation-frame": Array.from({ length: 25 }, (_, index) => ({ startTime: 100 + index * 50, duration: 70, blockingDuration: 20, renderStart: 110 + index * 50, styleAndLayoutStart: 130 + index * 50, scripts: [{ sourceFunctionName: "updateMenu", sourceURL: "https://example.test/assets/main-test.js?ignored=1", duration: 12 }] })),
  resource: [{ name: "https://example.test/resources/a/menu-arena-v2.webp", startTime: 100, responseEnd: 700 }, { name: "https://example.test/resources/b/font.woff2?query=1", startTime: 120, responseEnd: 400 }, { name: "https://example.test/resources/b/font.woff2?query=1", startTime: 120, responseEnd: 400 }, { name: "https://example.test/unrelated.js", startTime: 40, responseEnd: 500 }, ...Array.from({ length: 40 }, (_, index) => ({ name: `https://example.test/font-${index}.woff2`, startTime: 200, responseEnd: 800 + index }))]
};
class PerformanceObserverStub {
  static supportedEntryTypes = Object.keys(entries);
  observe({ type }) { this.type = type; }
  takeRecords() { return entries[this.type]; }
  disconnect() {}
}
const fonts = Object.assign([], { status: "loaded", ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} });
const context = {
  PerformanceObserver: PerformanceObserverStub,
  MutationObserver: class { observe() {} disconnect() {} },
  performance: { now: () => now, getEntriesByType: () => [], measure: (name, options) => measurements.push({ name, ...options }) },
  document: { fonts, documentElement: { dataset: { lcpVariant: "priority" } }, body: { append: node => output = node }, readyState: "complete", visibilityState: "visible", hasFocus: () => focused, querySelector: () => null, addEventListener: (type, fn) => documentEvents.set(type, fn), removeEventListener: type => documentEvents.delete(type), createElement: () => ({}) },
  window: { addEventListener() {}, removeEventListener() {} },
  requestAnimationFrame: fn => { frameCallbacks.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frameCallbacks.delete(id), setTimeout: fn => { timer = fn; },
  navigator: { userAgent: "unit-check" }, location: { pathname: "/test/" }, innerWidth: 400, innerHeight: 800, devicePixelRatio: 2, Date
};
vm.runInNewContext(await readFile(new URL("../scripts/lcp-diagnosis-probe.js", import.meta.url), "utf8"), context);
for (let frame = 1; frame <= 20; frame++) {
  now = frame * 16;
  const pending = [...frameCallbacks.values()];
  frameCallbacks.clear();
  for (const callback of pending) callback(now);
}
context.document.visibilityState = "hidden";
focused = false;
documentEvents.get("visibilitychange")({ type: "visibilitychange" });
context.document.visibilityState = "visible";
focused = true;
documentEvents.get("visibilitychange")({ type: "visibilitychange" });
now = 10000;
timer();
const snapshot = JSON.parse(output.textContent);
assert.equal(output.id, "lcp-probe-results");
assert.equal(snapshot.completed, true);
assert.equal(snapshot.lcpMs, 2100);
assert.equal(snapshot.cls, .05);
assert.equal(snapshot.conditions.viewport.width, 400);
assert.ok(snapshot.conditions.cache.includes("neither clears"));
assert.ok(measurements.some(entry => entry.name.includes("candidate 1") && entry.start === 0 && entry.end === 2100));
assert.ok(measurements.every(entry => entry.name.startsWith("LCP diagnosis: ")));
assert.equal(snapshot.resourceCompletions.length, 32);
assert.equal(snapshot.resourceCompletions.filter(entry => entry.name === "font.woff2").length, 1);
assert.ok(measurements.some(entry => entry.name.includes("resource complete menu-arena-v2.webp") && entry.end === 700));
assert.ok(measurements.some(entry => entry.name.includes("resource complete font.woff2") && entry.end === 400));
assert.ok(!measurements.some(entry => entry.name.includes("unrelated.js")));
assert.equal(snapshot.frames.length, 10);
assert.equal(snapshot.frames[0].timestamp, 16);
assert.equal(snapshot.frames[9].timestamp, 160);
assert.equal(snapshot.visibility[0].reason, "probe-start");
assert.equal(snapshot.visibility[1].visibility, "hidden");
assert.equal(snapshot.visibility[1].focused, false);
assert.equal(snapshot.longAnimationFrames.length, 20);
assert.equal(snapshot.longAnimationFrames[0].scripts[0].source, "main-test.js");
assert.ok(measurements.some(entry => entry.name.includes("LoAF 1 ") && entry.start === 100 && entry.duration === 70));
assert.equal(frameCallbacks.size, 0);
assert.ok(!documentEvents.has("visibilitychange"));
console.log("LCP diagnosis checks passed: thirteen isolated arms, noindex/canonical/shared content, probe-only diagnostics, bounded LCP/CLS and resource User Timing output.");
