import * as THREE from "three/webgpu";
import { clipLegPolygon, torsoGeometry } from "../src/player.js";
import { exhaustBody } from "./exhaustShroudGeometry.js";

// QA-only fit of the inner front surface to the actual polygonal chest housing.
export function fittedChestCore(source, variant) {
  if (![0, 1, 2, 3].includes(variant) || source.index) throw Error("Unexpected chest core");
  const indexed = torsoGeometry(), reference = indexed.toNonIndexed(); indexed.dispose();
  try {
    for (const [name, attribute] of Object.entries(reference.attributes)) {
      const actual = source.attributes[name];
      if (!actual || actual.itemSize !== attribute.itemSize || actual.count < attribute.count ||
          attribute.array.some((value, i) => Math.abs(value - actual.array[i]) > 1e-7)) throw Error(`Unexpected chest ${name} prefix`);
    }
    const segments = [6, 8, 5, 7][variant];
    const frontLimit = (x, y) => {
      const radius = .49 + (.37 - .49) * (y - 1.105) / .65;
      let limit = -Infinity, dx = 0, dy = 0;
      for (let i = 0; i < segments; i++) {
        const a = i * Math.PI * 2 / segments, b = (i + 1) * Math.PI * 2 / segments;
        const ax = Math.sin(a) * radius, bx = Math.sin(b) * radius;
        if (Math.abs(bx - ax) < 1e-9 || x < Math.min(ax, bx) - 1e-9 || x > Math.max(ax, bx) + 1e-9) continue;
        const t = (x - ax) / (bx - ax);
        const z = .015 + .76 * radius * (Math.cos(a) + t * (Math.cos(b) - Math.cos(a)));
        if (z > limit + 1e-9) {
          limit = z;
          const slope = (Math.cos(b) - Math.cos(a)) / (Math.sin(b) - Math.sin(a));
          dx = .76 * slope; dy = .76 * (-.12 / .65) * (Math.cos(a) - Math.sin(a) * slope);
        }
      }
      return { limit, dx, dy };
    };
    const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
    const derivative = value => value <= 0 || value >= 1 ? 0 : 6 * value * (1 - value);
    const fit = v => {
      if (v[2] <= 0 || v[1] <= 1.105 || v[1] >= 1.755) return v;
      // Quantize coordinates before choosing a polygon facet, so shared positions
      // produced by opposite clipping directions receive identical derivatives.
      const x = Math.fround(v[0]), y = Math.fround(v[1]), z = Math.fround(v[2]);
      const surface = frontLimit(x, y), limit = surface.limit - .008;
      if (!Number.isFinite(limit) || limit < 0 || limit >= v[2]) return v;
      const lower = (y - 1.105) / .035, upper = (1.755 - y) / .055;
      const weight = smooth(lower) * smooth(upper);
      const weightY = derivative(lower) / .035 * smooth(upper) - smooth(lower) * derivative(upper) / .055;
      const zx = weight * surface.dx, zy = weight * surface.dy + weightY * (limit - z), zz = 1 - weight;
      // Cofactor form of inverse-transpose: remains defined when the fully
      // contained front surface projects onto the inner housing plane (zz=0).
      const normal = new THREE.Vector3(v[3] * zz - v[5] * zx, v[4] * zz - v[5] * zy, v[5]).normalize();
      const result = [...v]; result[2] = z + (limit - z) * weight;
      result.splice(3, 3, ...normal.toArray()); return result;
    };
    const output = [], p = reference.attributes.position, n = reference.attributes.normal, uv = reference.attributes.uv;
    for (let i = 0; i < p.count; i += 3) {
      const triangle = [0, 1, 2].map(k => [p.getX(i + k), p.getY(i + k), p.getZ(i + k),
        n.getX(i + k), n.getY(i + k), n.getZ(i + k), uv.getX(i + k), uv.getY(i + k)]);
      let polygons = [triangle];
      if (triangle.some(v => v[2] > 1e-8) && triangle.some(v => v[1] > 1.105) && triangle.some(v => v[1] < 1.755)) {
        for (const level of [1.105, 1.105 + .035 / 3, 1.105 + .035 * 2 / 3, 1.14,
          1.70, 1.70 + .055 / 3, 1.70 + .055 * 2 / 3, 1.755]) polygons = polygons.flatMap(poly => {
          if (!poly.some(v => v[1] < level) || !poly.some(v => v[1] > level)) return [poly];
          return [clipLegPolygon(poly, level, false), clipLegPolygon(poly, level, true)];
        });
      }
      for (const polygon of polygons) for (let j = 1; j + 1 < polygon.length; j++) {
        const original = [polygon[0], polygon[j], polygon[j + 1]], points = original.map(fit);
        for (const v of points) output.push(...v);
      }
    }
    const result = new THREE.BufferGeometry();
    for (const [name, offset, size] of [["position", 0, 3], ["normal", 3, 3], ["uv", 6, 2]]) {
      const suffix = source.attributes[name].array.subarray(reference.attributes[name].array.length), data = [];
      for (let i = 0; i < output.length; i += 8) data.push(...output.slice(i + offset, i + offset + size));
      const array = new Float32Array(data.length + suffix.length); array.set(data); array.set(suffix, data.length);
      result.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    result.computeBoundingBox(); result.computeBoundingSphere(); return result;
  } finally { reference.dispose(); }
}

export async function withFittedChestCore(hero, capture) {
  const body = exhaustBody(hero), variant = [...hero.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  const geometry = fittedChestCore(body.geometry, variant), sibling = new THREE.Mesh(geometry, body.material), visible = body.visible;
  sibling.position.copy(body.position); sibling.quaternion.copy(body.quaternion); sibling.scale.copy(body.scale);
  sibling.castShadow = body.castShadow; sibling.receiveShadow = body.receiveShadow;
  try {
    body.parent.add(sibling); body.visible = false; sibling.updateWorldMatrix(true, false);
    return await capture(sibling);
  } finally { sibling.removeFromParent(); body.visible = visible; geometry.dispose(); }
}
