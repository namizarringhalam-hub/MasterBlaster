import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { getCurrentStack, getNormalFromDepth, materialOpacity, normalView, normalViewGeometry, positionViewDirection, setCurrentStack, stack, time as shaderTime, uniform, vec2, vec4 } from "three/tsl";
import NodeMaterialObserver from "../node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js";
import WebGPUPipelineUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js";
import { ArenaWorld, structuralPanelGeometry, structuralRouteGeometry } from "../src/world.js";
import { Fighter, fittedTorsoGeometry, kneeTaperGeometry, legAssemblyGeometry } from "../src/player.js";
import { graphicsProfile, swapStolenWeapon, WEAPONS } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import { NeonRenderPipeline, recoverInvalidAONormals } from "../src/renderPipeline.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { surfaceTextures } from "../src/surfaceTextures.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { weaponUsesAmmo } from "../src/gameData.js";
import { weaponPresentation } from "../src/weaponPresentation.js";
import { shoulderChamferGeometry } from "./shoulderChamferGeometry.js";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { ankleReliefGeometry } from "./ankleReliefGeometry.js";
import { exhaustBody, exhaustShroudGeometry, previousExhaustGeometries, withExhaustShrouds, withPreviousExhaust } from "./exhaustShroudGeometry.js";
import { shortenedTorsoGeometry, withShortenedTorso } from "./torsoShape.js";
import { withAlignedShoulders } from "./shoulderFit.js";
import { fittedChestCore, withFittedChestCore } from "./chestFit.js";

const pre66Source = readFileSync(new URL("../src/player.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("part(fittedTorsoGeometry(costumeVariant), dark, 0, 0, 0)", "part(torsoGeometry(), dark, 0, 0, 0)");
assert.ok(pre66Source.includes("part(torsoGeometry(), dark, 0, 0, 0)"), "pre-Pass66 builder restores the actual previous torso");
const Pre66Fighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${pre66Source}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);

const cachedCores = new Set(); let cachedCoreDisposals = 0;
for (let variant = 0; variant < 4; variant++) {
  const core = fittedTorsoGeometry(variant); cachedCores.add(core);
  assert.equal(fittedTorsoGeometry(variant), core); assert.equal(core.userData.sharedFighterGeometry, true);
  assert.equal(core.attributes.position.count, 816);
  core.addEventListener("dispose", () => cachedCoreDisposals++);
}
assert.equal(cachedCores.size, 4);
assert.throws(() => fittedTorsoGeometry(4), /Unknown fighter variant/);
for (let variant = 0; variant < 4; variant++) for (const weapon of Object.keys(WEAPONS)) {
  const options = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const current = new Fighter(new THREE.Scene(), options, [weapon], new THREE.Vector3());
  const previous = new Pre66Fighter(new THREE.Scene(), options, [weapon], new THREE.Vector3());
  const body = exhaustBody(current), oldBody = exhaustBody(previous), expected = fittedChestCore(oldBody.geometry, variant);
  const reviewedCoreCount = fittedTorsoGeometry(variant).attributes.position.count;
  // Match the normal-matrix normalization performed by the actual pre-merge path.
  const normal = new THREE.Vector3(), normals = expected.attributes.normal;
  for (let i = 0; i < reviewedCoreCount; i++) {
    normal.fromBufferAttribute(normals, i).normalize(); normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  try {
    const a = [], b = [];
    current.group.traverse(o => a.push(o)); previous.group.traverse(o => b.push(o));
    assert.equal(a.length, b.length);
    a.forEach((o, i) => {
      const old = b[i];
      for (const key of ["position", "quaternion", "scale"]) assert.deepEqual(o[key].toArray(), old[key].toArray());
      if (!o.isMesh) return;
      const reference = o === body ? expected : old.geometry;
      assert.deepEqual(o.geometry.index?.array, reference.index?.array);
      for (const [name, attr] of Object.entries(o.geometry.attributes)) assert.deepEqual(attr.array, reference.attributes[name].array,
        `integrated chest ${variant}/${weapon}/${i}/${name} matches the reviewed geometry exactly`);
      for (const key of ["type", "roughness", "metalness", "clearcoat", "clearcoatRoughness", "emissiveIntensity", "opacity", "transparent", "side"])
        assert.equal(o.material[key], old.material[key]);
      for (const key of ["color", "emissive"]) assert.equal(o.material[key]?.getHex(), old.material[key]?.getHex());
    });
    await withFittedChestCore(current, target => {
      for (const [name, attr] of Object.entries(target.geometry.attributes)) assert.deepEqual(attr.array, oldBody.geometry.attributes[name].array,
        "reverse control reconstructs exact published torso and preserves every suffix");
    }, true);
    if (weapon === "blaster") {
      const before = current.group.toJSON();
      await assert.rejects(withFittedChestCore(current, () => { throw Error("reverse core interrupted"); }, true), /reverse core interrupted/);
      assert.deepEqual(current.group.toJSON(), before);
    }
  } finally { expected.dispose(); current.dispose(); previous.dispose(); }
}
assert.equal(cachedCoreDisposals, 0, "fighter/rematch teardown never disposes the bounded immutable source cache");

for (const variant of [0, 1, 2, 3]) {
  const hero = new Pre66Fighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  const body = exhaustBody(hero), source = body.geometry, before = hero.group.toJSON();
  const coreCount = 432, candidate = fittedChestCore(source, variant), added = candidate.attributes.position.count - source.attributes.position.count;
  assert.ok(added > 0, "chest boundary rings must split the original long side triangles");
  for (const [name, attribute] of Object.entries(source.attributes)) {
    assert.deepEqual(candidate.attributes[name].array.subarray((coreCount + added) * attribute.itemSize), attribute.array.subarray(coreCount * attribute.itemSize), "all non-core suffixes remain byte-identical");
    assert.ok([...candidate.attributes[name].array].every(Number.isFinite));
  }
  const sharedNormals = new Map();
  for (let i = 0; i < coreCount + added; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(candidate.attributes.position, i), n = new THREE.Vector3().fromBufferAttribute(candidate.attributes.normal, i).normalize();
    const key = p.toArray().map(v => Math.round(v * 1e6)).join(":");
    if (sharedNormals.has(key)) assert.ok(sharedNormals.get(key).dot(n) > .99999, "clipped shared positions retain a continuous smooth normal field");
    else sharedNormals.set(key, n);
  }
  const housingGeometry = new THREE.CylinderGeometry(.37, .49, .65, [6, 8, 5, 7][variant]);
  const housingMaterial = new THREE.MeshBasicMaterial(), housing = new THREE.Mesh(housingGeometry, housingMaterial);
  housing.position.set(0, 1.43, .015); housing.scale.z = .76; housing.updateMatrixWorld(true);
  let normalWitnesses = 0;
  for (let i = 0; i < coreCount + added; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(candidate.attributes.position, i);
    if (p.y <= 1.15 || p.y >= 1.69 || Math.abs(p.x) < .05 || Math.abs(p.x) > .32 || p.z < .15) continue;
    const hit = new THREE.Raycaster(new THREE.Vector3(p.x, p.y, 1), new THREE.Vector3(0, 0, -1)).intersectObject(housing, false)[0];
    if (!hit || Math.abs(hit.point.z - p.z - .008) > 1e-5) continue;
    const normal = new THREE.Vector3().fromBufferAttribute(candidate.attributes.normal, i);
    assert.ok(Math.abs(normal.length() - 1) < 1e-6);
    assert.ok(normal.dot(hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(housing.matrixWorld))) > .9999,
      "fully fitted surface normal equals the real housing normal, including taper and inverse Z scale");
    normalWitnesses++;
  }
  assert.ok(normalWitnesses >= 4); housingGeometry.dispose(); housingMaterial.dispose();
  for (let i = 0; i < coreCount; i += 3) {
    const p = source.attributes.position;
    if (![["y", .91, false], ["y", 1.755, true], ["z", 1e-8, false]].some(([axis, level, above]) =>
      [0, 1, 2].every(k => above ? p.getY(i + k) >= level : (axis === "y" ? p.getY(i + k) : p.getZ(i + k)) <= level))) continue;
    const positions = p.array.subarray(i * 3, (i + 3) * 3), normals = source.attributes.normal.array.subarray(i * 3, (i + 3) * 3);
    let found = false;
    for (let j = 0; j < coreCount + added; j += 3) if (positions.every((v, k) => v === candidate.attributes.position.array[j * 3 + k]) &&
      normals.every((v, k) => v === candidate.attributes.normal.array[j * 3 + k])) { found = true; break; }
    assert.ok(found, "whole rear/hip/neck triangles outside the chest band are untouched");
  }
  candidate.dispose();
  for (const fail of [false, true]) {
    let disposed = 0;
    const capture = target => {
      target.geometry.addEventListener("dispose", () => disposed++);
      assert.equal(body.visible, false); assert.equal(target.material, body.material);
      assert.deepEqual(target.position.toArray(), body.position.toArray());
      if (fail) throw Error("chest capture interrupted");
    };
    if (fail) await assert.rejects(withFittedChestCore(hero, capture), /chest capture interrupted/);
    else await withFittedChestCore(hero, capture);
    assert.equal(disposed, 1); assert.deepEqual(hero.group.toJSON(), before);
  }
  const bad = source.clone(); bad.attributes.position.array[1] += .01;
  assert.throws(() => fittedChestCore(bad, variant), /Unexpected chest position/); bad.dispose(); hero.dispose();
}

for (const variant of [0, 2, 3]) for (const fail of [false, true]) {
  const hero = new Fighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  const before = hero.group.toJSON(), armor = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.armorMaterial);
  const originals = [armor, hero.leftArm.children[0], hero.rightArm.children[0]];
  let disposed = 0;
  const run = () => withAlignedShoulders(hero, async target => {
    assert.equal(target.material, hero.armorMaterial);
    assert.ok(originals.every(mesh => !mesh.visible));
    for (const mesh of originals) {
      const sibling = mesh.parent.children.find(child => child !== mesh && child.visible && child.material === mesh.material && child.geometry?.attributes.position.count === mesh.geometry.attributes.position.count);
      assert.ok(sibling); sibling.geometry.addEventListener("dispose", () => disposed++);
      for (const name of Object.keys(mesh.geometry.attributes)) {
        assert.equal(sibling.geometry.attributes[name].array.length, mesh.geometry.attributes[name].array.length);
      }
      const cap = variant === 3 ? new THREE.DodecahedronGeometry(.25, 0) : new RoundedBoxGeometry(.34, .27, .48, 1, .0378);
      const indexedSphere = new THREE.SphereGeometry(.18, 10, 6), sphere = indexedSphere.toNonIndexed().translate(0, -.045, 0);
      const count = mesh === armor ? (cap.index?.count ?? cap.attributes.position.count) * 2 : sphere.attributes.position.count;
      for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
        const changed = sibling.geometry.attributes[name], start = (attr.count - count) * attr.itemSize;
        assert.deepEqual(changed.array.subarray(0, start), attr.array.subarray(0, start), `${name} prefix is byte-identical`);
        if (mesh !== armor) assert.deepEqual(changed.array.subarray(start), sphere.attributes[name].array, "previous reference is the exact radius .18 joint");
        else if (variant === 2) {
          const refs = [-1, 1].map(side => cap.clone().applyMatrix4(new THREE.Matrix4().compose(
            new THREE.Vector3(side * .57, 1.62, -.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * .16)),
            new THREE.Vector3(.84, 1.34, .92))));
          const size = refs[0].attributes[name].array.length;
          for (let side = 0; side < 2; side++) assert.deepEqual(changed.array.subarray(start + side * size, start + (side + 1) * size), refs[side].attributes[name].array,
            "previous capsule cap uses absolute X scale.84 only, with the correct inverse-transpose normals");
          for (const ref of refs) ref.dispose();
        }
        else if (name !== "position") assert.deepEqual(changed.array, attr.array, "cap normals and UVs unchanged");
        else for (let i = 0; i < count; i++) {
          const k = start + i * 3;
          assert.ok(Math.abs(changed.array[k] - attr.array[k] - (i < count / 2 ? .04 : -.04)) < 1e-7);
          assert.equal(changed.array[k + 1], attr.array[k + 1]); assert.equal(changed.array[k + 2], attr.array[k + 2]);
        }
      }
      cap.dispose(); indexedSphere.dispose(); sphere.dispose();
    }
    if (fail) throw Error("shoulder capture failed");
  }, true);
  if (fail) await assert.rejects(run, /shoulder capture failed/); else await run();
  assert.equal(disposed, 3); assert.deepEqual(hero.group.toJSON(), before);
  hero.dispose();
}
for (const variant of [0, 1]) {
  const hero = new Fighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  if (variant === 0) {
    const armor = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.armorMaterial);
    armor.geometry.attributes.position.array[armor.geometry.attributes.position.array.length - 1] += 1;
  }
  const before = hero.group.toJSON(); let captured = false;
  await assert.rejects(() => withAlignedShoulders(hero, () => { captured = true; }, true), /accepted fit|Unexpected shoulder/);
  assert.equal(captured, false); assert.deepEqual(hero.group.toJSON(), before); hero.dispose();
}

for (let variant = 0; variant < 4; variant++) {
  const hero = new Pre66Fighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const body = exhaustBody(hero), integrated = body.geometry, source = shortenedTorsoGeometry(integrated, true), children = [...hero.rig.children];
  const candidate = shortenedTorsoGeometry(source), capsule = new THREE.CapsuleGeometry(.39, .68, 4, 8);
  for (const [name, attribute] of Object.entries(integrated.attributes)) {
    const reviewed = candidate.attributes[name]; assert.equal(attribute.count, reviewed.count);
    for (let i = 0; i < attribute.array.length; i++) assert.ok(Math.abs(attribute.array[i] - reviewed.array[i]) < 1e-7,
      `integrated ${name} matches the reviewed torso within Float32 normal rounding`);
  }
  const count = capsule.index.count, p = source.attributes.position, q = candidate.attributes.position;
  let changed = 0, minimum = Infinity;
  assert.equal(q.count, p.count); assert.equal(candidate.index, source.index);
  assert.deepEqual(candidate.attributes.uv.array, source.attributes.uv.array);
  for (let i = 0; i < p.count; i++) {
    const lower = i < count && p.getY(i) < .91;
    assert.equal(q.getX(i), p.getX(i)); assert.equal(q.getZ(i), p.getZ(i));
    if (i < count) minimum = Math.min(minimum, q.getY(i));
    if (!lower) {
      assert.equal(q.getY(i), p.getY(i));
      for (let axis = 0; axis < 3; axis++) assert.equal(candidate.attributes.normal.array[i * 3 + axis], source.attributes.normal.array[i * 3 + axis]);
    } else {
      changed++;
      assert.ok(Math.abs(q.getY(i) - (.91 + (p.getY(i) - .91) * .11 / .39)) < 1e-7);
      const expected = new THREE.Vector3().fromBufferAttribute(source.attributes.normal, i);
      expected.y *= .39 / .11; expected.normalize();
      assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(candidate.attributes.normal, i)) < 1e-7);
    }
    assert.ok(candidate.boundingBox.containsPoint(new THREE.Vector3().fromBufferAttribute(q, i)));
  }
  assert.ok(changed > 0); assert.ok(Math.abs(minimum - .8) < 1e-7);
  candidate.dispose(); capsule.dispose();
  const corrupt = source.clone(); corrupt.attributes.position.setX(0, 99);
  assert.throws(() => shortenedTorsoGeometry(corrupt), /Unexpected torso position/); corrupt.dispose();
  for (const fail of [false, true]) {
    let disposed = 0;
    const run = () => withShortenedTorso(hero, async target => {
      target.geometry.addEventListener("dispose", () => disposed++);
      assert.equal(body.geometry, integrated); assert.equal(body.visible, false);
      assert.equal(target.material, body.material); assert.equal(target.geometry.attributes.position.count, p.count);
      assert.deepEqual(target.matrixWorld.elements, body.matrixWorld.elements);
      if (fail) throw Error("torso capture failed");
    }, true);
    hero.group.updateWorldMatrix(true, true);
    if (fail) await assert.rejects(run, /torso capture failed/); else await run();
    assert.equal(disposed, 1); assert.equal(body.geometry, integrated); assert.equal(body.visible, true);
    assert.deepEqual(hero.rig.children, children);
  }
  source.dispose(); hero.dispose();
}

function previousFighter(...args) {
  // CPU-only reconstruction, before any renderer has seen these owned meshes.
  const hero = new Fighter(...args), { body, light, bodyGeometry, lightGeometry } = previousExhaustGeometries(hero);
  body.geometry.dispose(); light.geometry.dispose(); body.geometry = bodyGeometry; light.geometry = lightGeometry;
  return hero;
}

for (let variant = 0; variant < 4; variant++) for (const fail of [false, true]) {
  const hero = new Fighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const body = exhaustBody(hero), geometry = body.geometry, children = [...hero.rig.children];
  const light = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.accentMaterial && mesh.position.lengthSq() === 0), lightGeometry = light.geometry;
  assert.equal(geometry.attributes.position.count, 2652);
  const run = () => withPreviousExhaust(hero, async previous => {
    assert.equal(body.geometry, geometry); assert.equal(body.visible, false);
    assert.equal(previous.geometry.attributes.position.count, 1464);
    assert.equal(previous.material, body.material);
    for (const [name, attribute] of Object.entries(previous.geometry.attributes))
      assert.deepEqual(attribute.array, geometry.attributes[name].array.slice(0, attribute.array.length), "integrated original body prefix is unchanged");
    await withExhaustShrouds(hero, async (reviewed, panel) => {
      for (const [actual, expected] of [[geometry, reviewed.geometry], [lightGeometry, panel.geometry]]) for (const [name, attribute] of Object.entries(actual.attributes)) {
        const reference = expected.attributes[name]; assert.equal(attribute.count, reference.count);
        for (let i = 0; i < attribute.array.length; i++) assert.ok(Math.abs(attribute.array[i] - reference.array[i]) < 1e-7,
          `integrated ${name} matches the reviewed geometry within Float32 transform rounding`);
      }
      assert.equal(panel.material, light.material);
    }, true);
    if (fail) throw Error("previous capture failed");
  });
  if (fail) await assert.rejects(run, /previous capture failed/); else await run();
  assert.equal(body.geometry, geometry); assert.equal(light.geometry, lightGeometry);
  assert.equal(body.visible, true); assert.equal(light.visible, true); assert.deepEqual(hero.rig.children, children);
  hero.dispose();
}
{
  const source = readFileSync(new URL("../src/player.js", import.meta.url), "utf8");
  const cacheSource = source.slice(source.indexOf("function sharedExhaustGeometry("), source.indexOf("export function clipLegPolygon("));
  const cache = new Map(); let builds = 0;
  const get = new Function("roundedParts", "exhaustShroudGeometry", `${cacheSource}; return sharedExhaustGeometry;`)(cache, variant => { builds++; return exhaustShroudGeometry(variant); });
  const geometries = Array.from({ length: 16 }, (_, i) => get(i % 4));
  assert.equal(builds, 2); assert.equal(new Set(geometries).size, 2);
  assert.ok(geometries.every(geometry => geometry.userData.sharedFighterGeometry));
  for (const geometry of new Set(geometries)) geometry.dispose();
}

// Corresponding real rounded-light surfaces, not stale screen pixels. The
// original body filters buried samples; the candidate includes its pedestal.
for (let variant = 0; variant < 4; variant++) {
  const hero = previousFighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const body = exhaustBody(hero), accent = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.accentMaterial && mesh.position.lengthSq() === 0);
  const reference = new RoundedBoxGeometry(.38, .32, .055, 1, .055 * .14), count = reference.attributes.position.count;
  reference.dispose();
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(accent.geometry.attributes.position.array.slice(-count * 3), 3));
  const light = new THREE.Mesh(geometry, accent.material), positions = geometry.attributes.position;
  await withExhaustShrouds(hero, async candidate => {
    for (const camera of [[-.7476635514, .6345527576, -1.6822430005], [-1.4953271028, 1.6093531652, -2.1495327353]]) {
      const origin = new THREE.Vector3(...camera), ray = new THREE.Raycaster(), hits = [];
      const blocked = (mesh, point) => {
        hits.length = 0; ray.set(origin, point.clone().sub(origin).normalize()); ray.far = point.distanceTo(origin) - 1e-5;
        ray.intersectObject(mesh, false, hits); return hits.length > 0;
      };
      let visible = 0;
      for (let i = 0; i < positions.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j));
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        if (normal.dot(origin.clone().sub(a)) <= 0) continue;
        for (let u = 0; u <= 12; u++) for (let v = 0; v <= 12 - u; v++) {
          const point = a.clone().multiplyScalar(1 - (u + v) / 12).addScaledVector(b, u / 12).addScaledVector(c, v / 12);
          if (blocked(light, point) || blocked(body, point)) continue;
          visible++;
          assert.equal(blocked(candidate, point.add(new THREE.Vector3(0, 0, -.060))), false, `variant ${variant}: supported panel cannot lose an originally visible surface sample`);
        }
      }
      assert.ok(visible > 2000, "visibility check must cover the actual rounded panel, not an empty sample set");
    }
  }, true);
  geometry.dispose(); hero.dispose();
}

for (let variant = 0; variant < 4; variant++) for (const fail of [false, true]) {
  const hero = previousFighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const body = exhaustBody(hero), light = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.accentMaterial && mesh.position.lengthSq() === 0);
  hero.rig.children.reverse(); assert.equal(exhaustBody(hero), body, "target identity does not depend on child order");
  const children = [...hero.rig.children], originalBody = body.geometry, originalLight = light.geometry;
  originalLight.computeBoundingBox(); originalLight.computeBoundingSphere();
  const originalBounds = JSON.stringify([originalLight.boundingBox, originalLight.boundingSphere]);
  const dispose = THREE.BufferGeometry.prototype.dispose, released = new Map();
  THREE.BufferGeometry.prototype.dispose = function () { released.set(this, (released.get(this) || 0) + 1); return dispose.call(this); };
  try {
    const run = () => withExhaustShrouds(hero, async (candidate, panel) => {
      assert.equal(body.geometry, originalBody); assert.equal(light.geometry, originalLight);
      assert.equal(body.visible, false); assert.equal(light.visible, false);
      assert.equal(candidate.material, body.material); assert.equal(panel.material, light.material);
      assert.deepEqual(panel.matrix, light.matrix);
      const reference = new RoundedBoxGeometry(.38, .32, .055, 1, .055 * .14), count = reference.attributes.position.count;
      // Do not include this independent reference in the helper ownership count.
      dispose.call(reference);
      for (const [name, attribute] of Object.entries(originalLight.attributes)) {
        const actual = panel.geometry.attributes[name]; assert.equal(actual.count, attribute.count);
        for (let i = 0; i < attribute.array.length; i++) {
          const moved = name === "position" && i >= attribute.array.length - count * 3 && i % 3 === 2;
          assert.equal(actual.array[i], moved ? Math.fround(attribute.array[i] - .060) : attribute.array[i], "only existing pack-light suffix Z changes");
        }
      }
      const points = panel.geometry.attributes.position;
      assert.ok(Math.abs(panel.geometry.boundingBox.min.z - originalLight.boundingBox.min.z + .060) < 1e-7);
      for (let i = 0; i < points.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(points, i);
        assert.equal(panel.geometry.boundingBox.containsPoint(point), true);
        assert.ok(panel.geometry.boundingSphere.distanceToPoint(point) <= 1e-7);
      }
      for (let i = points.count - count; i < points.count; i++) assert.ok(points.getZ(i) < -.61249, "every actual rounded light vertex is ahead of shrouds");
      if (variant === 3) for (const [camera, point] of [
        [[-.7476635514, .6345527576, -1.6822430005], [-.1351761967, 1.4849813382, -.5547552705]],
        [[-1.4953271028, 1.6093531652, -2.1495327353], [-.1351761967, 1.2250560522, -.5547552705]]
      ]) {
        const origin = new THREE.Vector3(...camera), target = new THREE.Vector3(...point).add(new THREE.Vector3(0, 0, -.060));
        const ray = new THREE.Ray(origin, target.clone().sub(origin).normalize()), hit = new THREE.Vector3(), positions = candidate.geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 3) {
          if (ray.intersectTriangle(...[0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j)), false, hit))
            assert.ok(hit.distanceTo(origin) >= target.distanceTo(origin) - 1e-5, "known exposed-edge rays clear body, shrouds and pedestal at translated light surface");
        }
      }
      if (fail) throw Error("raised capture failed");
    }, true);
    if (fail) await assert.rejects(run, /raised capture failed/); else await run();
  } finally { THREE.BufferGeometry.prototype.dispose = dispose; }
  assert.equal(released.size, 6); assert.ok([...released.values()].every(count => count === 1));
  assert.equal(released.has(originalBody), false); assert.equal(released.has(originalLight), false);
  assert.equal(JSON.stringify([originalLight.boundingBox, originalLight.boundingSphere]), originalBounds);
  assert.equal(body.visible, true); assert.equal(light.visible, true); assert.deepEqual(hero.rig.children, children);
  hero.dispose();
}

for (let variant = 0; variant < 4; variant++) {
  const geometry = exhaustShroudGeometry(variant), positions = geometry.attributes.position, normals = geometry.attributes.normal;
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y - (variant === 2 ? .9974 : 1.055)) < 1e-7);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 1.460) < 1e-7);
  const outletY = variant === 2 ? .9974 : 1.055, outletRadius = variant === 2 ? .056 : .075;
  let minimumClearance = Infinity;
  for (let step = 0; step <= 175; step++) {
    const scale = .65 + step / 100, bottom = 1.02 - .18 * scale, top = 1.02 + .18 * scale;
    assert.ok(top <= 1.456 - .004 + 1e-12, "closed ceiling clears the full authored plume scale envelope");
    for (let slice = 0; slice <= 100; slice++) {
      const y = outletY + (top - outletY) * slice / 100;
      const cavity = y >= 1.137 ? .110 : outletRadius + (.110 - outletRadius) * (y - outletY) / (1.137 - outletY);
      const coneRadius = .105 * (y - bottom) / (top - bottom);
      minimumClearance = Math.min(minimumClearance, cavity * Math.cos(Math.PI / 12) - coneRadius);
    }
  }
  assert.ok(minimumClearance > .00125, "twelve-sided cavity clears the circular upper bound of every plume cross-section");
  const edges = new Map(), point = index => new THREE.Vector3().fromBufferAttribute(positions, index);
  const key = v => v.toArray().map(x => x.toFixed(6)).join(",").replaceAll("-0.000000", "0.000000");
  for (let i = 0; i < positions.count; i += 3) {
    const triangle = [point(i), point(i + 1), point(i + 2)], normal = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0]));
    assert.ok(normal.length() > 1e-8, "no degenerate shroud faces"); normal.normalize();
    for (let j = 0; j < 3; j++) {
      assert.ok(normal.dot(new THREE.Vector3().fromBufferAttribute(normals, i + j)) > .99999);
      const a = key(triangle[j]), b = key(triangle[(j + 1) % 3]), edge = [a, b].sort().join("|");
      const counts = edges.get(edge) || [0, 0]; counts[a < b ? 0 : 1]++; edges.set(edge, counts);
    }
  }
  assert.ok([...edges.values()].every(([a, b]) => a === 1 && b === 1), "closed oriented shroud manifold, open cavity outlet remains annular");
  geometry.dispose();
  for (const fail of [false, true]) {
    const hero = previousFighter(new THREE.Scene(), { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
    const target = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.darkMaterial), original = target.geometry;
    const children = [...hero.rig.children];
    const flame = hero.thrusterLights, flameState = JSON.stringify({ geometry: flame.geometry.toJSON(), material: flame.material.toJSON(), position: flame.position, scale: flame.scale });
    let disposed = 0;
    const run = () => withExhaustShrouds(hero, async changed => {
      assert.notEqual(changed, target); assert.equal(changed.material, hero.darkMaterial);
      assert.equal(target.geometry, original); assert.equal(target.visible, false); assert.equal(changed.visible, true);
      assert.equal(changed.parent, hero.rig); assert.deepEqual(changed.matrix, target.matrix);
      assert.equal(changed.castShadow, target.castShadow); assert.equal(changed.receiveShadow, target.receiveShadow);
      changed.geometry.addEventListener("dispose", () => disposed++);
      for (const [name, attribute] of Object.entries(original.attributes))
        assert.deepEqual(changed.geometry.attributes[name].array.slice(0, attribute.array.length), attribute.array, "existing static body bytes remain unchanged");
      assert.ok(changed.geometry.attributes.position.count > original.attributes.position.count);
      if (fail) throw Error("capture failure");
    });
    const disposeGeometry = THREE.BufferGeometry.prototype.dispose, releases = new Map();
    THREE.BufferGeometry.prototype.dispose = function () { releases.set(this, (releases.get(this) || 0) + 1); return disposeGeometry.call(this); };
    try { if (fail) await assert.rejects(run, /capture failure/); else await run(); }
    finally { THREE.BufferGeometry.prototype.dispose = disposeGeometry; }
    assert.equal(releases.size, 3); assert.ok([...releases.values()].every(count => count === 1));
    assert.equal(releases.has(original), false); assert.equal(releases.has(flame.geometry), false);
    assert.equal(target.geometry, original); assert.equal(disposed, 1);
    assert.equal(target.visible, true); assert.deepEqual(hero.rig.children, children);
    assert.equal(JSON.stringify({ geometry: flame.geometry.toJSON(), material: flame.material.toJSON(), position: flame.position, scale: flame.scale }), flameState);
    hero.dispose();
  }
}

{
  const owned = new Set();
  for (let variant = 0; variant < 4; variant++) {
    const hero = new Fighter(new THREE.Scene(), { id: `p${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
    const shin = hero.shinMaterial, armor = hero.armorMaterial;
    assert.ok(shin !== armor && !owned.has(shin)); owned.add(shin);
    assert.equal(shin.roughness, .56); assert.equal(armor.roughness, .24 + variant * .025);
    assert.equal(shin.clearcoat, .68 - variant * .08);
    const expected = armor.toJSON(), actual = shin.toJSON(); actual.uuid = expected.uuid; actual.roughness = expected.roughness;
    assert.deepEqual(actual, expected, "shin finish clones final costume armor and changes only base roughness");
    let users = 0;
    hero.group.traverse(mesh => { if (mesh.material === shin) { users++; assert.ok(mesh === hero.leftLeg.children[1] || mesh === hero.rightLeg.children[1]); } });
    assert.equal(users, 2, "one owned material serves only the two existing shin batches");
    let released = 0; shin.addEventListener("dispose", () => released++);
    hero.takeHit(10);
    hero.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, { resolve: () => ({ grounded: true }), boostAt: () => null });
    assert.ok(armor.emissiveIntensity > .16); assert.equal(shin.emissiveIntensity, armor.emissiveIntensity);
    hero.takeHit(100); hero.updateDeath(.25);
    assert.equal(shin.emissiveIntensity, armor.emissiveIntensity);
    hero.respawn(new THREE.Vector3());
    assert.equal(shin.emissiveIntensity, .16); assert.equal(shin.roughness, .56);
    hero.dispose(); assert.equal(released, 1);
  }
}

{
  const fixture = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
  const source = fixture.slice(fixture.indexOf("async function withAnkleRelief("), fixture.indexOf("async function withPreviousKnees("));
  const run = new Function("THREE", "ankleReliefGeometry", "RoundedBoxGeometry", `${source}; return withAnkleRelief;`)(THREE, ankleReliefGeometry, RoundedBoxGeometry);
  const dark = new RoundedBoxGeometry(.3, .78, .34, 1, .042), shin = new RoundedBoxGeometry(.255, .4, .39, 1, .0357);
  const legs = [new THREE.Group(), new THREE.Group()];
  for (const leg of legs) {
    const body = new THREE.Mesh(dark), plate = new THREE.Mesh(shin);
    body.position.set(0, -.39, 0); plate.position.set(0, -.54, .035); leg.add(body, plate);
  }
  const hero = { leftLeg: legs[0], rightLeg: legs[1] }; let originalsDisposed = 0;
  dark.addEventListener("dispose", () => originalsDisposed++); shin.addEventListener("dispose", () => originalsDisposed++);
  for (const assembly of [false, true]) for (const fail of [false, true]) {
    const disposed = [0, 0];
    const capture = async () => {
      for (let i = 0; i < 2; i++) {
        const geometry = legs[0].children[i].geometry;
        assert.ok(geometry !== (i ? shin : dark)); assert.ok(geometry === legs[1].children[i].geometry);
        geometry.addEventListener("dispose", () => disposed[i]++);
      }
      if (fail) throw new Error("ankle capture interrupted");
    };
    if (fail) await assert.rejects(run(hero, capture, assembly), /ankle capture interrupted/); else await run(hero, capture, assembly);
    for (const leg of legs) assert.ok(leg.children[0].geometry === dark && leg.children[1].geometry === shin);
    assert.deepEqual(disposed, [1, 1]); assert.equal(originalsDisposed, 0);
  }
  for (const leg of legs) leg.children.reverse();
  await assert.rejects(run(hero, async () => assert.fail("wrong layout must not capture")), /Unexpected authored leg/);
  dark.dispose(); shin.dispose();
}

for (const [ys, derivative] of [[[-.16, -.18, -.22], -12.5], [[-.25, -.27, -.30], 12.5]]) {
  const original = new THREE.BufferGeometry();
  original.setAttribute("position", new THREE.Float32BufferAttribute([-.1, ys[0], -.17, .1, ys[1], -.17, -.1, ys[2], -.17], 3));
  original.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  original.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const trial = ankleReliefGeometry(original, -.39, .9, .30 / .34, .02);
  assert.equal(trial.attributes.position.count, 3);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(original.attributes.position, i), t = 1 - Math.abs(p.y - .39 + .62) / .08;
    const sx = 1 - .1 * t, sz = 1 + (.30 / .34 - 1) * t;
    const expected = new THREE.Vector3(p.x * sx, p.y, p.z * sz + .02 * t);
    assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(trial.attributes.position, i)) < 2e-8);
    expected.set(0, derivative * ((.30 / .34 - 1) * p.z + .02) / sz, -1 / sz).normalize();
    assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(trial.attributes.normal, i)) < 1e-7);
  }
  trial.dispose(); original.dispose();
}

for (const [sample, curve] of [[.008, u => [12.5 * u * u / .032, 25 * u / .032]],
  [.04, u => [12.5 * (u - .008), 12.5]], [.08, u => [.85 - 12.5 * (u - .08) ** 2 / .016, -25 * (u - .08) / .016]],
  [.12, u => [12.5 * (.152 - u), -12.5]], [.152, u => [12.5 * (.16 - u) ** 2 / .032, -25 * (.16 - u) / .032]]]) {
  const y = sample - .70 + .39, geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-.1, y, -.17, .1, y + .0001, -.17, -.1, y + .0002, -.17], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([.6, 0, -.8, .6, 0, -.8, .6, 0, -.8], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const trial = ankleReliefGeometry(geometry, -.39, .9, .30 / .34, .02, true);
  const p = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 0);
  const n = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, 0), [t, derivative] = curve(p.y - .39 + .70);
  const sx = 1 - .1 * t, sz = 1 + (.30 / .34 - 1) * t;
  const expectedPosition = new THREE.Vector3(p.x * sx, p.y, p.z * sz + .02 * t);
  const expectedNormal = new THREE.Vector3(n.x / sx, n.y + derivative * .1 * p.x * n.x / sx
    - derivative * ((.30 / .34 - 1) * p.z + .02) * n.z / sz, n.z / sz).normalize();
  let checked = 0;
  for (let i = 0; i < trial.attributes.uv.count; i++) if (trial.attributes.uv.getX(i) === 0 && trial.attributes.uv.getY(i) === 0) {
    assert.ok(expectedPosition.distanceTo(new THREE.Vector3().fromBufferAttribute(trial.attributes.position, i)) < 2e-8);
    assert.ok(expectedNormal.distanceTo(new THREE.Vector3().fromBufferAttribute(trial.attributes.normal, i)) < 1e-7);
    checked++;
  }
  assert.ok(checked > 0, "beveled capture profile sample was verified");
  trial.dispose(); geometry.dispose();
}

for (const bevel of [false, true, "assembly"]) for (const [w, h, d, cy, wr, dr, shift] of [[.3, .78, .34, -.39, .9, .30 / .34, .02], [.255, .4, .39, -.54, .23 / .255, .33 / .39, .01]]) {
  const original = new RoundedBoxGeometry(w, h, d, 1, Math.min(.045, w * .14, h * .14, d * .14));
  const trial = bevel === "assembly" ? legAssemblyGeometry(original, cy, cy === -.39 ? -.65 : -.70, cy === -.39)
    : ankleReliefGeometry(original, cy, wr, dr, shift, bevel), points = [];
  const p = original.attributes.position, q = trial.attributes.position;
  for (let i = 0; i < p.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(p, i));
  const hull = new ConvexHull().setFromPoints(points), point = new THREE.Vector3(), retained = new Set();
  for (let i = 0; i < q.count; i++) {
    point.fromBufferAttribute(q, i); retained.add(point.toArray().join(","));
    assert.ok(hull.faces.every(face => face.distanceToPoint(point) <= 2e-8), "ankle relief stays inside its original hull");
  }
  for (const point of points) assert.ok(retained.has(point.toArray().join(",")), "every old support extremum is retained exactly");
  if (bevel === "assembly") {
    const edges = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3(), average = new THREE.Vector3();
    for (let i = 0; i < q.count; i += 3) {
      a.fromBufferAttribute(q, i); b.fromBufferAttribute(q, i + 1); c.fromBufferAttribute(q, i + 2);
      const keys = [a, b, c].map(v => v.toArray().map(value => Math.round(value * 1e6)).join(","));
      face.crossVectors(b.clone().sub(a), c.clone().sub(a));
      average.set(0, 0, 0);
      for (let k = 0; k < 3; k++) average.add(new THREE.Vector3().fromBufferAttribute(trial.attributes.normal, i + k));
      assert.ok(face.lengthSq() > 1e-16 && face.dot(average) > 0, "closed assembly faces are nondegenerate and correctly wound");
      for (let k = 0; k < 3; k++) {
        const key = [keys[k], keys[(k + 1) % 3]].sort().join("|"); edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2), "each welded assembly edge has exactly two faces");
  }
  assert.ok(q.count > p.count, "authored ankle rings are added");
  trial.dispose(); original.dispose();
}

{
  const original = new RoundedBoxGeometry(.3, .78, .34, 1, .042), released = [];
  const dispose = THREE.BufferGeometry.prototype.dispose;
  let assembly;
  try {
    THREE.BufferGeometry.prototype.dispose = function () { released.push(this); return dispose.call(this); };
    assembly = legAssemblyGeometry(original, -.39, -.65, true);
  } finally { THREE.BufferGeometry.prototype.dispose = dispose; }
  assert.equal(released.length, 3, "indexed connector, expanded connector and temporary shell are released");
  assert.equal(new Set(released).size, 3);
  assert.ok(!released.includes(original) && !released.includes(assembly));
  assembly.dispose(); original.dispose();
}

{
  const original = new RoundedBoxGeometry(.29, .18, .13, 1, .0182);
  const before = original.attributes.position.array.slice(), normalBefore = original.attributes.normal.array.slice();
  const trial = kneeTaperGeometry(original), points = [];
  for (let i = 0; i < original.attributes.position.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(original.attributes.position, i));
  const hull = new ConvexHull().setFromPoints(points), point = new THREE.Vector3(), normal = new THREE.Vector3();
  let changed = 0;
  for (let i = 0; i < trial.attributes.position.count; i++) {
    point.fromBufferAttribute(trial.attributes.position, i);
    assert.ok(hull.faces.every(face => face.distanceToPoint(point) <= 2e-8), "taper remains inside original hull within Float32 precision");
    assert.equal(point.y, original.attributes.position.getY(i));
    assert.equal(point.z, original.attributes.position.getZ(i));
    normal.fromBufferAttribute(trial.attributes.normal, i);
    assert.ok(Math.abs(normal.length() - 1) < 1e-7, "transformed rounded normal remains normalized");
    const old = points[i], slope = (1 - .22 / .29) / .18, scale = 1 + slope * (old.y - .09);
    assert.ok(Math.abs(point.x - old.x * scale) < 1e-8, "authored taper width is applied");
    const expected = new THREE.Vector3().fromBufferAttribute(original.attributes.normal, i);
    expected.set(expected.x / scale, expected.y - slope * old.x * expected.x / scale, expected.z).normalize();
    assert.ok(normal.distanceTo(expected) < 1e-7, "smooth normals follow the taper Jacobian");
    if (point.x !== old.x) changed++;
  }
  assert.ok(changed > 250, "identity geometry cannot pass the taper test");
  assert.deepEqual(original.attributes.position.array, before);
  assert.deepEqual(original.attributes.normal.array, normalBefore);
  assert.deepEqual(trial.attributes.uv.array, original.attributes.uv.array);
  assert.equal(trial.attributes.position.count, original.attributes.position.count);
  assert.equal(trial.userData.sharedFighterGeometry, undefined);
  trial.dispose(); original.dispose();
}

{
  const fixture = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
  const source = fixture.slice(fixture.indexOf("async function withPreviousKnees("), fixture.indexOf('select("knee-comparison").onclick'));
  const run = new Function("RoundedBoxGeometry", `${source}; return withPreviousKnees;`)(RoundedBoxGeometry);
  const original = new RoundedBoxGeometry(.29, .18, .13, 1, .0182);
  const knees = [new THREE.Mesh(original), new THREE.Mesh(original)];
  for (const knee of knees) knee.position.set(0, -.39, .23);
  const hero = { leftLeg: { children: [null, null, knees[0]] }, rightLeg: { children: [null, null, knees[1]] } };
  let originalDisposals = 0;
  original.addEventListener("dispose", () => originalDisposals++);
  for (const fail of [false, true]) {
    let trialDisposals = 0;
    const capture = async () => {
      assert.ok(knees[0].geometry !== original);
      assert.ok(knees[0].geometry === knees[1].geometry, "both knees share one owned trial");
      knees[0].geometry.addEventListener("dispose", () => trialDisposals++);
      if (fail) throw new Error("capture interrupted");
    };
    if (fail) await assert.rejects(run(hero, capture), /capture interrupted/); else await run(hero, capture);
    assert.ok(knees.every(knee => knee.geometry === original), "both originals restored");
    assert.equal(trialDisposals, 1); assert.equal(originalDisposals, 0);
  }
  original.dispose();
}

// Execute the previous clone path against the same complete fighter/weapon builder.
// Only the three transient merge copies differ; no frozen art data to maintain.
const playerMergeSource = readFileSync(new URL("../src/player.js", import.meta.url), "utf8");
{
  const original = new RoundedBoxGeometry(.29, .18, .13, 1, .0182), expected = kneeTaperGeometry(original);
  const fighters = Array.from({ length: 16 }, (_, i) => new Fighter(new THREE.Scene(), { id: `knee-${i}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3()));
  const shared = fighters[0].leftLeg.children[2].geometry;
  const assemblies = fighters[0].leftLeg.children.slice(0, 2).map(mesh => mesh.geometry);
  const oldBody = new RoundedBoxGeometry(.3, .78, .34, 1, .042), oldShin = new RoundedBoxGeometry(.255, .4, .39, 1, .0357);
  const expectedAssemblies = [legAssemblyGeometry(oldBody, -.39, -.65, true), legAssemblyGeometry(oldShin, -.54, -.70)];
  let disposals = 0; const onDispose = () => disposals++;
  shared.addEventListener("dispose", onDispose);
  for (const geometry of assemblies) geometry.addEventListener("dispose", onDispose);
  for (const fighter of fighters) {
    for (const leg of [fighter.leftLeg, fighter.rightLeg]) {
      assert.ok(leg.children[2].geometry === shared, "all 32 knees reuse one immutable geometry");
      assert.deepEqual(leg.children[2].position.toArray(), [0, -.39, .23]);
      assert.equal(leg.children.length, 3, "construction preserves the existing three material batches per leg");
      for (let i = 0; i < 2; i++) {
        assert.ok(leg.children[i].geometry === assemblies[i], "all fighters reuse the two immutable assembly geometries");
        assert.deepEqual(leg.children[i].position.toArray(), i ? [0, -.54, .035] : [0, -.39, 0]);
      }
    }
    fighter.dispose();
  }
  assert.equal(disposals, 0, "fighter disposal cannot destroy shared knees");
  assert.equal(shared.userData.sharedFighterGeometry, true);
  for (const name of ["position", "normal", "uv"]) assert.deepEqual(shared.attributes[name].array, expected.attributes[name].array);
  shared.removeEventListener("dispose", onDispose); expected.dispose(); original.dispose();
  for (let i = 0; i < 2; i++) {
    assemblies[i].removeEventListener("dispose", onDispose);
    assert.equal(assemblies[i].userData.sharedFighterGeometry, true);
    for (const name of ["position", "normal", "uv"]) assert.deepEqual(assemblies[i].attributes[name].array, expectedAssemblies[i].attributes[name].array);
    expectedAssemblies[i].dispose();
  }
  oldBody.dispose(); oldShin.dispose();
}
{
  const effects = new CombatVisuals(new THREE.Scene());
  for (const weapon of Object.values(WEAPONS)) {
    const mesh = effects.createProjectile({ accent: 0x6ff6ff }, weapon, .11);
    for (const trail of mesh.userData.combatVisual?.trailParts || []) {
      assert.equal(trail.material.vertexColors, weapon.id === "blaster", `${weapon.id} trail shading isolation`);
      assert.equal(!!trail.geometry.getAttribute("color"), weapon.id === "blaster", `${weapon.id} shared geometry isolation`);
      assert.ok(Math.abs(trail.rotation.x - (weapon.id === "blaster" ? -Math.PI / 2 : Math.PI / 2)) < 1e-12,
        `${weapon.id} trail orientation: only Blaster should taper toward the rear`);
    }
    effects.removeProjectile({ mesh }); mesh.traverse(child => child.material?.dispose());
  }
  effects.dispose();
}
{
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  const removeSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const removeObject = new Function(`return function(object) {${removeSource.split("  removeObject(object) {")[1].split("\n  }\n}")[0]}}`)();
  let geometry, colorAttribute, geometryDisposals = 0;
  const materials = new Set();
  for (let i = 0; i < 32; i++) {
    const mesh = effects.createProjectile({ accent: i % 2 ? 0xff3377 : 0x6ff6ff }, WEAPONS.blaster, .11);
    scene.add(mesh);
    const trails = mesh.userData.combatVisual.trailParts;
    assert.equal(trails.length, 1);
    const trail = trails[0], uv = trail.geometry.getAttribute("uv"), colors = trail.geometry.getAttribute("color");
    if (!geometry) {
      geometry = trail.geometry; colorAttribute = colors;
      geometry.addEventListener("dispose", () => geometryDisposals++);
      const p = geometry.parameters, original = new THREE.ConeGeometry(p.radius, p.height, p.radialSegments, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
      for (const name of ["position", "normal", "uv"]) assert.deepEqual(geometry.getAttribute(name).array, original.getAttribute(name).array);
      assert.deepEqual(geometry.index.array, original.index.array); original.dispose();
    }
    assert.equal(trail.geometry, geometry); assert.equal(colors, colorAttribute);
    assert.equal(colors.array.byteLength, 168);
    for (let v = 0; v < uv.count; v++) for (const channel of ["getX", "getY", "getZ"]) assert.equal(colors[channel](v), 1 - uv.getY(v));
    assert.equal(materials.has(trail.material), false); materials.add(trail.material);
    assert.ok(trail.material.color.equals(new THREE.Color(i % 2 ? 0xff3377 : 0x6ff6ff).multiplyScalar(2.2)));
    let materialDisposals = 0; trail.material.addEventListener("dispose", () => materialDisposals++);
    removeObject.call({ scene }, mesh);
    assert.equal(materialDisposals, 1); assert.equal(geometryDisposals, 0);
    assert.equal(mesh.parent, null);
  }
  effects.dispose();
}
{
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  const hero = new Fighter(scene, { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3(8, 15, 8));
  effects.muzzle(hero, hero.weapon);
  const flash = effects.flashes[0], tracer = effects.tracers[0], light = effects.combatLights[0];
  const origin = flash.position.clone(), end = tracer.end.clone(), lamp = light.position.clone(), direction = flash.direction.clone();
  hero.weaponGroup.position.z -= .2;
  const delta = hero.visualMuzzlePoint().sub(origin);
  effects.update(1 / 60);
  assert.ok(flash.position.distanceTo(origin.clone().add(delta)) < 1e-12, "live Blaster flash must follow its animated aperture");
  assert.ok(tracer.end.distanceTo(end.clone().add(delta)) < 1e-12);
  assert.ok(light.position.distanceTo(lamp.clone().add(delta)) < 1e-12);
  assert.ok(flash.direction.equals(direction));
  const held = flash.position.clone();
  hero.switchSlot(1); hero.switchSlot(0); hero.weaponGroup.position.z += 3;
  effects.update(1 / 60);
  assert.ok(flash.position.equals(held), "cached switch-away/back must detach the previous event without killing its fade");
  assert.ok(flash.life > 0);
  hero.dispose(); effects.dispose();
}
for (const action of ["death", "respawn", "dispose", "model", "expiry", "reuse", "quality", "effects-dispose"]) {
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  const hero = new Fighter(scene, { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3());
  effects.muzzle(hero, hero.weapon);
  const flash = effects.flashes[0], tracer = effects.tracers[0], light = effects.combatLights[0];
  const held = flash.position.clone(), originalLife = flash.life;
  if (action === "death") hero.takeHit(100);
  if (action === "respawn") hero.respawn(new THREE.Vector3(100, 0, 0));
  if (action === "dispose") hero.dispose();
  if (action === "model") hero.updateWeaponModel();
  if (action === "quality") effects.setGraphicsProfile({ combatQuality: "low", combatLights: 0 });
  if (action === "effects-dispose") effects.dispose();
  if (action === "reuse") {
    effects.cursors.tracer = 0; effects.combatLightCursor = 0;
    effects.addTracer(new THREE.Vector3(2, 3, 4), new THREE.Vector3(5, 6, 7), hero.weapon, hero, .2, .1);
    effects.pulseLight(new THREE.Vector3(9, 8, 7), new THREE.Color(), 4, 10, .2);
    assert.equal(tracer.muzzleOwner, null); assert.equal(light.muzzleOwner, null);
  }
  hero.weaponGroup.position.x += 2;
  if (action !== "effects-dispose") effects.update(action === "expiry" ? .11 : 0);
  if (["death", "respawn", "dispose", "model", "expiry", "effects-dispose"].includes(action)) {
    assert.equal(flash.muzzleOwner, null); assert.equal(tracer.muzzleOwner, null); assert.equal(light.muzzleOwner, null);
    assert.ok(flash.position.equals(held));
    if (action !== "expiry") assert.equal(flash.life, originalLife, "detachment preserves the existing fade");
  }
  if (action === "expiry") assert.ok(light.intensity > 0, "detach the pulse without deleting its damped tail");
  if (action === "quality") assert.equal(light.muzzleOwner, null);
  if (action === "reuse") { assert.deepEqual(tracer.start.toArray(), [2, 3, 4]); assert.deepEqual(light.position.toArray(), [9, 8, 7]); }
  if (action !== "dispose") hero.dispose();
  if (action !== "effects-dispose") effects.dispose();
}
for (const tier of ["low", "medium", "high"]) {
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  effects.setGraphicsProfile(graphicsProfile(tier));
  const fighters = Array.from({ length: 16 }, (_, i) => new Fighter(scene, { id: `p${i}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3(i, 0, 0)));
  for (let round = 0; round < 12; round++) {
    for (const hero of fighters) {
      hero.switchSlot(round % 2); effects.muzzle(hero, hero.weapon);
      effects.impact(new THREE.Vector3(50, 0, 0), hero.weapon, hero);
    }
    for (const hero of fighters) hero.weaponGroup.position.z -= .1;
    effects.update(1 / 60);
    for (const flash of effects.flashes) if (flash.muzzleOwner) assert.ok(flash.position.distanceTo(flash.muzzleOwner.visualMuzzlePoint()) < 1e-12);
    for (const light of effects.combatLights) if (!light.muzzleOwner && light.intensity > 0) assert.ok(Number.isFinite(light.position.x));
  }
  effects.setGraphicsProfile(graphicsProfile("low"));
  for (const light of effects.combatLights.slice(1)) assert.equal(light.muzzleOwner, null);
  effects.setGraphicsProfile(graphicsProfile("high"));
  for (const light of effects.combatLights.slice(1)) assert.equal(light.muzzleOwner, null);
  for (const hero of fighters) hero.dispose();
  effects.update(0);
  for (const pool of [effects.flashes, effects.tracers, effects.combatLights]) assert.ok(pool.every(slot => !slot.muzzleOwner));
  effects.dispose();
}
for (const reducedMotion of [false, true]) {
  const scene = new THREE.Scene(), current = new CombatVisuals(scene, { reducedMotion }), previous = new CombatVisuals(new THREE.Scene(), { reducedMotion });
  previous.bindMuzzle = () => {};
  const hero = new Fighter(scene, { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  current.muzzle(hero, hero.weapon); previous.muzzle(hero, hero.weapon);
  const timeline = effects => ({ flash: effects.flashes.map(slot => slot.life), tracer: effects.tracers.map(slot => slot.life),
    lights: effects.combatLights.map(light => [light.userData.life, light.intensity]), counts: [effects.flashOuter.count, effects.flashInner.count, effects.tracerOuter.count, effects.tracerInner.count] });
  const direction = current.flashes[0].direction.clone(), segment = current.tracers[0].end.clone().sub(current.tracers[0].start);
  for (let frame = 0; frame < 60; frame++) {
    hero.weaponGroup.position.z -= .005;
    current.update(1 / 60); previous.update(1 / 60);
    assert.deepEqual(timeline(current), timeline(previous));
    assert.ok(current.flashes[0].direction.equals(direction));
    assert.ok(current.tracers[0].end.clone().sub(current.tracers[0].start).distanceTo(segment) < 1e-12);
  }
  hero.dispose(); current.dispose(); previous.dispose();
}
{
  const target = new THREE.Vector3(), effects = new CombatVisuals(new THREE.Scene());
  for (const id of Object.keys(WEAPONS)) {
    const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, [id], new THREE.Vector3(8, 15, 8));
    assert.equal(typeof hero.visualMuzzlePoint, "function", "visual muzzle origin must be distinct from gameplay origin");
    for (const pitch of [0, Math.PI / 3, -Math.PI / 3]) {
      hero.rig.position.y = -.08; hero.rig.rotation.x = .13; hero.weaponGroup.rotation.x = pitch; hero.weaponGroup.position.z = .15;
      const logical = hero.muzzlePoint().toArray(), projectile = hero.forwardPoint(.08).toArray();
      assert.ok(hero.visualMuzzlePoint(target) === target);
      const expected = id === "blaster" ? new THREE.Vector3(.05, .06, .994).applyMatrix4(hero.weaponGroup.matrixWorld) : hero.muzzlePoint();
      assert.ok(target.distanceTo(expected) < 1e-12);
      assert.deepEqual(hero.muzzlePoint().toArray(), logical); assert.deepEqual(hero.forwardPoint(.08).toArray(), projectile);
    }
    if (id !== "blaster") {
      const index = effects.cursors.flash % effects.flashes.length;
      effects.muzzle(hero, hero.weapon);
      assert.equal(effects.flashes[index].muzzleOwner, null);
      assert.ok(effects.flashes[index].position.distanceTo(hero.muzzlePoint()) < 1e-12);
    }
    if (id === "blaster") {
      effects.muzzle(hero, hero.weapon); const flash = effects.flashes[0], tracer = effects.tracers[0], light = effects.combatLights[0];
      assert.ok(flash.position.distanceTo(hero.visualMuzzlePoint(target)) < 1e-12);
      assert.ok(tracer.start.distanceTo(flash.position) < 1e-12);
      assert.ok(light.position.distanceTo(flash.position.clone().addScaledVector(flash.direction, flash.length * .32)) < 1e-12);
      assert.equal(flash.life, .1); assert.equal(tracer.life, .085); assert.equal(light.userData.life, .085);
    }
    hero.dispose();
  }
  const cached = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3(8, 15, 8));
  const blasterModel = cached.weaponModels.get("blaster");
  cached.ammo.blaster = 2; cached.health = 73;
  for (const slot of [1, 0, 1, 0]) {
    cached.switchSlot(slot); assert.ok(cached.visualMuzzlePoint(target) === target);
    const expected = slot ? cached.muzzlePoint() : new THREE.Vector3(.05, .06, .994).applyMatrix4(cached.weaponGroup.matrixWorld);
    assert.ok(target.distanceTo(expected) < 1e-12); assert.ok(cached.weaponModels.get("blaster") === blasterModel);
    assert.equal(cached.weaponModels.size, 2); assert.equal(cached.ammo.blaster, 2); assert.equal(cached.health, 73);
  }
  cached.dispose();
  effects.dispose();
}
{
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(8, 15, 8));
  hero.grounded = true; hero.landTimer = .22; hero.landStrength = 1;
  const floor = { surfaceHeightAt: () => 15, resolve: position => { position.y = 15; return { grounded: true }; }, boostAt: () => null };
  for (let frame = 0; frame < 14; frame++) {
    hero.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, floor); hero.group.updateMatrixWorld(true);
    for (const leg of [hero.leftLeg, hero.rightLeg]) assert.ok(new THREE.Box3().setFromObject(leg, true).min.y >= 15,
      "hard-landing visual legs must not penetrate the physical floor");
  }
  hero.dispose();
}
// The advancing-clock hit pose caught a floor-crossing regression missed by a fixed clock.
{
  let clock = 1000, landingFrame = -1, checked = false;
  const plain = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "");
  const Type = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation", "performance",
    `${plain}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation, { now: () => clock });
  const p = new Type(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15, 8));
  const still = new THREE.Vector3(), aim = new THREE.Vector3(0, 0, -1);
  const world = { resolve(position) { const grounded = position.y <= 15; if (grounded) position.y = 15; return { grounded }; }, boostAt: () => null };
  try {
    for (let step = 0; step < 60; step++) { clock = 1000 + step * 1000 / 60; p.update(1 / 60, still, aim, {}, world); }
    p.position.y += 8; p.grounded = false;
    for (let step = 60; step < 180; step++) {
      clock = 1000 + step * 1000 / 60;
      if (landingFrame === 6) p.hitTimer = .3;
      p.update(1 / 60, still, aim, {}, world); p.group.updateMatrixWorld(true);
      if (landingFrame < 0 && p.landTimer > 0) landingFrame = 0;
      if (landingFrame === 13) {
        checked = true;
        for (const leg of [p.leftLeg, p.rightLeg]) assert.ok(new THREE.Box3().setFromObject(leg, true).min.y >= 15,
          "advancing-clock hit frame 13 must not introduce the rejected pitch trial's floor crossing");
      }
      if (landingFrame >= 0) landingFrame++;
    }
    assert.ok(checked); assert.equal(p.landTimer, 0);
  } finally { p.dispose(); }
}
// Archived variant-1-only controls for Pass40/39, not the pre-Pass65 builder.
const beforeBearingSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("const shoulderRadius = .16;", "const shoulderRadius = costumeVariant === 1 ? .18 : .16;");
const BeforeBearingFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeBearingSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
{
  const fighter = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const sphere = new THREE.SphereGeometry(.16, 10, 6);
  for (const arm of [fighter.leftArm, fighter.rightArm]) {
    const position = arm.children[0].geometry.attributes.position;
    const radii = Array.from({ length: sphere.index.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, position.count - sphere.index.count + i).sub(new THREE.Vector3(0, -.045, 0)).length());
    assert.ok(radii.every(radius => Math.abs(radius - .16) < 2e-8), "bearing must fit the measured housing without changing its topology or pivot");
  }
  sphere.dispose(); fighter.dispose();
}
const beforeElbowSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("this.elbowMaterial = dark.clone();", "this.elbowMaterial = dark;")
  .replace("this.elbowMaterial.roughness = .56;", "")
  .replace("this.elbowMaterial.clearcoatRoughness = .4;", "")
  .replace("const elbowGeometry = new THREE.SphereGeometry(.135, 16, 10);", "const elbowGeometry = null;")
  .replace("part(elbowGeometry, elbowMaterial", "part(new THREE.SphereGeometry(.135, 10, 6), dark")
  .replace("[hand, thumb, ...curledFingers]), elbowJoint", "[hand, thumb, ...curledFingers, elbowJoint])");
const BeforeElbowFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeElbowSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const beforeShoulderSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("mergeStaticParts(elbowMaterial, [upperArmor, shoulderJoint])", "mergeStaticParts(dark, [upperArmor, shoulderJoint])");
const BeforeShoulderFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeShoulderSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const beforeCapSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("const shoulderX = .61;", "const shoulderX = costumeVariant === 1 ? .57 : .61;");
const BeforeCapFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeCapSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
function shoulderClearance(fighter, y) {
  fighter.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-2, y, 0).applyMatrix4(fighter.rig.matrixWorld),
    new THREE.Vector3(1, 0, 0).transformDirection(fighter.rig.matrixWorld));
  const armor = ray.intersectObject(fighter.rig.children[1], false)[0], joint = ray.intersectObject(fighter.leftArm.children[0], false)[0];
  assert.ok(armor && joint, "contact witness must hit both real surfaces");
  return joint.distance - armor.distance;
}
{
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["energy_sword"], new THREE.Vector3());
  assert.ok(shoulderClearance(hero, 1.625) > .015, "aligned cap must cover the protruding joint by at least 15mm");
  assert.ok(shoulderClearance(hero, 1.76) > .035, "aligned cap must cover the upper joint patch by at least 35mm");
  hero.dispose();
  const BeforeContactFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
    `${beforeCapSource.replace("const shoulderRadius = .16;", "const shoulderRadius = .18;")}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
  const previous = new BeforeContactFighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["energy_sword"], new THREE.Vector3());
  assert.ok(shoulderClearance(previous, 1.625) < -.025, "old cap exposes the lower joint");
  assert.ok(shoulderClearance(previous, 1.76) < -.004, "old cap exposes the upper joint");
  previous.dispose();
}
const elbowProbe = new Fighter(new THREE.Scene(), { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
for (const arm of [elbowProbe.leftArm, elbowProbe.rightArm]) {
  assert.ok(arm.children[0].material === elbowProbe.elbowMaterial, "upper-arm finish reuses the existing owned satin material");
  assert.ok(arm.children[1].material === elbowProbe.accentMaterial, "upper stripe remains unchanged");
}
for (const arm of [elbowProbe.leftForearm, elbowProbe.rightForearm]) {
  const elbow = arm.children[3];
  assert.ok(elbow?.isMesh, "elbow finish must be isolated from the approved fist");
  assert.equal(elbow.geometry.parameters.widthSegments, 16);
  assert.equal(elbow.geometry.parameters.heightSegments, 10);
  assert.equal(elbow.geometry.parameters.radius, .135);
  assert.deepEqual(elbow.position.toArray(), [0, .015, 0]);
  assert.equal(elbow.material, elbowProbe.elbowMaterial);
  assert.notEqual(elbow.material, elbowProbe.darkMaterial);
  assert.equal(elbow.material.roughness, .56);
  assert.equal(elbow.material.clearcoatRoughness, .4);
  assert.equal(arm.children[2].material.roughness, .4);
}
let elbowMaterialDisposals = 0;
const elbowGeometryDisposals = new Map([elbowProbe.leftForearm, elbowProbe.rightForearm].map(arm => [arm.children[3].geometry, 0]));
for (const geometry of elbowGeometryDisposals.keys()) geometry.addEventListener("dispose", () => elbowGeometryDisposals.set(geometry, elbowGeometryDisposals.get(geometry) + 1));
elbowProbe.elbowMaterial.addEventListener("dispose", () => elbowMaterialDisposals++);
assert.equal(new Set([elbowProbe.darkMaterial, elbowProbe.shellMaterial, elbowProbe.elbowMaterial]).size, 3);
elbowProbe.takeHit(10);
elbowProbe.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, { resolve: () => ({ grounded: true }), boostAt: () => null });
assert.ok(elbowProbe.elbowMaterial.emissiveIntensity > .025);
assert.equal(elbowProbe.elbowMaterial.emissiveIntensity, elbowProbe.darkMaterial.emissiveIntensity);
assert.equal(elbowProbe.elbowMaterial.emissiveIntensity, elbowProbe.shellMaterial.emissiveIntensity);
elbowProbe.respawn(new THREE.Vector3());
assert.equal(elbowProbe.elbowMaterial.emissiveIntensity, elbowProbe.darkMaterial.emissiveIntensity);
elbowProbe.dispose();
assert.equal(elbowMaterialDisposals, 1, "both elbows share one fighter-owned material disposed once");
assert.equal(elbowGeometryDisposals.size, 1, "both elbows share the identical fighter-owned geometry");
assert.deepEqual([...elbowGeometryDisposals.values()], [1]);
{
  const other = new Fighter(new THREE.Scene(), { id: "elbow-owner", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const geometry = other.leftForearm.children[3].geometry, expected = new THREE.SphereGeometry(.135, 16, 10);
  assert.ok(!elbowGeometryDisposals.has(geometry), "geometry sharing cannot cross fighter lifetime ownership");
  for (const name of ["position", "normal", "uv"]) assert.deepEqual(geometry.attributes[name].array, expected.attributes[name].array);
  assert.deepEqual(geometry.index.array, expected.index.array, "sharing preserves every authored triangle and attribute");
  expected.dispose(); other.dispose();
}
const fistProbe = new Fighter(new THREE.Scene(), { id: "fist-probe", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
for (const hand of [fistProbe.leftHand, fistProbe.rightHand]) {
  assert.ok(!hand.geometry, "grip metadata must not retain the disposed source palm buffers");
  assert.deepEqual(hand.position.toArray(), [0, -.58, .05], "hand shaping cannot change the IK grip center");
}
for (const forearm of [fistProbe.leftForearm, fistProbe.rightForearm]) {
  const positions = forearm.children[2].geometry.attributes.position;
  let wristWidth = 0, fingerWidth = 0;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i), x = Math.abs(positions.getX(i));
    if (y > -.51 && y < -.475) wristWidth = Math.max(wristWidth, x);
    if (y < -.63) fingerWidth = Math.max(fingerWidth, x);
  }
  assert.ok(wristWidth > .05 && wristWidth < .095 && fingerWidth > .1, "actual merged fist tapers from curl to wrist");
}
const fistVertices = (forearm, mirror) => {
  const { position, normal } = forearm.children[2].geometry.attributes;
  // Rounded-box face diagonals duplicate corner vertices with different valence;
  // compare the actual surface samples/normals, not their triangulation counts.
  return [...new Set(Array.from({ length: position.count }, (_, i) => [position.getX(i) * mirror, position.getY(i), position.getZ(i),
    normal.getX(i) * mirror, normal.getY(i), normal.getZ(i)].map(value => Math.round(value * 1e5)).join(",")))].sort();
};
assert.deepEqual(fistVertices(fistProbe.leftForearm, 1), fistVertices(fistProbe.rightForearm, -1), "merged left/right fist vertices and normals are true mirrors");
fistProbe.dispose();
const satinProbe = new Fighter(new THREE.Scene(), { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
assert.ok(satinProbe.helmetShell?.isMesh, "capsule shell needs its own finish without changing the shared dark hardware");
assert.equal(satinProbe.helmetShell.material.roughness, .56);
assert.equal(satinProbe.helmetShell.material.clearcoatRoughness, .4);
satinProbe.dispose();
assert.equal(playerMergeSource.split("new THREE.BufferGeometry().copy(mesh.geometry)").length - 1, 3,
  "transient merge copies must not rebuild each procedural geometry constructor");
const legacyPlayerSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replaceAll("new THREE.BufferGeometry().copy(mesh.geometry)", "mesh.geometry.clone()");
const LegacyMergeFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${legacyPlayerSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const beforeSatinSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("costumeVariant === 2 ? visorFrame : [helmet, ...visorFrame]", "[helmet, ...visorFrame]")
  .replace(/    if \(costumeVariant === 2\) \{\r?\n      \/\/ Separate only the shell finish;[\s\S]*?    \}\r?\n/, "");
const BeforeSatinFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeSatinSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const beforeFistSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace(/  \/\/ Fixed armored fist:[\s\S]*?(?=  const elbowJoint)/, `  const hand = part(new THREE.BoxGeometry(.25, .22, .29), dark, 0, -.58, .05);
  const knuckle = part(new THREE.BoxGeometry(.2, .055, .18), accent, 0, -.59, .19, false);
`)
  .replace("[wristLight, ...knuckles]", "[wristLight, knuckle]")
  .replace("[hand, thumb, ...curledFingers]", "[hand]")
  .replace("hand: { position: hand.position.clone() }", "hand");
const BeforeFistFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeFistSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
function assertFingerSeparations(fighter) {
  for (const arm of [fighter.leftForearm, fighter.rightForearm]) {
    const dark = new THREE.Mesh(arm.children[2].geometry, arm.children[2].material);
    const accent = new THREE.Mesh(arm.children[1].geometry, arm.children[1].material);
    const hit = (mesh, x) => new THREE.Raycaster(new THREE.Vector3(x, -.654, .3), new THREE.Vector3(0, 0, -1)).intersectObject(mesh, false)[0];
    for (const x of [-.0475, 0, .0475]) {
      assert.ok(!hit(dark, x) || hit(dark, x).point.z < .178, "three finger separations must remain recessed in the actual dark batch");
      assert.equal(hit(accent, x), undefined, "the light insets must not bridge the finger separations");
    }
    for (const x of [-.07125, -.02375, .02375, .07125]) {
      assert.ok(Math.abs(hit(dark, x).point.z - .183) < 1e-6);
      assert.ok(Math.abs(hit(accent, x).point.z - .184) < 1e-6, "each inset sits on the flat finger face without covering its bevel");
    }
  }
}
{
  const scene = new THREE.Scene(), config = { id: "finger-qa", color: 0x129dba, accent: 0x6ff6ff };
  const before = new BeforeFistFighter(scene, config, ["blaster"], new THREE.Vector3());
  const after = new Fighter(scene, config, ["blaster"], new THREE.Vector3());
  assert.throws(() => assertFingerSeparations(before), /three finger separations/, "the original undivided hand fails the finger-readability regression");
  assertFingerSeparations(after); before.dispose(); after.dispose();
}
function mergedFighterSnapshot(fighter, excluded = new Set()) {
  const meshes = [];
  fighter.group.updateMatrixWorld(true);
  fighter.group.traverse(object => {
    if (!object.geometry || excluded.has(object)) return;
    const geometry = object.geometry, digest = createHash("sha256");
    const attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      digest.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      attributes[name] = [attribute.itemSize, attribute.count, attribute.normalized];
    }
    if (geometry.index) digest.update(new Uint8Array(geometry.index.array.buffer, geometry.index.array.byteOffset, geometry.index.array.byteLength));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    meshes.push({ attributes, hash: digest.digest("hex"), groups: geometry.groups, drawRange: geometry.drawRange,
      bounds: [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray(), geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius],
      matrix: object.matrixWorld.toArray(), shadow: [object.castShadow, object.receiveShadow],
      materials: [].concat(object.material).map(material => ({ type: material.type, color: material.color?.getHexString(), emissive: material.emissive?.getHexString(),
        intensity: material.emissiveIntensity, roughness: material.roughness, metalness: material.metalness, clearcoat: material.clearcoat,
        opacity: material.opacity, transparent: material.transparent, blending: material.blending, side: material.side, depthWrite: material.depthWrite })) });
  });
  return { meshes, grip: fighter.weaponGrip.toArray(), support: fighter.weaponSupportGrip.toArray(), muzzle: fighter.weaponMuzzleDistance };
}
for (const weapon of Object.values(WEAPONS)) {
  const config = { id: "fist-parity", color: 0x129dba, accent: 0x6ff6ff }, scene = new THREE.Scene();
  const after = new Fighter(scene, config, [weapon.id], new THREE.Vector3());
  const oldElbow = new BeforeElbowFighter(scene, config, [weapon.id], new THREE.Vector3());
  // Keep the newer shoulder finish fixed while reconstructing the older elbow-only change.
  for (const arm of [oldElbow.leftArm, oldElbow.rightArm]) arm.children[0].material = after.elbowMaterial.clone();
  const oldShoulder = new BeforeShoulderFighter(scene, config, [weapon.id], new THREE.Vector3());
  const shoulders = fighter => new Set([fighter.leftArm.children[0], fighter.rightArm.children[0]]);
  assert.deepEqual(mergedFighterSnapshot(after, shoulders(after)), mergedFighterSnapshot(oldShoulder, shoulders(oldShoulder)),
    `${weapon.id}: shoulder finish preserves every other mesh, material, grip and muzzle`);
  assert.equal(mergedFighterSnapshot(after).meshes.length, mergedFighterSnapshot(oldShoulder).meshes.length);
  for (const side of ["leftArm", "rightArm"]) {
    const current = after[side].children[0], previous = oldShoulder[side].children[0];
    for (const key of Object.keys(current.geometry.attributes)) assert.deepEqual(current.geometry.attributes[key].array, previous.geometry.attributes[key].array);
    assert.deepEqual(current.matrix.toArray(), previous.matrix.toArray());
    const actual = current.material.toJSON(), expected = { ...previous.material.toJSON(), roughness: .56, clearcoatRoughness: .4 };
    delete actual.uuid; delete expected.uuid; assert.deepEqual(actual, expected);
  }
  const elbowBatches = fighter => new Set([fighter.leftForearm, fighter.rightForearm].flatMap(arm => arm.children.slice(2)));
  assert.deepEqual(mergedFighterSnapshot(after, elbowBatches(after)), mergedFighterSnapshot(oldElbow, elbowBatches(oldElbow)),
    `${weapon.id}: elbow shaping preserves all other meshes, weapon anchors and materials`);
  for (const side of ["leftForearm", "rightForearm"]) for (const name of ["position", "normal", "uv"]) {
    const current = after[side].children[2].geometry.attributes[name];
    assert.deepEqual(current.array, oldElbow[side].children[2].geometry.attributes[name].array.slice(0, current.array.length),
      `${weapon.id}: every approved hand ${name} float remains exact`);
  }
  assert.equal(mergedFighterSnapshot(after).meshes.length - mergedFighterSnapshot(oldElbow).meshes.length, 2);
  const before = new BeforeFistFighter(scene, config, [weapon.id], new THREE.Vector3());
  const changedBatches = fighter => new Set([fighter.leftForearm, fighter.rightForearm].flatMap(arm => arm.children.slice(1)));
  assert.deepEqual(mergedFighterSnapshot(after, changedBatches(after)), mergedFighterSnapshot(before, changedBatches(before)),
    `${weapon.id}: hand art must not alter other geometry/materials, grip anchors or weapon/muzzle transforms`);
  assert.equal(mergedFighterSnapshot(after).meshes.length, mergedFighterSnapshot(before).meshes.length, "fist uses existing render batches");
  for (const forearm of [after.leftForearm, after.rightForearm]) {
    const geometry = forearm.children[2].geometry;
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.x > -.16 && geometry.boundingBox.max.x < .16 && geometry.boundingBox.min.y > -.7,
      "tucked thumb and curl stay within the compact forearm envelope");
    for (const name of ["position", "normal", "uv"]) assert.ok([...geometry.attributes[name].array].every(Number.isFinite));
    const normals = geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-6);
  }
  const world = { resolve: p => { p.y = 0; return { grounded: true }; }, boostAt: () => null }, move = new THREE.Vector3();
  for (const pose of ["aim", "reload", "fire"]) for (let i = 0; i < 24; i++) {
    for (const fighter of [before, after, oldElbow, oldShoulder]) {
      fighter.reloadTimer = pose === "reload" ? 1 : 0; fighter.attackTimer = pose === "fire" ? weapon.cooldown : 0;
      fighter.update(1 / 60, move, new THREE.Vector3(0, .4, -1), {}, world);
    }
    assert.deepEqual(after.weaponGroup.matrix.toArray(), before.weaponGroup.matrix.toArray(), `${weapon.id}/${pose}: weapon animation remains exact`);
    for (const key of ["leftArm", "rightArm", "leftForearm", "rightForearm"]) assert.deepEqual(after[key].quaternion.toArray(), before[key].quaternion.toArray());
    for (const key of ["leftArm", "rightArm", "leftForearm", "rightForearm"]) assert.deepEqual(after[key].quaternion.toArray(), oldElbow[key].quaternion.toArray());
    assert.deepEqual(after.weaponGroup.matrix.toArray(), oldElbow.weaponGroup.matrix.toArray());
    assert.deepEqual(after.weaponGroup.matrix.toArray(), oldShoulder.weaponGroup.matrix.toArray());
    for (const key of ["leftArm", "rightArm", "leftForearm", "rightForearm"]) assert.deepEqual(after[key].quaternion.toArray(), oldShoulder[key].quaternion.toArray());
    assert.equal(after.elbowMaterial.emissiveIntensity, after.darkMaterial.emissiveIntensity);
  }
  after.takeHit(100);
  for (let i = 0; i < 90; i++) {
    after.updateDeath(1 / 60);
    assert.equal(after.elbowMaterial.emissiveIntensity, after.darkMaterial.emissiveIntensity);
  }
  after.dispose(); before.dispose(); oldElbow.dispose(); oldShoulder.dispose(); assert.equal(scene.children.length, 0);
}
for (let variant = 0; variant < 4; variant++) {
  const config = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const fighter = new Fighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  const before = new BeforeSatinFighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  if (variant !== 2) {
    assert.equal(fighter.helmetShell, undefined); assert.ok(fighter.shellMaterial === fighter.darkMaterial);
    assert.deepEqual(mergedFighterSnapshot(fighter), mergedFighterSnapshot(before), "other variants retain all geometry, materials and transforms");
  } else {
    const shell = fighter.helmetShell;
    assert.ok(shell.parent === fighter.helmet && shell.material === fighter.shellMaterial && shell.material !== fighter.darkMaterial);
    assert.deepEqual(shell.position.toArray(), [0, 0, 0]); assert.deepEqual(shell.scale.toArray(), [1, 1, 1]);
    assert.deepEqual(mergedFighterSnapshot(fighter, new Set([fighter.helmet, shell])), mergedFighterSnapshot(before, new Set([before.helmet])),
      "hardware children, weapons, body, armor, lenses and all other materials remain exact");
    const combined = mergeGeometries([shell.geometry, fighter.helmet.geometry], false);
    for (const name of ["position", "normal", "uv"]) assert.deepEqual(combined.attributes[name].array, before.helmet.geometry.attributes[name].array,
      `splitting the shell preserves every existing ${name} value and triangle order`);
    combined.dispose();
    const oldJSON = before.darkMaterial.toJSON(), satinJSON = shell.material.toJSON();
    for (const key of ["uuid", "roughness", "clearcoatRoughness"]) { delete oldJSON[key]; delete satinJSON[key]; }
    assert.deepEqual(satinJSON, oldJSON, "only the two approved finish properties differ, no lighting/color/emission loss");
    assert.ok(shell.material.envMap === null, "shell keeps full shared scene environment lighting");
    assert.equal(shell.castShadow, before.helmet.castShadow); assert.equal(shell.receiveShadow, before.helmet.receiveShadow);
    assert.equal(shell.frustumCulled, true);
    assert.deepEqual(new THREE.Box3().setFromObject(fighter.group), new THREE.Box3().setFromObject(before.group));
    const relative = fighter.helmet.matrixWorld.clone().invert().multiply(shell.matrixWorld);
    const world = { resolve: () => ({ grounded: true }), boostAt: () => null };
    for (const pitch of [-Math.PI / 2, -Math.PI / 3, 0, Math.PI / 3, Math.PI / 2]) {
      fighter.takeHit(1);
      for (let frame = 0; frame < 60; frame++) {
        fighter.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)), {}, world);
        fighter.group.updateMatrixWorld(true);
        const actual = fighter.helmet.matrixWorld.clone().invert().multiply(shell.matrixWorld);
        actual.elements.forEach((value, i) => assert.ok(Math.abs(value - relative.elements[i]) < 1e-12));
        assert.equal(shell.material.emissiveIntensity, fighter.darkMaterial.emissiveIntensity, "hit/idle shell feedback stays synchronized");
      }
    }
    fighter.takeHit(100);
    for (let frame = 0; frame < 90; frame++) {
      fighter.updateDeath(1 / 60);
      assert.equal(shell.material.emissiveIntensity, fighter.darkMaterial.emissiveIntensity, "death flash/fade remains synchronized");
    }
    fighter.respawn(new THREE.Vector3(1, 2, 3));
    assert.equal(shell.material.emissiveIntensity, .025);
    assert.equal(shell.material.roughness, .56); assert.equal(shell.material.clearcoatRoughness, .4);
    const owned = [shell.geometry, shell.material], disposals = new Map(owned.map(resource => [resource, 0]));
    for (const resource of owned) resource.addEventListener("dispose", () => disposals.set(resource, disposals.get(resource) + 1));
    fighter.dispose();
    assert.ok([...disposals.values()].every(count => count === 1), "nested shell buffers and owned finish dispose exactly once");
  }
  if (variant !== 2) fighter.dispose();
  before.dispose();
}
for (const id of Object.keys(WEAPONS)) {
  const config = { id: "merge-parity", color: 0x129dba, accent: 0x6ff6ff };
  const modern = new Fighter(new THREE.Scene(), config, [id], new THREE.Vector3(3, 4, 5));
  const legacy = new LegacyMergeFighter(new THREE.Scene(), config, [id], new THREE.Vector3(3, 4, 5));
  assert.deepEqual(mergedFighterSnapshot(modern), mergedFighterSnapshot(legacy), `${id}: direct buffer copies preserve the full fighter/weapon output`);
  modern.dispose(); legacy.dispose();
}
const mergeHelperSource = playerMergeSource.slice(playerMergeSource.indexOf("function mergeStaticParts("), playerMergeSource.indexOf("const armDown"));
const mergeCopies = [];
const mergeHelpers = new Function("THREE", "mergeGeometries", "disposeGeometry", `${mergeHelperSource}; return { mergeStaticParts, mergeRigidMeshes, combineMaterialBatches };`)(THREE,
  (geometries, groups) => {
    for (const geometry of geometries) {
      const copy = { geometry, disposals: 0 }; mergeCopies.push(copy);
      geometry.addEventListener("dispose", () => copy.disposals++);
    }
    return mergeGeometries(geometries, groups);
  }, geometry => { if (!geometry.userData.sharedFighterGeometry) geometry.dispose(); });
let proceduralCopies = 0;
class CountedMergeGeometry extends THREE.BufferGeometry {
  constructor() { super(); proceduralCopies++; }
}
for (const indexed of [true, false]) for (const name of Object.keys(mergeHelpers)) {
  const box = new THREE.BoxGeometry(1, 2, 3), flat = indexed ? box : box.toNonIndexed();
  const source = new CountedMergeGeometry().copy(flat);
  if (flat !== box) flat.dispose(); box.dispose();
  source.userData.sharedFighterGeometry = true;
  source.morphAttributes.position = [source.attributes.position.clone()]; source.morphTargetsRelative = true;
  source.computeBoundingBox(); source.computeBoundingSphere(); source.setDrawRange(0, 12);
  const sourceData = source.toJSON(), sourceBuffers = Object.values(source.attributes).map(attribute => attribute.array);
  let sourceDisposals = 0; source.addEventListener("dispose", () => sourceDisposals++);
  const beforeConstructors = proceduralCopies, beforeCopies = mergeCopies.length;
  const root = new THREE.Group();
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const meshes = materials.map((material, i) => { const mesh = new THREE.Mesh(source, name === "mergeRigidMeshes" ? materials[0] : material); mesh.position.set(i, 2, 3); mesh.updateMatrix(); root.add(mesh); return mesh; });
  const output = name === "mergeStaticParts" ? mergeHelpers[name](materials[0], meshes) : (mergeHelpers[name](root), root);
  assert.equal(proceduralCopies, beforeConstructors, `${name} must not invoke a source subclass constructor (${indexed ? "indexed" : "flat"})`);
  assert.equal(sourceDisposals, 0, "shared source buffers remain owned by their cache");
  assert.deepEqual(source.toJSON(), sourceData, "transforms/copying cannot mutate source geometry data, morphs or bounds");
  assert.deepEqual(Object.values(source.attributes).map(attribute => attribute.array), sourceBuffers);
  assert.ok(mergeCopies.slice(beforeCopies).every(copy => copy.disposals === 1), "all transient merge inputs are disposed exactly once");
  output.traverse(object => { if (object.geometry && object.geometry !== source) object.geometry.dispose(); });
  source.dispose(); materials.forEach(material => material.dispose());
}
if (process.argv.includes("--bench-merge")) {
  const results = [];
  for (let batch = 0; batch < 6; batch++) {
    const variants = [["current", Fighter], ["legacy", LegacyMergeFighter]];
    if (batch % 2) variants.reverse();
    for (const [name, Type] of variants) {
      let constructionMs = 0, disposalMs = 0;
      for (const id of Object.keys(WEAPONS)) {
        const start = performance.now();
        const fighter = new Type(new THREE.Scene(), { id: "merge-bench", color: 0x129dba, accent: 0x6ff6ff }, [id], new THREE.Vector3());
        const built = performance.now(); fighter.dispose();
        constructionMs += built - start; disposalMs += performance.now() - built;
      }
      results.push({ batch, name, weapons: Object.keys(WEAPONS).length, constructionMs, disposalMs });
    }
  }
  console.log(JSON.stringify({ mergeBenchmark: results }));
}

// Execute the fixture's actual wait helper with a stopped animation clock.
const graphicsFixture = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
const humanGrappleSource = graphicsFixture.slice(graphicsFixture.indexOf('select("human-grapple").onclick = ') + 'select("human-grapple").onclick = '.length,
  graphicsFixture.indexOf('select("hold-ropes").onclick')).trim().replace(/;$/, "");
const startHumanMotion = new Function("game", "stress", "resetPhase", "resetSamples", `(${humanGrappleSource})(); return stress;`);
const humanEvents = [], humanGame = { paused: true, players: [{ grapple: {} }], sound: { resume: () => humanEvents.push("audio") },
  setTrainingBotOption: (...args) => humanEvents.push(args) };
for (const [stress, phase] of [[true, "ready"], [false, "starting"]]) assert.throws(() => startHumanMotion(humanGame, stress, phase, () => {}), /ready paused grapple/);
assert.equal(humanEvents.length, 0);
assert.equal(startHumanMotion(humanGame, false, "ready", () => humanEvents.push("samples")), true);
assert.equal(humanGame.paused, false);
assert.deepEqual(humanEvents, [["botsStandStill", true], ["botsDontAttack", true], "audio", "samples"]);
const holdRopeSource = graphicsFixture.slice(graphicsFixture.indexOf('select("hold-ropes").onclick = ') + 'select("hold-ropes").onclick = '.length,
  graphicsFixture.indexOf('select("thruster-dust").onclick')).trim().replace(/;$/, "");
for (const legacy of [false, true]) {
  const players = Array.from({ length: 16 }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(1, 2, 3), aim: new THREE.Vector3(), grapple: {} }));
  let releases = 0, creates = 0;
  const game = { paused: true, players, releaseGrapple(player) { releases++; player.grapple = null; },
    toggleGrapple(player) { creates++; player.grapple = { line: { material: { opacityNode: materialOpacity } } }; } };
  const runHeld = new Function("game", "stress", "resetPhase", "location", `return (${holdRopeSource})();`);
  const location = { search: legacy ? "?legacyRopeBindings" : "" };
  for (const [stress, phase, paused] of [[true, "ready", true], [false, "starting", true], [false, "ready", false]]) {
    game.paused = paused;
    assert.throws(() => runHeld(game, stress, phase, location), /ready paused/);
    assert.equal(releases + creates, 0, "guarded QA attempts cannot mutate gameplay");
  }
  game.paused = true; runHeld(game, false, "ready", location);
  assert.equal(releases, 16); assert.equal(creates, 15); assert.equal(players[0].grapple, null);
  assert.deepEqual(players[0].position.toArray(), [0, 0, 0]);
  for (const [i, player] of players.slice(1).entries()) {
    assert.deepEqual(player.position.toArray(), [-12, 18.6, -9 + i * 1.25]);
    assert.equal(player.velocity.lengthSq(), 0); assert.ok(Math.abs(player.aim.length() - 1) < 1e-12);
    assert.ok(player.grapple.line.material.opacityNode === (legacy ? null : materialOpacity));
  }
}
const textureTraceSource = graphicsFixture.slice(graphicsFixture.indexOf("function installResizeTextureTrace("), graphicsFixture.indexOf("const resizeTextureTrace ="));
const installTextureTrace = new Function(`${textureTraceSource}; return installResizeTextureTrace;`)();
const tracedDescriptors = [], traceEvents = [], textureTraceState = { serial: 0, dropped: 0, entries: [] };
const traceDevice = { createTexture(descriptor) {
  assert.equal(this, traceDevice); tracedDescriptors.push(descriptor);
  const result = { label: descriptor.label, destroy(...args) { assert.equal(this, result); traceEvents.push(args); return "destroyed"; } }; return result;
} };
const traceBackend = { device: traceDevice, createTexture(texture, options) {
  assert.equal(this, traceBackend);
  if (options.fail) throw Error("trace failure");
  if (options.nested) this.createTexture({}, { descriptor: options.descriptor });
  return this.device.createTexture(options.descriptor);
} };
installTextureTrace({ backend: traceBackend, info: { calls: 42 } }, textureTraceState);
const tracedOwner = { id: 123, name: "output", version: 7, renderTarget: { width: 10, height: 20, isPostProcessingRenderTarget: true } };
const sourceDescriptor = { label: "original", format: "rgba16float", size: { width: 10, height: 20 }, sampleCount: 4, usage: 16 };
const tracedTexture = traceBackend.createTexture(tracedOwner, { descriptor: sourceDescriptor, nested: true });
assert.equal(tracedDescriptors[0], sourceDescriptor, "non-target texture descriptors stay untouched even inside nested creation");
assert.deepEqual(tracedDescriptors[1], { ...sourceDescriptor, label: "resize-texture-1 original" });
assert.equal(sourceDescriptor.label, "original");
assert.deepEqual(textureTraceState.entries[0].owner, { textureId: 123, version: 7, name: "output", width: 10, height: 20, outputConversion: true });
assert.notEqual(textureTraceState.entries[0].size, sourceDescriptor.size);
assert.equal(tracedTexture.destroy("argument"), "destroyed");
assert.deepEqual(traceEvents, [["argument"]]);
assert.equal(textureTraceState.entries[0].destroyed.calls, 42);
assert.equal(textureTraceState.entries[0].actualLabel, "resize-texture-1 original");
assert.equal(textureTraceState.entries[0].destroyed.label, "resize-texture-1 original");
assert.throws(() => traceBackend.createTexture(tracedOwner, { fail: true }), /trace failure/);
traceDevice.createTexture(sourceDescriptor);
assert.equal(tracedDescriptors.at(-1), sourceDescriptor, "a thrown backend call always restores the previous trace owner");
for (let i = 0; i < 100; i++) traceBackend.createTexture(tracedOwner, { descriptor: sourceDescriptor });
assert.equal(textureTraceState.serial, 101); assert.equal(textureTraceState.entries.length, 96); assert.equal(textureTraceState.dropped, 5);
assert.equal(textureTraceState.entries.at(-1).label, "resize-texture-101");
const resetCaptureSource = graphicsFixture.slice(graphicsFixture.indexOf('  resetPhase = "starting";'), graphicsFixture.indexOf('  clearThrusterSortControl();', graphicsFixture.indexOf("async function reset()")));
const staleLink = { hidden: false, href: "old-frame", removeAttribute(name) { delete this[name]; } };
const clearedCapture = new Function("select", `let resetPhase='ready', captureCanvas=true, canvasCapture={old:true}; ${resetCaptureSource}; return {resetPhase,captureCanvas,canvasCapture};`)(() => staleLink);
assert.deepEqual(clearedCapture, { resetPhase: "starting", captureCanvas: false, canvasCapture: null });
assert.equal(staleLink.hidden, true); assert.equal(staleLink.href, undefined);
const requestCaptureSource = graphicsFixture.match(/select\("capture-canvas"\)\.onclick = ([^\n]+);/)[1];
for (const phase of ["starting", "started", "ready"]) {
  let checked = false;
  const requested = new Function("resetPhase", "validateExhaustView", `let captureCanvas=false; (${requestCaptureSource})(); return captureCanvas;`)(phase, () => { checked = true; });
  assert.equal(checked, true);
  assert.equal(requested, phase === "ready");
  assert.throws(() => new Function("resetPhase", "validateExhaustView", `let captureCanvas=false; (${requestCaptureSource})();`)(phase, () => { throw Error("unsupported view"); }), /unsupported view/);
}
let deferredReset, resetCalls = 0;
const costumeChangeSource = graphicsFixture.match(/select\("costume"\)\.onchange = ([^\n]+);/)[1];
new Function("setTimeout", "reset", `(${costumeChangeSource})();`)((fn, delay) => { assert.equal(delay, 0); deferredReset = fn; }, () => resetCalls++);
assert.equal(resetCalls, 0); deferredReset(); assert.equal(resetCalls, 1);
assert.ok(graphicsFixture.includes('if (captureCanvas && resetPhase === "ready")'));
assert.ok(graphicsFixture.includes("function replaceReviewCostume("), "helmet review uses all four actual Fighter variants");
const reviewCostumeSource = graphicsFixture.slice(graphicsFixture.indexOf("function replaceReviewCostume("), graphicsFixture.indexOf("function setView("));
for (const variant of ["", "0", "1", "2", "3"]) {
  const scene = new THREE.Scene();
  const original = new Fighter(scene, { id: "p1", name: "Review", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(2, 3, 4));
  const originalLoadout = original.loadout, neighbor = { id: "untouched" };
  let disposed = 0;
  const dispose = original.dispose.bind(original);
  original.dispose = () => { disposed++; dispose(); };
  const reviewGame = { scene, players: [original, neighbor] };
  new Function("game", "select", "Fighter", `${reviewCostumeSource}; replaceReviewCostume();`)(reviewGame, () => ({ value: variant }), Fighter);
  const selected = reviewGame.players[0];
  assert.equal(reviewGame.players.length, 2); assert.ok(reviewGame.players[1] === neighbor);
  assert.equal(disposed, variant === "" ? 0 : 1);
  assert.equal(scene.children.length, 1);
  assert.deepEqual(selected.position.toArray(), [2, 3, 4]);
  assert.equal(selected.color, original.color); assert.equal(selected.accent, original.accent); assert.equal(selected.name, "Review");
  assert.deepEqual(selected.loadout, originalLoadout);
  if (variant === "") assert.ok(selected === original);
  else {
    assert.equal([...selected.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4, Number(variant));
    assert.ok(selected.loadout !== originalLoadout); assert.equal(original.group.parent, null);
    assert.equal(original.weaponModels.size, 0);
  }
  selected.dispose(); assert.equal(scene.children.length, 0);
}
const settleReviewSource = graphicsFixture.slice(graphicsFixture.indexOf("const stillMove"), graphicsFixture.indexOf("function replaceReviewCostume("));
for (const active of [true, false]) {
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const pad = { position: new THREE.Vector3(0, 0, 0), strength: 24, active };
  const world = { boostPads: [pad], resolve: position => {
    const grounded = position.y <= 0; if (grounded) position.y = 0; return { grounded };
  }, boostAt: () => active ? pad : null };
  const geometry = hero.thrusterLights.geometry, material = hero.thrusterMaterial;
  const run = () => new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "view" ? "thrusters" : ["aim-height", "boost-pad"].includes(name) ? "0" : "boost" }));
  if (active) {
    const review = run();
    assert.equal(review.boost.sampledFrames, 30); assert.equal(review.boost.launched, true);
    assert.equal(hero.grounded, false); assert.ok(hero.position.y > 5 && hero.velocity.y > 0);
    assert.deepEqual(review.boost.position, hero.position.toArray());
    assert.equal(review.boost.scale, hero.thrusterScale); assert.equal(review.boost.opacity, material.opacity);
    assert.ok(hero.thrusterScale > 1.19 && hero.thrusterScale < 1.21);
  } else assert.throws(run, /active pad/);
  assert.equal(hero.thrusterLights.geometry, geometry); assert.equal(hero.thrusterMaterial, material);
  hero.dispose();
}
for (const view of ["fighter", "helmet-profile", "weapon", "hand-front", "lower-body-front", "arena"]) {
  let touched = false;
  assert.throws(() => new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
    { clearTransientNetworkCombat() { touched = true; } }, name => ({ value: name === "view" ? view : "boost" })), /requires a thruster or player-camera view/);
  assert.equal(touched, false, "unsupported boost framing fails before touching the scene");
}
for (const view of ["hand-front", "hand-side", "hand-opposite", "hand-palm", "player-camera"]) assert.ok(graphicsFixture.includes(`<option>${view}</option>`), `missing actual ${view} review view`);
for (const weaponId of ["blaster", "rocket_launcher", "energy_sword"]) for (const pose of ["aim", "reload", "reacquire-early", "reacquire-complete"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "hand-qa", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  const world = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
  const review = new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose }));
  assert.equal(review.requested, pose);
  if (pose !== "aim") assert.equal(review.reloadAccepted, weaponUsesAmmo(hero.weapon));
  if (weaponUsesAmmo(hero.weapon) && pose === "reload") {
    assert.ok(hero.reloadTimer > 0); assert.equal(hero.supportGripProgress, 0);
  } else if (weaponUsesAmmo(hero.weapon) && pose.startsWith("reacquire")) {
    assert.equal(hero.reloadTimer, 0); assert.equal(hero.reloadWeaponId, null); assert.equal(hero.ammo[weaponId], hero.weapon.ammo);
    if (pose === "reacquire-early") assert.ok(hero.supportGripProgress > 0 && hero.supportGripProgress < 1);
    else assert.equal(hero.supportGripProgress, 1);
  }
  if (pose === "aim" || pose === "reacquire-complete") {
    const grip = hero.weaponGrip.clone().applyMatrix4(hero.weaponGroup.matrixWorld);
    const hand = hero.rightHand.position.clone().applyMatrix4(hero.rightForearm.matrixWorld);
    assert.ok(hand.distanceTo(grip) < .03, "review uses the existing grip solve, not a synthetic hand pose");
  }
  hero.dispose();
}
for (const height of [0, Math.sqrt(3), -Math.sqrt(3)]) {
  const aims = [], hero = { velocity: new THREE.Vector3(2, 3, 4), group: { updateMatrixWorld() {} },
    update(dt, move, aim) { assert.equal(dt, 1 / 60); assert.equal(move.length(), 0); aims.push(aim.clone()); } };
  let clears = 0;
  new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
    { players: [hero], world: {}, clearTransientNetworkCombat() { clears++; } }, name => ({ value: name === "aim-height" ? String(height) : "aim" }));
  assert.equal(clears, 1); assert.equal(aims.length, 60); assert.equal(hero.velocity.length(), 0);
  assert.ok(aims.every(aim => Math.abs(aim.length() - 1) < 1e-12 && Math.abs(aim.y - height / Math.hypot(height, 1)) < 1e-12 && aim.z < 0));
}
// Execute the exact capture block: later frame counters must not alter evidence.
for (const pose of ["gait-positive", "gait-negative", "landing"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15.01, 8));
  const world = { resolve: position => { const grounded = position.y <= 15.01; if (grounded) position.y = 15.01; return { grounded }; }, boostAt: () => null };
  const poseState = new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose }));
  const sample = poseState.locomotion;
  assert.ok(sample.sampledFrames > 0 && sample.sampledFrames <= 180); assert.equal(sample.grounded, true);
  assert.ok(sample.maxHorizontalCorrection < 1e-12);
  assert.deepEqual(sample.position, hero.position.toArray()); assert.deepEqual(sample.velocity, hero.velocity.toArray());
  if (pose === "landing") {
    assert.ok(sample.landTimer > 0 && sample.landTimer <= .12); assert.ok(sample.landStrength > 0);
  } else {
    assert.ok(sample.sampledFrames > 60); assert.ok(sample.velocity[2] < -8.9);
    if (pose === "gait-positive") assert.ok(sample.previousDelta > 0 && sample.delta <= 0 && sample.angle > .3);
    else assert.ok(sample.previousDelta < 0 && sample.delta >= 0 && sample.angle < -.3);
    const resolve = world.resolve;
    world.resolve = position => { position.z = Math.max(position.z, 7.9); return resolve(position); };
    assert.throws(() => new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
      { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose })), /route obstructed/);
  }
  hero.dispose();
}
const handViewSource = graphicsFixture.slice(graphicsFixture.indexOf("function setView()"), graphicsFixture.indexOf("async function reset()"));
const chestVisibilitySource = graphicsFixture.slice(graphicsFixture.indexOf("async function withUnobstructedChest("), graphicsFixture.indexOf("async function runChestInspection("));
const inspectChest = new Function(`${chestVisibilitySource}; return withUnobstructedChest;`)();
{
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-0", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  const links = [], controls = { view: { value: "chest-front" }, pose: { value: "aim" }, "camera-captures": { replaceChildren() { links.length = 0; }, append(link) { links.push(link); } } };
  const document = { querySelectorAll: () => [], createElement: () => ({ dataset: {} }), querySelector: () => ({ toDataURL: () => "test-frame" }) };
  const source = graphicsFixture.slice(graphicsFixture.indexOf("async function runChestInspection("), graphicsFixture.indexOf("async function withSettledReviewCamera("));
  const runner = new Function("game", "select", "document", "withUnobstructedChest", "withAlignedShoulders", "withFittedChestCore", "exhaustBody", "shellReviewState", `
    const resetReview={},cacheReview={},decoyReview={},cameraReview={},poseReview={},sceneSerial=1,errorCount=0,stress=false,resetPhase="ready";
    let renderedFrames=0; const waitForReviewFrame=async()=>{renderedFrames+=4;},withFrozenShaderTime=async capture=>capture();
    ${source};return runChestInspection;
  `)({players:[hero],paused:true,renderPipeline:{direct:false}}, name => controls[name], document, inspectChest, withAlignedShoulders, withFittedChestCore, exhaustBody,
    mesh => ({fighterId:hero.id,geometryId:mesh.geometry.uuid}));
  for (const shoulder of [false, true]) {
    await runner(shoulder);
    const samples = links.map(link => JSON.parse(link.dataset.review));
    assert.equal(samples.length, 3); assert.deepEqual(samples.map(s => s.index), [0, 1, 2]);
    assert.ok(samples.every(s => s.fighterId === "helmet-0" && s.view === "chest-front" && s.errorCount === 0));
    assert.deepEqual(samples.map(s => s.armVisibility), shoulder ? [[true,true,true],[true,true,true],[true,true,true]] : [[true,true,true],[false,false,false],[true,true,true]]);
    assert.equal(samples[0].geometryId, samples[2].geometryId);
    if (shoulder) assert.notEqual(samples[0].geometryId, samples[1].geometryId);
    const frozen = links[0].dataset.review; hero.aim.y += .1;
    assert.equal(links[0].dataset.review, frozen, "per-PNG evidence is immutable, independent of later pose or throttled status panel");
  }
  await runner("core-fit");
  const chestFrames = links.map(link => JSON.parse(link.dataset.review));
  assert.deepEqual(chestFrames.map(s => s.mode), ["current", "hidden-current", "hidden-previous-core", "hidden-restored", "previous-core", "restored"]);
  assert.deepEqual(chestFrames.map(s => s.armVisibility), [[true,true,true],[false,false,false],[false,false,false],[false,false,false],[true,true,true],[true,true,true]]);
  assert.equal(chestFrames[0].geometryId, chestFrames[5].geometryId);
  assert.equal(chestFrames[0].geometryId, exhaustBody(hero).geometry.uuid, "all controls describe the edited dark torso, not unrelated armor");
  assert.equal(chestFrames[1].geometryId, chestFrames[3].geometryId);
  assert.notEqual(chestFrames[1].geometryId, chestFrames[2].geometryId);
  hero.dispose();
}
for (const fail of [false, true]) {
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-0", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  hero.rightArm.visible = false;
  const before = hero.group.toJSON(), children = [...hero.rig.children];
  const run = () => inspectChest(hero, async () => {
    assert.deepEqual([hero.leftArm.visible, hero.rightArm.visible, hero.weaponGroup.visible], [false, false, false]);
    assert.deepEqual(hero.rig.children, children);
    if (fail) throw Error("chest capture failed");
  });
  if (fail) await assert.rejects(run, /chest capture failed/); else await run();
  assert.deepEqual(hero.group.toJSON(), before, "diagnostic restores exactly, including previously hidden arms");
  hero.dispose();
}
for (const view of ["chest-front", "chest-oblique", "chest-profile"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-0", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { resolve: position => { position.y = 15.01; return { grounded: true }; }, boostAt: () => null } };
  const controls = { view: { value: view }, pose: { value: "aim" }, "aim-height": { value: "1.7320508075688772" } };
  new Function("THREE", "game", "select", `let stress=false, cameraOffset=0;
    const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; setView();`)(THREE, game, name => controls[name]);
  game.camera.updateMatrixWorld(true);
  const target = new THREE.Vector3(0, 16.54, 8).project(game.camera);
  assert.ok(Math.abs(target.x) < 1e-6 && Math.abs(target.y) < 1e-6 && target.z > 0 && target.z < 1);
  assert.ok(hero.aim.y > .86, "chest review retains actual raised aim");
  hero.dispose();
}
for (const [pose, view] of [["gait-positive", "waist-profile"], ["gait-negative", "waist-profile"],
  ["hip-hard-peak", "waist-low-front"], ["hip-hard-recovery", "waist-low-front"], ["hip-hard-peak", "chest-oblique"]]) {
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { boostPads: [], boostAt: () => null, resolve: position => { const grounded = position.y <= 15; if (grounded) position.y = 15; return { grounded }; } } };
  const controls = { view: { value: view },
    pose: { value: pose }, "aim-height": { value: "0" } };
  const state = new Function("THREE", "game", "select", `let stress=false, cameraOffset=0;
    const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; setView(); return poseReview;`)(THREE, game, name => controls[name]);
  assert.equal(state.requested, pose);
  if (pose.startsWith("hip-hard-")) {
    assert.equal(state.hipLanding.landStrength, 1); assert.equal(state.hipLanding.grounded, true);
    if (pose === "hip-hard-peak") assert.ok(state.hipLanding.landTimer > .09 && state.hipLanding.landTimer <= .11);
    else { assert.equal(state.hipLanding.landTimer, 0); assert.equal(state.hipLanding.afterTimer, 6); }
  } else {
    assert.equal(state.locomotion.grounded, true); assert.ok(state.locomotion.maxHorizontalCorrection < 1e-12);
    assert.ok(pose === "gait-positive" ? state.locomotion.angle > .3 : state.locomotion.angle < -.3);
  }
  game.camera.updateMatrixWorld(true);
  const target = (view.startsWith("chest-") ? new THREE.Vector3(0, 16.54, 8)
    : hero.position.clone().add(new THREE.Vector3(0, pose.startsWith("gait-") ? .91 : .85, 0))).project(game.camera);
  assert.ok(Math.abs(target.x) < 1e-6 && Math.abs(target.y) < 1e-6 && target.z > 0 && target.z < 1);
  hero.dispose();
}
const settledCameraSource = graphicsFixture.slice(graphicsFixture.indexOf("async function withSettledReviewCamera("), graphicsFixture.indexOf("async function runLowerBodyReview("));
for (const mode of ["exhaust", "exhaust-raised", "exhaust-integrated", "torso"]) {
  const source = graphicsFixture.slice(graphicsFixture.indexOf("async function runLowerBodyReview("), graphicsFixture.indexOf("async function runShellReview("));
  const hero = (["exhaust-integrated", "torso"].includes(mode) ? (...args) => new Fighter(...args) : previousFighter)(new THREE.Scene(), { id: "helmet-1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const target = hero.rig.children.find(mesh => mesh.isMesh && mesh.material === hero.darkMaterial), original = target.geometry;
  const game = { players: [hero], paused: true, renderPipeline: { direct: false } }, captured = [];
  const controls = { view: { value: mode === "torso" ? "waist-front" : "thrusters" }, pose: { value: "aim" }, "camera-captures": { replaceChildren() {}, append() {} } };
  const document = { querySelectorAll: () => [], createElement: () => ({}), querySelector: () => ({ toDataURL: () => "unit-test-only" }) };
  const review = new Function("game", "select", "document", "withExhaustShrouds", "shellReviewState", "exhaustBody", "withPreviousExhaust", "withShortenedTorso", `
    const resetReview={},cacheReview={},decoyReview={},cameraReview={},sceneSerial=1,errorCount=0,stress=false,resetPhase="ready",poseReview={requested:"aim"};
    let renderedFrames=0; const waitForReviewFrame=async()=>{renderedFrames+=4;},withFrozenShaderTime=async capture=>capture();
    ${settledCameraSource}; ${source}; return {run:runLowerBodyReview,state:cameraReview};
  `)(game, name => controls[name], document, withExhaustShrouds, mesh => {
    captured.push(mesh); return { targetGeometry: mesh.geometry.uuid, targetVertices: mesh.geometry.attributes.position.count };
  }, exhaustBody, withPreviousExhaust, withShortenedTorso);
  await review.run(mode);
  assert.equal(review.state.error, null); assert.equal(review.state.running, false);
  const count = mode === "exhaust-raised" ? 4 : 3;
  assert.equal(captured.length, count); assert.equal(captured[0], target); assert.equal(captured[count - 1], target);
  assert.notEqual(captured[1], target); assert.equal(captured[1].material, target.material);
  assert.equal(review.state.samples[0].targetGeometry, original.uuid);
  assert.equal(review.state.samples[count - 1].targetGeometry, original.uuid);
  if (mode === "torso") {
    assert.equal(review.state.samples[1].targetVertices, review.state.samples[0].targetVertices);
    assert.deepEqual(review.state.samples.map(s => s.mode), ["integrated-lower-core", "previous-lower-core", "restored"]);
    hero.dispose(); continue;
  }
  assert.ok(mode === "exhaust-integrated" ? review.state.samples[1].targetVertices < review.state.samples[0].targetVertices
    : review.state.samples[1].targetVertices > review.state.samples[0].targetVertices, "metadata uses the intended previous or candidate body, never another dark helmet mesh");
  if (count === 4) assert.ok(review.state.samples[2].targetVertices > review.state.samples[1].targetVertices, "raised candidate includes the actual pedestal");
  const flames = review.state.samples.map(s => { const { light, ...flame } = s.exhaust; return flame; });
  assert.deepEqual(flames, Array(count).fill(flames[0]));
  assert.deepEqual(review.state.samples.map(s => s.exhaust.light.shiftZ), mode === "exhaust-integrated" ? [0, .060, 0] : count === 3 ? [0, 0, 0] : [0, 0, -.060, 0]);
  assert.equal(review.state.samples[0].exhaust.light.geometry, review.state.samples[count - 1].exhaust.light.geometry);
  if (mode === "exhaust-integrated") assert.notEqual(review.state.samples[1].exhaust.light.geometry, review.state.samples[0].exhaust.light.geometry);
  hero.dispose();
}
for (const view of ["player-camera", "thrusters-low"]) for (const fail of [false, true]) {
  let updates = 0;
  const game = { updateCamera: () => updates++ }, original = game.updateCamera;
  const settle = new Function("game", "select", `${settledCameraSource}; return withSettledReviewCamera;`)(game, () => ({ value: view }));
  const run = () => settle(async () => {
    assert.equal(updates, view === "player-camera" ? 240 : 0);
    game.updateCamera();
    assert.equal(updates, view === "player-camera" ? 240 : 1);
    if (fail) throw Error("capture failed");
  });
  if (fail) await assert.rejects(run, /capture failed/); else await run();
  assert.equal(game.updateCamera, original); game.updateCamera();
  assert.equal(updates, view === "player-camera" ? 241 : 2);
}
for (const view of ["fighter", "helmet-profile", "hand-front", "lower-body-front"]) for (const pose of ["boost", "exhaust-hard-landing", "hip-hard-peak", "hip-hard-recovery"]) {
  const game = { players: [{ position: new THREE.Vector3(4, 5, 6), group: { rotation: { y: .4 } } }],
    camera: new THREE.PerspectiveCamera() };
  const controls = { view: { value: view }, pose: { value: pose } }, before = JSON.stringify(game);
  let touched = false;
  const review = new Function("THREE", "game", "select", "touch", `let stress=false, cameraOffset=0;
    const clearThrusterSortControl=touch, resetSamples=touch, cameraUpdate=touch;
    ${settleReviewSource}; ${handViewSource}; poseReview={requested:"aim"}; return {setView,state:()=>poseReview};`)(THREE, game, name => controls[name], () => { touched = true; });
  assert.throws(review.setView, /requires a thruster or player-camera view|Hip landing requires a waist or chest view/);
  assert.equal(touched, false); assert.equal(JSON.stringify(game), before);
  assert.deepEqual(review.state(), { requested: "aim" }); assert.equal(controls.pose.value, pose);
}
for (const view of ["thrusters", "thrusters-low"]) for (const pose of ["boost", "exhaust-hard-landing"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const pad = { position: new THREE.Vector3(-66, 0, 22), strength: 29, active: true };
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { boostPads: [pad], boostAt: position => Math.abs(position.x - pad.position.x) < 1 ? pad : null,
      resolve: position => { const floor = position.x === -66 ? 0 : 15; const grounded = position.y <= floor;
        if (grounded) position.y = floor; return { grounded }; } } };
  const controls = { view: { value: view }, pose: { value: pose }, "aim-height": { value: "0" }, "boost-pad": { value: "0" } };
  const state = new Function("THREE", "game", "select", `let stress=false, cameraOffset=0; const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; setView(); return poseReview;`)(THREE, game, name => controls[name]);
  game.camera.updateMatrixWorld(true);
  const target = hero.position.clone().add(new THREE.Vector3(0, view === "thrusters" ? 1.14 : 1.16, .49)).project(game.camera);
  assert.ok(Math.abs(target.x) < 1e-6 && Math.abs(target.y) < 1e-6 && target.z > 0 && target.z < 1, "final dynamic exhaust target stays centred and in clip range");
  if (pose === "boost") assert.equal(state.boost.launched, true);
  else {
    assert.equal(state.exhaustLanding.landStrength, 1);
    assert.ok(state.exhaustLanding.peakScale > 1.9 && state.exhaustLanding.peakScale < 2.4);
    assert.ok(state.exhaustLanding.capturedScale < state.exhaustLanding.peakScale);
    assert.ok(state.exhaustLanding.peakScale - state.exhaustLanding.capturedScale < .05);
  }
  hero.dispose();
}
{
  const routing = graphicsFixture.match(/select\("pose"\)\.onchange = ([^\n]+)/)[0];
  for (const view of ["thrusters", "thrusters-low", "player-camera", "lower-body-front", "waist-profile", "waist-low-front", "fighter", "hand-front"]) {
    const controls = { pose: {}, view: { value: view } }; let framed = 0, settled = 0;
    new Function("select", "setView", "settlePose", routing)(name => controls[name], () => framed++, () => settled++);
    controls.pose.onchange();
    assert.equal(framed, ["thrusters", "thrusters-low", "player-camera", "lower-body-front", "waist-profile", "waist-low-front"].includes(view) ? 1 : 0);
    assert.equal(settled, 1 - framed);
  }
}
const landingDropSource = graphicsFixture.slice(graphicsFixture.indexOf("async function withPreviousLandingDrop("), graphicsFixture.indexOf("async function runLandingReview("));
const removeLandingDrop = new Function(`${landingDropSource}; return withPreviousLandingDrop;`)();
const translateMuzzle = new Function(`${landingDropSource}; return withTranslatedMuzzle;`)();
const reverseTrail = new Function(`${landingDropSource}; return withReversedTrail;`)();
const makeTrailShading = new Function("THREE", `${landingDropSource}; return makeTrailShading;`)(THREE);
const shadeTrail = new Function(`${landingDropSource}; return withTrailShading;`)();
const landingReference = new Function(`${landingDropSource}; return landingReference;`)();
const plantLanding = new Function("THREE", `${landingDropSource}; return withLandingContact;`)(THREE);
{
  const start = graphicsFixture.indexOf("    grapple: game.players[0]?.grapple ?");
  const end = graphicsFixture.indexOf("    aoGeometryApplied:", start);
  const readGrapple = new Function("game", `return ({${graphicsFixture.slice(start, end)}}).grapple;`);
  const pose = { anchor: new THREE.Vector3(4, 40, 0) };
  assert.deepEqual(readGrapple({ players: [{ grapple: pose }] }), { anchor: [4, 40, 0], blending: null });
  pose.line = { material: { blending: THREE.AdditiveBlending } };
  assert.equal(readGrapple({ players: [{ grapple: pose }] }).blending, THREE.AdditiveBlending);
  assert.equal(readGrapple({ players: [{}] }), null);
}
const clockLanding = new Function(`${landingDropSource}; return withLandingClock;`)();
{
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now"), nativeNow = performance.now;
  for (const fail of [false, true]) {
    const update = () => { assert.equal(performance.now(), 1234); if (fail) throw new Error("landing clock interrupted"); };
    if (fail) assert.throws(() => clockLanding(1234, update), /landing clock interrupted/); else clockLanding(1234, update);
    assert.equal(performance.now, nativeNow); assert.deepEqual(Object.getOwnPropertyDescriptor(performance, "now"), descriptor);
  }
}
{
  const fighter = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(8, 15, 8));
  fighter.rig.position.y = .012;
  fighter.leftLeg.rotation.z = .025; fighter.rightLeg.rotation.z = -.025;
  const standing = landingReference(fighter);
  fighter.group.updateMatrixWorld(true);
  const feet = () => [fighter.leftLeg, fighter.rightLeg].map(leg => new THREE.Box3().setFromObject(leg, true).min.y);
  const referenceFeet = feet();
  fighter.rig.scale.set(1.18, .79, 1.18); fighter.rig.rotation.x = .08;
  fighter.leftLeg.rotation.x = .65; fighter.rightLeg.rotation.x = .6; fighter.group.updateMatrixWorld(true);
  const original = landingReference(fighter), originalFeet = feet(), position = fighter.position.toArray(), muzzle = fighter.muzzlePoint().toArray();
  for (const fail of [false, true]) {
    const capture = async offset => {
      const planted = feet();
      assert.ok(offset <= 0);
      assert.ok(Math.abs(Math.min(...planted) - Math.min(...referenceFeet, ...originalFeet)) < 1e-12);
      for (let i = 0; i < 2; i++) assert.ok(Math.abs(planted[i] - originalFeet[i] - offset) < 1e-12);
      assert.deepEqual(fighter.position.toArray(), position); assert.deepEqual(fighter.muzzlePoint().toArray(), muzzle);
      if (fail) throw new Error("foot contact interrupted");
    };
    if (fail) await assert.rejects(plantLanding(fighter, standing, capture), /foot contact interrupted/);
    else await plantLanding(fighter, standing, capture);
    assert.deepEqual(landingReference(fighter), original); assert.equal(fighter.rig.position.y, .012); assert.deepEqual(feet(), originalFeet);
  }
  fighter.grounded = false;
  await plantLanding(fighter, standing, offset => { assert.equal(offset, 0); assert.deepEqual(feet(), originalFeet); });
  fighter.dispose();
}
const makeTrailEdgeMaterials = new Function("THREE", "materialOpacity", "normalViewGeometry", "positionViewDirection", `${landingDropSource}; return makeTrailEdgeMaterials;`)(THREE, materialOpacity, normalViewGeometry, positionViewDirection);
const fadeTrail = new Function(`${landingDropSource}; return withTrailEdgeMaterials;`)();
{
  const effects = new CombatVisuals(new THREE.Scene()), mesh = effects.createProjectile({ accent: 0xff3388 }, WEAPONS.blaster, .11);
  const entries = makeTrailEdgeMaterials({ mesh }); assert.equal(entries.length, 1);
  const { trail, control, trial } = entries[0], geometry = trail.geometry, material = trail.material;
  assert.equal(control.opacityNode, null); assert.ok(trial.opacityNode?.isNode);
  for (const candidate of [control, trial]) {
    for (const field of ["transparent", "blending", "depthWrite", "toneMapped", "vertexColors", "side"]) assert.equal(candidate[field], material[field]);
    assert.ok(candidate.color.equals(material.color));
  }
  for (const mode of ["control", "trial"]) for (const fail of [false, true]) {
    material.opacity = .17;
    const capture = async () => {
      assert.equal(trail.geometry, geometry); assert.equal(trail.material, entries[0][mode]); assert.equal(trail.material.opacity, .17);
      if (fail) throw new Error("edge capture interrupted");
    };
    if (fail) await assert.rejects(fadeTrail(entries, mode, capture), /edge capture interrupted/);
    else await fadeTrail(entries, mode, capture);
    assert.equal(trail.material, material); assert.equal(trail.geometry, geometry);
  }
  control.dispose(); trial.dispose(); mesh.traverse(child => child.material?.dispose()); effects.dispose();
}
const freezeShaderTime = new Function("shaderTime", `${landingDropSource}; return withFrozenShaderTime;`)(shaderTime);
for (const fail of [false, true]) {
  const update = shaderTime.update;
  shaderTime.update({ time: 7 });
  const capture = async () => {
    shaderTime.update({ time: 99 });
    assert.equal(shaderTime.value, 7, "paused comparison must freeze renderer-time effects too");
    if (fail) throw new Error("clock capture interrupted");
  };
  if (fail) await assert.rejects(freezeShaderTime(capture), /clock capture interrupted/);
  else await freezeShaderTime(capture);
  assert.equal(shaderTime.update, update);
  shaderTime.update({ time: 100 });
  assert.equal(shaderTime.value, 100, "ordinary shader time must resume after comparison");
}
{
  const effects = new CombatVisuals(new THREE.Scene()), mesh = effects.createProjectile({ accent: 0x6ff6ff }, WEAPONS.blaster, .11);
  const entries = makeTrailShading({ mesh }); assert.equal(entries.length, 1);
  const entry = entries[0], geometry = entry.trail.geometry, material = entry.trail.material;
  for (const candidate of [entry.white, entry.gradient]) {
    for (const attribute of ["position", "normal", "uv"]) assert.deepEqual(candidate.getAttribute(attribute).array, geometry.getAttribute(attribute).array);
    assert.deepEqual(candidate.index.array, geometry.index.array);
    assert.equal(candidate.getAttribute("color").count, geometry.getAttribute("position").count);
  }
  assert.ok(entry.white.getAttribute("color").array.every(value => value === 1));
  const uv = geometry.getAttribute("uv"), colors = entry.gradient.getAttribute("color");
  for (let i = 0; i < uv.count; i++) assert.equal(colors.getX(i), 1 - uv.getY(i));
  for (const mode of ["white", "gradient"]) for (const fail of [false, true]) {
    material.opacity = .17;
    const capture = () => {
      assert.ok(entry.trail.geometry === entry[mode] && entry.trail.material === entry.material);
      assert.equal(entry.material.vertexColors, true); assert.equal(entry.material.opacity, material.opacity);
      assert.ok(entry.material.color.equals(material.color));
      if (fail) throw new Error("shading interrupted");
    };
    if (fail) await assert.rejects(shadeTrail(entries, mode, capture), /shading interrupted/); else await shadeTrail(entries, mode, capture);
    assert.ok(entry.trail.geometry === geometry && entry.trail.material === material);
  }
  for (const asset of [entry.white, entry.gradient, entry.material]) asset.dispose();
  mesh.traverse(child => child.material?.dispose()); effects.dispose();
}
{
  const effects = new CombatVisuals(new THREE.Scene());
  const mesh = effects.createProjectile({ accent: 0x6ff6ff }, WEAPONS.blaster, .11);
  const shot = { mesh, velocity: new THREE.Vector3(0, 0, -30) };
  effects.updateProjectile(shot, 1 / 60); mesh.updateMatrixWorld(true);
  const trails = mesh.userData.combatVisual.trailParts;
  assert.equal(trails.length, 1);
  const before = trails.map(trail => ({ rotationX: trail.rotation.x, quaternion: trail.quaternion.toArray(), matrix: trail.matrixWorld.toArray(), position: trail.position.toArray(), scale: trail.scale.toArray(), geometry: trail.geometry, material: trail.material }));
  for (const fail of [false, true]) {
    const capture = () => {
      trails.forEach((trail, i) => {
        assert.ok(Math.abs(trail.rotation.x + before[i].rotationX) < 1e-12);
        assert.deepEqual(trail.position.toArray(), before[i].position); assert.deepEqual(trail.scale.toArray(), before[i].scale);
        assert.ok(trail.geometry === before[i].geometry && trail.material === before[i].material);
      });
      if (fail) throw new Error("trail capture interrupted");
    };
    if (fail) await assert.rejects(reverseTrail(shot, capture), /trail capture interrupted/); else await reverseTrail(shot, capture);
    trails.forEach((trail, i) => { assert.deepEqual(trail.quaternion.toArray(), before[i].quaternion); assert.deepEqual(trail.matrixWorld.toArray(), before[i].matrix); });
  }
  mesh.traverse(child => child.material?.dispose()); effects.dispose();
}
assert.ok(playerMergeSource.includes("this.rig.position.y = bob;"), "QA previous-drop control requires the corrected production translation");
for (const weaponId of Object.keys(WEAPONS)) {
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3(8, 15, 8));
  hero.grounded = true; hero.landTimer = .11; hero.landStrength = .36; hero.rig.position.y = -.07; hero.group.updateMatrixWorld(true);
  const before = { y: hero.rig.position.y, scale: hero.rig.scale.toArray(), rotation: hero.rig.rotation.toArray(),
    muzzle: hero.muzzlePoint().toArray(), projectile: hero.forwardPoint(.08).toArray(), position: hero.position.toArray(),
    legs: [hero.leftLeg, hero.rightLeg].map(leg => leg.matrix.toArray()), rig: hero.rig.matrixWorld.toArray() };
  for (const fail of [false, true]) {
    const capture = drop => {
      assert.ok(Math.abs(drop - .0972) < 1e-12); assert.ok(Math.abs(hero.rig.position.y - before.y + drop) < 1e-12);
      assert.deepEqual(hero.rig.scale.toArray(), before.scale); assert.deepEqual(hero.rig.rotation.toArray(), before.rotation);
      assert.deepEqual(hero.muzzlePoint().toArray(), before.muzzle); assert.deepEqual(hero.forwardPoint(.08).toArray(), before.projectile);
      assert.deepEqual(hero.position.toArray(), before.position); assert.deepEqual([hero.leftLeg, hero.rightLeg].map(leg => leg.matrix.toArray()), before.legs);
      if (fail) throw new Error("landing capture interrupted");
    };
    if (fail) await assert.rejects(removeLandingDrop(hero, capture), /landing capture interrupted/); else await removeLandingDrop(hero, capture);
    assert.equal(hero.rig.position.y, before.y); assert.deepEqual(hero.rig.matrixWorld.toArray(), before.rig);
  }
  hero.landTimer = 0; await assert.rejects(removeLandingDrop(hero, () => assert.fail("idle accepted")), /landing pose/);
  hero.dispose();
}
{
  const source = graphicsFixture.slice(graphicsFixture.indexOf("async function runLandingReview("), graphicsFixture.indexOf('select("landing-translation").onclick'));
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(8, 15, 8));
  hero.grounded = true; hero.landTimer = .11; hero.landStrength = .36; hero.rig.position.y = -.07; hero.group.updateMatrixWorld(true);
  const state = {}, controls = [{ disabled: false }, { disabled: true }], links = [];
  let beforeShot;
  const shotCalls = [], shotGame = { scene: new THREE.Scene(), projectiles: [], combatMusicPulse: .23, combatVisuals: new CombatVisuals(new THREE.Scene()),
    clearTransientNetworkCombat() { for (const { mesh } of this.projectiles) mesh.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); }); this.projectiles = []; shotCalls.push("clear"); },
    tryFire(player) { shotCalls.push("fire");
      const mesh = new THREE.Group(), trail = new THREE.Mesh(new THREE.ConeGeometry(.1, 2, 6, 1, true), new THREE.MeshBasicMaterial()); trail.rotation.x = Math.PI / 2; mesh.add(trail);
      mesh.position.copy(player.forwardPoint(.08)); mesh.userData.combatVisual = { trailParts: [trail] }; mesh.updateMatrixWorld(true);
      this.projectiles.push({ mesh, age: 0 });
      beforeShot = { velocity: player.velocity.toArray(), recoilVisual: player.recoilVisual };
      player.recoil(); player.ammo[player.weapon.id]--; player.attackTimer = .3; this.combatMusicPulse = .52;
      this.combatVisuals.muzzle(player, player.weapon); },
    updateProjectiles(dt) { shotCalls.push("step"); this.projectiles[0].age += dt; this.projectiles[0].mesh.position.addScaledVector(hero.aim, dt * 30); this.projectiles[0].mesh.updateMatrixWorld(true); } };
  let interrupted = false;
  const shadingDisposals = [];
  const trackedShading = projectile => {
    const entries = makeTrailShading(projectile);
    for (const entry of entries) for (const asset of [entry.white, entry.gradient, entry.material]) asset.addEventListener("dispose", () => shadingDisposals.push(asset.uuid));
    return entries;
  };
  const trackedEdges = projectile => {
    const entries = makeTrailEdgeMaterials(projectile);
    for (const entry of entries) for (const asset of [entry.control, entry.trial]) asset.addEventListener("dispose", () => shadingDisposals.push(asset.uuid));
    return entries;
  };
  const nativeNow = performance.now;
  const run = new Function("THREE", "Fighter", "game", "cameraReview", "document", "select", "waitForReviewFrame", "shellReviewState", "withPreviousLandingDrop", "withTranslatedMuzzle", "withReversedTrail", "makeTrailShading", "withTrailShading", "withFrozenShaderTime", "makeTrailEdgeMaterials", "withTrailEdgeMaterials", "landingReference", "withLandingContact", "withLandingClock", `
    const resetReview={},cacheReview={},decoyReview={},sceneSerial=1,errorCount=0,stress=false,resetPhase="ready",renderedFrames=0,stillMove=new THREE.Vector3(),reviewAim=new THREE.Vector3(0,0,-1); let cameraOffset=0;
    ${source};return runLandingReview;`)(THREE, Fighter, Object.assign(shotGame, { players: [hero], paused: true, renderPipeline: { direct: false }, world: {
      surfaceHeightAt: () => 15, resolve: position => { const grounded = position.y <= 15; if (grounded) position.y = 15; return { grounded }; }, boostAt: () => null } }), state,
    { querySelectorAll: () => controls, createElement: () => ({}), querySelector: () => ({ toDataURL: () => "data:image/png;base64,test" }) },
    name => name === "view" ? { value: "lower-body-side" } : name === "pose" ? { value: "landing" } : { replaceChildren: () => { links.length = 0; }, append: link => links.push(link) },
    async () => { assert.equal(performance.now, nativeNow); assert.equal(state.shell, true); assert.ok(controls.every(control => control.disabled)); if (interrupted && state.samples.length === 1) throw new Error("landing frame timeout"); },
    () => ({}), removeLandingDrop, translateMuzzle, reverseTrail, trackedShading, shadeTrail, freezeShaderTime, trackedEdges, fadeTrail, landingReference, plantLanding, clockLanding);
  for (const transition of ["grapple", "move", "hit"]) {
    await run(true, 8, false, null, false, transition);
    assert.equal(state.error, null); assert.equal(state.samples.length, 27); assert.equal(state.landingFrames.length, 46);
    assert.equal(shotGame.players[0], hero); assert.equal(hero.group.visible, true);
    assert.equal(state.transitionKind, "pose-branch-control-before-update");
    assert.equal(state.landingFrames[5].baseline.grappled, false);
    assert.equal(state.landingFrames[6].baseline.grappled, transition === "grapple");
    if (transition === "hit") assert.ok(state.landingFrames[6].baseline.hitTimer > 0);
    if (transition === "move") for (const sample of state.samples) assert.ok(Math.abs(sample.cameraOffset - sample.fighterPosition[0] + hero.position.x) < 1e-12);
    assert.ok(state.samples.every(sample => sample.reviewStep > 60));
    interrupted = true; await run(true, 8, false, null, false, transition);
    assert.match(state.error, /landing frame timeout/); assert.equal(shotGame.players[0], hero); assert.equal(hero.group.visible, true);
    assert.equal(performance.now, nativeNow); interrupted = false;
  }
  await run(); assert.equal(state.error, null); assert.equal(links.length, 3);
  assert.deepEqual(state.samples.map(sample => sample.mode), ["current", "previous-drop", "current-restored"]);
  assert.equal(state.samples[0].rigY, state.samples[2].rigY); assert.ok(state.samples[1].rigY < state.samples[0].rigY);
  interrupted = true; await run(); assert.match(state.error, /landing frame timeout/);
  assert.equal(hero.rig.position.y, -.07); assert.equal(state.running, false); assert.equal(state.shell, false);
  assert.deepEqual(controls.map(control => control.disabled), [false, true]);
  interrupted = false;
  for (const fallHeight of [0, 8]) {
    await run(true, fallHeight); assert.equal(state.error, null);
    assert.equal(state.samples.length, 27); assert.equal(state.landingFrames.length, 46);
    assert.equal(state.landingFrames.at(-1).baseline.landTimer, 0);
    assert.ok(state.landingFrames[0].baseline.landStrength > (fallHeight ? .9 : .3));
    for (const frame of state.landingFrames) {
      assert.equal(frame.fallHeight, fallHeight); assert.equal(frame.baseline.floor, 15);
      assert.deepEqual(frame.baseline.fighterPosition, frame.candidate.fighterPosition);
      assert.deepEqual(frame.baseline.velocity, frame.candidate.velocity);
      assert.deepEqual(frame.baseline.logicalMuzzle, frame.candidate.logicalMuzzle);
      assert.deepEqual(frame.baseline.rigScale, frame.candidate.rigScale);
      assert.ok(frame.candidate.rigY <= frame.baseline.rigY);
    }
  }
  for (const fallHeight of [0, 8]) {
    await run(true, fallHeight, false, null, true);
    assert.equal(state.error, null); assert.equal(state.samples.length, 27); assert.equal(state.landingFrames.length, 46);
    assert.equal(state.standingReference.grounded, true); assert.equal(state.standingReference.landTimer, 0); assert.equal(state.standingReference.velocityY, 0);
    const referenceClearance = Math.min(...state.standingReference.footClearances) - state.standingReference.rigY;
    for (const { baseline, candidate } of state.landingFrames) {
      assert.deepEqual(baseline.fighterPosition, candidate.fighterPosition); assert.deepEqual(baseline.velocity, candidate.velocity);
      assert.deepEqual(baseline.logicalMuzzle, candidate.logicalMuzzle); assert.deepEqual(baseline.rigScale, candidate.rigScale);
      const baselineMin = Math.min(...baseline.legs.map(leg => leg.minY));
      const expectedMin = Math.min(baselineMin, baseline.floor + baseline.rigY + referenceClearance);
      assert.ok(candidate.rigY <= baseline.rigY);
      assert.ok(Math.abs(Math.min(...candidate.legs.map(leg => leg.minY)) - expectedMin) < 1e-12);
      if (expectedMin === baselineMin) assert.deepEqual(candidate.legs, baseline.legs);
      for (let i = 0; i < 2; i++) assert.ok(Math.abs(candidate.legs[i].minY - baseline.legs[i].minY - candidate.rigY + baseline.rigY) < 1e-12);
    }
    assert.equal(state.landingFrames.at(-1).baseline.landTimer, 0);
    assert.ok(Math.abs(state.landingFrames.at(-1).candidate.rigY - state.landingFrames.at(-1).baseline.rigY) < .001, "full recovery must remove the contact correction smoothly");
    for (let i = 0; i < 27; i += 3) assert.deepEqual(state.samples[i].legs, state.samples[i + 2].legs);
  }
  interrupted = true; await run(true, 8, false, null, true); assert.match(state.error, /landing frame timeout/);
  assert.equal(state.running, false); assert.equal(state.shell, false); interrupted = false;
  await run(true, 8, true); assert.equal(state.error, null); assert.equal(state.samples.length, 9);
  assert.deepEqual(shotCalls, ["clear", "fire", "step", "step", "clear"]);
  for (let index = 0; index < 9; index += 3) {
    assert.deepEqual(state.samples[index].shotEvidence, state.samples[index + 1].shotEvidence);
    assert.deepEqual(state.samples[index].weaponMatrix, state.samples[index + 2].weaponMatrix);
    assert.ok(state.samples[index + 1].blasterAperture[1] < state.samples[index].blasterAperture[1]);
    const rayDistance = sample => new THREE.Vector3().fromArray(sample.blasterAperture)
      .sub(new THREE.Vector3().fromArray(sample.logicalMuzzle)).cross(hero.aim).length();
    assert.ok(rayDistance(state.samples[index]) <= rayDistance(state.samples[index + 1]), "corrected barrel must not move farther from the muzzle ray");
    assert.equal(state.samples[index].shotEvidence.projectiles[0].age, index / 3 / 60);
  }
  interrupted = true; await run(true, 8, true); assert.match(state.error, /landing frame timeout/);
  assert.equal(shotCalls.at(-1), "clear"); assert.equal(shotGame.projectiles.length, 0);
  assert.deepEqual(hero.velocity.toArray(), beforeShot.velocity); assert.equal(hero.recoilVisual, beforeShot.recoilVisual);
  assert.equal(hero.attackTimer, 0); assert.equal(hero.ammo.blaster, WEAPONS.blaster.ammo); assert.equal(shotGame.combatMusicPulse, .23);
  assert.ok([...shotGame.combatVisuals.flashes, ...shotGame.combatVisuals.tracers].every(slot => slot.life <= 0 && !slot.visible));
  assert.ok(shotGame.combatVisuals.combatLights.every(light => light.userData.life <= 0 && light.intensity === 0));
  for (const layer of ["flashOuter", "flashInner", "tracerOuter", "tracerInner", "ringOuter", "sparkLayer", "bloodLayer"])
    assert.equal(shotGame.combatVisuals[layer].count, 0, `${layer} must be empty after the shot check`);
  interrupted = false;
  const originalSnapshot = () => {
    const fields = Object.fromEntries(Object.entries(hero).filter(([, value]) => value === null || ["number", "string", "boolean"].includes(typeof value) || value?.isVector3 || value?.isQuaternion)
      .map(([key, value]) => [key, value?.toArray ? value.toArray() : value]));
    const transforms = []; hero.group.traverse(object => transforms.push([object.uuid, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.visible]));
    return { fields, transforms, ammo: { ...hero.ammo } };
  };
  const original = originalSnapshot();
  for (const mode of ["neutral", "landing", "neutral-follow", "landing-follow", "neutral-tail", "landing-tail", "neutral-shade", "landing-shade", "neutral-edge", "landing-edge"]) {
    const following = mode.endsWith("-follow"), tail = mode.endsWith("-tail"), shade = mode.endsWith("-shade"), edge = mode.endsWith("-edge"), quartet = shade || edge;
    shadingDisposals.length = 0;
    await run(true, mode.startsWith("neutral") ? 0 : 8, true, mode); assert.equal(state.error, null); assert.equal(state.samples.length, quartet ? 48 : following || tail ? 36 : 27);
    assert.equal(shadingDisposals.length, shade ? 3 : edge ? 2 : 0); assert.equal(new Set(shadingDisposals).size, shadingDisposals.length);
    assert.ok(shotGame.players[0] === hero); assert.deepEqual(originalSnapshot(), original); assert.equal(shotGame.scene.children.length, 0);
    if (tail || quartet) assert.ok(Math.abs(state.samples[0].shotEvidence.muzzleEvent.age - 1 / 60) < 1e-12, "trail review starts after the real heading update, not construction state");
    for (let index = 0; index < state.samples.length; index += quartet ? 4 : 3) {
      const before = state.samples[index], trial = state.samples[index + (quartet ? 2 : 1)], restored = state.samples[index + (quartet ? 3 : 2)];
      assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(new THREE.Matrix4().fromArray(before.weaponMatrix)).dot(new THREE.Vector3(0, 0, -1)) > .95,
        "temporary fighter barrel must face the shot direction throughout recoil");
      assert.deepEqual(before.shotEvidence, restored.shotEvidence);
      if (tail || shade) {
        assert.deepEqual(before.shotEvidence.projectiles.map(({ trails, ...physical }) => physical), trial.shotEvidence.projectiles.map(({ trails, ...physical }) => physical));
        if (tail) assert.notDeepEqual(before.shotEvidence.projectiles[0].trails[0].rotation, trial.shotEvidence.projectiles[0].trails[0].rotation);
        else {
          assert.deepEqual(before.shotEvidence.projectiles[0].trails[0].rotation, trial.shotEvidence.projectiles[0].trails[0].rotation);
          assert.ok(state.samples[index + 1].shotEvidence.projectiles[0].trails[0].colors.every(value => value === 1));
          assert.ok(trial.shotEvidence.projectiles[0].trails[0].colors.includes(0));
          assert.equal(before.shotEvidence.projectiles[0].trails[0].opacity, trial.shotEvidence.projectiles[0].trails[0].opacity);
        }
        assert.deepEqual(before.shotEvidence.projectiles[0].trails[0].scale, trial.shotEvidence.projectiles[0].trails[0].scale);
      } else assert.deepEqual(before.shotEvidence.projectiles, trial.shotEvidence.projectiles);
      assert.deepEqual(before.weaponMatrix, trial.weaponMatrix);
      const event = before.shotEvidence.muzzleEvent, moved = trial.shotEvidence.muzzleEvent;
      if (following && event.flashLife > 0) assert.ok(new THREE.Vector3().fromArray(event.flash).distanceTo(new THREE.Vector3().fromArray(before.blasterAperture)) < 1e-12);
      for (const field of ["flash", "tracerStart", "tracerEnd", "lightPosition"]) {
        const expected = tail || quartet ? new THREE.Vector3().fromArray(event[field]) : following ? new THREE.Vector3().fromArray(state.samples[0].shotEvidence.muzzleEvent[field])
          : new THREE.Vector3().fromArray(event[field]).add(new THREE.Vector3().fromArray(event.delta));
        assert.ok(expected.distanceTo(new THREE.Vector3().fromArray(moved[field])) < 1e-12);
      }
      assert.equal(event.flashLife, moved.flashLife); assert.equal(event.lightIntensity, moved.lightIntensity);
    }
    assert.ok(state.samples.at(-1).shotEvidence.muzzleEvent.flashLife <= 0, "capture must include flash expiry");
    if (following) {
      assert.ok(Math.abs(state.samples.at(-1).shotEvidence.muzzleEvent.age - .5) < 1e-12);
      assert.ok(state.samples.at(-1).shotEvidence.muzzleEvent.lightIntensity < .001, "include the damped light tail");
    }
    assert.notDeepEqual(state.samples[0].weaponMatrix, state.samples[quartet ? 4 : 3].weaponMatrix, "recoil must actually animate");
  }
  interrupted = true; await run(true, 8, true, "landing"); assert.match(state.error, /landing frame timeout/);
  shadingDisposals.length = 0; await run(true, 8, true, "landing-shade"); assert.match(state.error, /landing frame timeout/);
  assert.equal(shadingDisposals.length, 3); assert.equal(new Set(shadingDisposals).size, 3);
  shadingDisposals.length = 0; await run(true, 8, true, "landing-edge"); assert.match(state.error, /landing frame timeout/);
  assert.equal(shadingDisposals.length, 2); assert.equal(new Set(shadingDisposals).size, 2);
  assert.ok(shotGame.players[0] === hero); assert.deepEqual(originalSnapshot(), original); assert.equal(shotGame.scene.children.length, 0);
  assert.equal(shotGame.projectiles.length, 0); assert.ok(shotGame.combatVisuals.flashes.every(slot => slot.life === 0));
  shotGame.combatVisuals.dispose();
  hero.dispose();
}
const weaponSelectSource = graphicsFixture.slice(graphicsFixture.indexOf('select("weapon").onchange ='), graphicsFixture.indexOf('select("pose").onchange ='));
for (const view of ["lower-body-front", "lower-body-side"]) {
  assert.ok(graphicsFixture.includes(`<option>${view}</option>`));
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { resolve: position => { position.y = 15.01; return { grounded: true }; }, boostAt: () => null } };
  new Function("THREE", "game", "select", `let stress=false, cameraOffset=0; const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; setView();`)(THREE, game, name => ({ value: name === "view" ? view : name === "aim-height" ? "0" : "aim" }));
  game.camera.updateMatrixWorld(true);
  assert.equal(hero.position.x, 8, "lower-body route clears the central seven-metre spire");
  const center = new THREE.Vector3(8, 15.55, 8).project(game.camera);
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6);
  assert.equal(game.camera.fov, 62);
  const before = game.camera.position.clone(); hero.weaponGroup.position.x += .3; game.updateCamera();
  assert.deepEqual(game.camera.position, before); hero.dispose();
}
for (const view of ["hand-front", "hand-side", "hand-opposite", "hand-palm", "hand-shoulder", "hand-shoulder-opposite", "hand-shoulder-oblique"]) for (const previousPose of ["aim", "reload", "reacquire-early"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "hand-view", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const controls = { view: { value: view }, weapon: { value: "blaster" }, pose: { value: "aim" }, "aim-height": { value: "0" } };
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { resolve: position => { position.y = 15.01; return { grounded: true }; }, boostAt: () => null } };
  const review = new Function("THREE", "game", "select", `let stress=false, cameraOffset=0;
    const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; ${weaponSelectSource}; return {setView,settlePose};`)(THREE, game, name => controls[name]);
  review.setView();
  controls.pose.value = previousPose; review.settlePose();
  controls.weapon.value = "hammer";
  assert.ok(WEAPONS[controls.weapon.value], "use a real alternate grip");
  controls.weapon.onchange();
  assert.equal(controls.pose.value, "aim", "hand view/weapon changes visibly reset to ready pose before framing");
  game.updateCamera(); game.camera.updateMatrixWorld(true);
  const target = (view.startsWith("hand-shoulder") ? new THREE.Vector3(0, -.16, 0).applyMatrix4((view === "hand-shoulder-opposite" ? hero.leftArm : hero.rightArm).matrixWorld)
    : view === "hand-palm" ? hero.leftHand.position.clone().applyMatrix4(hero.leftForearm.matrixWorld)
    : hero.weaponGrip.clone().applyMatrix4(hero.weaponGroup.matrixWorld)).project(game.camera);
  assert.ok(Math.abs(target.x) < 1e-6 && Math.abs(target.y) < 1e-6, "weapon switching must reframe the current grip, not retain the old anchor");
  if (view === "hand-shoulder-oblique") {
    const focus = new THREE.Vector3(0, -.16, 0).applyMatrix4(hero.rightArm.matrixWorld);
    const offset = new THREE.Vector3(1.5, .24, .12).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 9).applyQuaternion(hero.group.quaternion);
    assert.ok(game.camera.position.clone().sub(focus).distanceTo(offset) < 1e-8, "oblique view orbits exactly 20 degrees without changing focus or distance");
    assert.equal(game.camera.fov, 62);
  }
  const cameraPosition = game.camera.position.clone();
  controls.pose.value = "fire";
  // A weapon transform change must NOT be followed after the view is established.
  hero.weaponGroup.position.x += .3; hero.group.updateMatrixWorld(true); game.updateCamera();
  assert.deepEqual(game.camera.position, cameraPosition, "fixed framing preserves visible weapon travel");
  hero.dispose();
}
const captureSource = graphicsFixture.slice(graphicsFixture.indexOf("    const grapple = game.players[0]?.grapple;"), graphicsFixture.indexOf('    const link = select("canvas-capture");'));
const captureFrame = new Function("THREE", "game", "renderedFrames", "sceneSerial", "select", "ropeRenders", "ropeRendersBefore", "errorCount", "thrusterSortControl", "thrusterRenderOrder", "poseReview", `let canvasCapture; ${captureSource}; return canvasCapture;`).bind(null, THREE);
{
  const hero = new Fighter(new THREE.Scene(), { id: "hand-metadata", color: 0x129dba, accent: 0x6ff6ff }, ["rocket_launcher"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 300); camera.position.set(1, 2, 3); camera.updateMatrixWorld(true);
  const game = { players: [hero], scene: { children: [] }, camera, settings: { graphics: "high" },
    renderer: { info: { render: { drawCalls: 1, triangles: 1 } } }, renderPipeline: { direct: false, profile: "WEBGPU ULTRA" } };
  const review = { requested: "aim", reloadAccepted: null, additionalReacquireFrames: 0 };
  const captured = captureFrame(game, 10, 3, () => ({ value: "hand-front" }), 0, 0, 0, null, [], review);
  assert.equal(captured.handPose.weapon, "rocket_launcher"); assert.equal(captured.tier, "high"); assert.equal(captured.profile, "WEBGPU ULTRA");
  assert.equal(captured.lowerBody.floorAtFighter, null);
  assert.deepEqual(captured.lowerBody.legs[0].matrix, hero.leftLeg.matrixWorld.toArray());
  assert.deepEqual(captured.lowerBody.legs[0].bounds.min, new THREE.Box3().setFromObject(hero.leftLeg, true).min.toArray());
  assert.equal(captured.camera.gameplay, false);
  assert.deepEqual(captured.exhaust.position, hero.position.toArray());
  assert.deepEqual(captured.exhaust.velocity, hero.velocity.toArray());
  assert.deepEqual(captured.exhaust.scale, hero.thrusterLights.scale.toArray());
  assert.deepEqual(captured.exhaust.matrix, hero.thrusterLights.matrixWorld.toArray());
  assert.equal(captured.exhaust.opacity, hero.thrusterMaterial.opacity);
  assert.equal(captured.exhaust.vertices, hero.thrusterLights.geometry.attributes.position.count);
  assert.deepEqual(captured.handPose.rightForearmMatrix, hero.rightForearm.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.leftForearmMatrix, hero.leftForearm.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.weaponMatrix, hero.weaponGroup.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.rightHandLocal, [0, -.58, .05]);
  const stored = JSON.stringify(captured);
  hero.rightHand.position.x = 8; hero.rightForearm.matrixWorld.elements[12] = 9; hero.weaponGrip.y = 8;
  camera.matrixWorld.elements[12] = 10; review.requested = "reload";
  hero.position.x = 15; hero.velocity.y = 20; hero.thrusterLights.scale.y = 2;
  hero.thrusterLights.matrixWorld.elements[12] = 13; hero.thrusterMaterial.opacity = .9;
  assert.equal(JSON.stringify(captured), stored, "later pose/camera changes cannot rewrite saved evidence");
  hero.dispose();
}
for (const renders of [0, 1]) {
  const captureGame = { players: [{ id: "helmet-2", aim: new THREE.Vector3(0, 0, -1), helmet: { matrixWorld: new THREE.Matrix4() }, visor: { matrixWorld: new THREE.Matrix4() },
    grapple: { anchor: new THREE.Vector3(1, 2, 3), line: { geometry: { instanceCount: 1 }, material: { blending: THREE.NoBlending } } } }],
    scene: { children: [{ isLine2: true }, {}] },
    renderer: { info: { render: { drawCalls: 378, triangles: 169330 } } }, renderPipeline: { direct: false } };
  const captured = captureFrame(captureGame, 8, 1, () => ({ value: "effects" }), 4 + renders, 4, 0);
  captureGame.renderer.info.render.drawCalls = 1;
  assert.equal(captured.draws, 378);
  assert.equal(captured.rope.rendersThisFrame, renders, "a live grapple object alone cannot certify a rendered rope");
  assert.equal(captured.rope.segments, 1);
  assert.equal(captured.grappleLines, 1);
  captureGame.players[0].aim.y = 1; captureGame.players[0].helmet.matrixWorld.elements[12] = 8;
  assert.equal(captured.fighter.id, "helmet-2"); assert.deepEqual(captured.fighter.aim, [0, 0, -1]); assert.equal(captured.fighter.helmetMatrix[12], 0);
  captureGame.players = []; captureGame.scene.children = [];
  const released = captureFrame(captureGame, 9, 1, () => ({ value: "effects" }), 4, 4, 0);
  assert.equal(released.rope, null); assert.equal(released.grappleLines, 0); assert.equal(released.fighter, null);
}
const sortControlSource = graphicsFixture.slice(graphicsFixture.indexOf("function clearThrusterSortControl("), graphicsFixture.indexOf("let settleUntil"));
const sortScene = new THREE.Scene(), sortCamera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 300);
sortCamera.position.set(1.6, 1.7, 2.3); sortCamera.lookAt(0, 1.15, .49); sortCamera.updateMatrixWorld(true);
const sortFighter = new Fighter(sortScene, { id: "sort-control", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const modernFlames = sortFighter.thrusterLights, originalParent = modernFlames.parent, originalCallback = modernFlames.onBeforeRender;
const sortHarness = new Function("THREE", "game", `let stress=false, resetReview={}, cacheReview={}, cameraReview={}, decoyReview={}, thrusterSortControl=null, thrusterRenderOrder=[], captureCanvas=false;
  ${sortControlSource}; return { toggle: toggleThrusterSortControl, clear: clearThrusterSortControl, state: () => thrusterSortControl };`)(THREE, { scene: sortScene, camera: sortCamera, players: [sortFighter] });
sortHarness.toggle();
const sortControl = sortHarness.state();
assert.ok(sortControl.quadZ > Math.min(sortControl.legacyZ, sortControl.modernZ) && sortControl.quadZ < Math.max(sortControl.legacyZ, sortControl.modernZ),
  "overlap control must exercise the changed transparent sort keys");
assert.equal(sortControl.mode, "merged");
sortHarness.toggle();
assert.equal(sortControl.mode, "legacy"); assert.equal(modernFlames.parent, null);
assert.ok(sortControl.legacy.parent === originalParent);
const controlResources = [sortControl.legacy.geometry, sortControl.legacy.material, sortControl.quad.geometry, sortControl.quad.material];
const disposed = new Map(controlResources.map(resource => [resource, 0]));
for (const resource of controlResources) resource.addEventListener("dispose", () => disposed.set(resource, disposed.get(resource) + 1));
sortHarness.clear(); sortHarness.clear();
assert.ok(modernFlames.parent === originalParent && modernFlames.onBeforeRender === originalCallback, "cleanup restores the real fighter even when the legacy control is active");
assert.ok([...disposed.values()].every(count => count === 1));
sortFighter.dispose();
const hideAOObjectSource = graphicsFixture.slice(graphicsFixture.indexOf("function hideAOObjectForReview("), graphicsFixture.indexOf("const requestedAOOutput"));
for (const hidden of [null, "grid", "route", "unknown"]) {
  const hide = new Function("hiddenAOObject", `${hideAOObjectSource}; return hideAOObjectForReview;`)(hidden);
  const objects = [{ type: "GridHelper", visible: true }, { name: "District route floor", visible: true }, { name: "Arena floor", visible: true }];
  objects.forEach(hide);
  assert.deepEqual(objects.map(object => object.visible), [hidden !== "grid", hidden !== "route", true], "QA visibility isolation changes only the requested object, never the ground");
}
const aoWrapperSource = graphicsFixture.slice(graphicsFixture.indexOf("function withAODiagnostics("), graphicsFixture.indexOf("// QA-only causal comparison"));
assert.ok(graphicsFixture.includes("async function withHelmetShellDiagnostic("), "shell diagnosis needs an isolated, restoring material control");
const shellControlSource = graphicsFixture.slice(graphicsFixture.indexOf("async function withHelmetShellDiagnostic("), graphicsFixture.indexOf("function shellReviewState("));
assert.ok(graphicsFixture.includes("async function withElbowSilhouette("), "elbow silhouette comparison needs an isolated restoring geometry control");
const elbowControlSource = graphicsFixture.slice(graphicsFixture.indexOf("async function withElbowSilhouette("), graphicsFixture.indexOf("async function withHelmetShellDiagnostic("));
const elbowControl = new Function("THREE", "game", `${elbowControlSource}; return withElbowSilhouette;`)(THREE, { players: [] });
{
  const fighter = new Fighter(new THREE.Scene(), { id: "elbow-qa", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  for (const arm of [fighter.leftForearm, fighter.rightForearm]) for (const fail of [false, true]) {
    const elbow = arm.children[3], original = elbow.geometry, hand = arm.children[2].geometry;
    let temporaryDisposals = 0;
    const capture = async () => {
      assert.equal(elbow.geometry.parameters.widthSegments, 10);
      assert.equal(elbow.geometry.parameters.heightSegments, 6);
      assert.equal(arm.children[2].geometry, hand);
      assert.equal(elbow.material, fighter.elbowMaterial);
      elbow.geometry.addEventListener("dispose", () => temporaryDisposals++);
      if (fail) throw new Error("isolated elbow capture failure");
    };
    if (fail) await assert.rejects(elbowControl(elbow, capture), /isolated elbow capture failure/);
    else await elbowControl(elbow, capture);
    assert.equal(elbow.geometry, original); assert.equal(temporaryDisposals, 1);
  }
  fighter.dispose();
}
const shellOriginal = new THREE.MeshPhysicalMaterial({ roughness: .4, metalness: .68, clearcoat: .32, clearcoatRoughness: .2, envMapIntensity: 1.2 });
const shellEnvironment = new THREE.Texture(), shellOutput = {}, shellRawOutput = {};
const shellGame = { players: [{ helmet: { material: shellOriginal } }], renderer: { toneMapping: THREE.ACESFilmicToneMapping },
  scene: { environment: shellEnvironment, environmentIntensity: .82, environmentRotation: new THREE.Euler(0, .3, 0) },
  renderPipeline: { pipeline: { outputNode: shellOutput }, scenePass: { getTextureNode: name => { assert.equal(name, "output"); return shellRawOutput; } } } };
const shellControl = new Function("THREE", "game", `${shellControlSource}; return withHelmetShellDiagnostic;`)(THREE, shellGame);
{
  const source = graphicsFixture.slice(graphicsFixture.indexOf("async function withLegEnvironment("), graphicsFixture.indexOf("async function withAnkleRelief("));
  const run = new Function("withHelmetShellDiagnostic", `${source}; return withLegEnvironment;`)(shellControl);
  const fighter = new Fighter(new THREE.Scene(), { id: "boot-environment", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const targets = fighter.leftLeg.children.slice(0, 2), materials = new Map(), geometries = new Map();
  fighter.group.traverse(mesh => { if (mesh.isMesh) { materials.set(mesh, mesh.material); geometries.set(mesh, mesh.geometry); } });
  const originals = targets.map(mesh => mesh.material.toJSON());
  for (const mode of ["explicit-environment", "no-environment"]) for (const fail of [false, true]) {
    let disposed = 0;
    const capture = async () => {
      for (const [mesh, original] of materials) {
        assert.ok(mesh.geometry === geometries.get(mesh));
        if (!targets.includes(mesh)) { assert.ok(mesh.material === original); continue; }
        assert.ok(mesh.material !== original && mesh.material.envMap === shellEnvironment);
        assert.equal(mesh.material.envMapIntensity, mode === "no-environment" ? 0 : .82);
        for (const key of ["roughness", "clearcoat", "clearcoatRoughness", "metalness", "emissiveIntensity", "side", "normalMap"])
          assert.equal(mesh.material[key], original[key]);
        assert.ok(mesh.material.color.equals(original.color) && mesh.material.emissive.equals(original.emissive));
        mesh.material.addEventListener("dispose", () => disposed++);
      }
      if (fail) throw new Error("leg environment interrupted");
    };
    if (fail) await assert.rejects(run(fighter, mode, capture), /leg environment interrupted/); else await run(fighter, mode, capture);
    assert.equal(disposed, 2);
    for (const [mesh, original] of materials) assert.ok(mesh.material === original);
    assert.deepEqual(targets.map(mesh => mesh.material.toJSON()), originals);
  }
  const wrong = targets[0].material;
  targets[0].material = targets[1].material;
  await assert.rejects(run(fighter, "no-environment", () => assert.fail("incorrect material must not capture")), /Unexpected leg targets/);
  targets[0].material = wrong;
  fighter.dispose();
}
{
  const source = graphicsFixture.slice(graphicsFixture.indexOf("async function withShinFinish("), graphicsFixture.indexOf("async function withAnkleRelief("));
  const run = new Function("withHelmetShellDiagnostic", `${source}; return withShinFinish;`)(shellControl);
  const fighter = new Fighter(new THREE.Scene(), { id: "shin-coat", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const shin = fighter.leftLeg.children[1], original = shin.material, saved = original.toJSON(), peers = new Map();
  fighter.group.traverse(mesh => { if (mesh.isMesh) peers.set(mesh, [mesh.geometry, mesh.material]); });
  for (const both of [false, true]) for (const mode of ["material-control", "no-clearcoat", "base-roughness-trial", "previous-shin-base"]) for (const fail of [false, true]) {
    const targets = both ? [shin, fighter.rightLeg.children[1]] : [shin];
    let disposed = 0;
    const capture = async () => {
      for (const [mesh, [geometry, material]] of peers) {
        assert.ok(mesh.geometry === geometry);
        if (!targets.includes(mesh)) assert.ok(mesh.material === material);
      }
      for (const target of targets) {
        assert.ok(target.material !== original);
        const current = target.material.toJSON(); current.uuid = saved.uuid;
        assert.equal(current.clearcoat, mode === "no-clearcoat" ? 0 : saved.clearcoat);
        assert.equal(current.roughness, mode === "previous-shin-base" ? fighter.armorMaterial.roughness : mode === "base-roughness-trial" ? .56 : saved.roughness);
        current.clearcoat = saved.clearcoat; current.roughness = saved.roughness;
        assert.deepEqual(current, saved, "only the selected finish scalar differs from identical clone control");
        target.material.addEventListener("dispose", () => disposed++);
      }
      if (fail) throw new Error("shin coating interrupted");
    };
    if (fail) await assert.rejects(run(fighter, mode, capture, both), /shin coating interrupted/); else await run(fighter, mode, capture, both);
    assert.ok(targets.every(target => target.material === original)); assert.deepEqual(original.toJSON(), saved); assert.equal(disposed, targets.length);
    assert.ok(shellGame.renderPipeline.pipeline.outputNode === shellOutput);
    assert.equal(shellGame.renderer.toneMapping, THREE.ACESFilmicToneMapping);
  }
  await assert.rejects(run(fighter, "unknown", () => assert.fail("invalid control")), /Unexpected shin/);
  fighter.dispose();
}
let sharedShellDisposals = 0;
shellOriginal.addEventListener("dispose", () => sharedShellDisposals++);
shellEnvironment.addEventListener("dispose", () => sharedShellDisposals++);
const shellOriginalJSON = shellOriginal.toJSON();
for (const mode of ["baseline", "explicit-environment", "no-environment", "normals", "previous-finish", "restored"]) for (const fail of [false, true]) {
  let temporaryDisposals = 0;
  const action = async () => {
    const current = shellGame.players[0].helmet.material;
    if (mode === "baseline" || mode === "restored") assert.ok(current === shellOriginal);
    else {
      assert.notEqual(current, shellOriginal);
      current.addEventListener("dispose", () => temporaryDisposals++);
      if (mode === "previous-finish") {
        assert.equal(current.roughness, .4); assert.equal(current.clearcoatRoughness, .2);
        assert.equal(current.envMap, shellOriginal.envMap); assert.equal(current.envMapIntensity, shellOriginal.envMapIntensity);
        assert.equal(current.metalness, shellOriginal.metalness); assert.equal(current.clearcoat, shellOriginal.clearcoat);
      } else if (mode !== "normals") {
        assert.ok(current.envMap === shellEnvironment, "explicit texture makes the zero intensity effective in pinned Three");
        assert.equal(current.envMapIntensity, mode === "no-environment" ? 0 : .82);
        assert.ok(current.envMapRotation.equals(shellGame.scene.environmentRotation));
        for (const key of ["roughness", "metalness", "clearcoat", "clearcoatRoughness", "side", "depthWrite", "normalMap", "roughnessMap"])
          assert.equal(current[key], shellOriginal[key], `isolation preserves ${key}`);
        assert.ok(current.color.equals(shellOriginal.color));
      } else assert.equal(current.isMeshNormalMaterial, true);
    }
    assert.ok(shellGame.renderPipeline.pipeline.outputNode === (mode === "normals" ? shellRawOutput : shellOutput));
    assert.equal(shellGame.renderer.toneMapping, mode === "normals" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping);
    await Promise.resolve();
    if (fail) throw new Error("deliberate capture failure");
    return 42;
  };
  if (fail) await assert.rejects(shellControl(mode, action), /deliberate capture failure/);
  else assert.equal(await shellControl(mode, action), 42);
  assert.ok(shellGame.players[0].helmet.material === shellOriginal);
  assert.ok(shellGame.renderPipeline.pipeline.outputNode === shellOutput);
  assert.equal(shellGame.renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(temporaryDisposals, ["explicit-environment", "no-environment", "normals", "previous-finish"].includes(mode) ? 1 : 0);
  assert.equal(sharedShellDisposals, 0, "temporary controls never dispose shared environment or original material");
  assert.deepEqual(shellOriginal.toJSON(), shellOriginalJSON);
}
await assert.rejects(shellControl("unknown", () => assert.fail("invalid mode ran")), /Unknown shell/);
const hardwareMaterial = new THREE.MeshPhysicalMaterial();
shellGame.players[0].helmetShell = shellGame.players[0].helmet;
shellGame.players[0].helmet = { material: hardwareMaterial };
await shellControl("previous-finish", async () => {
  assert.ok(shellGame.players[0].helmet.material === hardwareMaterial, "split-shell QA never changes hardware material");
  assert.notEqual(shellGame.players[0].helmetShell.material, shellOriginal);
});
assert.ok(shellGame.players[0].helmetShell.material === shellOriginal);
// A forearm diagnostic targets the existing whole dark batch (elbow AND fist),
// without replacing any other mesh that shares its production material.
const armDiagnosticProbe = new BeforeElbowFighter(new THREE.Scene(), { id: "arm-diagnostic", color: 0x129dba, accent: 0x6ff6ff }, ["energy_sword"], new THREE.Vector3());
const armTarget = armDiagnosticProbe.rightForearm.children[2], armOriginal = armTarget.material;
const armOriginalJSON = armOriginal.toJSON(), otherArmMaterials = new Map();
armDiagnosticProbe.group.traverse(mesh => { if (mesh.isMesh && mesh !== armTarget) otherArmMaterials.set(mesh, mesh.material); });
const fineElbowIndexed = new THREE.SphereGeometry(.135, 16, 10), fineElbow = fineElbowIndexed.toNonIndexed().translate(0, .015, 0);
fineElbowIndexed.dispose();
for (const arm of [armDiagnosticProbe.rightForearm, armDiagnosticProbe.leftForearm]) for (const fail of [false, true]) {
  const target = arm.children[2], originalGeometry = target.geometry, originalMaterial = target.material;
  const originalArrays = Object.fromEntries(Object.entries(originalGeometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
  const originalDispose = THREE.BufferGeometry.prototype.dispose, disposed = new Map();
  THREE.BufferGeometry.prototype.dispose = function () { disposed.set(this, (disposed.get(this) || 0) + 1); return originalDispose.call(this); };
  try {
    const capture = async () => {
      const candidate = target.geometry;
      assert.ok(candidate !== originalGeometry && target.material !== originalMaterial);
      assert.equal(target.material.roughness, .56); assert.equal(target.material.clearcoatRoughness, .4);
      assert.equal(candidate.attributes.position.count - originalGeometry.attributes.position.count, 188 * 3);
      for (const [name, attribute] of Object.entries(candidate.attributes)) {
        const prefix = originalArrays[name].length - 300 * attribute.itemSize;
        assert.deepEqual(attribute.array.slice(0, prefix), originalArrays[name].slice(0, prefix), "every non-elbow float remains byte-identical");
        assert.deepEqual(attribute.array.slice(prefix), fineElbow.attributes[name].array, "only the verified elbow suffix becomes the authored16x10 sphere");
      }
      assert.ok(Math.abs(candidate.boundingBox.min.z + .135) < 1e-7);
      assert.ok(candidate.boundingSphere.radius > 0 && Number.isFinite(candidate.boundingSphere.radius));
      if (fail) throw new Error("deliberate silhouette capture failure");
      return 17;
    };
    const run = () => shellControl("satin-trial", () => elbowControl(target, capture), target);
    if (fail) await assert.rejects(run(), /deliberate silhouette capture failure/);
    else assert.equal(await run(), 17);
    assert.ok(target.geometry === originalGeometry && target.material === originalMaterial);
    for (const [name, attribute] of Object.entries(originalGeometry.attributes)) assert.deepEqual(attribute.array, originalArrays[name]);
    assert.equal(disposed.get(originalGeometry), undefined);
    assert.equal(disposed.size, 5, "two indexed sources, two expanded sources and one candidate are released");
    assert.ok([...disposed.values()].every(count => count === 1), "temporary geometry disposal is exactly once, including capture failure");
  } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; }
}
for (const change of ["position", "normal", "uv", "index", "missing-uv"]) {
  const malformed = new THREE.BufferGeometry().copy(armTarget.geometry);
  if (change === "index") malformed.setIndex([0, 1, 2]);
  else if (change === "missing-uv") malformed.deleteAttribute("uv");
  else malformed.attributes[change].array[malformed.attributes[change].array.length - 1] += .01;
  const target = { geometry: malformed };
  await assert.rejects(elbowControl(target, () => assert.fail("invalid elbow layout reached capture")), /Unexpected elbow/);
  assert.ok(target.geometry === malformed, "fail-closed validation preserves the supplied source geometry");
  malformed.dispose();
}
fineElbow.dispose();
for (const mode of ["baseline", "explicit-environment", "no-environment", "normals", "satin-trial", "restored"]) for (const fail of [false, true]) {
  let disposed = 0;
  const action = async () => {
    assert.ok(shellGame.players[0].helmetShell.material === shellOriginal, "forearm diagnosis must not replace the helmet material");
    assert.ok(shellGame.players[0].helmet.material === hardwareMaterial);
    for (const [mesh, original] of otherArmMaterials) assert.ok(mesh.material === original,
      "temporary material is isolated to the selected batch, not every shared dark surface");
    if (["baseline", "restored"].includes(mode)) assert.ok(armTarget.material === armOriginal);
    else {
      assert.ok(armTarget.material !== armOriginal);
      armTarget.material.addEventListener("dispose", () => disposed++);
      if (mode === "normals") assert.equal(armTarget.material.isMeshNormalMaterial, true);
      else if (mode === "satin-trial") {
        assert.equal(armTarget.material.roughness, .56); assert.equal(armTarget.material.clearcoatRoughness, .4);
        const trialJSON = armTarget.material.toJSON(), expectedJSON = { ...armOriginalJSON };
        for (const key of ["uuid", "roughness", "clearcoatRoughness"]) { delete trialJSON[key]; delete expectedJSON[key]; }
        assert.deepEqual(trialJSON, expectedJSON, "satin trial changes only two finish values, preserving full lighting and every other material property");
      }
      else assert.equal(armTarget.material.envMapIntensity, mode === "no-environment" ? 0 : .82);
    }
    if (fail) throw new Error("deliberate arm capture failure");
  };
  if (fail) await assert.rejects(shellControl(mode, action, armTarget), /deliberate arm capture failure/);
  else await shellControl(mode, action, armTarget);
  assert.ok(armTarget.material === armOriginal);
  assert.deepEqual(armOriginal.toJSON(), armOriginalJSON);
  assert.equal(disposed, ["baseline", "restored"].includes(mode) ? 0 : 1);
  assert.equal(sharedShellDisposals, 0);
}
const shoulderProbe = new Fighter(new THREE.Scene(), { id: "shoulder-diagnostic", color: 0x129dba, accent: 0x6ff6ff }, ["energy_sword"], new THREE.Vector3());
const shoulderTarget = shoulderProbe.rightArm.children[0], shoulderOriginal = shoulderTarget.material;
const shoulderOriginalJSON = shoulderOriginal.toJSON(), untouchedShoulderMeshes = new Map();
shoulderProbe.group.traverse(mesh => { if (mesh.isMesh && mesh !== shoulderTarget) untouchedShoulderMeshes.set(mesh, [mesh.material, mesh.geometry]); });
for (const mode of ["baseline", "explicit-environment", "no-environment", "normals", "satin-trial", "restored"]) for (const fail of [false, true]) {
  let disposals = 0;
  const geometry = shoulderTarget.geometry;
  const capture = async () => {
    for (const [mesh, [material, originalGeometry]] of untouchedShoulderMeshes) {
      assert.ok(mesh.material === material && mesh.geometry === originalGeometry, "shoulder control preserves approved elbow, fist, armor and opposite arm");
    }
    assert.ok(shoulderTarget.geometry === geometry);
    if (!["baseline", "restored"].includes(mode)) {
      assert.notEqual(shoulderTarget.material, shoulderOriginal);
      shoulderTarget.material.addEventListener("dispose", () => disposals++);
      if (mode === "satin-trial") {
        const trial = shoulderTarget.material.toJSON(), expected = { ...shoulderOriginalJSON, roughness: .56, clearcoatRoughness: .4 };
        delete trial.uuid; delete expected.uuid;
        assert.deepEqual(trial, expected, "shoulder satin control changes only two finish properties, not lighting or adjacent surfaces");
      }
    }
    if (fail) throw new Error("shoulder capture interruption");
  };
  if (fail) await assert.rejects(shellControl(mode, capture, shoulderTarget), /shoulder capture interruption/);
  else await shellControl(mode, capture, shoulderTarget);
  assert.ok(shoulderTarget.material === shoulderOriginal && shoulderTarget.geometry === geometry);
  assert.deepEqual(shoulderOriginal.toJSON(), shoulderOriginalJSON);
  assert.equal(disposals, ["baseline", "restored"].includes(mode) ? 0 : 1);
}
for (const arm of [shoulderProbe.leftArm, shoulderProbe.rightArm]) for (const fail of [false, true]) for (const preserveZ of [false, true]) {
  const target = arm.children[0], geometry = target.geometry, material = target.material;
  const coarseIndexed = new THREE.SphereGeometry(.16, 10, 6), coarse = coarseIndexed.toNonIndexed().translate(0, -.045, 0);
  const fineIndexed = new THREE.SphereGeometry(.16, 16, 10), fine = fineIndexed.toNonIndexed().translate(0, -.045, 0);
  coarse.computeBoundingBox(); fine.computeBoundingBox();
  if (preserveZ) fine.scale(1, 1, coarse.boundingBox.max.z / fine.boundingBox.max.z);
  const capture = async () => {
    assert.notEqual(target.geometry, geometry); assert.ok(target.material === material);
    for (const [key, attribute] of Object.entries(geometry.attributes)) {
      const prefix = attribute.array.length - coarse.attributes[key].array.length;
      assert.deepEqual(target.geometry.attributes[key].array.slice(0, prefix), attribute.array.slice(0, prefix), "capsule prefix is byte-identical");
      assert.deepEqual(target.geometry.attributes[key].array.slice(prefix), fine.attributes[key].array, "only the authenticated ball suffix changes");
    }
    for (const [mesh, [originalMaterial, originalGeometry]] of untouchedShoulderMeshes) {
      if (mesh !== target) assert.ok(mesh.material === originalMaterial && mesh.geometry === originalGeometry);
    }
    assert.equal(target.geometry.attributes.position.count - geometry.attributes.position.count, 564);
    if (preserveZ) {
      assert.ok(Math.abs(target.geometry.boundingBox.max.z - coarse.boundingBox.max.z) < 1e-8);
      assert.ok(Math.abs(target.geometry.boundingBox.min.z - coarse.boundingBox.min.z) < 1e-8);
      const normals = target.geometry.attributes.normal;
      for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-6);
    }
    if (fail) throw new Error("shoulder silhouette interrupted");
  };
  if (fail) await assert.rejects(elbowControl(target, capture, true, preserveZ), /shoulder silhouette interrupted/);
  else await elbowControl(target, capture, true, preserveZ);
  assert.ok(target.geometry === geometry && target.material === material);
  coarseIndexed.dispose(); coarse.dispose(); fineIndexed.dispose(); fine.dispose();
}
await assert.rejects(elbowControl(shoulderTarget, () => assert.fail("shoulder accepted as elbow")), /Unexpected elbow/);
await assert.rejects(elbowControl(shoulderTarget, () => assert.fail("invalid envelope route"), false, true), /shoulder-only/);
const capAlignment = new Function("THREE", "game", "shoulderChamferGeometry", `${elbowControlSource}; return withShoulderCapAlignment;`)(THREE, shellGame, shoulderChamferGeometry);
const capHeroBefore = shellGame.players[0];
const capMaterialSplit = new Function("THREE", "game", "shoulderChamferGeometry", `${elbowControlSource}; return withCapMaterialSplit;`)(THREE, shellGame, shoulderChamferGeometry);
const capSurfaceFinish = new Function("THREE", `${elbowControlSource}; return withCapSurfaceFinish;`)(THREE);
{
  const material = new THREE.MeshPhysicalMaterial({ emissiveIntensity: .16, roughness: .265, clearcoat: .6 });
  const before = material.toJSON(); let firstData;
  for (const fail of [false, true]) {
    let texture, disposed = 0;
    const capture = () => {
      texture = material.normalMap; texture.addEventListener("dispose", () => disposed++);
      assert.deepEqual(material.normalScale.toArray(), [.025, .025]);
      assert.equal(texture.image.width, 64); assert.equal(texture.image.height, 64);
      assert.equal(texture.colorSpace, THREE.NoColorSpace); assert.equal(texture.generateMipmaps, true);
      assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping);
      assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(texture.magFilter, THREE.LinearFilter); assert.equal(texture.anisotropy, 4);
      const data = texture.image.data;
      if (firstData) assert.deepEqual(data, firstData); else firstData = data.slice();
      for (let i = 0; i < data.length; i += 4) {
        const x = (data[i] / 255 * 2 - 1) * .025, y = (data[i + 1] / 255 * 2 - 1) * .025, z = data[i + 2] / 255 * 2 - 1;
        assert.ok(Math.atan2(Math.hypot(x, y), z) < 2 * Math.PI / 180); assert.equal(data[i + 3], 255);
      }
      const json = material.toJSON();
      assert.equal(json.normalMapType, THREE.TangentSpaceNormalMap);
      delete json.normalMap; delete json.normalMapType; delete json.normalScale; delete json.textures; delete json.images;
      assert.deepEqual(json, before, "no unrelated material property changes");
      if (fail) throw new Error("finish interrupted");
    };
    if (fail) await assert.rejects(capSurfaceFinish(material, capture), /finish interrupted/); else await capSurfaceFinish(material, capture);
    assert.equal(disposed, 1); assert.equal(material.normalMap, null); assert.deepEqual(material.toJSON(), before);
  }
  material.normalMap = new THREE.Texture();
  await assert.rejects(capSurfaceFinish(material, () => assert.fail("existing texture overwritten")), /untextured baseline/);
  material.normalMap.dispose(); material.dispose();
}
{
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  shellGame.players[0] = hero;
  const target = hero.rig.children[1], owned = target.geometry, material = target.material, intensity = material.emissiveIntensity;
  await assert.rejects(capMaterialSplit(target, () => assert.fail("unreviewed cap shape")), /suffix/);
  for (const fail of [false, true]) await capAlignment(target, async () => {
    const chamfer = target.geometry, originalDispose = THREE.BufferGeometry.prototype.dispose, originalMaterialDispose = THREE.Material.prototype.dispose;
    const geometries = new Map(), materials = new Map();
    THREE.BufferGeometry.prototype.dispose = function () { geometries.set(this, (geometries.get(this) || 0) + 1); return originalDispose.call(this); };
    THREE.Material.prototype.dispose = function () { materials.set(this, (materials.get(this) || 0) + 1); return originalMaterialDispose.call(this); };
    try {
      const capture = capMaterial => {
        assert.deepEqual(target.material, [material, capMaterial]); assert.notEqual(capMaterial, material);
        const current = capMaterial.toJSON(), previous = material.toJSON(); delete current.uuid; delete previous.uuid;
        assert.deepEqual(current, previous, "split baseline preserves every authored material property");
        assert.deepEqual(target.geometry.groups, [{ start: 0, count: 564, materialIndex: 0 }, { start: 564, count: 276, materialIndex: 1 }]);
        for (const name of Object.keys(chamfer.attributes)) assert.deepEqual(target.geometry.attributes[name].array, chamfer.attributes[name].array);
        capMaterial.emissiveIntensity = 0;
        assert.equal(material.emissiveIntensity, intensity, "original armor and feedback material cannot be changed by cap diagnosis");
        if (fail) throw new Error("split material interrupted");
      };
      if (fail) await assert.rejects(capMaterialSplit(target, capture), /split material interrupted/); else await capMaterialSplit(target, capture);
      assert.equal(target.geometry, chamfer); assert.equal(target.material, material);
      assert.equal(geometries.size, 2); assert.ok([...geometries.values()].every(count => count === 1)); assert.ok(!geometries.has(chamfer));
      assert.equal(materials.size, 1); assert.ok([...materials.values()].every(count => count === 1)); assert.ok(!materials.has(material));
    } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; THREE.Material.prototype.dispose = originalMaterialDispose; }
  }, false, "chamfer");
  assert.equal(target.geometry, owned); assert.equal(target.material, material); hero.dispose(); shellGame.players[0] = capHeroBefore;
}
{
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  shellGame.players[0] = hero;
  const target = hero.rig.children[1], original = target.geometry, material = target.material;
  const cap = new THREE.CylinderGeometry(.2, .25, .42, 6), count = cap.index.count; cap.dispose();
  const untouched = new Map(); hero.group.traverse(mesh => { if (mesh.isMesh && mesh !== target) untouched.set(mesh, [mesh.geometry, mesh.material]); });
  for (const fail of [false, true]) {
    const originalDispose = THREE.BufferGeometry.prototype.dispose, disposed = new Map();
    THREE.BufferGeometry.prototype.dispose = function () { disposed.set(this, (disposed.get(this) || 0) + 1); return originalDispose.call(this); };
    try {
      const capture = () => {
        const geometry = target.geometry, positions = geometry.attributes.position, normals = geometry.attributes.normal, start = positions.count - count;
        assert.deepEqual(positions.array, original.attributes.position.array);
        assert.deepEqual(geometry.attributes.uv.array, original.attributes.uv.array);
        assert.deepEqual(normals.array.slice(0, start * 3), original.attributes.normal.array.slice(0, start * 3), "left cap and armor-prefix normals unchanged");
        assert.notDeepEqual(normals.array.slice(start * 3), original.attributes.normal.array.slice(start * 3));
        for (let i = start; i < positions.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(positions, i), b = new THREE.Vector3().fromBufferAttribute(positions, i + 1), c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
          const expected = b.sub(a).cross(c.sub(a)).normalize();
          for (let j = 0; j < 3; j++) assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(normals, i + j)) < 1e-7);
        }
        assert.equal(target.material, material);
        for (const [mesh, [geometry, material]] of untouched) assert.ok(mesh.geometry === geometry && mesh.material === material);
        if (fail) throw new Error("cap normals interrupted");
      };
      if (fail) await assert.rejects(capAlignment(target, capture, false, true), /cap normals interrupted/);
      else await capAlignment(target, capture, false, true);
      assert.equal(target.geometry, original); assert.equal(disposed.size, 7);
      assert.ok([...disposed.values()].every(count => count === 1)); assert.ok(!disposed.has(original));
    } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; }
  }
  await assert.rejects(capAlignment(target, () => assert.fail("mixed cap controls"), true, true), /cannot be combined/);
  hero.dispose(); shellGame.players[0] = capHeroBefore;
}
{
  const geometry = shoulderChamferGeometry(), indexed = new THREE.CylinderGeometry(.2, .25, .42, 6), original = indexed.toNonIndexed();
  const vertices = [], planes = [], position = original.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i);
    if (!vertices.some(old => old.distanceTo(point) < 1e-7)) vertices.push(point);
  }
  for (let i = 0; i < position.count; i += 3) {
    const plane = new THREE.Plane().setFromCoplanarPoints(...[0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, i + j)));
    if (!planes.some(old => old.normal.distanceTo(plane.normal) < 1e-6 && Math.abs(old.constant - plane.constant) < 1e-6)) planes.push(plane);
  }
  assert.equal(planes.length, 8);
  const broadPlanes = planes.slice();
  for (let i = 0; i < broadPlanes.length; i++) for (let j = i + 1; j < broadPlanes.length; j++) {
    const a = broadPlanes[i], b = broadPlanes[j];
    if (vertices.filter(point => Math.abs(a.distanceToPoint(point)) < 1e-7 && Math.abs(b.distanceToPoint(point)) < 1e-7).length < 2) continue;
    const normal = a.normal.clone().add(b.normal), length = normal.length();
    planes.push(new THREE.Plane(normal.divideScalar(length), (a.constant + b.constant) / length + .005 * Math.sqrt((1 - a.normal.dot(b.normal)) / 2)));
  }
  assert.equal(planes.length, 26);
  assert.equal(geometry.attributes.position.count, 276, "authored chamfer is exactly 92 triangles");
  assert.equal(Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) - Object.values(original.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0), 6528);
  const edges = new Map(), covered = new Set();
  for (let i = 0; i < 276; i += 3) {
    const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i + j));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    assert.ok(normal.dot(points[0]) > 0, "all faces point outward");
    for (const [j, plane] of planes.entries()) {
      assert.ok(points.every(point => plane.distanceToPoint(point) < 1e-7), "chamfer never grows the housing or violates its edge cuts");
      if (points.every(point => Math.abs(plane.distanceToPoint(point)) < 1e-7)) covered.add(j);
    }
    for (let j = 0; j < 3; j++) {
      assert.ok(normal.distanceTo(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, i + j)) < 1e-7);
      const a = points[j].toArray().join(","), b = points[(j + 1) % 3].toArray().join(","), key = [a, b].sort().join("/");
      const entry = edges.get(key) ?? { count: 0, winding: 0 }; entry.count++; entry.winding += a < b ? 1 : -1; edges.set(key, entry);
    }
  }
  assert.equal(covered.size, 26, "all original broad planes and new bevel planes are present");
  assert.ok([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0), "closed, consistently wound chamfer");
  assert.ok([...geometry.attributes.uv.array].every(Number.isFinite));
  indexed.dispose(); original.dispose(); geometry.dispose();
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  shellGame.players[0] = hero;
  const target = hero.rig.children[1], owned = target.geometry;
  const expected = shoulderChamferGeometry().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(.61, 1.62, -.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, .16)), new THREE.Vector3(1, 1, 1)));
  for (const fail of [false, true]) {
    const originalDispose = THREE.BufferGeometry.prototype.dispose, disposed = new Map();
    THREE.BufferGeometry.prototype.dispose = function () { disposed.set(this, (disposed.get(this) || 0) + 1); return originalDispose.call(this); };
    try {
      const capture = () => {
        for (const [name, attribute] of Object.entries(owned.attributes)) {
          const start = attribute.array.length - 72 * attribute.itemSize, actual = target.geometry.attributes[name].array;
          assert.deepEqual(actual.slice(0, start), attribute.array.slice(0, start), "all left-cap and armor-prefix attributes preserved");
          assert.deepEqual(actual.slice(start), expected.attributes[name].array);
        }
        assert.equal(target.material, hero.armorMaterial);
        if (fail) throw new Error("chamfer interrupted");
      };
      if (fail) await assert.rejects(capAlignment(target, capture, false, "chamfer"), /chamfer interrupted/);
      else await capAlignment(target, capture, false, "chamfer");
      assert.equal(target.geometry, owned); assert.equal(disposed.size, 7); assert.ok([...disposed.values()].every(count => count === 1)); assert.ok(!disposed.has(owned));
    } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; }
  }
  expected.dispose(); hero.dispose(); shellGame.players[0] = capHeroBefore;
}
const bearingControl = new Function("THREE", "game", `${elbowControlSource}; return withElbowSilhouette;`)(THREE, shellGame);
for (const variant of [0, 1, 2, 3]) {
  const hero = new BeforeBearingFighter(new THREE.Scene(), { id: String.fromCharCode(100 + variant), color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  shellGame.players[0] = hero;
  for (const arm of [hero.leftArm, hero.rightArm]) {
    const target = arm.children[0], original = target.geometry;
    if (variant !== 1) { await assert.rejects(bearingControl(target, () => assert.fail("wrong costume"), true, false, true), /variant-1/); continue; }
    for (const fail of [false, true]) {
      const originalDispose = THREE.BufferGeometry.prototype.dispose, disposed = new Map();
      THREE.BufferGeometry.prototype.dispose = function () { disposed.set(this, (disposed.get(this) || 0) + 1); return originalDispose.call(this); };
      try {
        const check = () => {
          THREE.BufferGeometry.prototype.dispose = originalDispose;
          const indexed = new THREE.SphereGeometry(.16, 10, 6), expected = indexed.toNonIndexed().translate(0, -.045, 0);
          for (const [name, attribute] of Object.entries(target.geometry.attributes)) {
            const tail = expected.attributes[name].array, start = attribute.array.length - tail.length;
            assert.equal(attribute.array.length, original.attributes[name].array.length);
            assert.deepEqual(attribute.array.slice(0, start), original.attributes[name].array.slice(0, start), "capsule prefix preserved");
            assert.deepEqual(attribute.array.slice(start), tail, "only the bearing radius changes");
          }
          indexed.dispose(); expected.dispose();
          THREE.BufferGeometry.prototype.dispose = function () { disposed.set(this, (disposed.get(this) || 0) + 1); return originalDispose.call(this); };
          assert.equal(target.material, hero.elbowMaterial);
          if (fail) throw new Error("bearing interrupted");
        };
        if (fail) await assert.rejects(bearingControl(target, check, true, false, true), /bearing interrupted/);
        else await bearingControl(target, check, true, false, true);
        assert.equal(target.geometry, original);
        assert.equal(disposed.size, 5); assert.ok([...disposed.values()].every(count => count === 1));
        assert.ok(!disposed.has(original));
      } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; }
    }
    await assert.rejects(bearingControl(target, () => assert.fail("mixed trial"), true, true, true), /variant-1/);
  }
  hero.dispose();
}
shellGame.players[0] = capHeroBefore;
for (let variant = 0; variant < 4; variant++) {
  const hero = new BeforeCapFighter(new THREE.Scene(), { id: String.fromCharCode(100 + variant), color: 0x129dba, accent: 0x6ff6ff }, ["energy_sword"], new THREE.Vector3());
  shellGame.players[0] = hero;
  const target = hero.rig.children[1], geometry = target.geometry;
  if (variant !== 1) {
    await assert.rejects(capAlignment(target, () => assert.fail("other costume changed")), /variant-1/);
    assert.ok(target.geometry === geometry); hero.dispose(); continue;
  }
  const capIndexed = new THREE.CylinderGeometry(.2, .25, .42, 6), capVertexCount = capIndexed.index.count;
  capIndexed.dispose();
  const untouched = new Map(); hero.group.traverse(mesh => { if (mesh.isMesh && mesh !== target) untouched.set(mesh, [mesh.geometry, mesh.material]); });
  for (const fail of [false, true]) {
    const originalDispose = THREE.BufferGeometry.prototype.dispose, disposed = new Map();
    THREE.BufferGeometry.prototype.dispose = function () { disposed.set(this, (disposed.get(this) || 0) + 1); return originalDispose.call(this); };
    try {
      const capture = async () => {
        const actual = target.geometry.attributes.position, previous = geometry.attributes.position, prefix = actual.count - capVertexCount * 2;
        assert.equal(actual.count, previous.count); assert.ok(target.material === hero.armorMaterial);
        for (const name of ["normal", "uv"]) assert.deepEqual(target.geometry.attributes[name].array, geometry.attributes[name].array);
        assert.deepEqual(actual.array.slice(0, prefix * 3), previous.array.slice(0, prefix * 3));
        for (let i = prefix; i < actual.count; i++) {
          const shift = i < prefix + capVertexCount ? -.04 : .04;
          assert.ok(Math.abs(actual.getX(i) - previous.getX(i) - shift) < 8e-8);
          assert.equal(actual.getY(i), previous.getY(i)); assert.equal(actual.getZ(i), previous.getZ(i));
        }
        for (const [mesh, [originalGeometry, material]] of untouched) assert.ok(mesh.geometry === originalGeometry && mesh.material === material);
        if (fail) throw new Error("cap alignment interrupted");
      };
      if (fail) await assert.rejects(capAlignment(target, capture), /cap alignment interrupted/);
      else await capAlignment(target, capture);
      assert.ok(target.geometry === geometry);
      assert.equal(disposed.size, 7); assert.ok([...disposed.values()].every(count => count === 1));
      assert.ok(!disposed.has(geometry), "original static armor remains owned by the Fighter");
    } finally { THREE.BufferGeometry.prototype.dispose = originalDispose; }
  }
  const malformed = geometry.clone(); malformed.attributes.position.array[malformed.attributes.position.array.length - 1] += .01;
  target.geometry = malformed;
  await assert.rejects(capAlignment(target, () => assert.fail("unauthenticated cap suffix changed")), /cap position suffix/);
  assert.ok(target.geometry === malformed); target.geometry = geometry; malformed.dispose(); hero.dispose();
}
shellGame.players[0] = capHeroBefore;
// Preserve the archived variant-1 cap/bearing trial parity across all weapons.
for (const change of ["cap", "bearing"]) for (const variant of [0, 1, 2, 3]) for (const weapon of Object.keys(WEAPONS)) {
  const options = { id: String.fromCharCode(100 + variant), color: 0x129dba, accent: 0x6ff6ff };
  const current = new Fighter(new THREE.Scene(), options, [weapon], new THREE.Vector3());
  const PreviousFighter = change === "cap" ? BeforeCapFighter : BeforeBearingFighter;
  const previous = new PreviousFighter(new THREE.Scene(), options, [weapon], new THREE.Vector3());
  const swap = (fighter, capture, reverse = false) => change === "cap" ? capAlignment(fighter.rig.children[1], capture, reverse)
    : bearingControl(fighter.leftArm.children[0], () => bearingControl(fighter.rightArm.children[0], capture, true, false, reverse ? "previous" : true), true, false, reverse ? "previous" : true);
  const compare = () => {
    const oldObjects = [], newObjects = [];
    previous.group.traverse(object => oldObjects.push(object)); current.group.traverse(object => newObjects.push(object));
    assert.equal(newObjects.length, oldObjects.length);
    newObjects.forEach((object, index) => {
      const old = oldObjects[index];
      assert.deepEqual(object.position.toArray(), old.position.toArray());
      assert.deepEqual(object.quaternion.toArray(), old.quaternion.toArray());
      assert.deepEqual(object.scale.toArray(), old.scale.toArray());
      if (!object.geometry) return;
      assert.deepEqual(object.geometry.index?.array, old.geometry.index?.array);
      for (const name of Object.keys(object.geometry.attributes))
        assert.deepEqual(object.geometry.attributes[name].array, old.geometry.attributes[name].array, `${variant}/${weapon}/${index}/${name}`);
      for (const name of ["type", "roughness", "metalness", "clearcoat", "clearcoatRoughness", "emissiveIntensity", "opacity", "transparent", "side"])
        assert.equal(object.material[name], old.material[name]);
      for (const name of ["color", "emissive"]) assert.equal(object.material[name]?.getHex(), old.material[name]?.getHex());
    });
  };
  shellGame.players[0] = previous;
  if (variant === 1) await swap(previous, compare); else compare();
  if (variant === 1) {
    shellGame.players[0] = current;
    const targets = [current.rig.children[1], current.leftArm.children[0], current.rightArm.children[0]], originals = targets.map(target => target.geometry);
    await swap(current, compare, true);
    targets.forEach((target, i) => assert.equal(target.geometry, originals[i]));
    if (change === "bearing") for (const envelope of [false, true]) {
      await bearingControl(current.rightArm.children[0], () => {
        assert.ok(current.rightArm.children[0].geometry.attributes.position.count > originals[2].attributes.position.count, "existing tessellation controls use the current fitted radius");
      }, true, envelope);
      assert.equal(current.rightArm.children[0].geometry, originals[2]);
    }
    await assert.rejects(swap(current, () => { throw new Error("reverse interrupted"); }, true), /reverse interrupted/);
    targets.forEach((target, i) => assert.equal(target.geometry, originals[i]));
  }
  current.dispose(); previous.dispose();
}
shellGame.players[0] = capHeroBefore;
// Actual pre-Pass65 source: all three changed constants restored together.
const pre65Source = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("const shoulderRadius = .16;", "const shoulderRadius = costumeVariant === 1 ? .16 : .18;")
  .replace("const shoulderX = .61;", "const shoulderX = costumeVariant === 1 ? .61 : .57;")
  .replace("leftShoulder.scale.set(1.15, 1.34, .92);", "leftShoulder.scale.set(.84, 1.34, .92);");
for (const source of ["costumeVariant === 1 ? .16 : .18", "costumeVariant === 1 ? .61 : .57", "leftShoulder.scale.set(.84, 1.34, .92)"])
  assert.ok(pre65Source.includes(source), "pre-Pass65 reconstruction must not silently become a no-op");
const Pre65Fighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${pre65Source}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
for (const variant of [0, 1, 2, 3]) for (const weapon of Object.keys(WEAPONS)) {
  const options = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const current = new Fighter(new THREE.Scene(), options, [weapon], new THREE.Vector3());
  const previous = new Pre65Fighter(new THREE.Scene(), options, [weapon], new THREE.Vector3());
  const meshes = fighter => { const result = []; fighter.group.traverse(o => { if (o.isMesh) result.push(o); }); return result; };
  const currentMeshes = meshes(current), previousMeshes = meshes(previous);
  const compare = () => {
    assert.equal(currentMeshes.length, previousMeshes.length);
    for (let i = 0; i < currentMeshes.length; i++) {
      // The QA control hides originals and adds temporary siblings; compare each
      // sibling in its original mesh's slot, not traversal order after insertion.
      const visibleMesh = mesh => mesh.visible ? mesh : mesh.parent.children.find(o => o !== mesh && o.isMesh && o.visible && o.material === mesh.material &&
        o.geometry.attributes.position.count === mesh.geometry.attributes.position.count);
      const a = visibleMesh(currentMeshes[i]), b = visibleMesh(previousMeshes[i]);
      assert.ok(a && b);
      for (const key of ["position", "quaternion", "scale"]) assert.deepEqual(a[key].toArray(), b[key].toArray());
      assert.deepEqual(a.geometry.index?.array, b.geometry.index?.array);
      for (const key of Object.keys(a.geometry.attributes)) assert.deepEqual(a.geometry.attributes[key].array, b.geometry.attributes[key].array,
        `Pass65 ${variant}/${weapon}/${i}/${key} equals the approved trial`);
      for (const key of ["type", "roughness", "metalness", "clearcoat", "clearcoatRoughness", "emissiveIntensity", "opacity", "transparent", "side"])
        assert.equal(a.material[key], b.material[key]);
      for (const key of ["color", "emissive"]) assert.equal(a.material[key]?.getHex(), b.material[key]?.getHex());
    }
  };
  try {
    if (variant === 1) compare();
    else {
      await withAlignedShoulders(previous, compare);
      await withAlignedShoulders(current, compare, true);
    }
  } finally { current.dispose(); previous.dispose(); }
}
shoulderProbe.dispose();
armDiagnosticProbe.dispose();
hardwareMaterial.dispose();
shellOriginal.dispose(); shellEnvironment.dispose();
const shellRunSource = graphicsFixture.slice(graphicsFixture.indexOf("async function runShellReview("), graphicsFixture.indexOf('select("shell-diagnosis").onclick'));
const shellControlElements = [{ disabled: false }, { disabled: true }];
const shellRunState = { running: false }, shellRunGame = { paused: true, settings: { graphics: "high" },
  renderPipeline: { direct: false }, combatVisuals: { combatLights: [{ intensity: 0, userData: { life: 0 } }] }, updateCamera() {} };
let shellWaits = 0, interruptShell = false;
const runShellHarness = new Function("game", "cameraReview", "document", "select", "waitForReviewFrame", "withHelmetShellDiagnostic", `
  const resetReview={}, cacheReview={}, decoyReview={}, resetPhase="ready", sceneSerial=1, errorCount=0, renderedFrames=0, aoOutput="final";
  let stress=false, cameraOffset=.31;
  ${shellRunSource}
  return { run: runShellReview, offset: () => cameraOffset };
`)(shellRunGame, shellRunState, { querySelectorAll: () => shellControlElements },
  id => id === "view" ? { value: "helmet-profile" } : { replaceChildren() {} }, async () => {
    shellWaits++;
    assert.deepEqual(shellControlElements.map(control => control.disabled), [true, true]);
    if (interruptShell) { shellRunGame.paused = false; return; }
    throw new Error("deliberate shell frame timeout");
  }, async (mode, action) => action());
await runShellHarness.run();
assert.match(shellRunState.error, /deliberate shell frame timeout/);
assert.equal(shellRunState.running, false); assert.equal(shellRunState.shell, false);
assert.equal(runShellHarness.offset(), .31);
assert.deepEqual(shellControlElements.map(control => control.disabled), [false, true], "outer failure restores prior disabled states");
assert.equal(shellRunGame.paused, true);
shellRunState.running = true;
await runShellHarness.run();
assert.equal(shellWaits, 1, "an already running camera review cannot start a duplicate shell run");
shellRunState.running = false; shellRunGame.combatVisuals.combatLights[0].intensity = .1;
await runShellHarness.run();
assert.match(shellRunState.error, /combat lights/);
assert.equal(shellWaits, 1, "active combat lighting invalidates the fixed-light diagnostic before capture");
assert.deepEqual(shellControlElements.map(control => control.disabled), [false, true]);
shellRunGame.combatVisuals.combatLights[0].intensity = 0; interruptShell = true;
await runShellHarness.run();
assert.match(shellRunState.error, /paused/, "Escape can resume simulation despite disabled navigation; discard that comparison");
assert.equal(shellRunState.running, false); assert.equal(shellRunState.shell, false);
assert.equal(shellRunGame.paused, false, "cleanup preserves the user's new pause choice");
assert.deepEqual(shellControlElements.map(control => control.disabled), [false, true]);
const armRunState = { running: false }, armRunMaterial = {}, armRunTarget = { isMesh: true, material: armRunMaterial }, armRunLinks = [], armRunModes = [];
const armRunControls = [{ disabled: false }, { disabled: true }];
const armRunGame = { ...shellRunGame, paused: true, players: [{ darkMaterial: armRunMaterial, rightForearm: { children: [null, null, armRunTarget] } }] };
let armRunView = "hand-side", armWaits = 0, expectedDiagnosticTarget = armRunTarget, armGeometryCalls = 0, shoulderGeometryCalls = 0, envelopeCalls = 0, capCalls = 0, bearingCalls = 0, splitCalls = 0, splitRestores = 0, interruptCapEmission = false;
const armRunHarness = new Function("game", "cameraReview", "document", "select", "waitForReviewFrame", "withHelmetShellDiagnostic", "shellReviewState", "withElbowSilhouette", "withShoulderCapAlignment", "withCapMaterialSplit", "withCapSurfaceFinish", `
  const resetReview={}, cacheReview={}, decoyReview={}, resetPhase="ready", sceneSerial=1, errorCount=0, renderedFrames=0, aoOutput="final";
  let stress=false, cameraOffset=.31;
  ${shellRunSource}
  return { run: runShellReview, offset: () => cameraOffset };
`)(armRunGame, armRunState, { querySelectorAll: () => armRunControls, createElement: () => ({}),
  querySelector: () => ({ toDataURL: type => { assert.equal(type, "image/png"); return "data:image/png;base64,test"; } }) },
  id => id === "view" ? { value: armRunView } : { replaceChildren() { armRunLinks.length = 0; }, append(link) { armRunLinks.push(link); } },
  async () => { armWaits++; if (interruptCapEmission && armRunState.samples.length === 6) throw new Error("cap emission interrupted"); assert.equal(armRunState.shell, true, "freeze flag spans every forearm capture");
    assert.deepEqual(armRunControls.map(control => control.disabled), [true, true]); },
  async (mode, action, target) => { assert.ok(target === expectedDiagnosticTarget); armRunModes.push(mode); await action(); },
  (target, material) => { assert.ok(target === expectedDiagnosticTarget, "every sample records the material target actually overridden"); return { targetName: "actual forearm batch", capIntensity: material?.emissiveIntensity }; },
  async (target, capture, shoulder, preserveZ, bearingFit) => {
    if (bearingFit && armRunView === "fighter") assert.ok([armRunGame.players[0].leftArm.children[0], armRunGame.players[0].rightArm.children[0]].includes(target));
    else assert.ok(target === expectedDiagnosticTarget);
    if (shoulder) shoulderGeometryCalls++; else armGeometryCalls++;
    if (preserveZ) envelopeCalls++;
    if (bearingFit) { assert.equal(shoulder, true); assert.equal(preserveZ, false); assert.equal(bearingFit, "previous"); bearingCalls++; }
    return capture();
  }, async (target, capture, previous, faceNormals) => { assert.ok(target === expectedDiagnosticTarget); assert.equal(previous, !faceNormals); capCalls++; return capture(); },
  async (target, capture) => { assert.ok(target === expectedDiagnosticTarget); splitCalls++; try { return await capture({ emissiveIntensity: .16 }); } finally { splitRestores++; } },
  async (material, capture) => { assert.equal(material.emissiveIntensity, .16); return capture(); });
await armRunHarness.run(false, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 13); assert.equal(armRunLinks.length, 13);
assert.ok(armRunLinks.every(link => link.download.startsWith("forearm-")), "download names disclose the actual diagnostic scope");
assert.deepEqual(armRunModes, ["baseline", "explicit-environment", "no-environment", "normals", "restored"]);
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.04, 0, .04, 0, -.04, 0, .04, -.04, 0, .04, -.04, 0, .04]);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget === "right forearm dark batch: elbow and fist"));
assert.deepEqual(armRunState.samples.filter(sample => sample.mode === "normals").map(sample => sample.output), ["scene-color", "scene-color", "scene-color"]);
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunView = "helmet-profile"; await armRunHarness.run(false, true);
assert.match(armRunState.error, /matching view/); assert.equal(armWaits, 13, "wrong view cannot begin a forearm diagnostic");
armRunView = "hand-side"; armRunModes.length = 0; await armRunHarness.run(true, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 22); assert.equal(armRunLinks.length, 9);
assert.deepEqual(armRunModes, ["baseline", "satin-trial", "restored"], "forearm trial never applies the previous capsule finish");
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.04, 0, .04, -.04, 0, .04, -.04, 0, .04]);
assert.ok(armRunState.samples.every(sample => sample.output === "final" && sample.diagnosticTarget.includes("elbow and fist")));
assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false); assert.equal(armRunHarness.offset(), .31);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunTarget.material = {};
await armRunHarness.run(false, true);
assert.match(armRunState.error, /forearm batch layout/, "a future child reorder must fail closed instead of silently diagnosing another surface");
assert.equal(armWaits, 22);
armRunTarget.material = armRunMaterial;
armRunView = "helmet-profile"; expectedDiagnosticTarget = undefined; armRunModes.length = 0;
await armRunHarness.run(true);
assert.match(armRunState.error, /capsule helmet/); assert.equal(armWaits, 22, "original capsule comparison still rejects other helmets");
armRunGame.players[0].helmetShell = {};
await armRunHarness.run(true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 31); assert.equal(armRunLinks.length, 9);
assert.deepEqual(armRunModes, ["baseline", "previous-finish", "restored"]);
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.16, 0, .16, -.16, 0, .16, -.16, 0, .16]);
assert.ok(armRunLinks.every(link => link.download.startsWith("shell-")));
armRunView = "hand-side"; expectedDiagnosticTarget = armRunTarget; armRunModes.length = 0;
await armRunHarness.run(true, true, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 40); assert.equal(armRunLinks.length, 9); assert.equal(armGeometryCalls, 1);
assert.deepEqual(armRunModes, ["satin-trial", "satin-trial", "satin-trial"], "geometry comparison keeps identical satin finish through all three modes");
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["satin-baseline", "satin-baseline", "satin-baseline", "elbow-silhouette", "elbow-silhouette", "elbow-silhouette", "satin-restored", "satin-restored", "satin-restored"]);
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.04, 0, .04, -.04, 0, .04, -.04, 0, .04]);
assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false); assert.equal(armRunHarness.offset(), .31);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
for (const [finish, forearm] of [[false, true], [true, false]]) {
  await armRunHarness.run(finish, forearm, true);
  assert.match(armRunState.error, /satin forearm route/); assert.equal(armWaits, 40); assert.equal(armGeometryCalls, 1);
}
// The production layout targets the extra elbow mesh, not the hand batch.
armRunGame.players[0].elbowMaterial = armRunMaterial;
armRunGame.players[0].rightForearm.children = [null, null, { isMesh: true, material: {} }, armRunTarget];
armRunModes.length = 0;
await armRunHarness.run(true, true, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 49); assert.equal(armGeometryCalls, 2);
assert.deepEqual(armRunModes, ["previous-finish"]);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["previous-elbow", "previous-elbow", "previous-elbow", "elbow-silhouette", "elbow-silhouette", "elbow-silhouette", "restored", "restored", "restored"]);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget === "right elbow only"));
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
// Shoulder diagnosis reuses the frozen control without touching the approved elbow.
const shoulderRunTarget = { isMesh: true, material: armRunMaterial };
armRunGame.players[0].rightArm = { children: [shoulderRunTarget, {}, armRunGame.players[0].rightForearm] };
expectedDiagnosticTarget = shoulderRunTarget; armRunView = "hand-shoulder"; armRunModes.length = 0;
await armRunHarness.run(false, false, false, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 62); assert.equal(armRunLinks.length, 13);
assert.deepEqual(armRunModes, ["baseline", "explicit-environment", "no-environment", "normals", "restored"]);
assert.ok(armRunLinks.every(link => link.download.startsWith("shoulder-")));
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.includes("excludes elbow, fist and static armor")));
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.04, 0, .04, 0, -.04, 0, .04, -.04, 0, .04, -.04, 0, .04]);
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunView = "hand-side"; await armRunHarness.run(false, false, false, true);
assert.match(armRunState.error, /matching view/); assert.equal(armWaits, 62);
armRunView = "hand-shoulder"; shoulderRunTarget.material = {};
await armRunHarness.run(false, false, false, true);
assert.match(armRunState.error, /shoulder batch layout/); assert.equal(armWaits, 62);
shoulderRunTarget.material = armRunMaterial;
for (const args of [[false, true, false, true], [false, false, true, true], [true, true, false, true]]) {
  await armRunHarness.run(...args); assert.match(armRunState.error, /cannot run/); assert.equal(armWaits, 62);
}
delete armRunGame.players[0].helmetShell; armRunModes.length = 0;
await armRunHarness.run(true, false, false, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 71); assert.equal(armRunLinks.length, 9);
assert.deepEqual(armRunModes, ["baseline", "satin-trial", "restored"], "shoulder trial cannot accidentally use the helmet finish");
assert.ok(armRunState.samples.every(sample => sample.output === "final" && sample.diagnosticTarget.startsWith("right upper-arm")));
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.04, 0, .04, -.04, 0, .04, -.04, 0, .04]);
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunModes.length = 0;
await armRunHarness.run(true, false, false, true, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 80); assert.equal(shoulderGeometryCalls, 1);
assert.deepEqual(armRunModes, [], "geometry-only comparison must never clone or retune the published finish");
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["baseline", "baseline", "baseline", "shoulder-silhouette", "shoulder-silhouette", "shoulder-silhouette", "restored", "restored", "restored"]);
armRunGame.players[0].leftForearm = {};
const leftShoulderTarget = { isMesh: true, material: armRunMaterial };
armRunGame.players[0].leftArm = { children: [leftShoulderTarget, {}, armRunGame.players[0].leftForearm] };
armRunView = "hand-shoulder-opposite"; expectedDiagnosticTarget = leftShoulderTarget;
await armRunHarness.run(true, false, false, true, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 89); assert.equal(shoulderGeometryCalls, 2);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.startsWith("left upper-arm")));
for (const args of [[false, false, false, true, true], [true, false, false, false, true]]) {
  await armRunHarness.run(...args); assert.match(armRunState.error, /Shoulder silhouette requires/); assert.equal(armWaits, 89);
}
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
await armRunHarness.run(true, false, false, true, "envelope");
assert.equal(armRunState.error, null); assert.equal(armWaits, 98); assert.equal(envelopeCalls, 1);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["baseline", "baseline", "baseline", "ellipsoidal-z-envelope", "ellipsoidal-z-envelope", "ellipsoidal-z-envelope", "restored", "restored", "restored"]);
assert.deepEqual(armRunModes, [], "envelope control preserves the exact published material");
await armRunHarness.run(true, false, false, true, "typo");
assert.match(armRunState.error, /Unknown shoulder silhouette/); assert.equal(armWaits, 98);
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunGame.players[0].id = "p1";
const capRunTarget = { isMesh: true, material: {} };
armRunGame.players[0].rig = { children: [null, capRunTarget] }; expectedDiagnosticTarget = capRunTarget;
await armRunHarness.run(true, false, false, true, "cap-alignment");
assert.equal(armRunState.error, null); assert.equal(armWaits, 107); assert.equal(capCalls, 1);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["previous-cap-x-alignment", "previous-cap-x-alignment", "previous-cap-x-alignment", "aligned-cap-x", "aligned-cap-x", "aligned-cap-x", "restored", "restored", "restored"]);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.includes("variant-1 static shoulder caps")));
assert.deepEqual(armRunModes, [], "cap position experiment does not override any material");
armRunGame.players[0].id = "d";
await armRunHarness.run(true, false, false, true, "cap-alignment");
assert.match(armRunState.error, /restricted to costume variant 1/); assert.equal(armWaits, 107);
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunGame.players[0].id = "p1"; armRunView = "fighter";
await armRunHarness.run(true, false, false, true, "cap-alignment");
assert.equal(armRunState.error, null); assert.equal(armWaits, 116); assert.equal(capCalls, 2);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.startsWith("whole-fighter")));
expectedDiagnosticTarget = leftShoulderTarget;
await armRunHarness.run(true, false, false, true, true);
assert.match(armRunState.error, /matching view/); assert.equal(armWaits, 116, "whole-fighter framing is restricted to the cap-contact comparison");
armRunView = "hand-shoulder-opposite";
await armRunHarness.run(true, false, false, true, "bearing-fit");
assert.equal(armRunState.error, null); assert.equal(armWaits, 125); assert.equal(bearingCalls, 1);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["previous-bearing-fit", "previous-bearing-fit", "previous-bearing-fit", "bearing-fit", "bearing-fit", "bearing-fit", "restored", "restored", "restored"]);
assert.deepEqual(armRunModes, [], "bearing fit preserves material");
armRunGame.players[0].id = "d";
await armRunHarness.run(true, false, false, true, "bearing-fit");
assert.match(armRunState.error, /restricted to costume variant 1/); assert.equal(armWaits, 125);
assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false); assert.equal(armRunHarness.offset(), .31);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunGame.players[0].id = "p1"; armRunView = "fighter"; expectedDiagnosticTarget = armRunGame.players[0].rightArm.children[0];
await armRunHarness.run(true, false, false, true, "bearing-fit");
assert.equal(armRunState.error, null); assert.equal(armWaits, 134); assert.equal(bearingCalls, 3, "whole-fighter trial swaps both bearings");
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.includes("both variant-1 shoulder bearings")));
armRunView = "hand-shoulder"; expectedDiagnosticTarget = capRunTarget;
await armRunHarness.run(true, false, false, true, "cap-normals");
assert.equal(armRunState.error, null); assert.equal(armWaits, 143); assert.equal(capCalls, 3);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["baseline", "baseline", "baseline", "right-cap-face-normals", "right-cap-face-normals", "right-cap-face-normals", "restored", "restored", "restored"]);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.startsWith("right static cap normals only")));
assert.deepEqual(armRunModes, []);
armRunView = "hand-shoulder-opposite";
await armRunHarness.run(true, false, false, true, "cap-normals");
assert.match(armRunState.error, /requires the right shoulder view/); assert.equal(armWaits, 143);
assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false); assert.equal(armRunHarness.offset(), .31);
armRunView = "hand-shoulder";
await armRunHarness.run(true, false, false, true, "cap-chamfer");
assert.equal(armRunState.error, null); assert.equal(armWaits, 152); assert.equal(capCalls, 4);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["baseline", "baseline", "baseline", "right-cap-chamfer", "right-cap-chamfer", "right-cap-chamfer", "restored", "restored", "restored"]);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget.startsWith("right static cap inward edge chamfer")));
armRunView = "hand-shoulder-oblique";
await armRunHarness.run(true, false, false, true, "cap-chamfer");
assert.equal(armRunState.error, null); assert.equal(armWaits, 161); assert.equal(capCalls, 5);
await armRunHarness.run(true, false, false, true, "cap-emission");
assert.equal(armRunState.error, null); assert.equal(armWaits, 176); assert.equal(capCalls, 6); assert.equal(splitCalls, 1); assert.equal(splitRestores, 1);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["chamfer-baseline", "split-baseline", "cap-no-emission", "split-restored", "chamfer-restored"].flatMap(mode => [mode, mode, mode]));
assert.deepEqual(armRunState.samples.map(sample => sample.capIntensity), [undefined, undefined, undefined, .16, .16, .16, 0, 0, 0, .16, .16, .16, undefined, undefined, undefined]);
interruptCapEmission = true;
await armRunHarness.run(true, false, false, true, "cap-emission");
assert.match(armRunState.error, /cap emission interrupted/); assert.equal(armWaits, 183); assert.equal(splitRestores, 2);
interruptCapEmission = false;
await armRunHarness.run(true, false, false, true, "cap-finish");
assert.equal(armRunState.error, null); assert.equal(armWaits, 198); assert.equal(splitRestores, 3);
assert.deepEqual(armRunState.samples.map(sample => sample.mode), ["chamfer-baseline", "split-baseline", "cap-finish", "split-restored", "chamfer-restored"].flatMap(mode => [mode, mode, mode]));
assert.ok(armRunState.samples.every(sample => sample.capIntensity === undefined || sample.capIntensity === .16));
interruptCapEmission = true;
await armRunHarness.run(true, false, false, true, "cap-finish");
assert.match(armRunState.error, /cap emission interrupted/); assert.equal(splitRestores, 4);
assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false); assert.equal(armRunHarness.offset(), .31);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
const geometryNormalToken = {}, colorOutputToken = {};
const makeAOWrapper = new Function("mrt", "normalViewGeometry", "output", "geometryAONormals", "aoOutput", "vec3", "vec4", "depthAONormals", "legacyAONormals", "normalView", "materialBlendAONormals", "THREE", "recoverAONormals", "singleSampleAO", "emulateCompatibilityAO", `${aoWrapperSource}; return withAODiagnostics;`);
const wrapAONormals = makeAOWrapper(value => value, geometryNormalToken, colorOutputToken, true, "final");
let aoOverrides = 0, aoBuildCalls = 0;
const aoFixture = { ensure: wrapAONormals(function (value) {
  aoBuildCalls++; this.aoPass = {};
  this.scenePass ??= { setMRT(value) { aoOverrides++; assert.ok(value.normal === geometryNormalToken && value.output === colorOutputToken); } };
  return value;
}) };
assert.equal(aoFixture.ensure(7), 7);
assert.equal(aoFixture.ensure(8), 8);
assert.equal(aoBuildCalls, 2); assert.equal(aoOverrides, 1, "QA normal comparison overrides only newly created AO scene passes");
const noAOFixture = { ensure: wrapAONormals(function () { this.scenePass = { setMRT() { throw new Error("non-AO pass changed"); } }; }) };
noAOFixture.ensure();
const depthAOFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, true)(function () {
  this.aoPass = { normalNode: {} }; this.scenePass = {};
}) };
depthAOFixture.ensure();
assert.equal(depthAOFixture.aoPass.normalNode, null, "depth-normal diagnostic changes only the AO normal source");
const legacyAOFixture = { ensure: makeAOWrapper(value => value, null, colorOutputToken, false, "final", null, null, false, true, normalView)(function () {
  this.aoPass = {}; this.scenePass = { setMRT(value) { assert.ok(value.normal === normalView && value.output === colorOutputToken); } };
}) };
legacyAOFixture.ensure();
let normalBlend;
const materialBlendFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, false, false, null, true, THREE)(function () {
  this.aoPass = {}; this.scenePass = { getMRT: () => ({ setBlendMode(name, blend) { assert.equal(name, "normal"); normalBlend = blend; } }) };
}) };
materialBlendFixture.ensure();
assert.equal(normalBlend.blending, THREE.MaterialBlending);

function assertCompatibleAONormals(root) {
  root.traverse(object => {
    for (const material of [].concat(object.material || [])) {
      if (material.depthWrite || !material.colorWrite) continue;
      assert.equal(material.transparent, true, "visible non-depth writers need alpha blending on compatibility GPUs");
      assert.equal(material.premultipliedAlpha, false, "a premultiplied normal needs separate coverage handling");
      assert.ok([THREE.NormalBlending, THREE.AdditiveBlending].includes(material.blending), "new blend modes need AO compatibility coverage");
      const blend = WebGPUPipelineUtils.prototype._getBlending.call({}, material);
      assert.equal(blend.color.srcFactor, "src-alpha");
      assert.ok(["one", "one-minus-src-alpha"].includes(blend.color.dstFactor));
      assert.equal(blend.color.operation, "add", "alpha zero preserves the destination normal in compatibility mode");
    }
  });
}
for (const mode of ["raw", "color"]) {
  const rawToken = {}, colorToken = {};
  const wrap = makeAOWrapper(() => { throw new Error("diagnostic changed material normals"); }, geometryNormalToken, colorOutputToken, false, mode,
    value => value, value => value);
  const target = { ensure: wrap(function () {
    this.aoPass = { getTextureNode: () => ({ r: rawToken }) };
    this.scenePass = { getTextureNode: () => colorToken };
    this.pipeline = {};
  }) };
  target.ensure();
  assert.ok(target.pipeline.outputNode === (mode === "raw" ? rawToken : colorToken));
  assert.equal(target.pipeline.needsUpdate, true);
}
const waitSource = graphicsFixture.slice(graphicsFixture.indexOf("function waitForReviewFrame("), graphicsFixture.indexOf("const stillMove"));
let timeoutCallback, timeoutDelay, frameCallback, cleared = 0, cancelled = 0, serial = 3;
const makeWait = new Function("setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "getSerial", "validateExhaustView",
  waitSource.replaceAll("sceneSerial", "getSerial()") + "; return waitForReviewFrame;");
for (const pose of ["hip-hard-peak", "hip-hard-recovery"]) {
  const guard = new Function("THREE", "select", `${settleReviewSource}; poseReview={requested:"aim"}; return validateExhaustView;`)(THREE,
    name => ({ value: name === "view" ? "waist-low-front" : pose }));
  let started = false;
  const fail = () => { started = true; };
  assert.throws(() => makeWait(fail, fail, fail, fail, () => 3, guard)(3, () => true), /successfully staged/);
  assert.equal(started, false);
}
const waitReview = makeWait((callback, delay) => { timeoutCallback = callback; timeoutDelay = delay; return 9; }, () => cleared++,
  callback => { frameCallback = callback; return 7; }, () => cancelled++, () => serial, capture => assert.equal(capture, true));
assert.throws(() => makeWait(() => { throw Error("must not start timer"); }, () => {}, () => {}, () => {}, () => serial,
  () => { throw Error("unsupported capture"); })(3, () => true), /unsupported capture/);
const stalledWait = waitReview(3, () => false);
assert.equal(timeoutDelay, 20000);
timeoutCallback();
await assert.rejects(stalledWait, /timed out/, "a suspended rAF cannot prevent the independent timeout");
assert.equal(cleared, 1); assert.equal(cancelled, 1);
await waitReview(3, () => true);
assert.equal(cleared, 2); assert.equal(cancelled, 2);
const interruptedWait = waitReview(3, () => false);
serial = 4; frameCallback();
await assert.rejects(interruptedWait, /scene change/);
const coldResetWait = waitReview(4, () => false, 60000);
assert.equal(timeoutDelay, 60000, "cold lifecycle readiness can request a longer bounded window");
timeoutCallback();
await assert.rejects(coldResetWait, /60 seconds/, "a stalled reset still terminates independently of rAF");
const decoySampleStart = graphicsFixture.indexOf("    const sample = async (cycle, phase) => {", graphicsFixture.indexOf("async function runDecoyReview"));
const decoySampleSource = graphicsFixture.slice(decoySampleStart, graphicsFixture.indexOf("    if (overlap) {", decoySampleStart));
const decoyWaits = [], decoySampleReview = { samples: [] };
const decoySample = new Function("game", "waitForReviewFrame", "decoyReview", "renderedFrames", "serial", "pipelineCreations", "errorCount",
  decoySampleSource + "; return sample;")({ settings: { graphics: "high" }, decoys: [], renderer: { info: { memory: {} } }, renderPipeline: { direct: false } },
  async (scene, ready, timeout) => { assert.equal(scene, 4); assert.equal(ready(), false); decoyWaits.push(timeout); }, decoySampleReview, 0, 4, 0, 0);
await decoySample(-1, "baseline"); await decoySample(0, "spawned"); await decoySample(0, "removed"); await decoySample(3, "cleanup");
assert.deepEqual(decoyWaits, [60000, 20000, 20000, 20000], "only cold decoy baseline gets reset readiness budget; warmed phases keep their original deadline");
assert.deepEqual(decoySampleReview.samples.map(sample => sample.phase), ["baseline", "spawned", "removed", "cleanup"]);

const botTraceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceBotMethod("), graphicsFixture.indexOf("if (traceFrames) for"));
let botTraceClock = 0, botTraceContext = null, botTraceCpu = {}, projectileTraceActive = false;
const traceBotMethod = new Function("performance", "getBot", "getCpu", "getProjectiles", botTraceSource.replaceAll("activeTraceBot", "getBot()").replaceAll("activeTraceProjectiles", "getProjectiles()").replaceAll("cpu.botCalls", "getCpu().botCalls").replaceAll("cpu[", "getCpu()[") + "; return traceBotMethod;")(
  { now: () => ++botTraceClock }, () => botTraceContext, () => botTraceCpu, () => projectileTraceActive);
const botTraceTarget = { value: 4, run(n) { return this.value + n; } };
assert.throws(() => traceBotMethod(botTraceTarget, "missing", "test"), /Unknown trace method: test.missing/, "stale hook names must fail visibly rather than silently lose attribution");
traceBotMethod(botTraceTarget, "run", "test");
assert.equal(botTraceTarget.run(3), 7);
assert.equal(botTraceClock, 0, "nested timing is inactive outside bot updates");
botTraceContext = { id: "p3", weapon: { id: "blaster" } };
for (let i = 0; i < 30; i++) assert.equal(botTraceTarget.run(i), 4 + i);
assert.deepEqual(botTraceCpu.botCalls["test.run"], { calls: 30, totalMs: 30, maxMs: 1, bot: "p3", weapon: "blaster" });
const botTraceError = new Error("bot call failed");
botTraceTarget.fail = () => { throw botTraceError; };
traceBotMethod(botTraceTarget, "fail", "test");
assert.throws(() => botTraceTarget.fail(), error => error === botTraceError);
assert.equal(botTraceCpu.botCalls["test.fail"].calls, 1);
botTraceCpu = {};
botTraceTarget.run(1);
assert.equal(botTraceCpu.botCalls["test.run"].calls, 1, "nested counters follow the current frame rather than retaining old state");
const queryPoint = new THREE.Vector3(1, 2, 3);
const queryTrace = { resolve(point) { point.x = 8; }, ropeObstacle(point) { return point; } };
traceBotMethod(queryTrace, "resolve", "world"); traceBotMethod(queryTrace, "ropeObstacle", "world");
queryTrace.resolve(queryPoint);
assert.equal(botTraceCpu.botCalls["world.resolve"].inputs, undefined, "mutating query coordinates cannot be mislabeled as inputs");
queryTrace.ropeObstacle(queryPoint); queryPoint.set(0, 0, 0);
assert.deepEqual(botTraceCpu.botCalls["world.ropeObstacle"].inputs, [[8, 2, 3]], "read-only query evidence owns numeric copies");
const ropeTrace = { updateGrapple() {} }, ropeTraceBot = { grapple: { wraps: Array.from({ length: 10 }, () => new THREE.Vector3(1, 2, 3)) } };
traceBotMethod(ropeTrace, "updateGrapple", "game"); ropeTrace.updateGrapple(ropeTraceBot);
ropeTraceBot.grapple.wraps[0].set(0, 0, 0);
assert.equal(botTraceCpu.botCalls["game.updateGrapple"].wraps.length, 8);
assert.deepEqual(botTraceCpu.botCalls["game.updateGrapple"].wraps[0], [1, 2, 3], "grapple evidence cannot retain mutable vectors");
botTraceContext = null; projectileTraceActive = true;
assert.equal(botTraceTarget.run(8), 12);
assert.deepEqual(botTraceCpu.projectileCalls["test.run"], { calls: 1, totalMs: 1, maxMs: 1, bot: null, weapon: null }, "projectile-loop timing must not be mislabeled as a bot update");
assert.throws(() => botTraceTarget.fail(), error => error === botTraceError);
assert.equal(botTraceCpu.projectileCalls["test.fail"].calls, 1);
const shotTrace = { damagePlayer() { return 7; } }, shotWeapon = { id: "rocket_launcher" };
traceBotMethod(shotTrace, "damagePlayer", "game");
assert.equal(shotTrace.damagePlayer({}, 10, {}, {}, shotWeapon), 7);
shotWeapon.id = "changed";
assert.equal(botTraceCpu.projectileCalls["game.damagePlayer"].weapon, "rocket_launcher", "max projectile attribution owns the relevant weapon label");
projectileTraceActive = false;
const stoppedTraceClock = botTraceClock;
botTraceTarget.run(1);
assert.equal(botTraceClock, stoppedTraceClock, "combat tracing stops outside both update phases");

const traceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceStartupMethod("), graphicsFixture.indexOf("if (traceStartup) {"));
assert.ok(graphicsFixture.includes("function createStartupIdentityRecorder("), "startup diagnostics distinguish actual cache keys from shader source identities");
const identitySource = graphicsFixture.slice(graphicsFixture.indexOf("function createStartupIdentityRecorder("), graphicsFixture.indexOf("const startupIdentityRecorder ="));
let clearedSources = 0;
class SourceMap extends Map { clear() { clearedSources += this.size; super.clear(); } }
const identityRecorder = new Function("Map", `${identitySource}; return createStartupIdentityRecorder();`)(SourceMap);
const identityObject = { initialCacheKey: 1, context: { id: 2 }, material: { type: "MeshStandardMaterial", isShadowPassMaterial: false },
  object: { id: 3, name: "Test slats", type: "Mesh", isInstancedMesh: true, count: 4, receiveShadow: false },
  getGeometryCacheKey: () => "position,3,uv,2,index," };
const identityBuilder = { material: identityObject.material, vertexShader: "vertex-a", fragmentShader: "fragment-a" };
identityRecorder.build(identityBuilder, identityObject);
identityObject.initialCacheKey = 4; identityRecorder.build(identityBuilder, identityObject);
identityObject.initialCacheKey = 1; identityRecorder.build(identityBuilder, identityObject);
identityRecorder.program({ code: "fragment-a", stage: "fragment" });
identityRecorder.program({ code: "fragment-b", stage: "fragment" });
assert.deepEqual(identityRecorder.state.builds.map(entry => entry.key), [1, 4, 1]);
assert.deepEqual(identityRecorder.state.builds.map(entry => entry.sources), [[1, 2], [1, 2], [1, 2]], "distinct/repeated keys retain identical exact shader IDs");
assert.deepEqual(identityRecorder.state.programs.map(entry => entry.source), [2, 3], "backend programs share the same exact source identity space");
assert.equal(identityRecorder.state.builds[0].instanced, true);
assert.equal(identityRecorder.state.builds[0].geometryKey, identityObject.getGeometryCacheKey(), "record the pinned renderer's full layout discriminator");
identityRecorder.build({ ...identityBuilder, material: { type: "NodeMaterial" } }, identityObject);
assert.equal(identityRecorder.state.builds[3].material, "NodeMaterial", "successful fallback builds report the actual material, not the original request");
assert.equal(identityRecorder.state.builds[3].requestedMaterial, "MeshStandardMaterial");
identityObject.object.name = "changed"; identityBuilder.fragmentShader = "changed";
assert.equal(identityRecorder.state.builds[0].object, "Test slats", "records retain primitives, never live scene objects");
assert.ok(!JSON.stringify(identityRecorder.state).includes("vertex-a"), "shader text is not copied into DOM metrics");
for (let i = 0; i < 600; i++) {
  identityRecorder.build({ material: identityObject.material, vertexShader: `vertex-${i}`, fragmentShader: `fragment-${i}` }, identityObject);
  identityRecorder.program({ code: `other-${i}`, stage: "vertex" });
}
assert.equal(identityRecorder.state.builds.length, 256);
assert.equal(identityRecorder.state.programs.length, 256);
assert.ok(identityRecorder.state.dropped > 0);
identityRecorder.close(); identityRecorder.close();
assert.equal(clearedSources, 512, "bounded source strings are released once capture finishes");
const closedIdentity = JSON.stringify(identityRecorder.state);
identityRecorder.build(identityBuilder, identityObject); identityRecorder.program({ code: "after", stage: "fragment" });
assert.equal(JSON.stringify(identityRecorder.state), closedIdentity, "closed captures cannot retain more sources");
let traceClock = 0;
const startupCalls = {};
const traceMethod = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, startupCalls);
const tracedTarget = { offset: 4, draw(value) { return this.offset + value; } };
traceMethod(tracedTarget, "draw", "test");
for (let i = 0; i < 20; i++) assert.equal(tracedTarget.draw(i), i + 4, "timing preserves receiver, arguments and return values");
assert.equal(startupCalls["test.draw"].calls, 20, "startup totals include calls beyond the old twelve-pipeline sample");
assert.equal(startupCalls["test.draw"].totalMs, 20);
assert.equal(startupCalls["test.draw"].slowest.length, 8, "startup detail retention stays bounded");
const shaderTarget = { object: { name: "Fighter thruster pair" }, material: { type: "MeshBasicMaterial" }, build() { return this.object; } };
traceMethod(shaderTarget, "build", "nodeBuilder");
assert.ok(shaderTarget.build() === shaderTarget.object);
assert.equal(startupCalls["nodeBuilder.build"].calls, 1, "actual shader builds are counted separately from cache lookups");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].object, "Fighter thruster pair");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].material, "MeshBasicMaterial");
for (let i = 0; i < 20; i++) shaderTarget.build();
assert.deepEqual(startupCalls["nodeBuilder.build"].thrusters, { calls: 21, totalMs: 21, maxMs: 1 }, "target aggregate counts every build, not just the top eight");
assert.equal(startupCalls["nodeBuilder.build"].slowest.length, 8);
shaderTarget.object = { name: "Other mesh" }; shaderTarget.build();
assert.equal(startupCalls["nodeBuilder.build"].thrusters.calls, 21, "other objects cannot inflate target attribution");
const expectedFailure = new Error("original failure");
tracedTarget.fail = () => { throw expectedFailure; };
traceMethod(tracedTarget, "fail", "test");
assert.throws(() => tracedTarget.fail(), error => error === expectedFailure, "instrumentation cannot swallow rendering errors");
assert.equal(startupCalls["test.fail"].calls, 1);
const inactiveTrace = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now() { throw new Error("inactive timing"); } }, null);
const inactiveTarget = { draw: value => value };
inactiveTrace(inactiveTarget, "draw", "test");
assert.equal(inactiveTarget.draw(7), 7, "timing stops after the bounded startup capture");
const capturedKinds = [];
const identityHooks = { build: (builder, object) => capturedKinds.push(["build", builder, object]), program: program => capturedKinds.push(["program", program]) };
const identityTrace = new Function("performance", "startupCalls", "startupIdentityRecorder", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, {}, identityHooks);
const identityBuildTarget = { build: () => 7 };
identityTrace(identityBuildTarget, "build", "nodeBuilder", identityObject);
assert.equal(identityBuildTarget.build(), 7);
assert.ok(capturedKinds[0][1] === identityBuildTarget && capturedKinds[0][2] === identityObject);
const identityBackend = { createProgram: program => program, fail() { throw expectedFailure; } };
identityTrace(identityBackend, "createProgram", "backend");
const sourceProgram = { stage: "vertex", code: "source" };
assert.ok(identityBackend.createProgram(sourceProgram) === sourceProgram);
assert.ok(capturedKinds[1][1] === sourceProgram);
identityTrace(identityBackend, "fail", "nodeBuilder", identityObject);
assert.throws(() => identityBackend.fail(), error => error === expectedFailure);
assert.equal(capturedKinds.length, 2, "failed builds never become successful source-identity evidence");
const tracedFrameAt = graphicsFixture.indexOf("    frame(time);");
const finishStartupSource = graphicsFixture.slice(graphicsFixture.lastIndexOf("  try {", tracedFrameAt), graphicsFixture.indexOf("  renderedFrames++;", tracedFrameAt));
const finishStartup = new Function("frame", "startupTrace", "startupIdentityRecorder", `const time=0, now=0, performance={now:()=>1}, game={renderer:{info:{render:{},memory:{}}}}; let startupCalls={}; ${finishStartupSource}; return startupCalls;`);
let startupClosures = 0;
assert.equal(finishStartup(() => {}, [{}, {}], { close: () => startupClosures++ }), null);
assert.equal(startupClosures, 1, "third successful frame releases transient shader-source identities");
assert.throws(() => finishStartup(() => { throw expectedFailure; }, [], { close: () => startupClosures++ }), error => error === expectedFailure);
assert.equal(startupClosures, 2, "render failure releases transient identities without swallowing the original error");
const destroyReviewSource = graphicsFixture.slice(graphicsFixture.indexOf("function destroyReviewCovers("), graphicsFixture.indexOf('select("destroy-cover").onclick'));
for (const all of [false, true]) {
  const items = [{ x: 1, z: 2, baseY: 0, h: 4 }, { x: 2, z: 3, baseY: 1, h: 6 }];
  const reviewWorld = { destructibles: [...items], detachedDestructibleMeshes: [], districtIndexAt: x => x,
    destroy(point, radius, context) {
      assert.equal(radius, .001); assert.equal(context.partId, "qa-cover-only");
      const item = this.destructibles.find(item => item.x === point.x);
      assert.equal(point.y, item.baseY + item.h / 2);
      this.detachedDestructibleMeshes.push(item); this.destructibles.splice(this.destructibles.indexOf(item), 1);
    } };
  const review = new Function("THREE", "game", "select", `let coverDestruction, sceneSerial=2; ${destroyReviewSource}; return {run:destroyReviewCovers,state:()=>coverDestruction};`)(THREE, { world: reviewWorld }, () => ({ value: "cover-shield" }));
  assert.equal(review.run(all), all ? 2 : 1);
  assert.deepEqual(review.state().targets, all ? [[1, 2], [2, 3]] : [[1, 2]]);
  items[0].x = 99; assert.equal(review.state().targets[0][0], 1, "destruction evidence keeps owned numeric positions");
}

for (const [seed, expected] of [
  ["GRAPHICS-QA-structure", ["3fcaf9d84ec4401241287fef3d3288259e9493dd3171fc3d3bd7ccf8cec086ec", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "183e544aca3ae4ebc7b6ada691287b7adfd03daeab38bd51a0c6056b5153a381"]],
  ["FOUNDRY111-ground", ["8464cd7f25660d46d3c91713d3f67e7a41d2a473a713646b75f8c02a6c5ec38b", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "0ad986808bd82a92fd56401c5747bee252f9a867a786b82e462f4839fd7ca2bf"]]
]) {
  const maps = surfaceTextures(seed, 4);
  assert.deepEqual(maps.map(map => createHash("sha256").update(map.image.data).digest("hex")), expected, "height-field reuse preserves every texture byte");
  maps.forEach(map => map.dispose());
}

const coverMaps = surfaceTextures("COVER-TEST", 4, true);
const normalPixel = (x, y) => coverMaps[1].image.data[(y * 256 + x) * 4];
assert.equal(normalPixel(2, 24), 127, "machined plate is flat two texels from a narrow seam, not broadly rounded");
assert.equal(normalPixel(64, 24), 127, "cover has two large plates per axis, not a four-cell upholstered grid");
assert.ok(Math.abs(normalPixel(128, 24) - 127) > 15, "the narrow inter-plate seam remains visibly recessed");
for (const x of [20, 107, 148, 235]) for (const y of [20, 107, 148, 235]) {
  assert.ok(coverMaps[0].image.data[(y * 256 + x) * 4] < 170, "recessed fasteners stay inside the visible cover UV crop");
}
assert.deepEqual(coverMaps.map(map => map.image.width), [256, 256, 256]);
assert.deepEqual(coverMaps.map(map => map.colorSpace), [THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.NoColorSpace]);
coverMaps.forEach(map => map.dispose());

const plate = structuralPanelGeometry();
plate.computeBoundingBox();
assert.deepEqual(plate.boundingBox.min.toArray(), [-.5, -.5, -.5]);
assert.deepEqual(plate.boundingBox.max.toArray(), [.5, .5, .5]);
assert.ok(plate.index.count / 3 <= 108, "macro plates have a fixed small triangle budget");
assert.ok(Math.min(...plate.attributes.color.array) < .4, "frames and inset panels have distinct values");
const pillarPlate = structuralPanelGeometry(.25);
assert.equal(Math.max(...pillarPlate.attributes.uv.array), .25, "pillar service panels use a quarter of the previous repeat cadence");
for (const name of ["position", "normal", "color"]) assert.ok(
  Buffer.from(pillarPlate.attributes[name].array.buffer).equals(Buffer.from(plate.attributes[name].array.buffer)),
  "pillar UV cadence cannot change geometry, normals or frame values");
pillarPlate.dispose();
const route = new THREE.Mesh(structuralRouteGeometry(), new THREE.MeshBasicMaterial());
route.updateMatrixWorld();
const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
assert.equal(ray.intersectObject(route).length, 0, "route lighting leaves the deck material visible through its center");
route.geometry.dispose(); route.material.dispose(); plate.dispose();

const rendererStub = nativeWebGPU => ({
  backend: { isWebGPUBackend: nativeWebGPU }, xr: { enabled: false },
  getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
  getRenderObjectFunction: () => null, getPixelRatio: () => 1, getMRT: () => null,
  getClearColor: target => target.set(0), getClearAlpha: () => 1, getScissorTest: () => false
});
// Inspect the real TSL graph, including the lazy branch's real depth sampler.
for (const alpha of [0, 1]) {
  const previousStack = getCurrentStack(), shaderStack = stack();
  try {
    setCurrentStack(shaderStack);
    const coord = vec2(.5), stored = vec4(.2, .3, .4, alpha);
    const depth = { value: new THREE.DepthTexture(4, 4) }, inverse = uniform(new THREE.Matrix4());
    const sample = recoverInvalidAONormals({ sample(uv) { assert.ok(uv === coord); return stored; } }, depth, inverse);
    const result = sample.sample.shaderNode.jsFunc([coord]);
    const conditions = shaderStack.nodes.filter(node => node.constructor.name === "ConditionalNode");
    assert.equal(conditions.length, 1);
    const condition = conditions[0], operator = condition.condNode.node;
    assert.equal(operator.op, "<");
    assert.equal(operator.bNode.value, .5);
    assert.equal(operator.aNode.components, "w");
    assert.ok(operator.aNode.node.node === stored, "test the stored normal's alpha, not scene opacity");
    assert.equal(result.node.components, "xyz");
    assert.ok(result.node.node === operator.aNode.node, "valid normals keep their exact material RGB");
    assert.equal(condition.elseNode, null);
    const invalidStack = stack(); setCurrentStack(invalidStack);
    condition.ifNode.jsFunc();
    const assign = invalidStack.nodes.find(node => node.isAssignNode);
    assert.ok(assign.targetNode === result);
    assert.ok(assign.sourceNode.node.shaderNode === getNormalFromDepth.shaderNode);
    assert.deepEqual(assign.sourceNode.node.rawInputs, [coord, depth.value, inverse]);
    depth.value.dispose();
  } finally { setCurrentStack(previousStack); }
}
for (const compatibilityMode of [undefined, false, true]) {
  const renderer = rendererStub(true); renderer.backend.compatibilityMode = compatibilityMode;
  renderer.samples = compatibilityMode === true ? 0 : 4;
  const pipeline = new NeonRenderPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(pipeline.aoPass.normalNode === pipeline.scenePass.getTextureNode("normal"), compatibilityMode !== true,
    "only actual compatibility mode installs conditional recovery");
  assert.equal(renderer.samples, compatibilityMode === true ? 0 : 4, "normal recovery cannot change antialiasing");
  assert.equal(pipeline.scenePass.options.samples, undefined, "product leaves sample selection to the renderer");
  pipeline.dispose();
}
for (const nativeWebGPU of [true, false]) for (const quality of ["low", "medium", "high"]) {
  const pipeline = new NeonRenderPipeline(rendererStub(nativeWebGPU), new THREE.Scene(), new THREE.PerspectiveCamera(), { quality });
  assert.equal(Boolean(pipeline.pipeline), quality !== "low" && (!nativeWebGPU || quality === "high"));
  assert.equal(Boolean(pipeline.highLoadPipeline), nativeWebGPU && quality === "medium");
  assert.equal(Boolean(pipeline.aoPass), nativeWebGPU && quality === "high");
  pipeline.setQuality("high");
  if (nativeWebGPU) {
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("normal").blending, THREE.NormalBlending,
      "AO normals must preserve the opaque normal behind non-depth-writing decoration");
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("output").blending, THREE.MaterialBlending,
      "scene color keeps the original per-material blend modes");
    const makeNormal = pipeline.scenePass.getMRT().get("normal").node.shaderNode.jsFunc;
    for (const depthWrite of [true, false]) for (const transparent of [true, false]) for (const opacity of [0, .11, 1]) {
      const normal = makeNormal([], { material: { depthWrite, transparent, opacity } }).node;
      assert.ok(normal.nodes[0] === normalView, "solid surface normal mapping is preserved");
      assert.equal(normal.nodes[1].value, Number(depthWrite), "AO normal coverage follows depth writes, not opacity or color blend mode");
    }
    assert.deepEqual([pipeline.aoPass.resolutionScale, pipeline.aoPass.samples.value, pipeline.aoPass.radius.value,
      pipeline.aoPass.thickness.value, pipeline.aoPass.distanceExponent.value, pipeline.aoPass.distanceFallOff.value],
      [.5, 16, 1.6, 2.2, 1.35, .7], "depth-matched normals do not reduce AO quality");
  }
  const full = pipeline.pipeline;
  pipeline.setQuality("medium");
  const balanced = pipeline.highLoadPipeline;
  for (let i = 0; i < 5; i++) for (const level of ["low", "high", "medium"]) pipeline.setQuality(level);
  assert.ok(pipeline.pipeline === full, "tier toggles reuse the full graph without recompiling it");
  assert.ok(pipeline.highLoadPipeline === balanced, "tier toggles reuse the balanced graph");
  pipeline.dispose(); pipeline.dispose();
  assert.equal(pipeline.pipeline, null);
  assert.equal(pipeline.highLoadPipeline, null);
}

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const ropeMaterialSource = main.slice(main.indexOf("    const ropeMaterial ="), main.indexOf("    const line = new Line2"));
const makeRopeMaterial = new Function("THREE", "materialOpacity", "player", `${ropeMaterialSource}; return ropeMaterial;`);
for (const isBot of [false, true]) {
  const material = makeRopeMaterial(THREE, materialOpacity, { accent: 0x6ff6ff, isBot });
  const observer = new NodeMaterialObserver({ material, object: {}, context: {} });
  // Two already-initialized, otherwise unchanged ropes share a builder monitor.
  // The second must still update bindings when their shared viewport copy resized.
  observer.firstInitialization = () => false;
  observer.getLights = () => [];
  observer.equals = () => true;
  const object = { object: {}, bundle: null }, frame = { renderId: 42, renderer: { getMRT: () => null } };
  assert.equal(observer.needsRefresh(object, frame), true);
  assert.equal(observer.needsRefresh(object, frame), true, "every rope refreshes its viewport-copy binding, including unchanged second ropes");
  assert.ok(material.opacityNode === materialOpacity, "explicit node is the original built-in opacity expression");
  assert.deepEqual([material.opacity, material.linewidth, material.transparent, material.depthWrite, material.toneMapped, material.alphaToCoverage],
    [isBot ? .64 : .92, isBot ? 1.55 : 2.35, true, false, false, true]);
  material.dispose();
}
const frameSource = main.slice(main.indexOf("  frame(time) {"), main.indexOf("  update(dt, realDt = dt) {"));
const firstFrameEvents = [];
const frameMethod = new Function("performance", `return ({${frameSource}}).frame`)({
  mark: name => firstFrameEvents.push(name), measure: name => firstFrameEvents.push(name)
});
const firstFrameState = {
  state: "play", paused: true, hideMatchLoadingAfterFrame: true,
  commitResize() {}, timer: { update() {}, getDelta: () => 1 / 60 },
  input: { tapped: () => false, endFrame() {} }, renderScene: () => false,
  setMatchLoading: value => firstFrameEvents.push(value)
};
frameMethod.call(firstFrameState, 100);
assert.equal(firstFrameState.hideMatchLoadingAfterFrame, true, "a skipped frame cannot dismiss the loader");
assert.equal(firstFrameEvents.length, 0);
firstFrameState.renderScene = () => true;
frameMethod.call(firstFrameState, 116);
assert.deepEqual(firstFrameEvents, ["blaster-arena-first-frame", "blaster-arena-first-render", false]);
frameMethod.call(firstFrameState, 133);
assert.equal(firstFrameEvents.length, 3, "first-render completion is emitted only once per match");
const resize = main.slice(main.indexOf("  commitResize() {"), main.indexOf("  applyGraphicsSettings() {"));
const commitResize = new Function(`return ({${resize}}).commitResize`)();
const submitted = [], renderer = { setDrawingBufferSize: (...args) => submitted.push(args) };
const resizeState = { renderer, pendingResize: { width: 1280, height: 720, pixelRatio: 1.65 } };
commitResize.call(resizeState);
resizeState.pendingResize = { width: 1280, height: 720, pixelRatio: 1.65 };
commitResize.call(resizeState);
assert.equal(submitted.length, 1, "same-size events never recreate framebuffer attachments");
resizeState.pendingResize = { width: 390, height: 844, pixelRatio: 1.3 };
commitResize.call(resizeState);
assert.deepEqual(submitted[1], [390, 844, 1.3]);
const qualityEvents = [];
Object.assign(resizeState, {
  pendingGraphics: true, graphics: graphicsProfile("low"),
  renderer: { ...renderer, getMaxAnisotropy: () => 8 },
  renderPipeline: { setQuality: level => qualityEvents.push(level) },
  world: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  combatVisuals: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  keyLight: { shadow: { mapSize: new THREE.Vector2(4096, 4096), map: { dispose: () => qualityEvents.push("dispose-shadow") } } }
});
commitResize.call(resizeState);
assert.deepEqual(qualityEvents, ["low", "low", "low", "dispose-shadow"]);
assert.equal(resizeState.keyLight.shadow.map, null);
commitResize.call(resizeState);
assert.equal(qualityEvents.length, 4, "graphics resources change only once at the frame boundary");

for (const [level, shadowMapSize, anisotropy] of [["low", 1024, 4], ["medium", 2048, 8], ["high", 4096, 16]]) {
  const profile = graphicsProfile(level, false, 3);
  assert.equal(profile.shadowMapSize, shadowMapSize);
  assert.equal(profile.anisotropy, anisotropy);
  assert.deepEqual(graphicsProfile(level, true, 3), profile, "touch input never silently lowers the selected tier");
  const effects = new CombatVisuals(new THREE.Scene(), { quality: profile.combatQuality });
  effects.setGraphicsProfile(profile);
  assert.equal(effects.rings.length, 128, "all tiers retain enough core impacts for the 112-hit maximum-player volley");
  assert.equal(effects.tracers.length, 128);
  assert.equal(effects.flashes.length, 64);
  const gameplayRandom = Math.random;
  let gameplayRandomCalls = 0;
  Math.random = () => { gameplayRandomCalls++; return .5; };
  try {
    for (const weapon of Object.values(WEAPONS)) {
      effects.impact(new THREE.Vector3(), weapon, { color: 0x129dba, accent: 0x6ff6ff }, { explosive: Boolean(weapon.radius) });
    }
    effects.burst(new THREE.Vector3(), 0x6ff6ff, 16);
    effects.blood(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  } finally { Math.random = gameplayRandom; }
  assert.equal(gameplayRandomCalls, 0, "visual density never consumes gameplay randomness");
  effects.dispose();
}
const scene = new THREE.Scene();
const createOnlineSource = main.slice(main.indexOf("  createOnlineFighter(data, position) {"), main.indexOf("  async startMatch("));
const createOnlineFighter = new Function("Fighter", `return ({${createOnlineSource}}).createOnlineFighter`)(Fighter);
const restoredWeapon = createOnlineFighter.call({ scene, controlsNetworkPlayer: () => true }, {
  id: "cache-online", name: "QA", color: 0x129dba, accent: 0x6ff6ff,
  loadout: ["blaster", "rocket_launcher"], slotIndex: 1, health: 37, ammo: { rocket_launcher: 1 }
}, new THREE.Vector3());
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "authoritative nonzero initial slot restores the corresponding model");
assert.equal(restoredWeapon.health, 37); assert.equal(restoredWeapon.ammo.rocket_launcher, 1);
const reconnectSource = main.slice(main.indexOf("  handleNetworkReconnect(welcome) {"), main.indexOf("  clearTransientNetworkCombat() {"));
const reconnect = new Function("THREE", "uniquePlayersById", `return ({${reconnectSource}}).handleNetworkReconnect`)(THREE, players => players);
restoredWeapon.switchSlot(0);
restoredWeapon.reloadTimer = .7; restoredWeapon.reloadWeaponId = "blaster";
reconnect.call({
  state: "play", world: {}, multiplayer: { playerId: restoredWeapon.id }, players: [restoredWeapon],
  hideNetworkReconnecting() {}, clearTransientNetworkCombat() {}, syncOnlineRoster() {}, updateCamera() {}
}, { players: [{ id: restoredWeapon.id, slotIndex: 1, health: 37, alive: true, ammo: { rocket_launcher: 1 } }] });
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "in-place reconnect restores the authoritative weapon visual");
assert.deepEqual([restoredWeapon.health, restoredWeapon.ammo.rocket_launcher, restoredWeapon.reloadTimer, restoredWeapon.reloadWeaponId], [37, 1, .7, "blaster"]);
restoredWeapon.dispose();
// Matrices/colors are captured from the full-capacity implementation before
// trimming dead draw tails. Stable slots keep transparent blending order intact.
const effectDigests = [];
const effectGroups = [
  ["flashes", "flashOuter", "flashInner"], ["tracers", "tracerOuter", "tracerInner"],
  ["rings", "ringOuter", "ringInner"], ["sparks", "sparkLayer"], ["bloodDecals", "bloodLayer"]
];
for (const quality of [.5, .75, 1]) {
  const effects = new CombatVisuals(new THREE.Scene(), { quality });
  assertCompatibleAONormals(effects.group);
  const digest = createHash("sha256");
  const start = new THREE.Vector3(1, 2, 3), end = new THREE.Vector3(5, 6, 7), normal = new THREE.Vector3(0, 1, 0);
  const owner = { color: 0x129dba, accent: 0x6ff6ff, aim: normal, muzzlePoint: target => target.copy(start) };
  for (let volley = 0; volley < 3; volley++) for (const weapon of Object.values(WEAPONS)) {
    effects.muzzle(owner, weapon); effects.tracer(start, end, weapon, owner);
    effects.impact(end, weapon, owner, { explosive: Boolean(weapon.radius) }); effects.blood(end, normal);
    for (const dt of [.008, .016, .09, .4]) {
      effects.update(dt);
      for (const [slots, ...names] of effectGroups) {
        const count = effects[slots].findLastIndex(slot => slot.life > 0) + 1;
        for (const name of names) assert.equal(effects[name].count, count, `${name} must retain every live slot through wrap/expiry`);
      }
      for (const [, ...names] of effectGroups) for (const name of names) {
        digest.update(new Uint8Array(effects[name].instanceMatrix.array.buffer));
        digest.update(new Uint8Array(effects[name].instanceColor.array.buffer));
      }
    }
  }
  effectDigests.push(digest.digest("hex"));
  for (const [slots] of effectGroups) {
    const pool = effects[slots];
    pool.forEach(slot => { slot.life = 0; });
    pool[0].life = .05; pool.at(-1).life = .01;
  }
  for (const [dt, bound] of [[.008, "full"], [.008, 1], [.05, 0], [.01, 0]]) {
    effects.update(dt);
    for (const [slots, ...names] of effectGroups) for (const name of names) {
      assert.equal(effects[name].count, bound === "full" ? effects[slots].length : bound, "sparse wrap retains the last slot until it expires, then keeps slot zero");
    }
  }
  effects.dispose();
}
assert.deepEqual(effectDigests, [
  "0210fb48d26f44d6745b45316c6f35b61c952e414de0e9ad78352308ef7279e4",
  "0f54f2d5a66f74c80741732d45bd2164a9ae59df2eb4c67b526163edbe1f5e77",
  "2a4ff06b7d57d1718b4a4ca63c6d3ccd0c8e5703ebe452b7a7fa50bf1fc6deaf"
], "all 47 weapons at all tiers retain byte-identical effect transforms and colours");
const emptyEffects = new CombatVisuals(new THREE.Scene());
for (const [, ...names] of effectGroups) for (const name of names) assert.equal(emptyEffects[name].count, 0, "countdown frames start with empty draw ranges");
emptyEffects.update(1 / 60);
assert.equal(emptyEffects.ringOuter.count, 0, "an empty impact pool must submit no triangles");
emptyEffects.dispose();
scene.environment = new THREE.Texture();
const lightingEnvironment = scene.environment;
const world = new ArenaWorld(scene, "GRAPHICS-QA");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.geometry)).size, 1, "all eight pads reuse one immutable housing");
assert.equal(world.boostPads[0].mesh.geometry.index.count / 3, 384, "housing triangle cost remains explicitly bounded");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.children[2].material.opacityNode)).size, 1,
  "all plumes must share one shader expression rather than compiling identical per-pad graphs");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.children[2].material.customProgramCacheKey())).size, 1);
assert.deepEqual(world.boostPads.map(pad => [...pad.position.toArray(), pad.strength]), [
  [-18, 0, -18, 24], [18, 0, 18, 24], [-66, 0, 22, 29], [66, 0, -22, 29],
  [-52, 15, -48, 26], [53, 15, 49, 26], [42, 31, -22, 27], [-42, 47, 30, 28]
], "boost artwork preserves all gameplay positions and launch strengths");
for (const pad of world.boostPads) {
  assert.equal(pad.radius, 2.5); assert.equal(pad.mesh.position.y, pad.position.y + .12);
  assert.equal(pad.mesh.material.transparent, false, "boost hardware is opaque, not a translucent light source");
  assert.equal(pad.mesh.material.emissiveIntensity, 0, "the body cannot compete with its inset emitters");
  pad.mesh.geometry.computeBoundingBox();
  const bounds = pad.mesh.geometry.boundingBox;
  assert.ok(Math.abs(bounds.min.y + .11) < 1e-6 && Math.abs(bounds.max.y - .11) < 1e-6);
  assert.ok(Math.abs(bounds.min.x + 2.5) < 1e-6 && Math.abs(bounds.max.x - 2.5) < 1e-6);
  const housingNormals = pad.mesh.geometry.attributes.normal;
  assert.ok(Array.from({ length: housingNormals.count }, (_, i) => Math.abs(housingNormals.getY(i)))
    .some(y => y > .1 && y < .99), "housing has an authored bevel between the flat top and cylindrical side");
  const [ring, arrows, plume] = pad.mesh.children;
  assert.equal(pad.mesh.children.length, 3, "material refinement adds no pad objects or light sources");
  assert.equal(ring.material.opacity, .38); assert.equal(arrows.material.opacity, .42);
  assert.equal(ring.material.blending, THREE.AdditiveBlending);
  assert.equal(plume.geometry.parameters.height, 3.4);
  assert.equal(plume.geometry.parameters.radiusTop, 1.55); assert.equal(plume.geometry.parameters.radiusBottom, 2.15);
  assert.equal(plume.material.depthWrite, false); assert.equal(plume.material.side, THREE.DoubleSide);
  assert.ok(plume.material.opacityNode?.isNode, "plume transparency fades continuously in its actual shader");
  const unwrap = node => node.isVarNode ? node.node : node;
  const opacity = unwrap(plume.material.opacityNode), inverse = unwrap(opacity.aNode), fade = unwrap(inverse.aNode);
  assert.equal(opacity.op, "*"); assert.equal(unwrap(opacity.bNode).value, .055, "lower lift cue keeps its original alpha");
  assert.equal(inverse.method, "oneMinus"); assert.equal(fade.method, "smoothstep");
  assert.equal(unwrap(fade.aNode).value, .5); assert.equal(unwrap(fade.bNode).value, 1);
  const heightUV = unwrap(fade.cNode);
  assert.equal(heightUV.components, "y"); assert.equal(unwrap(heightUV.node).getAttributeName(), "uv");
  const positions = plume.geometry.attributes.position, uvs = plume.geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) assert.equal(uvs.getY(i), positions.getY(i) > 0 ? 1 : 0,
    "actual cylinder UVs place full intensity at the base and zero at the upper rim");
  const pulse = world.pulsers.find(pulse => pulse.object === ring);
  assert.deepEqual([pulse.base, pulse.amplitude, pulse.speed, pulse.phase], [1, .055, 3.8, pad.position.x + pad.position.z]);
}
const triggerPad = world.boostPads[0], trigger = triggerPad.position;
assert.ok(world.boostAt(trigger) === triggerPad);
assert.equal(world.boostAt(trigger.clone().add(new THREE.Vector3(2.5, 0, 0))), undefined);
assert.equal(world.boostAt(trigger.clone().add(new THREE.Vector3(0, .35, 0))), undefined);
assertCompatibleAONormals(world.group);
const coverSource = readFileSync(new URL("../src/world.js", import.meta.url), "utf8");
const legacyLightGeometry = new Function("THREE", `${coverSource.slice(coverSource.indexOf("function coverLightGeometry("), coverSource.indexOf("function segmentCircle("))}; return coverLightGeometry;`)(THREE);
const legacyDecorateSource = coverSource.slice(coverSource.indexOf("  decorateBreakable("), coverSource.indexOf("  addBox(", coverSource.indexOf("  decorateBreakable(")))
  .replace(/^\s*if \(inset\) slats = bakeCoverSlats\(slats\);\r?\n/m, "");
const legacyDecorate = new Function("THREE", "coverLightGeometry", `return function ${legacyDecorateSource};`)(THREE, legacyLightGeometry);
const legacyCoverRoots = world.destructibles.map(obstacle => {
  const root = new THREE.Mesh(obstacle.mesh.geometry, obstacle.mesh.material);
  legacyDecorate.call(world, root, obstacle.x, obstacle.z, true); return root;
});
const legacyCoverLights = legacyCoverRoots.map(root => root.children.find(child => child.isInstancedMesh));
const coverLights = world.destructibles.map((obstacle, index) => obstacle.mesh.getObjectByName(legacyCoverLights[index].name));
assert.equal(coverLights.length, 34);
assert.equal(createHash("sha256").update(Buffer.concat(legacyCoverLights.map(mesh => Buffer.from(mesh.instanceMatrix.array.buffer)))).digest("hex"),
  "79e8a017067ce8ec1fed7ae87de457878322758c2d9d4c73c0128e90df5d8849", "symbol instances keep their authored positions, rotations and illuminated scale");
for (const [coverIndex, light] of legacyCoverLights.entries()) {
  const baked = coverLights[coverIndex], { geometry } = baked;
  assert.ok(baked.isMesh && !baked.isInstancedMesh, "opaque cover symbols use one locally baked mesh without object-specific instance bindings");
  assert.equal(geometry.index, null); assert.equal(geometry.attributes.position.count, 240);
  assert.ok(baked.material === light.material && baked.parent === world.destructibles[coverIndex].mesh);
  for (const flag of ["castShadow", "receiveShadow", "renderOrder", "frustumCulled", "visible"]) assert.equal(baked[flag], light[flag]);
  assert.equal(baked.layers.mask, light.layers.mask);
  assert.deepEqual(baked.matrix.toArray(), light.matrix.toArray());
  assert.deepEqual(geometry.boundingSphere, light.boundingSphere, "baked symbols retain the original conservative culling volume");
  const storedMatrix = new THREE.Matrix4(), storedNormal = new THREE.Matrix3(), point = new THREE.Vector3();
  for (let piece = 0; piece < 4; piece++) {
    light.getMatrixAt(piece, storedMatrix); storedNormal.getNormalMatrix(storedMatrix);
    for (let vertex = 0; vertex < light.geometry.attributes.position.count; vertex++) {
      const bakedIndex = piece * 60 + vertex;
      for (const name of ["position", "normal"]) {
        point.fromBufferAttribute(light.geometry.attributes[name], vertex);
        if (name === "position") point.applyMatrix4(storedMatrix); else point.applyNormalMatrix(storedNormal);
        const actual = new THREE.Vector3().fromBufferAttribute(geometry.attributes[name], bakedIndex);
        assert.ok(actual.distanceTo(point) < 3e-7, `${light.name}: stored Float32 transform and ${name} remain within rounding tolerance`);
        if (name === "position") assert.ok(actual.distanceTo(geometry.boundingSphere.center) <= geometry.boundingSphere.radius + 3e-7);
      }
      for (const name of ["uv", "color"]) {
        const before = light.geometry.attributes[name], after = geometry.attributes[name];
        for (let axis = 0; axis < before.itemSize; axis++) assert.equal(after.array[bakedIndex * before.itemSize + axis], before.array[vertex * before.itemSize + axis]);
      }
    }
  }
  const { position, normal, uv, color } = light.geometry.attributes;
  assert.equal((light.geometry.index?.count ?? position.count) / 3, 20, "closed light housing uses ten planar quads within its existing draw");
  assert.equal(light.count, 4);
  assert.equal(light.material.color.getHex(), 0xffffff, "vertex colors separate neutral housing from colored diffuser");
  assert.equal(light.material.emissiveIntensity, .3, "diffuser brightness is unchanged");
  assert.ok(light.material.emissiveMap === world.coverLightMask, "one shared mask keeps the neutral bezel unlit");
  const face = [];
  for (let i = 0; i < position.count; i++) if (uv.getX(i) > .5) {
    face.push(i);
    assert.ok(Math.abs(position.getZ(i) - .488) < 1e-6);
    assert.ok(Math.abs(normal.getZ(i) - 1) < 1e-6);
    assert.ok(Math.abs(Math.abs(position.getX(i)) - .445) < 1e-6 && Math.abs(Math.abs(position.getY(i)) - .445) < 1e-6, "colored face retains its exact old local bounds");
  }
  assert.equal(face.length, 6, "only the inset front diffuser emits light");
  for (let i = 0; i < position.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(color[axis](i), color[axis](i + 5), "bezel and diffuser colors never interpolate across a triangle");
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "light housing corners are planar without diagonal patches");
  }
}
const bakeSource = coverSource.slice(coverSource.indexOf("function bakeCoverSlats("), coverSource.indexOf("// Three owns and reuses"));
const temporaryBakes = new Map();
const actualBake = new Function("THREE", "mergeGeometries", `${bakeSource}; return bakeCoverSlats;`)(THREE, (pieces, groups) => {
  pieces.forEach(piece => { temporaryBakes.set(piece, 0); piece.addEventListener("dispose", () => temporaryBakes.set(piece, temporaryBakes.get(piece) + 1)); });
  return mergeGeometries(pieces, groups);
});
const bakeInput = new THREE.InstancedMesh(legacyCoverLights[0].geometry.clone(), legacyCoverLights[0].material.clone(), 4);
bakeInput.instanceMatrix.copy(legacyCoverLights[0].instanceMatrix); bakeInput.computeBoundingSphere();
let inputGeometryDisposals = 0, instanceDisposals = 0, bakeMaterialDisposals = 0;
bakeInput.geometry.addEventListener("dispose", () => inputGeometryDisposals++);
bakeInput.addEventListener("dispose", () => instanceDisposals++);
bakeInput.material.addEventListener("dispose", () => bakeMaterialDisposals++);
const bakeOutput = actualBake(bakeInput);
assert.equal(temporaryBakes.size, 4); assert.ok([...temporaryBakes.values()].every(count => count === 1));
assert.equal(inputGeometryDisposals, 1); assert.equal(instanceDisposals, 1);
assert.equal(bakeMaterialDisposals, 0, "baking cannot dispose the material still used by the new mesh and other covers");
bakeOutput.geometry.dispose(); bakeOutput.material.dispose();
for (const root of legacyCoverRoots) for (const child of root.children) { child.geometry.dispose(); child.dispose?.(); }
assert.ok(scene.backgroundNode?.isNode, "arena sky has a continuous horizon-to-zenith background");
assert.equal(scene.fog.density, .0044, "sky treatment cannot hide content with extra fog");
assert.ok(scene.environment === lightingEnvironment, "background must not replace the scene lighting environment");
for (const segment of world.structures.flatMap(structure => structure.segments)) {
  const rails = segment.instanceVisuals.filter(visual => visual.mesh.name === "Instanced pillar load rails");
  assert.equal(rails.length, 4, "each destructible module retains its four owned load rails");
  for (const rail of rails) for (const [axis, span] of [["x", segment.w], ["z", segment.d]]) {
    const outer = Math.abs(rail.offset[axis]) + rail.scale[axis] / 2;
    assert.ok(outer > span / 2 + .005, "pillar rails must be visible beyond the opaque body, not buried inside it");
    assert.ok(outer <= span / 2 + .07, "decorative rail clearance remains under seven centimetres; collision envelope is unchanged");
  }
}
const centralDeck = world.platforms.find(platform => platform.x === 0 && platform.z === 0 && platform.top === 15);
assert.equal(centralDeck.mesh.material.color.getHexString(), "162b3b", "walking surfaces keep a neutral slate base");
assert.ok(centralDeck.mesh.material.envMap === scene.environment, "deck reflections share the existing environment texture");
assert.equal(centralDeck.mesh.material.envMapIntensity, .24, "deck reflection tuning actually overrides scene intensity");
assert.ok(world.structuralBatchMeshes.find(mesh => mesh.name === "Instanced destructible platform decks").material.envMap === scene.environment);
for (const texture of world.textures) {
  if (texture === world.coverLightMask) {
    assert.deepEqual(Array.from(texture.image.data), [0, 0, 0, 255, 255, 255, 255, 255]);
    assert.equal(texture.minFilter, THREE.NearestFilter);
    assert.equal(texture.magFilter, THREE.NearestFilter);
    assert.equal(texture.generateMipmaps, false, "constant per-face emission lookup must not average the unlit and lit texels");
    continue;
  }
  assert.ok(texture.generateMipmaps, "procedural filtered textures must generate their mip chain");
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
}
assert.ok(world.panelTexture.image.width >= 256);
assert.equal(world.panelTexture.colorSpace, THREE.SRGBColorSpace);
assert.equal(world.panelNormal.colorSpace, THREE.NoColorSpace);
assert.equal(world.panelRoughness.colorSpace, THREE.NoColorSpace);
for (const level of ["low", "medium", "high", "low", "high"]) {
  world.setGraphicsProfile(graphicsProfile(level), 8);
  assert.equal(world.panelTexture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8));
  for (const texture of world.coverTextures) assert.equal(texture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8), "cover filtering follows every selected tier and device limit");
  assert.equal(world.structures.length, 20, "tier changes never alter structural/collision content");
}
const gripFighter = new Fighter(scene, { id: "grip-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15.01, 8));
const cacheFighter = new Fighter(scene, { id: "cache-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff },
  ["blaster", "minigun", "punch_glove", "fireball", "plasma_cannon"], new THREE.Vector3());
const cachedChildren = [];
for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  cachedChildren[slot] = [...cacheFighter.weaponGroup.children];
}
cacheFighter.switchSlot(0);
assert.ok(cacheFighter.weaponGroup.children[0] === cachedChildren[0][0], "returning to a selected weapon must reuse its existing visual resources");
const cachedResources = new Map();
const recordResource = resource => {
  if (!resource || resource.userData?.sharedFighterGeometry || cachedResources.has(resource)) return;
  cachedResources.set(resource, 0);
  resource.addEventListener("dispose", () => cachedResources.set(resource, cachedResources.get(resource) + 1));
};
for (const root of [cacheFighter.group, ...[...cacheFighter.weaponModels.values()].map(model => model.group)]) root.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
for (let cycle = 0; cycle < 3; cycle++) for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  assert.ok(cacheFighter.weaponGroup.children.every((child, i) => child === cachedChildren[slot][i]));
  assert.equal(cacheFighter.weaponModelId, cacheFighter.loadout[slot]);
  const activeObjects = new Set();
  cacheFighter.group.traverse(object => activeObjects.add(object));
  for (const [id, model] of cacheFighter.weaponModels) if (id !== cacheFighter.weaponModelId) {
    model.group.traverse(object => assert.ok(!activeObjects.has(object), "inactive cached weapons cannot be cloned into decoys"));
  }
}
assert.ok([...cachedResources.values()].every(count => count === 0), "switching never disposes a retained resource");
cacheFighter.loadout[0] = "rocket_launcher";
cacheFighter.switchSlot(0);
assert.equal(cacheFighter.weaponModelId, "rocket_launcher");
assert.equal(cacheFighter.weaponModels.has("blaster"), false, "removed loadout models are evicted");
cacheFighter.weaponGroup.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
cacheFighter.dispose();
assert.ok([...cachedResources.values()].every(count => count === 1), "all original active, inactive and evicted owned resources dispose exactly once");
assert.equal(cacheFighter.weaponModels.size, 0);
for (const id of Object.keys(WEAPONS)) {
  const alternate = id === "blaster" ? "machine_gun" : "blaster";
  const fighter = new Fighter(scene, { id: "cache-parity", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [id, alternate], new THREE.Vector3());
  const model = fighter.weaponModels.get(id), originalChildren = [...fighter.weaponGroup.children];
  const geometryHash = () => {
    const hash = createHash("sha256");
    fighter.weaponGroup.traverse(object => {
      for (const attribute of Object.values(object.geometry?.attributes || {})) hash.update(new Uint8Array(attribute.array.buffer));
    });
    return hash.digest("hex");
  };
  const before = geometryHash();
  fighter.weaponGlowMaterial.emissiveIntensity = 3;
  fighter.weaponSpinner?.rotateZ(.7);
  if (fighter.weaponPiston) fighter.weaponPiston.position.z += .3;
  fighter.switchSlot(1); fighter.switchSlot(0);
  assert.ok(fighter.weaponGroup.children.every((child, i) => child === originalChildren[i]));
  assert.equal(geometryHash(), before, `${id}: cached geometry is byte-identical`);
  assert.deepEqual(fighter.weaponGrip.toArray(), model.grip.toArray());
  assert.deepEqual(fighter.weaponSupportGrip.toArray(), model.supportGrip.toArray());
  assert.equal(fighter.weaponMuzzleDistance, model.state.weaponMuzzleDistance);
  assert.equal(fighter.weaponGlowMaterial.emissiveIntensity, .25);
  if (fighter.weaponSpinner) assert.deepEqual(fighter.weaponSpinner.quaternion.toArray(), model.spinnerRotation.toArray());
  if (fighter.weaponPiston) assert.deepEqual(fighter.weaponPiston.position.toArray(), model.pistonPosition.toArray());
  fighter.health = 37; fighter.ammo[id] = 1; fighter.reloadTimer = .7; fighter.reloadWeaponId = id;
  fighter.updateWeaponModel();
  assert.deepEqual([fighter.health, fighter.ammo[id], fighter.reloadTimer, fighter.reloadWeaponId], [37, 1, .7, id], "visual refresh cannot reset authoritative or weapon state");
  fighter.dispose();
}
const stealingId = "weapon_stealing_projectile";
const stealingFighters = [[stealingId, "blaster", "minigun"], ["blaster", stealingId, "fireball"]].map((loadout, i) =>
  new Fighter(scene, { id: `cache-steal-${i}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, loadout, new THREE.Vector3()));
for (const fighter of stealingFighters) for (let slot = 0; slot < 3; slot++) fighter.switchSlot(slot);
swapStolenWeapon(...stealingFighters, stealingId, 0, 0);
for (const fighter of stealingFighters) {
  for (let slot = 0; slot < 3; slot++) { fighter.slotIndex = slot; fighter.updateWeaponModel(); assert.equal(fighter.weaponModelId, fighter.loadout[slot]); }
  fighter.dispose();
}
for (let frame = 0; frame < 60; frame++) gripFighter.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, world);
gripFighter.group.updateMatrixWorld(true);
const handCenter = new THREE.Vector3(0, -.58, .05).applyMatrix4(gripFighter.rightForearm.matrixWorld);
const gripCenter = new THREE.Vector3(.05, -.2, .11).applyMatrix4(gripFighter.weaponGroup.matrixWorld);
assert.ok(handCenter.distanceTo(gripCenter) < .03, `aiming hand must meet its grip, gap=${handCenter.distanceTo(gripCenter).toFixed(3)}m`);
gripFighter.dispose();
const poseWorld = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
const noMovement = new THREE.Vector3(), poseLook = new THREE.Vector3();
// Reconstruct the old separate-pivot builder from the current builder. Put its
// armor parts in body-then-head order only for a direct buffer comparison.
const legacyHeadSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("visor.position.set(0, .02, .469)", "visor.position.set(0, 2.1, .469)")
  .replace(/    const headArmor = mergeStaticParts\(armor, \[brow, helmetCrest\]\);[\s\S]*?    helmetAssembly.add\(visor, headArmor\);\r?\n/, "")
  .replace("[chest, breastplate, pelvis, leftShoulder, rightShoulder]", "[chest, breastplate, pelvis, leftShoulder, rightShoulder, brow, helmetCrest]")
  .replace("staticDark, staticArmor, staticAccent, helmetAssembly,", "staticDark, staticArmor, staticAccent, helmetAssembly, visor,")
  .replace("    const thrust = landing", "    this.visor.rotation.x = this.helmet.rotation.x;\n    const thrust = landing");
const LegacyHeadFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${legacyHeadSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
// Exercise the production update: equal Euler angles on different pivots do
// not keep a lens inside its housing, especially at steep aim or on landing.
for (let variant = 0; variant < 4; variant++) {
  const fighter = new Fighter(scene, { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const legacy = new LegacyHeadFighter(new THREE.Scene(), { id: fighter.id, color: fighter.color, accent: fighter.accent }, ["blaster"], new THREE.Vector3());
  const headArmor = fighter.helmet.getObjectByName("Helmet brow and crest");
  assert.ok(headArmor, "head armor belongs to the moving head");
  const bodyArmor = fighter.rig.children[1], oldArmor = legacy.rig.children[1];
  for (const name of ["position", "normal", "uv"]) {
    const body = bodyArmor.geometry.attributes[name], head = headArmor.geometry.attributes[name], old = oldArmor.geometry.attributes[name];
    assert.equal(body.count + head.count, old.count, "splitting the armor never changes vertex/triangle count");
    assert.deepEqual(body.array, old.array.slice(0, body.array.length), "body buffers remain byte-identical");
    for (let i = 0; i < head.array.length; i++) {
      const inRig = head.array[i] + (name === "position" && i % 3 === 1 ? 2.08 : 0);
      assert.ok(Math.abs(inRig - old.array[body.array.length + i]) < 3e-7, `${variant}/${name}/${i}: neutral brow and crest geometry is preserved`);
    }
  }
  const modernSnapshot = mergedFighterSnapshot(fighter, new Set([bodyArmor, headArmor]));
  const legacySnapshot = mergedFighterSnapshot(legacy, new Set([oldArmor]));
  assert.equal(modernSnapshot.meshes.length, legacySnapshot.meshes.length);
  for (let i = 0; i < modernSnapshot.meshes.length; i++) {
    const current = modernSnapshot.meshes[i], old = legacySnapshot.meshes[i];
    assert.ok(current.matrix.every((value, index) => Math.abs(value - old.matrix[index]) < 1e-12), "all other neutral world transforms are unchanged");
    assert.deepEqual({ ...current, matrix: null }, { ...old, matrix: null }, "all other geometry, UVs, bounds and materials are unchanged");
  }
  fighter.group.updateMatrixWorld(true);
  const neutralLens = fighter.helmet.matrixWorld.clone().invert().multiply(fighter.visor.matrixWorld);
  for (const pitch of [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, 0]) {
    const aim = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));
    for (let frame = 0; frame < 60; frame++) {
      if (pitch === 0) { fighter.landTimer = .15; fighter.landStrength = 1; }
      fighter.update(1 / 60, noMovement, aim, {}, poseWorld);
      if (pitch === 0) { legacy.landTimer = .15; legacy.landStrength = 1; }
      legacy.update(1 / 60, noMovement, aim, {}, poseWorld);
      assert.deepEqual(fighter.muzzlePoint().toArray(), legacy.muzzlePoint().toArray(), "head motion cannot change projectile origins");
      assert.deepEqual(fighter.weaponGroup.matrix.elements, legacy.weaponGroup.matrix.elements, "weapon poses remain unchanged");
      fighter.group.updateMatrixWorld(true);
      const relative = fighter.helmet.matrixWorld.clone().invert().multiply(fighter.visor.matrixWorld);
      assert.ok(relative.elements.every((value, i) => Math.abs(value - neutralLens.elements[i]) < 1e-10),
        `helmet ${variant}/${pitch}/${frame}: lens must stay fixed inside the moving frame`);
    }
  }
  assert.equal(fighter.visor.parent, fighter.helmet, "the existing helmet is the only head pitch pivot");
  assert.deepEqual(fighter.visor.rotation.toArray(), [0, 0, 0, "XYZ"], "a child must not receive the head rotation twice");
  assert.equal(headArmor?.parent, fighter.helmet, "brow and crest must follow the same pivot");
  assert.equal(headArmor.material, fighter.armorMaterial, "head armor keeps its existing material");
  const resources = new Map();
  fighter.group.traverse(object => {
    for (const resource of [object.geometry, ...[].concat(object.material || [])]) {
      if (!resource || resource.userData?.sharedFighterGeometry || resources.has(resource)) continue;
      resources.set(resource, 0); resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
    }
  });
  fighter.dispose();
  legacy.dispose();
  assert.ok([...resources.values()].every(count => count === 1), "nested head resources are disposed exactly once with the fighter");
  assert.equal(fighter.group.parent, null);
}
const browFighter = new Fighter(scene, { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const browPositions = browFighter.helmet.getObjectByName("Helmet brow and crest").geometry.attributes.position;
for (const side of [-1, 1]) {
  assert.ok(Array.from({ length: browPositions.count }, (_, i) => i).some(i =>
    side * browPositions.getX(i) > .3 && browPositions.getY(i) > .1 && browPositions.getZ(i) < .16),
  "capsule brow ends must sweep back toward the temples, not remain a straight plank");
}
browFighter.dispose();
const straightBrowSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace(/    let browGeometry;[\s\S]*?    brow.rotation.x = -.18;/,
    "    const brow = part(new THREE.BoxGeometry(.78, .1, .16), armor, 0, 2.27, .3);\n    brow.rotation.x = -.18;")
  .replace("    } else if (costumeVariant === 2) {", "    } else if (costumeVariant === 2) {\n      brow.scale.set(1.22, .7, 1.14);");
const StraightBrowFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${straightBrowSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const browSources = [];
class TrackedBrowGeometry extends THREE.ExtrudeGeometry {
  constructor(...args) {
    super(...args);
    const record = { disposed: 0 }; browSources.push(record);
    this.addEventListener("dispose", () => record.disposed++);
  }
}
const TrackedBrowFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")}; return Fighter;`)(
  { ...THREE, ExtrudeGeometry: TrackedBrowGeometry }, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
for (const variant of [0, 1, 3, 2]) {
  const fighter = new TrackedBrowFighter(scene, { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  assert.deepEqual(browSources.map(source => source.disposed), variant === 2 ? [1] : [], "only capsule creates an extrusion and merge disposes that owned source exactly once");
  fighter.dispose();
  assert.deepEqual(browSources.map(source => source.disposed), variant === 2 ? [1] : [], "fighter teardown owns the merged geometry, not its already-disposed source");
}
for (let variant = 0; variant < 4; variant++) {
  const config = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const fighter = new Fighter(scene, config, ["blaster"], new THREE.Vector3());
  const before = new StraightBrowFighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  if (variant !== 2) assert.deepEqual(mergedFighterSnapshot(fighter), mergedFighterSnapshot(before), "non-capsule brow geometry and materials remain byte-identical");
  else {
    const head = fighter.helmet.getObjectByName("Helmet brow and crest"), oldHead = before.helmet.getObjectByName("Helmet brow and crest");
    assert.deepEqual(mergedFighterSnapshot(fighter, new Set([head])), mergedFighterSnapshot(before, new Set([oldHead])), "only capsule brow changes, not visor/socket/ears/weapons/body");
    assert.equal(head.material, fighter.armorMaterial);
    assert.deepEqual(head.matrix.elements, oldHead.matrix.elements);
    for (const name of ["position", "normal", "uv"]) {
      const current = head.geometry.attributes[name], old = oldHead.geometry.attributes[name];
      assert.equal(current.count, old.count - 48, "swept brow uses 92 triangles instead of 108, in the same existing mesh");
      assert.deepEqual(current.array.slice(276 * current.itemSize), old.array.slice(324 * old.itemSize), "crest buffers remain untouched");
      assert.ok([...current.array].every(Number.isFinite));
    }
    assert.deepEqual(new THREE.Box3().setFromObject(fighter.group), new THREE.Box3().setFromObject(before.group), "swept brow does not enlarge complete fighter bounds");
    const positions = head.geometry.attributes.position, normals = head.geometry.attributes.normal, edges = new Map();
    const key = point => point.toArray().map(value => value.toFixed(6)).join(",");
    for (let i = 0; i < 276; i += 3) {
      const [a, b, c] = [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(positions, i + corner));
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(normal.length() > 1e-8, "beveled brow has no degenerate triangles");
      normal.normalize();
      for (const [corner, point] of [a, b, c].entries()) {
        const stored = new THREE.Vector3().fromBufferAttribute(normals, i + corner);
        assert.ok(Math.abs(stored.length() - 1) < 1e-6 && stored.dot(normal) > .99999, "bevel normals agree with outward triangle winding");
        assert.ok(Math.abs(point.x) < .4758 && point.y < .241 && point.z < .399, "brow stays within its old upper/front/width silhouette");
        assert.ok(point.z < .4, "brow remains behind the nearest lens surface at z.4515");
      }
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const ka = key(start), kb = key(end), edgeKey = [ka, kb].sort().join("|");
        const edge = edges.get(edgeKey) || { count: 0, winding: 0 };
        edge.count++; edge.winding += ka < kb ? 1 : -1; edges.set(edgeKey, edge);
      }
    }
    assert.ok([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0), "swept brow is a closed consistently wound solid");
  }
  fighter.dispose(); before.dispose();
}
const posedHand = new THREE.Vector3(), posedGrip = new THREE.Vector3();
const wristAxis = new THREE.Vector3(), wristNormal = new THREE.Vector3(), barrelNormal = new THREE.Vector3();
for (const weaponId of ["blaster", "rocket_launcher", "machine_gun"]) for (const release of ["reload", "grapple"]) {
  const fighter = new Fighter(scene, { id: "transition-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  for (let frame = 0; frame < 60; frame++) {
    fighter.reloadTimer = release === "reload" ? 1 : 0;
    fighter.grapple = release === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
  }
  fighter.group.updateMatrixWorld(true);
  const rigInverse = fighter.rig.matrixWorld.clone().invert();
  const previousPalm = new THREE.Vector3(0, -.58, .05).applyMatrix4(fighter.leftForearm.matrixWorld).applyMatrix4(rigInverse);
  const localPalm = new THREE.Vector3();
  fighter.reloadTimer = 0; fighter.grapple = null;
  for (let frame = 0; frame < 24; frame++) {
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
    fighter.group.updateMatrixWorld(true);
    posedHand.set(0, -.58, .05).applyMatrix4(fighter.leftForearm.matrixWorld);
    // Isolate joint return from the existing grapple-release body roll/movement.
    rigInverse.copy(fighter.rig.matrixWorld).invert();
    localPalm.copy(posedHand).applyMatrix4(rigInverse);
    const jump = localPalm.distanceTo(previousPalm);
    assert.ok(jump < .2, `${weaponId}/${release}/${frame}: support-hand jump ${jump.toFixed(3)}m`);
    previousPalm.copy(localPalm);
  }
  posedGrip.copy(fighter.weaponSupportGrip).applyMatrix4(fighter.weaponGroup.matrixWorld);
  assert.ok(posedHand.distanceTo(posedGrip) < .03, "support hand returns exactly to the grip after its release transition");
  fighter.dispose();
}
for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: "pose-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  for (const pitch of [-.9, 0, .9]) for (const pose of ["aim", "fire", "reload", "grapple"]) {
    poseLook.set(0, Math.sin(pitch), -Math.cos(pitch));
    fighter.grapple = pose === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    for (let frame = 0; frame < 24; frame++) {
      fighter.reloadTimer = pose === "reload" ? 1 : 0;
      fighter.recoilVisual = pose === "fire" ? .9 : 0;
      fighter.attackTimer = pose === "fire" ? weapon.cooldown * .75 : 0;
      fighter.update(1 / 60, noMovement, poseLook, {}, poseWorld);
    }
    fighter.group.updateMatrixWorld(true);
    const hands = [[fighter.rightArm, fighter.rightForearm, fighter.weaponGrip]];
    if (fighter.weaponHasSupportGrip && pose !== "reload" && pose !== "grapple") hands.push([fighter.leftArm, fighter.leftForearm, fighter.weaponSupportGrip]);
    for (const [upper, forearm, grip] of hands) {
      posedHand.set(0, -.58, .05).applyMatrix4(forearm.matrixWorld);
      posedGrip.copy(grip).applyMatrix4(fighter.weaponGroup.matrixWorld);
      const gap = posedHand.distanceTo(posedGrip);
      assert.ok(gap < .04, `${weapon.id}/${pitch}/${pose}: grip gap ${gap.toFixed(3)}m`);
      assert.deepEqual(forearm.position.toArray(), [0, -.55, 0], "joint solve never stretches a limb");
      assert.ok(Math.abs(upper.quaternion.length() - 1) < .000001);
      assert.ok(Math.abs(forearm.quaternion.length() - 1) < .000001);
      wristAxis.set(0, -.58, .05).transformDirection(forearm.matrixWorld);
      wristNormal.set(0, 0, 1).transformDirection(forearm.matrixWorld).projectOnPlane(wristAxis).normalize();
      barrelNormal.set(0, 0, 1).transformDirection(fighter.weaponGroup.matrixWorld).projectOnPlane(wristAxis).normalize();
      assert.ok(wristNormal.dot(barrelNormal) > .998, `${weapon.id}/${pitch}/${pose}: wrist follows the weapon instead of twisting across its grip`);
    }
  }
  fighter.dispose();
}
for (const variant of [0, 1, 2, 3]) for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: `graphics-qa-${variant}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  assertCompatibleAONormals(fighter.group);
  assert.equal(fighter.visor.name, "Segmented inset visor");
  assert.equal(fighter.helmet.name, "Helmet and recessed visor housing");
  assert.ok(fighter.helmet.material === fighter.darkMaterial, "housing uses the existing dark batch material");
  fighter.visor.geometry.computeBoundingBox();
  assert.ok(fighter.visor.geometry.boundingBox.max.x < .33);
  assert.ok(fighter.visor.geometry.boundingBox.max.y < .05, "lens is smaller than its surrounding frame");
  assert.ok(fighter.visor.geometry.boundingBox.max.z + fighter.visor.position.z < .5, "lens sits behind housing front");
  assert.ok(fighter.accentMaterial.emissiveIntensity < 1, "idle armor keeps chroma and highlight detail");
  assert.ok(fighter.weaponGlowMaterial.emissiveIntensity < 1, "idle weapon casing is not a clipped light source");
  fighter.group.traverse(object => {
    if (!object.geometry) return;
    assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite), `${weapon.id}: finite authored geometry`);
  });
  fighter.dispose();
}
// The narrow capsule shell used to end before the common visor frame began.
// Probe the actual merged geometry from both sides, not an analytic capsule.
const socketFighter = new Fighter(scene, { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const socketHead = new THREE.Mesh(socketFighter.helmet.geometry, socketFighter.darkMaterial);
socketHead.updateMatrixWorld(true);
const socketRay = new THREE.Raycaster();
for (const side of [-1, 1]) for (const y of [-.04, .02, .08]) for (const z of [.35, .37, .39]) {
  socketRay.set(new THREE.Vector3(side * 2, y, z), new THREE.Vector3(-side, 0, 0));
  assert.ok(socketRay.intersectObject(socketHead, false).length > 0, `capsule visor backing must close the side gap at ${side}/${y}/${z}`);
}
for (const side of [-1, 1]) for (const x of [-.22, 0, .22]) for (const z of [.35, .37, .39]) {
  socketRay.set(new THREE.Vector3(x, side * 2, z), new THREE.Vector3(0, -side, 0));
  assert.ok(socketRay.intersectObject(socketHead, false).length > 0, "the backing also closes the upper and lower gap");
}
for (const side of [-1, 1]) for (const y of [-.05, 0, .05]) for (const x of [.39, .41, .423]) {
  socketRay.set(new THREE.Vector3(side * x, y, 2), new THREE.Vector3(0, 0, -1));
  assert.ok(socketRay.intersectObject(socketHead, false).length > 0, "capsule ear mounts must bridge shell to existing ear caps");
}
socketFighter.dispose();

const socketStart = playerMergeSource.indexOf("    // Close the capsule's shell-to-frame gap");
const socketEnd = playerMergeSource.indexOf("    const helmetAssembly", socketStart);
assert.ok(socketStart >= 0 && socketEnd > socketStart);
const withoutSocketSource = (playerMergeSource.slice(0, socketStart) + playerMergeSource.slice(socketEnd))
  .replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "");
const WithoutSocketFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${withoutSocketSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
for (let variant = 0; variant < 4; variant++) {
  const config = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const fighter = new Fighter(scene, config, ["blaster"], new THREE.Vector3());
  const before = new WithoutSocketFighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  if (variant !== 2) assert.deepEqual(mergedFighterSnapshot(fighter), mergedFighterSnapshot(before), "other helmet variants remain byte-identical");
  else {
    // Reassemble the two actual buffers for the existing shell/hardware contact checks.
    const headGeometry = mergeGeometries([fighter.helmetShell.geometry, fighter.helmet.geometry], false);
    const oldHeadGeometry = mergeGeometries([before.helmetShell.geometry, before.helmet.geometry], false);
    assert.deepEqual(mergedFighterSnapshot(fighter, new Set([fighter.helmet])), mergedFighterSnapshot(before, new Set([before.helmet])),
      "only the capsule housing changes; lens, pivot, armor, weapons and materials stay intact");
    const added = {};
    for (const name of ["position", "normal", "uv"]) {
      const current = headGeometry.attributes[name], old = oldHeadGeometry.attributes[name];
      assert.equal(current.count - old.count, 228, "socket and two closed eight-sided ear mounts add exactly 76 triangles and no draw");
      assert.deepEqual(current.array.slice(0, old.array.length), old.array, "existing shell and frame buffers stay byte-identical");
      added[name] = new THREE.BufferAttribute(current.array.slice(old.array.length), current.itemSize);
    }
    for (const fighterGeometry of [headGeometry, oldHeadGeometry]) {
      fighterGeometry.computeBoundingBox(); fighterGeometry.computeBoundingSphere();
    }
    assert.deepEqual(new THREE.Box3().setFromObject(fighter.group), new THREE.Box3().setFromObject(before.group), "mounts stay inside the existing complete fighter bounds");
    const headBounds = headGeometry.boundingBox, oldBounds = oldHeadGeometry.boundingBox;
    assert.ok(Math.abs(headBounds.max.x - .44) < 1e-7 && Math.abs(headBounds.min.x + .44) < 1e-7, "head culling bounds include both mounts");
    for (const axis of ["y", "z"]) { assert.equal(headBounds.min[axis], oldBounds.min[axis]); assert.equal(headBounds.max[axis], oldBounds.max[axis]); }
    assert.deepEqual(headGeometry.boundingSphere, oldHeadGeometry.boundingSphere);
    const vertices = Array.from({ length: 36 }, (_, i) => new THREE.Vector3().fromBufferAttribute(added.position, i));
    const edges = new Map(), center = new THREE.Vector3(0, .02, (.13 + .405) / 2);
    const pointKey = point => point.toArray().map(value => value.toFixed(6)).join(",");
    for (let i = 0; i < vertices.length; i += 3) {
      const [a, b, c] = vertices.slice(i, i + 3), normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      assert.ok(normal.dot(a.clone().add(b).add(c).divideScalar(3).sub(center)) > 0, "each face winds outward");
      for (let corner = 0; corner < 3; corner++) {
        const stored = new THREE.Vector3().fromBufferAttribute(added.normal, i + corner);
        assert.ok(stored.distanceTo(normal) < 1e-6, "deformed box retains correct hard face normals");
      }
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const ka = pointKey(start), kb = pointKey(end), key = [ka, kb].sort().join("|");
        const entry = edges.get(key) || { count: 0, winding: 0 };
        entry.count++; entry.winding += ka < kb ? 1 : -1; edges.set(key, entry);
      }
    }
    assert.ok([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0), "backing is closed with no missing face or duplicate triangle");
    assert.ok([...added.uv.array].every(value => value >= 0 && value <= 1));
    fighter.visor.geometry.computeBoundingBox();
    const front = Math.max(...vertices.map(point => point.z));
    assert.ok(fighter.visor.position.z + fighter.visor.geometry.boundingBox.min.z - front > .0464, "backing stays behind every lens");
    const oldHead = new THREE.Mesh(oldHeadGeometry, before.darkMaterial); oldHead.updateMatrixWorld(true);
    for (const vertex of vertices.filter(point => point.z < .14)) for (const side of [-1, 1]) {
      socketRay.set(new THREE.Vector3(side * 2, vertex.y, vertex.z), new THREE.Vector3(-side, 0, 0));
      const hit = socketRay.intersectObject(oldHead, false)[0];
      assert.ok(hit && side * hit.point.x > Math.abs(vertex.x) + .005, "each rear corner overlaps the actual faceted capsule shell");
    }
    for (let i = 36; i < added.position.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(added.position, i);
      assert.ok(Math.abs(Math.abs(vertex.x) - .25) < 1e-7 || Math.abs(Math.abs(vertex.x) - .44) < 1e-7, "closed mounts run from inside shell into the ear caps");
      if (Math.abs(vertex.x) < .3) {
        // CapsuleGeometry's duplicated angular seam can miss rays at z ~= -1e-17.
        // Probe both sides of that numerical seam; retain the full 5 mm overlap margin.
        for (const z of Math.abs(vertex.z) < 1e-8 ? [-1e-8, 1e-8] : [vertex.z]) {
          socketRay.set(new THREE.Vector3(Math.sign(vertex.x) * 2, vertex.y, z), new THREE.Vector3(-Math.sign(vertex.x), 0, 0));
          const hit = socketRay.intersectObject(oldHead, false)[0];
          assert.ok(hit && Math.abs(hit.point.x) > Math.abs(vertex.x) + .005, `inner mount vertex ${i} must overlap the actual shell`);
        }
      } else {
        assert.ok(Math.hypot(vertex.y, vertex.z) < .12 * Math.cos(Math.PI / 8), "outer mount stays inside the existing ear disc at every pitch");
        assert.ok(Math.abs(vertex.x) > .425 && Math.abs(vertex.x) < .515, "outer mount overlaps the unchanged ear cap depth");
      }
    }
    headGeometry.dispose(); oldHeadGeometry.dispose();
  }
  fighter.dispose(); before.dispose();
}
const outsideSprite = new THREE.Sprite();
for (const batch of world.destructibleBatches) {
  assert.ok(batch.material.map === world.coverTextures[0] && batch.material.normalMap === world.coverTextures[1] && batch.material.roughnessMap === world.coverTextures[2], "cover batches share one dedicated matched surface atlas");
  assert.ok(batch.material.map !== world.panelTexture, "cover tuning cannot alter pillar and deck textures");
  batch.geometry.computeBoundingBox();
  assert.deepEqual(batch.geometry.boundingBox.min.toArray(), [-.5, -.5, -.5]);
  assert.deepEqual(batch.geometry.boundingBox.max.toArray(), [.5, .5, .5]);
  assert.equal(batch.geometry.attributes.position.count / 3, 60, "cover uses four planar mitered rim sections and one panel per face");
  assert.ok(Math.abs(Math.max(...batch.geometry.attributes.uv.array) - .23625) < 1e-6, "infill retains its .25 UV cadence inside the 5.5% frame");
  assert.equal(batch.material.vertexColors, true, "cover perimeter retains its machined dark frame");
  const colors = batch.geometry.attributes.color;
  for (let i = 0; i < colors.count; i += 3) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(colors[axis](i), colors[axis](i + 1));
    assert.equal(colors[axis](i), colors[axis](i + 2), "each face triangle has a crisp frame/infill boundary");
  }
  const uv = batch.geometry.attributes.uv, normal = batch.geometry.attributes.normal;
  for (let i = 0; i < colors.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "each mitered frame quad is planar, without triangular corner patches");
  }
  for (let i = 0; i < colors.count; i += 3) {
    const area = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i));
    assert.ok(Math.abs(area) > 1e-10, "frame sampling keeps a valid tangent basis");
    for (const axis of ["getX", "getY", "getZ"]) {
      assert.equal(normal[axis](i), normal[axis](i + 1));
      assert.equal(normal[axis](i), normal[axis](i + 2), "split frame faces have geometric bevel normals");
    }
  }
}
scene.add(outsideSprite);
let sharedSpriteDisposals = 0;
const onSharedSpriteDispose = () => sharedSpriteDisposals++;
outsideSprite.geometry.addEventListener("dispose", onSharedSpriteDispose);
for (const arena of [world, new ArenaWorld(scene, "RESET-2"), new ArenaWorld(scene, "RESET-3")]) {
  let spriteMaterialsDisposed = 0, ownedGeometryDisposed = 0;
  const boostDisposals = new Map(arena.boostPads.flatMap(pad => [pad.mesh, ...pad.mesh.children])
    .flatMap(mesh => [mesh.geometry, mesh.material]).map(resource => [resource, 0]));
  for (const resource of boostDisposals.keys()) resource.addEventListener("dispose", () => boostDisposals.set(resource, boostDisposals.get(resource) + 1));
  const coverDisposals = new Map([...arena.coverTextures, arena.coverLightMask].map(texture => [texture, 0]));
  for (const texture of coverDisposals.keys()) texture.addEventListener("dispose", () => coverDisposals.set(texture, coverDisposals.get(texture) + 1));
  arena.group.traverse(object => {
    if (object.isSprite) object.material.addEventListener("dispose", () => spriteMaterialsDisposed++);
    else if (object.geometry) object.geometry.addEventListener("dispose", () => ownedGeometryDisposed++);
  });
  const victim = arena.destructibles[0], neighbor = arena.destructibles.at(-1);
  const secondVictim = arena.destructibles.find(item => item !== victim && item !== neighbor && arena.districtIndexAt(item.x, item.z) === arena.districtIndexAt(victim.x, victim.z));
  const removedCases = arena.seed === "RESET-3" ? [] : [victim, secondVictim];
  const detachedResources = new Map();
  for (const removed of removedCases) removed.mesh.traverse(object => {
    for (const resource of [object.geometry, ...[].concat(object.material || [])].filter(Boolean)) detachedResources.set(resource, 0);
  });
  for (const resource of detachedResources.keys()) resource.addEventListener("dispose", () => detachedResources.set(resource, detachedResources.get(resource) + 1));
  for (const removed of removedCases) {
    const point = new THREE.Vector3(removed.x, removed.baseY + removed.h / 2, removed.z), eventId = `cover-disposal-${removed.x}-${removed.z}`;
    arena.destroy(point, .001, { eventId, structuralDamage: .01 });
    arena.destroy(point, .001, { eventId, structuralDamage: .01 });
  }
  for (const removed of removedCases) assert.equal(removed.mesh.parent, null);
  assert.equal(arena.detachedDestructibleMeshes.length, removedCases.length, "duplicate destruction cannot enqueue a detached cover twice");
  assert.ok(neighbor.mesh.parent === arena.group && arena.destructibles.includes(neighbor), "removing one cover cannot remove its neighbor");
  assert.ok([...detachedResources.values()].every(count => count === 0), "shared resources remain valid for surviving covers until world teardown");
  arena.dispose();
  assert.equal(arena.detachedDestructibleMeshes.length, 0, "teardown releases its detached-root references");
  assert.ok([...detachedResources.values()].every(count => count === 1), "destroyed cover buffers and shared materials still dispose exactly once at teardown");
  assert.ok([...boostDisposals.values()].every(count => count === 1), "all boost geometry and materials dispose exactly once, including shared route marks");
  assert.ok([...coverDisposals.values()].every(count => count === 1), "shared cover textures dispose exactly once per arena");
  assert.ok(scene.backgroundNode === arena.previousBackgroundNode, "teardown restores the previous sky expression without disposing Three's owned sky mesh");
  assert.equal(sharedSpriteDisposals, 0, "arena teardown must not destroy Three's shared Sprite quad used by the next arena");
  assert.ok(spriteMaterialsDisposed > 0, "owned sprite materials are still released");
  assert.ok(ownedGeometryDisposed > 0, "owned arena geometry is still released");
  assert.ok(!scene.children.includes(arena.group));
}
outsideSprite.geometry.removeEventListener("dispose", onSharedSpriteDispose);
scene.remove(outsideSprite); outsideSprite.material.dispose();
console.log("Graphics profiles, mip chains, texture color spaces, unchanged structures and all 47 authored weapons passed.");
