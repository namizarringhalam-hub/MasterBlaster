import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Backport Three's geometry-owned attribute cleanup without a renderer upgrade.
// Upstream: https://github.com/mrdoob/three.js/commit/4e369cb1ba5573a12141af76ca9b1febd2751a12
// Remove this patch only after a library upgrade passes the lifecycle regression.
export const original = "const geometryAttributes = renderObject.getAttributes();";
export const replacement = "const geometryAttributes = new Set( [ ...Object.values( geometry.attributes ), ...renderObject.getAttributes() ] ); // Master Blaster: Three #33939";
export function patchGeometryDisposal(source) {
  if (source.includes(replacement)) {
    assert.equal(source.split(replacement).length, 2, "duplicate Three cleanup patch");
    assert.ok(!source.includes(original), "mixed patched/unpatched Three cleanup");
    return source;
  }
  assert.equal(source.split(original).length, 2, "Three cleanup source changed; revalidate the backport");
  return source.replace(original, replacement);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../node_modules/three/", import.meta.url);
  assert.equal(JSON.parse(readFileSync(new URL("package.json", root))).version, "0.185.1", "Three version changed; revalidate/remove the cleanup backport");
  // Validate every target before mechanically rewriting any installed file.
  const patches = ["src/renderers/common/Geometries.js", "build/three.webgpu.js", "build/three.webgpu.nodes.js"].map(path => {
    const url = new URL(path, root), source = readFileSync(url, "utf8");
    return { url, source, patched: patchGeometryDisposal(source) };
  });
  for (const { url, source, patched } of patches) if (source !== patched) writeFileSync(url, patched);
  console.log("Three 0.185.1 geometry cleanup backport verified.");
}
