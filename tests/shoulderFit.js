import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// QA-only: authenticate the authored cap/bearing suffixes, leaving every prefix intact.
function replaceSuffix(source, expected, replacement) {
  if (source.index) throw Error("Expected non-indexed shoulder batch");
  for (const [name, ref] of Object.entries(expected.attributes)) {
    const attr = source.attributes[name], start = attr?.array.length - ref.array.length;
    if (!attr || attr.itemSize !== ref.itemSize || start < 0 ||
        ref.array.some((v, i) => Math.abs(v - attr.array[start + i]) > 1e-7)) throw Error(`Unexpected shoulder ${name} suffix`);
  }
  const result = source.clone();
  for (const [name, ref] of Object.entries(replacement.attributes)) result.attributes[name].array.set(ref.array, result.attributes[name].array.length - ref.array.length);
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

export async function withAlignedShoulders(hero, capture, previous = false) {
  const variant = [...hero.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  if (variant === 1) throw Error("Variant 1 already has the accepted fit");
  const armor = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.armorMaterial);
  const cap = variant === 3 ? new THREE.DodecahedronGeometry(.25, 0) : new RoundedBoxGeometry(.34, .27, .48, 1, .0378);
  const base = cap.index ? cap.toNonIndexed() : cap;
  const expected = new THREE.BufferGeometry(), replacement = new THREE.BufferGeometry(), pieces = [], fittedPieces = [];
  const originals = [];
  try {
    for (const side of [-1, 1]) {
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(side * .57, 1.62, -.02),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * .16)),
        new THREE.Vector3(...(variant === 0 ? [1.3, .82, 1.22] : variant === 2 ? [.84, 1.34, .92] : [1, 1, 1])));
      pieces.push(base.clone().applyMatrix4(matrix));
      const fittedMatrix = new THREE.Matrix4().compose(new THREE.Vector3(side * .61, 1.62, -.02),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * .16)),
        new THREE.Vector3(...(variant === 0 ? [1.3, .82, 1.22] : variant === 2 ? [1.15, 1.34, .92] : [1, 1, 1])));
      fittedPieces.push(base.clone().applyMatrix4(fittedMatrix));
    }
    for (const name of Object.keys(base.attributes)) {
      for (const [list, geometry] of [[pieces, expected], [fittedPieces, replacement]]) {
        const arrays = list.map(p => p.attributes[name].array), data = new Float32Array(arrays[0].length + arrays[1].length);
        data.set(arrays[0]); data.set(arrays[1], arrays[0].length);
        geometry.setAttribute(name, new THREE.BufferAttribute(data, base.attributes[name].itemSize));
      }
    }
    const add = (mesh, geometry) => {
      const sibling = new THREE.Mesh(geometry, mesh.material);
      sibling.position.copy(mesh.position); sibling.quaternion.copy(mesh.quaternion); sibling.scale.copy(mesh.scale);
      sibling.castShadow = mesh.castShadow; sibling.receiveShadow = mesh.receiveShadow;
      originals.push([mesh, mesh.visible, sibling]); mesh.parent.add(sibling); mesh.visible = false;
      sibling.updateWorldMatrix(true, false);
      return sibling;
    };
    const armorTarget = add(armor, replaceSuffix(armor.geometry, previous ? replacement : expected, previous ? expected : replacement));
    const indexed = new THREE.SphereGeometry(.18, 10, 6), sphere = indexed.toNonIndexed().translate(0, -.045, 0);
    const fittedIndexed = new THREE.SphereGeometry(.16, 10, 6), fitted = fittedIndexed.toNonIndexed().translate(0, -.045, 0);
    try {
      for (const arm of [hero.leftArm, hero.rightArm]) add(arm.children[0], replaceSuffix(arm.children[0].geometry, previous ? fitted : sphere, previous ? sphere : fitted));
    } finally { indexed.dispose(); sphere.dispose(); fittedIndexed.dispose(); fitted.dispose(); }
    return await capture(armorTarget);
  } finally {
    for (const [mesh, visible, sibling] of originals) { sibling.removeFromParent(); mesh.visible = visible; sibling.geometry.dispose(); }
    for (const piece of [...pieces, ...fittedPieces]) piece.dispose(); expected.dispose(); replacement.dispose();
    if (base !== cap) base.dispose(); cap.dispose();
  }
}
