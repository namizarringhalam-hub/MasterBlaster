import * as THREE from "three/webgpu";
import { exhaustBody } from "./exhaustShroudGeometry.js";
import { torsoGeometry, fittedTorsoGeometry } from "../src/player.js";

// QA-only: authenticate the torso prefix before touching its lower hemisphere.
export function shortenedTorsoGeometry(source, previous = false, fittedVariant = null) {
  if (fittedVariant !== null) {
    if (!previous) throw Error("Fitted chest comparison requires previous lower core");
    const expected = fittedTorsoGeometry(fittedVariant).clone().applyMatrix4(new THREE.Matrix4());
    try {
      for (const [name, attr] of Object.entries(expected.attributes)) if (!source.attributes[name] ||
          attr.array.some((v, i) => Math.abs(v - source.attributes[name].array[i]) > 1e-7)) throw Error(`Unexpected fitted torso ${name} prefix`);
      const result = source.clone(), p = result.attributes.position, n = result.attributes.normal, normal = new THREE.Vector3();
      for (let i = 0; i < expected.attributes.position.count; i++) {
        const y = p.getY(i); if (y >= .91) continue;
        p.setY(i, .91 + (y - .91) * (.39 / .11));
        normal.fromBufferAttribute(n, i); normal.y *= .11 / .39; normal.normalize();
        n.setXYZ(i, normal.x, normal.y, normal.z);
      }
      result.computeBoundingBox(); result.computeBoundingSphere(); return result;
    } finally { expected.dispose(); }
  }
  const capsule = new THREE.CapsuleGeometry(.39, .68, 4, 8);
  const reference = capsule.toNonIndexed().translate(0, 1.25, 0);
  capsule.dispose();
  const integrated = previous ? torsoGeometry() : null;
  const expected = integrated ? integrated.toNonIndexed() : reference;
  integrated?.dispose();
  let result;
  try {
    if (source.index) throw Error("Expected merged non-indexed torso");
    for (const [name, attribute] of Object.entries(expected.attributes)) {
      const actual = source.attributes[name];
      if (!actual || actual.count < attribute.count || actual.itemSize !== attribute.itemSize ||
          attribute.array.some((value, i) => Math.abs(value - actual.array[i]) > 1e-7))
        throw Error(`Unexpected torso ${name} prefix`);
    }
    result = source.clone();
    if (previous) {
      for (const [name, attribute] of Object.entries(reference.attributes)) result.attributes[name].array.set(attribute.array);
      result.computeBoundingBox(); result.computeBoundingSphere();
      return result;
    }
    const positions = result.attributes.position, normals = result.attributes.normal;
    const normal = new THREE.Vector3(), scale = .11 / .39;
    for (let i = 0; i < reference.attributes.position.count; i++) {
      const y = positions.getY(i);
      if (y >= .91) continue;
      positions.setY(i, .91 + (y - .91) * scale);
      normal.fromBufferAttribute(normals, i); normal.y /= scale; normal.normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    result.computeBoundingBox(); result.computeBoundingSphere();
    return result;
  } catch (error) { result?.dispose(); throw error; }
  finally { reference.dispose(); if (expected !== reference) expected.dispose(); }
}

export async function withShortenedTorso(hero, capture, previous = false) {
  const body = exhaustBody(hero), variant = [...hero.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  const geometry = shortenedTorsoGeometry(body.geometry, previous, [1464, 2652].includes(body.geometry.attributes.position.count) ? variant : null);
  const sibling = new THREE.Mesh(geometry, body.material), visible = body.visible;
  sibling.position.copy(body.position); sibling.quaternion.copy(body.quaternion); sibling.scale.copy(body.scale);
  sibling.castShadow = body.castShadow; sibling.receiveShadow = body.receiveShadow;
  try {
    body.parent.add(sibling); body.visible = false; sibling.updateWorldMatrix(true, false);
    return await capture(sibling);
  } finally { sibling.removeFromParent(); body.visible = visible; geometry.dispose(); }
}
