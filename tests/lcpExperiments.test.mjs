import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { lcpVariant } from "../scripts/lcp-experiments.mjs";
import { HEADING_CSS } from "../scripts/lcp-experiment-data.mjs";

const original = await readFile("dist/client/index.html", "utf8");
for (const name of ["baseline", "priority", "fonts", "spacing", "combined"]) {
  const html = lcpVariant(original, name, HEADING_CSS);
  assert.ok(html.includes(`data-lcp-variant="${name}"`));
  assert.ok(html.includes('name="robots" content="noindex, follow"'));
  assert.ok(html.includes('rel="canonical" href="https://masterblaster.se/"'));
  assert.equal((html.match(/data-heading-subset/g) || []).length, ["fonts", "combined"].includes(name) ? 1 : 0);
  assert.ok(!html.includes("lcp-probe-results"), "scored variants contain no instrumentation");
  if (["spacing", "combined"].includes(name)) {
    assert.match(html, /body:has\(#resource-progress\) \[data-menu-scene/);
    assert.ok(!html.includes('body:has(#resource-progress:not([hidden])) [data-menu-scene'));
    assert.ok(html.includes('body:has(#resource-progress:not([hidden]) [data-resource-retry]'), "retry spacing remains conditional");
  }
  const preloads = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*>/g)].map(([tag]) => tag);
  const barlow = preloads.filter(tag => /HTx[wy]L3I/.test(tag));
  assert.equal(barlow.length, ["fonts", "combined"].includes(name) ? 0 : 2);
  const image = preloads.find(tag => tag.includes("menu-arena-v2.webp"));
  assert.equal(image.includes('fetchpriority="high"'), !["priority", "combined"].includes(name));
  if (name === "priority") {
    assert.ok(barlow.every(tag => tag.includes('fetchpriority="high"')));
    assert.ok(html.indexOf(barlow[0]) < html.indexOf(image));
  }
}
assert.ok(!original.includes("lcp-experiment"), "the production homepage is unchanged");
console.log("LCP experiment isolation and hosting metadata checks passed.");
