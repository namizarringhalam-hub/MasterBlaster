import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import Geometries from "three/src/renderers/common/Geometries.js";
import Attributes from "three/src/renderers/common/Attributes.js";
import Info from "three/src/renderers/common/Info.js";
import { readFileSync } from "node:fs";
import { original, replacement, patchGeometryDisposal } from "../scripts/patch-three.mjs";

assert.equal(patchGeometryDisposal(original), replacement);
assert.equal(patchGeometryDisposal(replacement), replacement, "install/build hooks are idempotent");
assert.throws(() => patchGeometryDisposal("unexpected source"), /source changed/);
assert.throws(() => patchGeometryDisposal(original + original), /source changed/);
for (const path of ["src/renderers/common/Geometries.js", "build/three.webgpu.js", "build/three.webgpu.nodes.js"]) {
  const source = readFileSync(new URL(`../node_modules/three/${path}`, import.meta.url), "utf8");
  assert.equal(source.split(replacement).length, 2, `${path} must contain exactly the validated cleanup backport`);
}

// Exercise the real library lifecycle with an allocation-counting GPU stand-in.
// Shadow shaders omit normal/color; the later visible pass uploads both.
const allocated = new Set(), destroyed = new Map();
const backend = {
  createAttribute: attribute => allocated.add(attribute),
  createIndexAttribute: attribute => allocated.add(attribute),
  updateAttribute() {},
  destroyAttribute(attribute) {
    assert.ok(allocated.delete(attribute), "no duplicate GPU buffer destruction");
    destroyed.set(attribute, (destroyed.get(attribute) || 0) + 1);
  }
};
const info = new Info(), attributes = new Attributes(backend, info), geometries = new Geometries(attributes, info);
for (let cycle = 0; cycle < 10; cycle++) {
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(72), 3));
  const nodeAttribute = new THREE.Float32BufferAttribute(new Float32Array(24), 1);
  const shadow = { geometry, material: {}, getAttributes: () => [geometry.attributes.position, nodeAttribute] };
  const visible = { geometry, material: {}, getAttributes: () => [geometry.attributes.position, geometry.attributes.normal, geometry.attributes.color, nodeAttribute] };
  info.render.calls++;
  geometries.updateForRender(cycle % 2 ? visible : shadow);
  geometries.updateForRender(cycle % 2 ? shadow : visible);
  assert.equal(info.memory.attributes, 4);
  assert.equal(info.memory.indexAttributes, 1);
  geometry.dispose(); geometry.dispose();
  assert.equal(allocated.size, 0, "all main-pass and node buffers must be released even when shadow pass initialized geometry");
  assert.equal(info.memory.attributes, 0);
  assert.equal(info.memory.attributesSize, 0);
  assert.equal(info.memory.indexAttributes, 0);
  assert.equal(info.memory.geometries, 0);
  assert.equal(info.memory.total, 0);
}
geometries.dispose();
console.log("Three multipass geometry disposal: ten cycles, both pass orders, zero retained attributes or duplicate destruction.");
