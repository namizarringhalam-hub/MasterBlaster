import * as THREE from "three/webgpu";
import { exhaustBody } from "./exhaustShroudGeometry.js";

// QA-only: authenticate the torso prefix before touching its lower hemisphere.
export function shortenedTorsoGeometry(source) {
  const capsule = new THREE.CapsuleGeometry(.39, .68, 4, 8);
  const reference = capsule.toNonIndexed().translate(0, 1.25, 0);
  capsule.dispose();
  let result;
  try {
    if (source.index) throw Error("Expected merged non-indexed torso");
    for (const [name, attribute] of Object.entries(reference.attributes)) {
      const actual = source.attributes[name];
      if (!actual || actual.count < attribute.count || actual.itemSize !== attribute.itemSize ||
          attribute.array.some((value, i) => Math.abs(value - actual.array[i]) > 1e-7))
        throw Error(`Unexpected torso ${name} prefix`);
    }
    result = source.clone();
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
  finally { reference.dispose(); }
}

export async function withShortenedTorso(hero, capture) {
  const body = exhaustBody(hero), geometry = shortenedTorsoGeometry(body.geometry);
  const sibling = new THREE.Mesh(geometry, body.material), visible = body.visible;
  sibling.position.copy(body.position); sibling.quaternion.copy(body.quaternion); sibling.scale.copy(body.scale);
  sibling.castShadow = body.castShadow; sibling.receiveShadow = body.receiveShadow;
  try {
    body.parent.add(sibling); body.visible = false; sibling.updateWorldMatrix(true, false);
    return await capture(sibling);
  } finally { sibling.removeFromParent(); body.visible = visible; geometry.dispose(); }
}
