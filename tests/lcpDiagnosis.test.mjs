import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { LCP_DIAGNOSIS_PATH, LCP_DIAGNOSTIC_VARIANTS, lcpDiagnosticVariant, writeLcpDiagnosis } from "../scripts/lcp-diagnosis.mjs";

const html = `<!doctype html><html lang="en"><head>
<meta charset="UTF-8" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="https://masterblaster.se/" />
<meta name="blaster-release" content="same-built-release" />
<link rel="preload" as="font" href="/resources/heading/regular.woff2" />
<link rel="preload" as="font" href="/resources/heading/italic.woff2" />
<link rel="preload" as="image" href="/resources/image/menu.webp" />
<style data-fonts>@font-face { font-family: Inter; font-weight: 700; src: url(/resources/body/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg-latin.woff2); }</style>
<script defer src="https://cloud.umami.is/script.js" data-auto-pageview="false"></script>
<script type="module" crossorigin src="/assets/index-boot.js"></script>
</head><body><div id="resource-progress"></div><main class="menu-shell" data-menu-scene="landing"><section class="hero-panel"><h1>SWING WILD.<br><em>BREAK EVERYTHING.</em></h1></section><div class="menu-atmosphere"><span></span></div></main>
<script>/* inline initial settings retained */</script></body></html>`;
const baseline = lcpDiagnosticVariant(html, "priority");
assert.equal(baseline.replace(' data-lcp-variant="priority"', "").replace('content="noindex, follow"', 'content="index, follow, max-image-preview:large"'), html);
assert.throws(() => lcpDiagnosticVariant(html, "unknown"), /Unknown/);
assert.throws(() => lcpDiagnosticVariant(html.replace('type="module"', 'type="text/plain"'), "shell"), /one production boot module/);

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
}
const withBody = lcpDiagnosticVariant(html, "body-preload");
assert.ok(withBody.indexOf('href="/resources/heading/italic.woff2"') < withBody.indexOf('href="/resources/body/'));
assert.ok(withBody.indexOf('href="/resources/body/') < withBody.indexOf('as="image"'));

const dir = await mkdtemp(join(tmpdir(), "master-blaster-lcp-diagnosis-"));
try {
  await writeFile(join(dir, "index.html"), html);
  const result = await writeLcpDiagnosis(dir);
  assert.equal(result.variants.length, 6);
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
const measurements = [];
const entries = {
  "largest-contentful-paint": [{ startTime: 2100, renderTime: 2100, loadTime: 0, size: 12000, element: null, url: "" }],
  paint: [{ name: "first-contentful-paint", startTime: 1300 }],
  "layout-shift": [{ startTime: 100, value: .02, hadRecentInput: false, sources: [] }, { startTime: 500, value: .03, hadRecentInput: false, sources: [] }, { startTime: 1600, value: .04, hadRecentInput: false, sources: [] }, { startTime: 1800, value: .9, hadRecentInput: true, sources: [] }],
  longtask: [{ startTime: 1800, duration: 80, name: "self" }]
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
  document: { fonts, documentElement: { dataset: { lcpVariant: "priority" } }, body: { append: node => output = node }, readyState: "complete", visibilityState: "visible", querySelector: () => null, addEventListener() {}, removeEventListener() {}, createElement: () => ({}) },
  window: { addEventListener() {}, removeEventListener() {} },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: fn => { timer = fn; },
  navigator: { userAgent: "unit-check" }, location: { pathname: "/test/" }, innerWidth: 400, innerHeight: 800, devicePixelRatio: 2, Date
};
vm.runInNewContext(await readFile(new URL("../scripts/lcp-diagnosis-probe.js", import.meta.url), "utf8"), context);
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
console.log("LCP diagnosis checks passed: six isolated arms, noindex/canonical/shared content, probe-only diagnostics, bounded LCP/CLS and User Timing output.");
