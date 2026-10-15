import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { HEADING_CSS, LCP_PROBE } from "./lcp-experiment-data.mjs";

// Temporary, identical-build experiment pages. The normal homepage stays intact.
export function lcpVariant(html, variant, headingCss = "") {
  assert.ok(["baseline", "priority", "fonts", "spacing", "combined"].includes(variant));
  if (["priority", "combined"].includes(variant)) {
    const preloads = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*>/g)].map(([tag]) => tag);
    const fonts = preloads.filter(tag => tag.includes('as="font"') && /HTx[wy]L3I/.test(tag));
    const image = preloads.find(tag => tag.includes("menu-arena-v2.webp"));
    assert.equal(fonts.length, 2);
    assert.ok(image);
    for (const tag of fonts) html = html.replace(tag, "");
    html = html.replace(image, fonts.map(tag => tag.replace("<link", '<link fetchpriority="high"')).join("\n")
      + image.replace(' fetchpriority="high"', ""));
  }
  if (["fonts", "combined"].includes(variant)) {
    assert.ok(headingCss.includes("Master Blaster Hero"));
    html = html.replace(/<link\b[^>]*as="font"[^>]*>/g, tag => /HTx[wy]L3I/.test(tag) ? "" : tag);
    html = html.replace("</head>", `<style data-heading-subset>${headingCss}</style></head>`);
  }
  if (["spacing", "combined"].includes(variant)) {
    const before = 'body:has(#resource-progress:not([hidden])) [data-menu-scene="landing"]';
    // Vite's minifier may remove optional quotes inside the attribute selector.
    const compact = 'body:has(#resource-progress:not([hidden])) [data-menu-scene=landing]';
    assert.ok(html.includes(before) || html.includes(compact));
    html = html.replace(before, 'body:has(#resource-progress) [data-menu-scene="landing"]')
      .replace(compact, 'body:has(#resource-progress) [data-menu-scene=landing]');
  }
  assert.equal((html.match(/<meta name="robots"[^>]*>/g) || []).length, 1);
  assert.ok(html.includes("<html "));
  return html.replace("<html ", `<html data-lcp-variant="${variant}" `)
    .replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, follow" />')
    .replace("</head>", `<meta name="lcp-experiment" content="${variant}"></head>`);
}

export async function writeLcpExperiments() {
  const html = await readFile("dist/client/index.html", "utf8");
  for (const variant of ["baseline", "priority", "fonts", "spacing", "combined"]) {
    const dir = `dist/client/lcp-experiment/${variant}`;
    await mkdir(dir, { recursive: true });
    const page = lcpVariant(html, variant, HEADING_CSS);
    await writeFile(`${dir}/index.html`, page);
    const diagnostic = `dist/client/lcp-experiment/diagnostic/${variant}`;
    await mkdir(diagnostic, { recursive: true });
    await writeFile(`${diagnostic}/index.html`, page.replace("</head>", `<script>${LCP_PROBE}</script></head>`));
  }
}
