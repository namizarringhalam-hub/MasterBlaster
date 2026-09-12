import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { exhaustShroudGeometry } from "../src/player.js";
export { exhaustShroudGeometry };

export function exhaustBody(hero) {
  const target = hero.rig.children.find(mesh => mesh.isMesh && mesh.visible && mesh.material === hero.darkMaterial && mesh.position.lengthSq() === 0);
  if (!target || target.geometry.index || ![1080, 1464, 2268, 2652].includes(target.geometry.attributes.position.count)) throw new Error("Unexpected static body layout");
  return target;
}

export function previousExhaustGeometries(hero) {
  const target = exhaustBody(hero);
  if (![2268, 2652].includes(target.geometry.attributes.position.count)) throw new Error("Previous comparison requires integrated exhaust");
  const light = hero.rig.children.find(mesh => mesh.isMesh && mesh.visible && mesh.material === hero.accentMaterial && mesh.position.lengthSq() === 0);
  const variant = [...hero.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  const scale = new THREE.Vector3(variant === 3 ? .72 : 1, variant === 3 ? 1.28 : 1, 1);
  const expected = new RoundedBoxGeometry(.38, .32, .055, 1, .055 * .14), previous = expected.clone();
  let bodyGeometry, lightGeometry;
  try {
    expected.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 1.42, -.64), new THREE.Quaternion(), scale));
    previous.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 1.42, -.58), new THREE.Quaternion(), scale));
    for (const [name, attribute] of Object.entries(expected.attributes)) {
      const actual = light.geometry.attributes[name], start = actual.array.length - attribute.array.length;
      if (start < 0 || !attribute.array.every((value, index) => Object.is(value, actual.array[start + index]))) throw new Error("Unexpected integrated pack-light suffix");
    }
    bodyGeometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(target.geometry.attributes))
      bodyGeometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array.slice(0, (target.geometry.attributes.position.count - 1188) * attribute.itemSize), attribute.itemSize));
    lightGeometry = new THREE.BufferGeometry().copy(light.geometry);
    const positions = lightGeometry.attributes.position.array;
    positions.set(previous.attributes.position.array, positions.length - previous.attributes.position.array.length);
    lightGeometry.computeBoundingBox(); lightGeometry.computeBoundingSphere();
    return { body: target, light, bodyGeometry, lightGeometry };
  } catch (error) { bodyGeometry?.dispose(); lightGeometry?.dispose(); throw error; }
  finally { expected.dispose(); previous.dispose(); }
}

export async function withPreviousExhaust(hero, capture) {
  if ([1080, 1464].includes(exhaustBody(hero).geometry.attributes.position.count)) return await capture();
  const { body, light, bodyGeometry, lightGeometry } = previousExhaustGeometries(hero);
  const bodyVisible = body.visible, lightVisible = light.visible;
  const replacement = body.clone(false), panel = light.clone(false);
  replacement.geometry = bodyGeometry; panel.geometry = lightGeometry;
  try {
    body.visible = light.visible = false; hero.rig.add(replacement, panel);
    return await capture(replacement, panel);
  } finally {
    replacement.removeFromParent(); panel.removeFromParent(); body.visible = bodyVisible; light.visible = lightVisible;
    bodyGeometry.dispose(); lightGeometry.dispose();
  }
}

export async function withExhaustShrouds(hero, capture, raisedLight = false) {
  const target = exhaustBody(hero);
  if (![1080, 1464].includes(target.geometry.attributes.position.count) || !hero.thrusterLights?.position.equals(new THREE.Vector3(0, 1.02, -.49)))
    throw new Error("Unexpected static backpack or plume layout");
  const variant = [...hero.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  const original = target.geometry, visible = target.visible, parent = target.parent;
  const left = exhaustShroudGeometry(variant).translate(-.2, 0, -.49), right = left.clone().translate(.4, 0, 0);
  let trial, replacement, lightTarget, lightReplacement, lightGeometry, pedestal, lightVisible;
  try {
    if (raisedLight) {
      lightTarget = hero.rig.children.find(mesh => mesh.isMesh && mesh.visible && mesh.material === hero.accentMaterial && mesh.position.lengthSq() === 0);
      if (!lightTarget || lightTarget.geometry.index) throw new Error("Unexpected pack-light batch");
      const scale = new THREE.Vector3(variant === 3 ? .72 : 1, variant === 3 ? 1.28 : 1, 1);
      const expected = new RoundedBoxGeometry(.38, .32, .055, 1, .055 * .14);
      try {
        expected.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 1.42, -.58), new THREE.Quaternion(), scale));
        for (const [name, attribute] of Object.entries(expected.attributes)) {
          const actual = lightTarget.geometry.attributes[name], start = actual.array.length - attribute.array.length;
          if (start < 0 || !attribute.array.every((value, index) => Object.is(value, actual.array[start + index])))
            throw new Error(`Unexpected rounded pack-light ${name} suffix`);
        }
        lightGeometry = new THREE.BufferGeometry().copy(lightTarget.geometry);
        const positions = lightGeometry.attributes.position;
        for (let i = positions.count - expected.attributes.position.count; i < positions.count; i++) positions.setZ(i, positions.getZ(i) - .060);
        lightGeometry.computeBoundingBox(); lightGeometry.computeBoundingSphere();
      } finally { expected.dispose(); }
      pedestal = new RoundedBoxGeometry(.38 * scale.x - .020, .32 * scale.y - .020, .075, 1, .0105).translate(0, 1.42, -.58);
    }
    trial = mergeGeometries([original, left, right, ...(pedestal ? [pedestal] : [])], false);
    // Keep the live object's cached GPU geometry untouched during a QA swap.
    replacement = target.clone(false); replacement.geometry = trial;
    target.visible = false; parent.add(replacement);
    if (lightGeometry) {
      lightVisible = lightTarget.visible;
      lightReplacement = lightTarget.clone(false); lightReplacement.geometry = lightGeometry;
      lightTarget.visible = false; parent.add(lightReplacement);
    }
    return await capture(replacement, lightReplacement);
  } finally {
    replacement?.removeFromParent(); target.visible = visible;
    lightReplacement?.removeFromParent(); if (lightVisible !== undefined) lightTarget.visible = lightVisible;
    trial?.dispose(); left.dispose(); right.dispose(); pedestal?.dispose(); lightGeometry?.dispose();
  }
}
