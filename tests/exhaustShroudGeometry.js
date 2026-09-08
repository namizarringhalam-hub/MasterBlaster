import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// QA-only closed upper socket with an open, annular lower outlet.
export function exhaustShroudGeometry(variant = 0) {
  if (![0, 1, 2, 3].includes(variant)) throw new Error("Unknown fighter variant");
  const large = variant === 2, y = large ? .9974 : 1.055;
  const profile = [[large ? .056 : .075, y], [large ? .062 : .081, y],
    [.113, 1.137], [.113, 1.460], [0, 1.460], [0, 1.456], [.110, 1.456], [.110, 1.137]];
  const positions = [], normals = [], uvs = [], sides = 12;
  for (let edge = 0; edge < profile.length; edge++) {
    const [r0, y0] = profile[edge], [r1, y1] = profile[(edge + 1) % profile.length];
    if (r0 === 0 && r1 === 0) continue;
    for (let side = 0; side < sides; side++) {
      const a = side * Math.PI * 2 / sides, b = (side + 1) * Math.PI * 2 / sides;
      const point = (r, y, angle) => [r * Math.cos(angle), y, r * Math.sin(angle)];
      const p = point(r0, y0, a), q = point(r1, y1, a), r = point(r1, y1, b), s = point(r0, y0, b);
      const triangles = r0 === 0 ? [[p, q, r]] : r1 === 0 ? [[p, q, s]] : [[p, q, r], [p, r, s]];
      for (const triangle of triangles) {
        const normal = new THREE.Vector3().subVectors(new THREE.Vector3(...triangle[1]), new THREE.Vector3(...triangle[0]))
          .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...triangle[2]), new THREE.Vector3(...triangle[0]))).normalize();
        for (const vertex of triangle) { positions.push(...vertex); normals.push(...normal.toArray()); uvs.push(0, 0); }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

export async function withExhaustShrouds(hero, capture) {
  const target = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.darkMaterial);
  if (!target || target.geometry.index || !hero.thrusterLights?.position.equals(new THREE.Vector3(0, 1.02, -.49)))
    throw new Error("Unexpected static backpack or plume layout");
  const variant = [...hero.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  const original = target.geometry, visible = target.visible, parent = target.parent;
  const left = exhaustShroudGeometry(variant).translate(-.2, 0, -.49), right = left.clone().translate(.4, 0, 0);
  let trial, replacement;
  try {
    trial = mergeGeometries([original, left, right], false);
    // Keep the live object's cached GPU geometry untouched during a QA swap.
    replacement = target.clone(false); replacement.geometry = trial;
    target.visible = false; parent.add(replacement);
    return await capture(replacement);
  } finally { replacement?.removeFromParent(); target.visible = visible; trial?.dispose(); left.dispose(); right.dispose(); }
}
