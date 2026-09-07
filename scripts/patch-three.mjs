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

// Adapt upstream's no-early-return observer path to r185's boolean refresh API.
// https://github.com/mrdoob/three.js/blob/e8356e918ca5d6a44010cd165ac267af8e106662/src/materials/nodes/manager/NodeMaterialObserver.js#L884-L917
// The first object still refreshes shared uniforms, but also synchronizes its
// comparison cache; otherwise changing draw order can freeze an old GPU matrix.
export const matrixOriginal = `\t\tconst { renderId } = nodeFrame;

\t\tif ( this.renderId !== renderId ) {

\t\t\tthis.renderId = renderId;

\t\t\treturn true;

\t\t}

\t\tconst isStatic = renderObject.object.static === true;
\t\tconst isBundle = renderObject.bundle !== null && renderObject.bundle.static === true && this.getRenderObjectData( renderObject ).version === renderObject.bundle.version;

\t\tif ( isStatic || isBundle )
\t\t\treturn false;

\t\tconst lightsData = this.getLights( renderObject.lightsNode, renderId );
\t\tconst notEqual = this.equals( renderObject, lightsData, renderId ) !== true;

\t\treturn notEqual;`;
export const matrixReplacement = matrixOriginal
  .replace("if ( this.renderId !== renderId ) {", "const firstRender = this.renderId !== renderId; // Master Blaster: synchronize observer fast path\n\n\t\tif ( firstRender ) {")
  .replace("\n\t\t\treturn true;\n", "")
  .replace("return false;", "return firstRender;")
  .replace("return notEqual;", "return firstRender || notEqual;");
export function patchObserverCache(source) {
  if (source.includes(matrixReplacement)) {
    assert.equal(source.split(matrixReplacement).length, 2, "duplicate Three observer patch");
    assert.ok(!source.includes(matrixOriginal), "mixed patched/unpatched Three observer");
    return source;
  }
  assert.equal(source.split(matrixOriginal).length, 2, "Three observer source changed; revalidate the cache correction");
  return source.replace(matrixOriginal, matrixReplacement);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../node_modules/three/", import.meta.url);
  assert.equal(JSON.parse(readFileSync(new URL("package.json", root))).version, "0.185.1", "Three version changed; revalidate/remove the pinned corrections");
  // Validate every target before mechanically rewriting any installed file.
  const patches = ["src/renderers/common/Geometries.js", "src/materials/nodes/manager/NodeMaterialObserver.js", "build/three.webgpu.js", "build/three.webgpu.nodes.js"].map(path => {
    const url = new URL(path, root), source = readFileSync(url, "utf8");
    let patched = path.includes("NodeMaterialObserver") ? source : patchGeometryDisposal(source);
    if (!path.includes("Geometries")) patched = patchObserverCache(patched);
    return { url, source, patched };
  });
  for (const { url, source, patched } of patches) if (source !== patched) writeFileSync(url, patched);
  console.log("Three 0.185.1 geometry cleanup and observer cache corrections verified.");
}
