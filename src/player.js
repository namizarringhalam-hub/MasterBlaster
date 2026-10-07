import * as THREE from "three/webgpu";
import { advanceSpring } from "./motionSpring.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { weaponUsesAmmo, WEAPONS } from "./gameData.js";
import { weaponPresentation } from "./weaponPresentation.js";
import { createMechaRig } from "./mecha.js";
import { surfaceMaps, projectSurfaceUVs } from "./surfaceTextures.js";
import { combatShotOrigin, headContact } from "./headshots.js";

const clamp = THREE.MathUtils.clamp;
export const PROJECTILE_SPAWN_OFFSET = .08;
const roundedParts = new Map();

export function torsoGeometry() {
  const geometry = new THREE.CapsuleGeometry(.39, .68, 4, 8).translate(0, 1.25, 0);
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (y >= .91) continue;
    positions.setY(i, .91 + (y - .91) * (.11 / .39));
    normal.fromBufferAttribute(normals, i); normal.y /= .11 / .39; normal.normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  return geometry;
}

// Fit only the inner chest-facing core; retain the authored shell and smooth joins.
// Four immutable source geometries reuse the existing fighter geometry cache.
export function fittedTorsoGeometry(variant) {
  if (![0, 1, 2, 3].includes(variant)) throw Error("Unknown fighter variant");
  const key = `fitted-torso-${variant}`;
  if (roundedParts.has(key)) return roundedParts.get(key);
  const indexed = torsoGeometry(), reference = indexed.toNonIndexed(); indexed.dispose();
  try {
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
      const data = [];
      for (let i = 0; i < output.length; i += 8) data.push(...output.slice(i + offset, i + offset + size));
      const array = new Float32Array(data);
      result.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    result.computeBoundingBox(); result.computeBoundingSphere();
    result.userData.sharedFighterGeometry = true; roundedParts.set(key, result); return result;
  } finally { reference.dispose(); }
}

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
  return projectSurfaceUVs(geometry);
}

export function clipLegPolygon(polygon, plane, above) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = a[1] - plane, db = b[1] - plane;
    if (above ? da >= 0 : da <= 0) out.push(a);
    if (da * db < 0) {
      const t = da / (da - db), point = a.map((v, j) => v + (b[j] - v) * t);
      point[1] = plane; out.push(point);
    }
  }
  return out;
}

export function legAssemblyGeometry(original, centerY, lowerCut, connector = false) {
  const position = [], normal = [], uv = [];
  const p = original.attributes.position, n = original.attributes.normal, tex = original.attributes.uv;
  const emit = v => { position.push(...v.slice(0, 3)); normal.push(...v.slice(3, 6)); uv.push(...v.slice(6, 8)); };
  for (const [level, above] of [[-.60, true], [lowerCut, false]]) {
    const plane = level - centerY, rim = new Map();
    for (let i = 0; i < p.count; i += 3) {
      const triangle = [0, 1, 2].map(k => [p.getX(i + k), p.getY(i + k), p.getZ(i + k),
        n.getX(i + k), n.getY(i + k), n.getZ(i + k), tex.getX(i + k), tex.getY(i + k)]);
      const polygon = clipLegPolygon(triangle, plane, above);
      for (const v of polygon) if (v[1] === plane) {
        const x = Math.fround(v[0]), z = Math.fround(v[2]); rim.set(`${x}:${z}`, [x, plane, z]);
      }
      for (let j = 1; j + 1 < polygon.length; j++) { emit(polygon[0]); emit(polygon[j]); emit(polygon[j + 1]); }
    }
    const ring = [...rim.values()].sort((a, b) => Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));
    const cap = v => [...v, 0, above ? -1 : 1, 0, v[0] + .5, v[2] + .5];
    for (let i = 0; i < ring.length; i++) {
      const a = cap(ring[i]), b = cap(ring[(i + 1) % ring.length]);
      emit(cap([0, plane, 0])); emit(above ? a : b); emit(above ? b : a);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  shell.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  shell.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  let geometry = shell;
  if (connector) {
    const indexed = new THREE.CylinderGeometry(.105, .105, .09, 8, 1);
    const ankle = indexed.toNonIndexed().translate(0, -.625 - centerY, 0);
    geometry = mergeGeometries([shell, ankle], false);
    indexed.dispose(); ankle.dispose(); shell.dispose();
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function kneeTaperGeometry(original) {
  const geometry = new THREE.BufferGeometry().copy(original);
  geometry.userData = {};
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const slope = (1 - .22 / .29) / .18, normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), scale = 1 + slope * (y - .09);
    positions.setX(i, x * scale);
    // Inverse-transpose preserves the rounded bevels under the varying X scale.
    normal.set(normals.getX(i) / scale,
      normals.getY(i) - slope * x * normals.getX(i) / scale, normals.getZ(i)).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function disposeGeometry(geometry) {
  if (!geometry?.userData?.sharedFighterGeometry) geometry?.dispose();
}

function material(color, emissive = 0, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    ...surfaceMaps(),
    normalScale: new THREE.Vector2(.3, .3),
    color,
    roughness: .29,
    metalness: .42,
    clearcoat: .42,
    clearcoatRoughness: .2,
    envMapIntensity: 1.2,
    specularIntensity: .92,
    emissive,
    emissiveIntensity: emissive ? .62 : 0,
    flatShading: false,
    ...options
  });
}

function part(geometry, mat, x, y, z, shadows = false) {
  if (geometry.type === "BoxGeometry") {
    const { width, height, depth } = geometry.parameters;
    geometry.dispose();
    const key = `${width}:${height}:${depth}`;
    if (!roundedParts.has(key)) {
      const rounded = new RoundedBoxGeometry(width, height, depth, 1, Math.min(.045, width * .14, height * .14, depth * .14));
      rounded.userData.sharedFighterGeometry = true;
      roundedParts.set(key, rounded);
    }
    geometry = roundedParts.get(key);
  }
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

function mergeStaticParts(mat, meshes) {
  const transformed = meshes.map((mesh) => {
    mesh.updateMatrix();
    // A derived geometry's clone rebuilds its default shape before copying.
    // Merge inputs need only owned buffers, not that discarded procedural work.
    const clone = new THREE.BufferGeometry().copy(mesh.geometry);
    const compatible = clone.index ? clone.toNonIndexed() : clone;
    if (compatible !== clone) clone.dispose();
    return compatible.applyMatrix4(mesh.matrix);
  });
  const geometry = mergeGeometries(transformed, false);
  for (const entry of transformed) entry.dispose();
  for (const entry of new Set(meshes.map((mesh) => mesh.geometry))) disposeGeometry(entry);
  return new THREE.Mesh(geometry, mat);
}

function mergeRigidMeshes(root, excludedRoots = []) {
  root.updateWorldMatrix(true, true);
  const excluded = new Set();
  for (const entry of excludedRoots.filter(Boolean)) entry.traverse((child) => excluded.add(child));
  const byMaterial = new Map();
  root.traverse((child) => {
    if (child === root || !child.isMesh || excluded.has(child)) return;
    const entries = byMaterial.get(child.material) || [];
    entries.push(child);
    byMaterial.set(child.material, entries);
  });
  const rootInverse = root.matrixWorld.clone().invert();
  for (const [mat, meshes] of byMaterial) {
    const transformed = meshes.map((mesh) => {
      const clone = new THREE.BufferGeometry().copy(mesh.geometry);
      const compatible = clone.index ? clone.toNonIndexed() : clone;
      if (compatible !== clone) clone.dispose();
      return compatible.applyMatrix4(rootInverse.clone().multiply(mesh.matrixWorld));
    });
    const geometry = mergeGeometries(transformed, false);
    for (const entry of transformed) entry.dispose();
    const merged = new THREE.Mesh(geometry, mat);
    merged.castShadow = meshes.some((mesh) => mesh.castShadow);
    merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      disposeGeometry(mesh.geometry);
    }
    root.add(merged);
  }
}

function combineMaterialBatches(root, excludedRoots = []) {
  const excluded = new Set(excludedRoots.filter(Boolean));
  const meshes = root.children.filter((child) => child.isMesh && !excluded.has(child));
  if (meshes.length < 2) return;
  const transformed = meshes.map((mesh) => new THREE.BufferGeometry().copy(mesh.geometry).applyMatrix4(mesh.matrix));
  const geometry = mergeGeometries(transformed, true);
  for (const entry of transformed) entry.dispose();
  const merged = new THREE.Mesh(geometry, meshes.map((mesh) => mesh.material));
  merged.castShadow = meshes.some((mesh) => mesh.castShadow);
  merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
  for (const mesh of meshes) {
    mesh.removeFromParent();
    disposeGeometry(mesh.geometry);
  }
  root.add(merged);
}

const armDown = new THREE.Vector3(0, -1, 0);
const handRest = new THREE.Vector3();
const armDirection = new THREE.Vector3(), armBend = new THREE.Vector3(), armElbow = new THREE.Vector3();
const handDirection = new THREE.Vector3(), palmNormal = new THREE.Vector3(), desiredPalm = new THREE.Vector3(), palmCross = new THREE.Vector3();
const handRotation = new THREE.Quaternion(), palmTwist = new THREE.Quaternion();

function alignArmGrip(upper, forearm, grip, forward) {
  // Analytic two-link solve in rig space. Only existing joint rotations change;
  // weapon transforms, projectile origins and the authored limb lengths do not.
  armDirection.copy(grip).sub(upper.position);
  const upperLength = -forearm.position.y;
  const handLength = forearm.userData.handRest.length();
  handRest.copy(forearm.userData.handRest).normalize();
  const distance = THREE.MathUtils.clamp(armDirection.length(), .035, upperLength + handLength - .001);
  armDirection.normalize();
  armBend.set(Math.sign(upper.position.x), -.75, -.2).projectOnPlane(armDirection).normalize();
  const along = (upperLength * upperLength - handLength * handLength + distance * distance) / (2 * distance);
  armElbow.copy(armDirection).multiplyScalar(along).addScaledVector(armBend, Math.sqrt(Math.max(0, upperLength * upperLength - along * along)));
  upper.quaternion.setFromUnitVectors(armDown, palmNormal.copy(armElbow).normalize());
  handDirection.copy(grip).sub(upper.position).sub(armElbow).normalize();
  handRotation.setFromUnitVectors(handRest, handDirection);
  palmNormal.set(0, 0, 1).applyQuaternion(handRotation).projectOnPlane(handDirection).normalize();
  desiredPalm.copy(forward).projectOnPlane(handDirection);
  if (desiredPalm.lengthSq() > .001) {
    desiredPalm.normalize();
    const turn = Math.atan2(handDirection.dot(palmCross.crossVectors(palmNormal, desiredPalm)), palmNormal.dot(desiredPalm));
    handRotation.premultiply(palmTwist.setFromAxisAngle(handDirection, turn));
  }
  forearm.quaternion.copy(upper.quaternion).invert().multiply(handRotation);
}

function disposeChildren(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse((child) => {
    if (child !== group && child.geometry) geometries.add(child.geometry);
    if (child !== group && child.material) {
      for (const entry of Array.isArray(child.material) ? child.material : [child.material]) materials.add(entry);
    }
  });
  group.clear();
  for (const geometry of geometries) disposeGeometry(geometry);
  for (const entry of materials) entry.dispose();
}

export class Fighter {
  constructor(scene, config, loadout, position, isBot = false) {
    this.scene = scene;
    this.id = config.id;
    this.name = config.name;
    this.color = config.color;
    this.accent = config.accent;
    this.loadout = loadout;
    this.weaponModels = new Map();
    this.weaponModelId = null;
    this.isBot = isBot;
    this.group = this.createModel();
    this.position = this.group.position;
    this.position.copy(position);
    this.velocity = new THREE.Vector3();
    this.controlMove = new THREE.Vector3();
    this.aim = new THREE.Vector3(0, 0, 1);
    this.desiredMove = new THREE.Vector3();
    this.previousPosition = new THREE.Vector3();
    this.botOrigin = new THREE.Vector3();
    this.botTargetPoint = new THREE.Vector3();
    this.botAimOffset = new THREE.Vector3();
    this.botForward = new THREE.Vector3();
    this.botMoveForward = new THREE.Vector3();
    this.botMove = new THREE.Vector3();
    this.botProbe = new THREE.Vector3();
    this.botChargeDistances = [];
    this.radius = .72;
    this.health = 100;
    this.slotIndex = 0;
    this.ammo = Object.fromEntries(loadout.map((id) => [id, WEAPONS[id].ammo]));
    this.reloadTimer = 0;
    this.reloadWeaponId = null;
    this.attackTimer = 0;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.hitTimer = 0;
    this.hitStagger = 1;
    this.slowTimer = 0;
    this.landTimer = 0;
    this.landStrength = 0;
    this.recoilVisual = 0;
    this.bodyPitchSpring = { value: 0, velocity: 0 };
    this.bodyRollSpring = { value: 0, velocity: 0 };
    this.previousVisualVelocity = new THREE.Vector3();
    this.weaponKick = { value: 0, velocity: 0 };
    this.weaponSpinSpeed = 0;
    this.deathTimer = 0;
    this.gaitPhase = 0;
    this.grounded = true;
    this.boosted = false;
    this.ledgeContact = null;
    this.alive = true;
    this.deaths = 0;
    this.networkLifeSequence = 0;
    this.networkRespawnId = "";
    this.networkRespawnSpawnIndex = -1;
    this.botThink = 0;
    this.botDodge = 1;
    this.botTarget = null;
    this.grapple = null;
    scene.add(this.group);
    this.updateWeaponModel();
  }

  get weapon() {
    return WEAPONS[this.loadout[this.slotIndex]];
  }

  createModel() {
    const group = new THREE.Group();
    group.add(createMechaRig(this));

    this.weaponGroup = new THREE.Group();
    this.weaponGroup.position.set(.26, 1.6, .22);
    this.weaponGrip = new THREE.Vector3();
    this.weaponSupportGrip = new THREE.Vector3();
    this.gripTarget = new THREE.Vector3();
    this.gripForward = new THREE.Vector3();
    this.supportGripProgress = 0;
    this.supportArmStart = new THREE.Quaternion();
    this.supportForearmStart = new THREE.Quaternion();
    this.rig.add(this.weaponGroup);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: .46,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    this.identityRing = part(new THREE.RingGeometry(.72, .91, 28), ringMaterial, 0, .035, 0, false);
    this.identityRing.rotation.x = -Math.PI / 2;
    this.identityRing.renderOrder = 3;
    this.freezeRing = part(new THREE.RingGeometry(.82, 1.08, 32), new THREE.MeshBasicMaterial({
      color: 0xa9efff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide
    }), 0, .055, 0, false);
    this.freezeRing.rotation.x = -Math.PI / 2;
    this.freezeRing.renderOrder = 4;
    this.identityBeacon = part(new THREE.OctahedronGeometry(.12, 0), material(this.accent, this.accent, {
      emissiveIntensity: 1.8, roughness: .16, metalness: .3, transparent: true, opacity: .94, depthWrite: false
    }), 0, 2.82, 0, false);
    this.identityBeacon.name = "Identity beacon";
    this.identityBeacon.scale.set(.78, 1.32, .52);
    this.identityBeacon.renderOrder = 5;
    group.add(this.identityRing, this.freezeRing, this.identityBeacon);
    const shadowProxy = part(new THREE.CapsuleGeometry(.4, 1.35, 3, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), 0, 1.1, 0, true);
    shadowProxy.receiveShadow = false;
    shadowProxy.name = "Fighter shadow proxy";
    this.rig.add(shadowProxy);
    return group;
  }

  updateWeaponModel() {
    this.weaponKick.value = this.weaponKick.velocity = 0;
    this.weaponSpinSpeed = 0;
    this.muzzleRevision = (this.muzzleRevision || 0) + 1;
    const weapon = this.weapon;
    const previous = this.weaponModels.get(this.weaponModelId);
    if (previous) previous.group.add(...this.weaponGroup.children);
    // Inactive models stay detached: decoys clone only the visible weapon.
    for (const [id, model] of this.weaponModels) if (!this.loadout.includes(id)) {
      disposeChildren(model.group);
      this.weaponModels.delete(id);
    }
    this.weaponModelId = weapon.id;
    const cached = this.weaponModels.get(weapon.id);
    if (cached) {
      this.weaponModels.delete(weapon.id);
      this.weaponModels.set(weapon.id, cached);
      this.weaponGroup.add(...cached.group.children);
      Object.assign(this, cached.state);
      this.weaponGrip.copy(cached.grip);
      this.weaponSupportGrip.copy(cached.supportGrip);
      this.weaponGlowMaterial.emissiveIntensity = .25;
      if (this.weaponSpinner) this.weaponSpinner.quaternion.copy(cached.spinnerRotation);
      if (this.weaponPiston) this.weaponPiston.position.copy(cached.pistonPosition);
      if (this.weaponMagazine) {
        this.weaponMagazine.position.copy(this.weaponMagazineHome);
        this.weaponMagazine.rotation.copy(this.weaponMagazineRotation);
      }
      return;
    }
    // Normally the five-slot loadout is the bound; retain that bound even if a
    // diagnostic or future loadout supplies more than five distinct weapons.
    if (this.weaponModels.size >= 5) {
      const [id, model] = this.weaponModels.entries().next().value;
      disposeChildren(model.group);
      this.weaponModels.delete(id);
    }
    const glow = material(weapon.color, weapon.color, { emissiveIntensity: .25, roughness: .3, metalness: .25, clearcoat: .15 });
    glow.color.multiplyScalar(.32);
    const paint = material(new THREE.Color(weapon.color).lerp(new THREE.Color(0x303840), .72), 0,
      { roughness: .64, metalness: .38, clearcoat: .08 });
    const steel = material(0x667078, 0, { roughness: .48, metalness: .88, clearcoat: .06 });
    const dark = material(0x303942, 0, { roughness: .62, metalness: .62, clearcoat: .08 });
    const rubber = material(0x17212b, 0, { ...surfaceMaps("rubber"), roughness: .96, metalness: 0, clearcoat: 0 });
    const presentation = weaponPresentation(weapon);
    this.weaponGrip.set(.05, -.2, .11);
    this.weaponSupportGrip.set(-.14, -.1, .32);
    this.weaponHasSupportGrip = true;
    if (weapon.type === "melee") {
      this.weaponGrip.set(.06, -.01, .03);
      this.weaponHasSupportGrip = ["hammer", "chainsaw"].includes(weapon.id);
      if (weapon.id === "hammer") {
        this.weaponGrip.set(.06, .04, .18);
        this.weaponSupportGrip.set(-.055, .04, .12);
      } else if (weapon.id === "chainsaw") {
        this.weaponGrip.set(.06, -.07, .15);
        this.weaponSupportGrip.set(-.18, -.04, .2);
      }
    } else if (weapon.type === "mine" || weapon.type === "remote") {
      this.weaponGrip.set(.04, -.08, .2); this.weaponHasSupportGrip = false;
    } else if (weapon.id === "fireball" || presentation.delivery === "disc") {
      this.weaponGrip.set(.05, -.04, .28); this.weaponHasSupportGrip = false;
    } else if (weapon.type === "flame") this.weaponGrip.set(.05, -.15, .13);
    this.weaponGlowMaterial = glow;
    this.weaponSpinner = null;
    this.weaponPiston = null;
    this.weaponMagazine = null;
    this.weaponMuzzleDistance = .92;
    // ponytail: reuse the existing primitive builder and material batching for all weapon fittings.
    const box = (w, h, d, mat, x, y, z, parent = this.weaponGroup) => {
      const source = new THREE.BoxGeometry(w, h, d);
      // Thin plates, rails and vent cuts keep crisp edges; only the main housings need bevels.
      let geometry = source;
      if (Math.min(w, h, d) < (weapon.id === "blaster" ? .16 : .06)) {
        geometry = new THREE.BufferGeometry().copy(source);
        source.dispose();
      }
      const mesh = part(geometry, mat, x, y, z);
      parent.add(mesh); return mesh;
    };
    const armor = (w, h, d, mat, x, y, z, parent = this.weaponGroup) => {
      const geometry = new RoundedBoxGeometry(w, h, d, 1, Math.min(.04, w * .2, h * .2, d * .2));
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const front = positions.getZ(i) / d + .5;
        positions.setX(i, positions.getX(i) * (1 - front * .22));
        positions.setY(i, positions.getY(i) * (1 - front * .3));
      }
      geometry.computeVertexNormals();
      const mesh = part(geometry, mat, x, y, z);
      parent.add(mesh); return mesh;
    };
    const tube = (front, back, length, mat, x, y, z, parent = this.weaponGroup, open = false) => {
      const mesh = part(new THREE.CylinderGeometry(front, back, length, 8, 1, open), mat, x, y, z);
      mesh.rotation.x = Math.PI / 2;
      parent.add(mesh); return mesh;
    };
    const ring = (radius, thickness, mat, x, y, z, parent = this.weaponGroup) => {
      const mesh = part(new THREE.TorusGeometry(radius, thickness, weapon.id === "blaster" ? 3 : 4, weapon.id === "blaster" ? 8 : 12), mat, x, y, z);
      parent.add(mesh); return mesh;
    };
    const vents = (x, y, z, count = 3, parent = this.weaponGroup) => {
      for (let i = 0; i < count; i++) box(.014, .085, .025, dark, x, y, z + i * .06, parent);
    };
    const finish = () => {
      if (this.weaponSpinner?.isGroup) {
        mergeRigidMeshes(this.weaponSpinner);
        combineMaterialBatches(this.weaponSpinner);
      }
      if (this.weaponPiston?.isGroup) {
        mergeRigidMeshes(this.weaponPiston);
        combineMaterialBatches(this.weaponPiston);
      }
      this.weaponMagazineHome = this.weaponMagazine?.position.clone();
      this.weaponMagazineRotation = this.weaponMagazine?.rotation.clone();
      mergeRigidMeshes(this.weaponGroup, [this.weaponSpinner, this.weaponPiston, this.weaponMagazine]);
      combineMaterialBatches(this.weaponGroup, [this.weaponSpinner, this.weaponPiston, this.weaponMagazine]);
      this.weaponModels.set(weapon.id, {
        group: new THREE.Group(), grip: this.weaponGrip.clone(), supportGrip: this.weaponSupportGrip.clone(),
        spinnerRotation: this.weaponSpinner?.quaternion.clone(), pistonPosition: this.weaponPiston?.position.clone(),
        state: { weaponGlowMaterial: this.weaponGlowMaterial, weaponSpinner: this.weaponSpinner, weaponPiston: this.weaponPiston,
          weaponMagazine: this.weaponMagazine, weaponMagazineHome: this.weaponMagazineHome, weaponMagazineRotation: this.weaponMagazineRotation,
          weaponHasSupportGrip: this.weaponHasSupportGrip, weaponMuzzleDistance: this.weaponMuzzleDistance }
      });
    };
    if (weapon.type === "mine" || weapon.type === "remote") {
      if (weapon.type === "mine") {
        const body = part(new THREE.CylinderGeometry(.28, .34, .18, 10), dark, .04, .035, .2);
        const cap = part(new THREE.CylinderGeometry(.23, .25, .045, 10), paint, .04, .148, .2);
        this.weaponGroup.add(body, cap);
        for (const x of [-.18, .26]) {
          box(.09, .055, .34, steel, x, .155, .2);
          box(.035, .065, .035, rubber, x, .205, .2);
        }
        box(.095, .04, .095, dark, .04, .19, .2);
        box(.03, .008, .035, glow, .04, .215, .2);
      } else {
        armor(.5, .2, .4, dark, .04, .04, .2);
        armor(.38, .05, .3, paint, .04, .16, .2);
        for (const z of [.08, .32]) box(.54, .04, .045, steel, .04, .18, z);
        box(.16, .045, .12, rubber, .04, .198, .2);
        box(.055, .012, .035, glow, .04, .227, .2);
        const aerial = tube(.014, .014, .22, steel, .25, .22, .3);
        aerial.rotation.x = 0;
      }
      this.weaponMuzzleDistance = .55;
      finish();
      return;
    }
    if (weapon.id === "fireball") {
      tube(.21, .25, .58, dark, .05, -.04, .28);
      ring(.25, .035, steel, .05, -.04, .03);
      tube(.17, .2, .12, rubber, .05, -.04, .035, this.weaponGroup, true);
      armor(.38, .13, .4, paint, .05, .1, .32);
      armor(.34, .15, .42, dark, .05, -.06, .7);
      tube(.12, .14, .26, glow, .05, .04, .81);
      for (const x of [-.14, .24]) box(.075, .18, .53, steel, x, .04, .8);
      armor(.36, .06, .44, dark, .05, .2, .75);
      ring(.16, .045, steel, .05, .04, 1.035);
      tube(.12, .12, .13, dark, .05, .04, 1.02, this.weaponGroup, true);
      vents(.247, .1, .25);
      this.weaponMuzzleDistance = 1.12;
      finish();
      return;
    }
    if (weapon.type === "flame") {
      armor(.34, .32, .58, dark, .05, .01, .28);
      box(.045, .23, .4, paint, .242, .035, .27);
      const fuelTank = tube(.15, .15, .56, paint, -.18, -.04, .18);
      fuelTank.rotation.x = 0;
      fuelTank.rotation.z = Math.PI / 2;
      tube(.075, .12, 1.08, dark, .05, .06, .86, this.weaponGroup, true);
      for (const z of [.73, .94, 1.15]) ring(.145, .035, steel, .05, .06, z);
      for (const x of [-.085, .185]) box(.055, .13, .69, steel, x, .06, .99);
      box(.045, .09, .83, rubber, -.18, -.18, .73);
      ring(.14, .035, steel, .05, .06, 1.39);
      tube(.024, .033, .16, steel, .05, -.065, 1.39);
      tube(.018, .018, .035, glow, .05, -.065, 1.475);
      box(.16, .36, .18, rubber, .05, -.15, .13);
      vents(.27, .06, .16);
      this.weaponMuzzleDistance = 1.52;
      finish();
      return;
    }
    if (weapon.type === "melee") {
      const reachScale = Math.min(1.5, weapon.reach / 3.5);
      tube(.07, .085, .34, rubber, .06, -.01, .03);
      ring(.085, .02, steel, .06, -.01, -.14);
      box(.03, .025, .055, glow, .06, .075, .13);
      if (weapon.id === "hammer") {
        tube(.065, .08, 1.28, steel, .06, .04, .62);
        tube(.095, .095, .38, rubber, .06, .04, .59);
        armor(.66, .36, .4, dark, .06, .04, 1.28);
        armor(.48, .39, .32, paint, .06, .04, 1.28);
        for (const x of [-.31, .43]) {
          box(.11, .45, .44, steel, x, .04, 1.28);
          box(.018, .27, .27, dark, x + Math.sign(x) * .061, .04, 1.28);
        }
        box(.25, .1, .25, steel, .06, .275, 1.28);
        this.weaponMuzzleDistance = 1.72;
      } else if (weapon.id === "punch_glove") {
        const pistonGroup = new THREE.Group();
        tube(.19, .21, .34, dark, .06, .04, .15);
        ring(.21, .035, steel, .06, .04, .32);
        tube(.1, .13, .55, steel, .06, .04, .35, pistonGroup);
        armor(.45, .32, .3, dark, .06, .04, .72, pistonGroup);
        armor(.38, .12, .26, paint, .06, .24, .72, pistonGroup);
        for (const x of [-.12, 0, .12, .24]) box(.085, .19, .1, steel, x, .1, .91, pistonGroup);
        box(.14, .18, .25, rubber, -.2, -.1, .7, pistonGroup);
        this.weaponGroup.add(pistonGroup);
        this.weaponPiston = pistonGroup;
        this.weaponMuzzleDistance = 1.05;
      } else if (weapon.id === "chainsaw") {
        armor(.34, .32, .55, dark, .06, .04, .37);
        box(.045, .25, .41, paint, .253, .055, .37);
        box(.05, .19, 1.06, steel, .06, .04, 1.12);
        box(.065, .12, 1, dark, .06, .04, 1.12);
        for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
          const tooth = part(new THREE.ConeGeometry(.04, .07, 4), steel, .06, .04 + side * .125, .69 + i * .125);
          tooth.scale.x = .65; tooth.rotation.z = side < 0 ? Math.PI : 0;
          this.weaponGroup.add(tooth);
        }
        const teeth = ring(.105, .022, steel, .06, .04, 1.66);
        box(.08, .31, .07, steel, -.18, .015, .22);
        box(.3, .075, .075, rubber, -.06, .2, .22);
        vents(.278, .05, .25);
        this.weaponSpinner = teeth;
        this.weaponMuzzleDistance = 1.88;
      } else if (weapon.id === "spear") {
        tube(.045, .065, 1.9 * reachScale, steel, .06, .04, .78);
        tube(.075, .075, .48, rubber, .06, .04, .63);
        const blade = part(new THREE.ConeGeometry(.16, .62, 4), steel, .06, .04, 1.76 * reachScale);
        blade.rotation.x = Math.PI / 2;
        blade.scale.x = .28;
        this.weaponGroup.add(blade);
        tube(.085, .065, .16, dark, .06, .04, 1.76 * reachScale - .36);
        ring(.085, .018, paint, .06, .04, 1.76 * reachScale - .38);
        this.weaponMuzzleDistance = 2.05 * reachScale;
      } else {
        const bladeLength = (weapon.id === "knife" ? .62 : weapon.id === "shock_baton" ? .92 : 1.12) * reachScale;
        box(weapon.id === "knife" ? .22 : .34, weapon.id === "knife" ? .06 : .08, .12, weapon.id === "knife" ? paint : steel, .06, .04, .18);
        if (weapon.id === "knife") {
          tube(.035, .045, .18, steel, .06, .04, .29);
          const blade = part(new THREE.ConeGeometry(.115, bladeLength, 4), steel, .06, .04, .43 + bladeLength * .35);
          blade.rotation.x = Math.PI / 2; blade.scale.x = .19;
          this.weaponGroup.add(blade);
          box(.008, .035, bladeLength * .6, dark, .082, .04, .46);
        } else if (weapon.id === "shock_baton") {
          tube(.065, .08, bladeLength, dark, .06, .04, .43 + bladeLength * .35);
          for (let i = 0; i < 3; i++) {
            ring(.083, .018, steel, .06, .04, .41 + i * .2);
            ring(.069, .01, glow, .06, .04, .445 + i * .2);
          }
          box(.15, .13, .19, paint, .06, .04, .27);
        } else {
          const blade = part(new THREE.ConeGeometry(.14, bladeLength, 4), glow, .06, .04, .43 + bladeLength * .35);
          blade.rotation.x = Math.PI / 2; blade.scale.x = .22;
          this.weaponGroup.add(blade);
          box(.025, .035, bladeLength * .7, steel, .06, .01, .41 + bladeLength * .27);
          armor(.08, .16, .18, paint, .06, .04, .25);
          for (const x of [-.095, .215]) box(.07, .12, .26, dark, x, .04, .23);
        }
        this.weaponMuzzleDistance = .55 + bladeLength;
      }
      finish();
      return;
    }
    if (presentation.delivery === "disc") {
      tube(.18, .24, .54, dark, .05, -.04, .25);
      armor(.29, .1, .35, paint, .05, .16, .25);
      const blade = ring(.29, .026, steel, .05, .11, .72);
      blade.rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3;
        const edge = part(new THREE.ConeGeometry(.16, .45, 3), steel, Math.sin(angle) * .22, Math.cos(angle) * .22, 0);
        edge.scale.z = .16; edge.rotation.z = -angle;
        blade.add(edge);
      }
      mergeRigidMeshes(blade);
      tube(.09, .11, .14, dark, .05, .105, .72).rotation.x = 0;
      box(.05, .012, .08, glow, .05, .19, .72);
      box(.18, .22, .45, rubber, .05, -.08, .48);
      this.weaponSpinner = blade;
      this.weaponMuzzleDistance = 1.18;
      finish();
      return;
    }
    const heavy = ["rocket", "plasma", "grenade"].includes(weapon.type);
    const width = heavy ? .38 : .3;
    armor(width, .3, heavy ? .66 : .5, dark, .05, .02, .26);
    const grip = armor(.18, .38, .2, rubber, .05, -.2, .11);
    grip.rotation.x = -.18;
    for (const side of [-1, 1]) {
      const x = .05 + side * (width / 2 + .012);
      box(.035, .22, .36, paint, x, .035, .24);
      for (const z of [.1, .38]) {
        const bolt = tube(.017, .017, .045, steel, x + side * .021, .11, z);
        bolt.rotation.set(0, 0, Math.PI / 2);
      }
      vents(x + side * .021, -.025, .18);
    }
    box(.035, .022, .07, glow, .05 - width / 2 - .031, .12, .3);
    box(.16, .05, .18, steel, .05, .185, .16);

    if (weapon.type === "rocket") {
      tube(.205, .23, .91, steel, .05, .06, .72, this.weaponGroup, true);
      ring(.225, .045, dark, .05, .06, 1.18);
      tube(.165, .165, .14, rubber, .05, .06, 1.105, this.weaponGroup, true);
      ring(.235, .035, dark, .05, .06, .49);
      armor(.42, .09, .46, dark, .05, -.13, .65);
      box(.07, .09, .57, steel, .05, .3, .67);
      armor(.09, .065, .12, dark, .05, .345, .88);
      if (weapon.id === "drill_missile") {
        const bit = part(new THREE.ConeGeometry(.145, .26, 6), steel, .05, .06, 1.04);
        bit.rotation.x = Math.PI / 2;
        this.weaponGroup.add(bit);
        for (const z of [.9, .98, 1.06]) ring(.15 - (z - .9) * .45, .025, dark, .05, .06, z);
      } else if (weapon.id === "napalm_launcher") {
        tube(.1, .1, .47, paint, -.24, -.055, .57);
        ring(.245, .018, paint, .05, .06, .92);
        box(.035, .06, .58, rubber, -.24, -.17, .7);
      } else {
        box(.045, .15, .36, paint, .287, .055, .61);
        armor(.09, .06, .12, rubber, .05, .345, .43);
      }
      this.weaponMuzzleDistance = 1.28;
    } else if (weapon.type === "plasma") {
      tube(.12, .14, .42, glow, .05, .07, .58);
      ring(.165, .045, steel, .05, .07, .4);
      ring(.17, .045, steel, .05, .07, .77);
      for (const side of [-1, 1]) {
        const x = .05 + side * .24;
        armor(.13, .3, .24, dark, x, .07, .43);
        armor(.13, .25, .27, dark, x, .07, .9);
        box(.065, .045, .49, steel, x, .21, .66);
        box(.065, .04, .49, steel, x, -.075, .66);
        box(.016, .065, .16, glow, x, .09, .655);
        vents(x + side * .065, .065, .835, 3);
      }
      armor(.33, .09, .48, paint, .05, .27, .55);
      armor(.35, .075, .64, steel, .05, -.13, .66);
      if (weapon.id === "black_hole_generator") {
        ring(.245, .05, dark, .05, .07, 1.07);
        ring(.175, .02, glow, .05, .07, 1.045);
        tube(.14, .19, .28, rubber, .05, .07, .93, this.weaponGroup, true);
        armor(.42, .09, .28, steel, .05, .275, .93);
        for (const z of [.45, .64, .83]) ring(.17, .027, dark, .05, .07, z);
      } else if (weapon.id === "tornado_generator") {
        tube(.21, .24, .31, steel, .05, .07, .99, this.weaponGroup, true);
        ring(.21, .033, dark, .05, .07, 1.145);
        for (let i = 0; i < 3; i++) {
          const angle = i * Math.PI * 2 / 3;
          const vane = box(.12, .035, .13, steel, .05 + Math.cos(angle) * .1, .07 + Math.sin(angle) * .1, 1.02);
          vane.rotation.z = angle; vane.rotation.y = .5;
        }
      } else if (weapon.id === "grapple_disrupting_pulse") {
        tube(.21, .17, .29, dark, .05, .07, .98, this.weaponGroup, true);
        ring(.19, .025, steel, .05, .07, 1.135);
        ring(.14, .015, glow, .05, .07, 1.105);
        for (const x of [-.17, .27]) box(.06, .14, .2, steel, x, .07, 1.05);
      } else {
        tube(.135, .18, .33, steel, .05, .07, .995, this.weaponGroup, true);
        ring(.145, .04, dark, .05, .07, 1.145);
        if (weapon.id === "pulse_cannon") {
          for (const x of [-.12, .22]) tube(.055, .055, .42, dark, x, .24, .65);
          armor(.42, .08, .26, steel, .05, .24, 1.02);
        } else {
          for (const x of [-.21, .31]) box(.05, .13, .34, steel, x, .07, 1.01);
        }
      }
      this.weaponMuzzleDistance = 1.21;
    } else if (weapon.type === "rail") {
      for (const x of [-.065, .165]) {
        box(.08, .12, 1.18, steel, x, .08, .78);
        box(.025, .045, .86, glow, x + (x < .05 ? .048 : -.048), .08, .78);
      }
      for (const z of [.43, .84, 1.26]) box(.36, .19, .075, dark, .05, .08, z);
      tube(.105, .105, .4, dark, .05, .23, .5);
      for (const z of [.34, .5, .66]) ring(.113, .018, steel, .05, .23, z);
      box(.28, .22, .42, dark, .05, .01, -.14);
      box(.3, .27, .065, rubber, .05, .01, -.35);
      if (weapon.id === "charged_energy_rifle") {
        for (const x of [-.22, .32]) tube(.085, .085, .46, paint, x, .025, .38);
        box(.1, .06, .55, dark, .05, .37, .44);
      } else {
        tube(.055, .055, .3, dark, .05, .365, .46);
        ring(.06, .017, steel, .05, .365, .605);
      }
      this.weaponMuzzleDistance = 1.42;
    } else if (weapon.type === "beam" || weapon.type === "chain") {
      tube(.11, .16, .89, dark, .05, .06, .69, this.weaponGroup, true);
      tube(.135, .135, .3, glow, .05, .06, .57);
      for (const z of [.43, .56, .69]) ring(.16, .024, steel, .05, .06, z);
      const forkA = box(.075, .11, .62, steel, -.13, .07, .93);
      const forkB = box(.075, .11, .62, steel, .23, .07, .93);
      if (weapon.type === "chain") {
        forkA.rotation.y = -.15;
        forkB.rotation.y = .15;
        for (const x of [-.18, .28]) tube(.045, .065, .18, glow, x, .07, 1.08);
        armor(.36, .08, .23, paint, .05, .24, .49);
        for (const x of [-.07, .17]) tube(.032, .05, .25, dark, x, .07, 1.16, this.weaponGroup, true);
      } else if (weapon.id === "gravity_beam") {
        ring(.24, .045, dark, .05, .06, 1.17);
        ring(.18, .018, glow, .05, .06, 1.145);
        box(.43, .06, .54, steel, .05, -.14, .82);
      } else if (weapon.id === "disintegration_weapon") {
        box(.09, .075, .73, steel, .05, .235, .87);
        box(.09, .075, .73, steel, .05, -.115, .87);
        armor(.34, .34, .1, dark, .05, .06, 1.185);
        tube(.035, .09, .16, glow, .05, .06, 1.19);
      } else {
        tube(.055, .11, .29, steel, .05, .06, 1.09, this.weaponGroup, true);
        ring(.063, .018, dark, .05, .06, 1.225);
        tube(.05, .05, .28, dark, .05, .31, .4);
      }
      this.weaponMuzzleDistance = 1.31;
    } else if (weapon.type === "spread") {
      for (const x of [-.065, .165]) {
        tube(.085, .105, .82, steel, x, .08, .74, this.weaponGroup, true);
        ring(.09, .022, dark, x, .08, 1.145);
      }
      armor(.43, .12, .48, dark, .05, .075, .56);
      armor(.42, .15, .3, rubber, .05, -.06, .68);
      for (const z of [.58, .66, .74]) box(.44, .035, .03, steel, .05, -.06, z);
      tube(.045, .045, .53, paint, .05, -.125, .86);
      box(.28, .19, .31, dark, .05, .015, -.12);
      this.weaponMuzzleDistance = 1.19;
    } else if (weapon.id === "submachine_gun") {
      armor(.34, .26, .5, dark, .05, .02, .38);
      box(.15, .045, .38, steel, .05, .185, .39);
      tube(.055, .08, .42, steel, .05, .05, .81, this.weaponGroup, true);
      const stickMagazine = box(.15, .42, .18, dark, .05, -.27, .31);
      stickMagazine.rotation.x = -.16;
      box(.07, .08, .35, steel, -.035, .04, -.13);
      box(.07, .08, .35, steel, .135, .04, -.13);
      box(.24, .2, .07, rubber, .05, -.005, -.31);
      ring(.075, .025, dark, .05, .05, 1.015);
      vents(.228, .07, .49, 2);
      this.weaponMagazine = stickMagazine;
      this.weaponMuzzleDistance = 1.08;
    } else if (weapon.id === "mortar") {
      tube(.24, .27, 1.08, steel, .05, .08, .72, this.weaponGroup, true);
      ring(.265, .045, dark, .05, .08, 1.25);
      const breech = tube(.25, .25, .32, paint, .05, .08, .18);
      breech.rotation.x = 0;
      breech.rotation.z = Math.PI / 2;
      box(.07, .28, .13, steel, -.25, .25, .6);
      box(.065, .09, .28, dark, -.25, .42, .63);
      box(.39, .16, .45, dark, .05, -.08, -.08);
      for (const z of [.47, .98]) ring(.27, .035, dark, .05, .08, z);
      box(.045, .045, .6, steel, .05, .37, .75);
      this.weaponMuzzleDistance = 1.38;
    } else if (weapon.id === "minigun" || weapon.id === "machine_gun") {
      const rotary = weapon.id === "minigun";
      const barrelCount = rotary ? 6 : 1;
      const barrelCluster = new THREE.Group();
      if (rotary) barrelCluster.position.set(.05, .06, 0);
      for (let index = 0; index < barrelCount; index++) {
        const angle = index / barrelCount * Math.PI * 2;
        const x = rotary ? Math.cos(angle) * .125 : .05, y = rotary ? Math.sin(angle) * .125 : .06;
        tube(rotary ? .037 : .065, rotary ? .045 : .085, .86, steel, x, y, .72, barrelCluster, true);
        ring(rotary ? .041 : .069, .015, dark, x, y, 1.15, barrelCluster);
      }
      if (rotary) {
        for (const z of [.4, .94]) ring(.175, .037, dark, 0, 0, z, barrelCluster);
        tube(.028, .028, .83, dark, 0, 0, .7, barrelCluster);
        armor(.43, .11, .35, paint, .05, .23, .31);
        vents(.263, .23, .22);
      } else {
        for (const x of [-.065, .165]) box(.055, .12, .54, dark, x, .065, .63);
        box(.28, .045, .52, steel, .05, .16, .59);
        box(.28, .19, .31, dark, .05, .015, -.13);
        vents(.201, .055, .52, 4);
      }
      const drum = tube(rotary ? .25 : .2, rotary ? .25 : .2, .34, dark, .05, -.11, .34);
      drum.rotation.x = 0;
      drum.rotation.z = Math.PI / 2;
      this.weaponGroup.add(barrelCluster);
      this.weaponMagazine = drum;
      if (rotary) this.weaponSpinner = barrelCluster;
      this.weaponMuzzleDistance = 1.17;
    } else {
      const grenade = weapon.type === "grenade";
      const radius = grenade ? .15 : weapon.id === "needle_launcher" ? .055 : .095;
      tube(radius, radius * 1.2, .65, steel, .05, .06, .67, this.weaponGroup, true);
      ring(radius + .015, .035, dark, .05, .06, .98);
      ring(radius, .014, steel, .05, .06, .994);
      const bore = part(new THREE.CircleGeometry(radius * .8, 12), presentation.energy ? glow : rubber, .05, .06, .94);
      this.weaponGroup.add(bore);
      if (weapon.id === "blaster") box(.29, .08, .42, dark, .05, .18, .61);
      else armor(grenade ? .41 : .29, .08, .42, dark, .05, .18, .61);
      if (grenade) {
        const drum = tube(.22, .22, .36, dark, .05, -.12, .39);
        drum.rotation.x = 0;
        drum.rotation.z = Math.PI / 2;
        this.weaponMagazine = drum;
        if (weapon.id === "cluster_grenade") {
          for (const x of [-.16, .26]) tube(.062, .062, .37, paint, x, .12, .59);
          box(.42, .06, .2, steel, .05, .245, .58);
        } else if (weapon.id === "sticky_launcher") {
          tube(.085, .085, .45, paint, -.2, -.015, .52);
          for (const x of [-.12, .22]) box(.055, .13, .16, dark, x, .06, .9);
        } else if (weapon.id === "implosion_bomb" || weapon.id === "gravity_grenade") {
          ring(.2, .035, dark, .05, .06, .76);
          ring(.155, .02, glow, .05, .06, .72);
          box(.42, .055, weapon.id === "gravity_grenade" ? .34 : .2, paint, .05, .27, .54);
        } else if (weapon.id === "bouncing_bomb") {
          for (const z of [.52, .7, .88]) ring(.18, .025, rubber, .05, .06, z);
          box(.4, .06, .1, steel, .05, .24, .7);
        } else {
          box(.14, .05, .18, steel, .05, .285, .55);
          box(.065, .06, .065, rubber, .05, .335, .55);
        }
      } else if (weapon.id === "needle_launcher") {
        for (const x of [-.07, .17]) box(.04, .09, .55, dark, x, .06, .65);
        box(.2, .24, .27, paint, .05, -.12, .37);
        tube(.04, .04, .28, dark, .05, .27, .53);
      } else if (weapon.id === "burst_rifle") {
        box(.27, .2, .31, dark, .05, .015, -.13);
        box(.14, .27, .17, paint, .05, -.2, .35);
        for (const z of [.45, .6, .75]) box(.31, .045, .035, steel, .05, .2, z);
      } else if (weapon.id === "freeze_gun") {
        for (const x of [-.17, .27]) tube(.09, .09, .44, paint, x, .03, .47);
        for (const z of [.56, .69, .82]) ring(.12, .025, steel, .05, .06, z);
        box(.34, .09, .2, dark, .05, .27, .44);
      } else if (weapon.id === "plasma_repeater" || weapon.id === "blaster") {
        tube(.1, .1, .27, glow, .05, .06, .56);
        for (const x of [-.095, .195]) box(.045, .16, .34, dark, x, .06, .6);
        for (const z of [.43, .7]) ring(.125, .026, steel, .05, .06, z);
        box(.22, weapon.id === "plasma_repeater" ? .25 : .14, .2, paint, .05, -.18, .35);
      } else if (weapon.id === "ricochet_cannon") {
        for (const z of [.48, .68, .86]) ring(.14, .03, steel, .05, .06, z);
        for (const x of [-.115, .215]) box(.055, .15, .41, dark, x, .06, .65);
        box(.25, .18, .27, paint, .05, -.14, .36);
      } else if (weapon.id === "temporary_wall") {
        for (const x of [-.145, .245]) box(.1, .29, .36, paint, x, .06, .77);
        box(.42, .065, .2, steel, .05, .25, .84);
        box(.2, .12, .32, dark, .05, -.17, .57);
      } else if (weapon.id === "decoy_launcher") {
        box(.26, .2, .29, dark, .05, .25, .56);
        tube(.065, .075, .19, glow, .05, .25, .66);
        for (const x of [-.12, .22]) box(.045, .15, .26, steel, x, .25, .58);
        box(.16, .25, .22, paint, .05, -.18, .38);
      } else if (weapon.id === "teleport_projectile") {
        for (const z of [.47, .7, .9]) ring(.14, .023, steel, .05, .06, z);
        for (const x of [-.12, .22]) box(.055, .12, .53, dark, x, .06, .68);
        box(.22, .2, .26, glow, .05, .025, .48);
        box(.23, .045, .3, paint, .05, .23, .47);
      } else if (weapon.id === "weapon_stealing_projectile") {
        for (const side of [-1, 1]) {
          const jaw = box(.055, .12, .3, steel, .05 + side * .16, .06, .84);
          jaw.rotation.y = side * -.25;
          box(.07, .12, .08, dark, .05 + side * .125, .06, .98);
        }
        box(.25, .14, .25, paint, .05, -.13, .39);
      }
      this.weaponMuzzleDistance = 1.08;
    }
    finish();
  }

  switchSlot(index) {
    if (index < 0 || index >= this.loadout.length || index === this.slotIndex) return;
    this.slotIndex = index;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.updateWeaponModel();
  }

  reload() {
    const weapon = this.weapon;
    if (!weaponUsesAmmo(weapon) || this.reloadTimer > 0 || this.ammo[weapon.id] === weapon.ammo) return false;
    this.reloadTimer = weapon.reload;
    this.reloadWeaponId = weapon.id;
    return true;
  }

  recoil(amount = this.weapon.recoil) {
    this.velocity.addScaledVector(this.aim, -amount);
    this.recoilVisual = Math.max(this.recoilVisual, clamp(.15 + amount * .12, .18, .9));
    this.weaponKick.velocity = Math.min(8, this.weaponKick.velocity + 2 + Math.max(0, amount) * .8);
  }

  takeHit(amount, push = null) {
    if (!this.alive) return false;
    this.health = clamp(this.health - amount, 0, 100);
    this.hitTimer = .5;
    this.hitStagger = push?.lengthSq()
      ? Math.sign(push.x * this.aim.z - push.z * this.aim.x) || 1
      : (Number(String(this.id).match(/\d+/)?.[0] || 1) % 2 ? 1 : -1);
    if (push) this.velocity.add(push);
    if (this.health > 0) return false;
    this.alive = false;
    this.slowTimer = 0;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.freezeRing.material.opacity = 0;
    this.deaths += 1;
    this.deathTimer = 1.4;
    return true;
  }

  reconcileAuthoritativeLife(health, alive, respawnPosition = null) {
    const nextHealth = clamp(Number.isFinite(health) ? health : this.health, 0, 100);
    const shouldLive = alive !== false && nextHealth > 0;
    if (!shouldLive) {
      if (!this.alive) {
        this.health = 0;
        return "none";
      }
      this.takeHit(100);
      this.health = 0;
      return "died";
    }
    if (!this.alive) {
      if (!respawnPosition) return "none";
      this.respawn(respawnPosition);
      this.health = nextHealth;
      return "respawned";
    }
    this.health = nextHealth;
    return "none";
  }

  updateDeath(dt) {
    if (this.alive || this.deathTimer <= 0) return;
    this.backHaloMaterial.opacity = 0;
    this.backVentMaterial.opacity = 0;
    this.deathTimer = Math.max(0, this.deathTimer - dt);
    const progress = 1 - this.deathTimer / 1.4;
    const side = Number(String(this.id).match(/\d+/)?.[0] || 1) % 2 ? 1 : -1;
    const burst = Math.sin(progress * Math.PI);
    const fade = 1 - progress;
    this.rig.rotation.set(progress * .88, side * progress * 1.5, side * progress * 1.28);
    this.rig.position.y = burst * .28 - progress * .78;
    this.leftArm.rotation.z = .72 + side * progress * .7;
    this.rightArm.rotation.z = -.72 + side * progress * .5;
    this.leftLeg.rotation.x = .35 + progress * .9;
    this.rightLeg.rotation.x = -.2 - progress * .7;
    this.group.scale.setScalar(1 + burst * .1 - progress * .78);
    this.armorMaterial.emissiveIntensity = 1.65 * fade;
    this.accentMaterial.emissiveIntensity = 2.8 * fade;

    this.identityRing.material.opacity = .62 * fade;
    this.identityBeacon.material.opacity = fade;
    if (this.deathTimer === 0) this.group.visible = false;
  }

  respawn(position) {
    this.muzzleRevision = (this.muzzleRevision || 0) + 1;
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.deathTimer = 0;
    this.grounded = true;
    this.boosted = false;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.rig.position.y = -.035;
    this.rig.rotation.set(0, 0, 0);
    this.rig.scale.set(1.07, 1.04, 1.07);
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);
    this.leftLeg.rotation.set(0, 0, 0);
    this.rightLeg.rotation.set(0, 0, 0);
    this.leftKnee.rotation.set(0, 0, 0);
    this.rightKnee.rotation.set(0, 0, 0);
    this.leftAnkle.rotation.set(0, 0, 0);
    this.rightAnkle.rotation.set(0, 0, 0);
    this.locomotionVisual = 0;
    this.gaitPhase = 0;
    this.strideVelocity.set(0, 0);
    this.armorMaterial.emissiveIntensity = .025;
    this.accentMaterial.emissiveIntensity = .7;
    this.backGlow = 0;
    this.backHaloMaterial.opacity = 0;
    this.backVentMaterial.opacity = .12;

    this.identityRing.material.opacity = .46;
    this.identityBeacon.material.opacity = .94;
    this.ammo = Object.fromEntries(this.loadout.map((id) => [id, WEAPONS[id].ammo]));
    this.reloadTimer = 0;
    this.reloadWeaponId = null;
    this.attackTimer = .7;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.slowTimer = 0;
    this.landTimer = 0;
    this.landStrength = 0;
    this.recoilVisual = 0;
    this.bodyPitchSpring.value = this.bodyPitchSpring.velocity = 0;
    this.bodyRollSpring.value = this.bodyRollSpring.velocity = 0;
    this.previousVisualVelocity.set(0, 0, 0);
    this.weaponKick.value = this.weaponKick.velocity = 0;
    this.weaponSpinSpeed = 0;
    this.hitStagger = 1;
    this.grapple = null;
    this.ledgeContact = null;
  }

  update(dt, move, look, actions, world) {
    if (!this.alive) return;
    if (this.supportGripProgress === 0) {
      this.supportArmStart.copy(this.leftArm.quaternion);
      this.supportForearmStart.copy(this.leftForearm.quaternion);
    }
    const wasGrounded = this.grounded;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const reloading = this.reloadTimer > 0;
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    if (reloading && this.reloadTimer === 0 && this.reloadWeaponId) {
      this.ammo[this.reloadWeaponId] = WEAPONS[this.reloadWeaponId].ammo;
      this.reloadWeaponId = null;
    }
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.recoilVisual = THREE.MathUtils.damp(this.recoilVisual, 0, 8, dt);

    if (look.lengthSq() > .001) this.aim.copy(look).normalize();
    if (actions.jump && this.grounded) {
      this.velocity.y = 7.5;
      this.grounded = false;
    }

    const moving = move.lengthSq() > .001;
    this.controlMove.copy(move);
    const movementScale = this.slowTimer > 0 ? .48 : 1;
    const desired = this.desiredMove.copy(move);
    if (moving) desired.normalize().multiplyScalar(9 * movementScale);
    else desired.set(0, 0, 0);
    // Grapple physics owns horizontal acceleration while attached. Ground
    // locomotion damping here would erase its pull before every movement step.
    if (!this.grapple && this.grounded) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, 11, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, 11, dt);
    } else if (!this.grapple) {
      const acceleration = 7 * movementScale;
      this.velocity.x += desired.x / 9 * acceleration * dt;
      this.velocity.z += desired.z / 9 * acceleration * dt;
      const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const limit = 16;
      if (horizontalSpeed > limit) {
        this.velocity.x *= limit / horizontalSpeed;
        this.velocity.z *= limit / horizontalSpeed;
      }
    }
    this.velocity.y -= 19 * dt;
    const fallSpeed = Math.max(0, -this.velocity.y);
    const previous = this.previousPosition.copy(this.position);
    this.position.addScaledVector(this.velocity, dt);

    const collision = world.resolve(this.position, this.radius, previous);
    this.ledgeContact = collision.ledge;
    if (collision.ceiling && this.velocity.y > 0) this.velocity.y = 0;
    if (collision.grounded && this.velocity.y <= 0) {
      if (!wasGrounded && fallSpeed > 2.5) {
        this.landTimer = .22;
        this.landStrength = clamp((fallSpeed - 2) / 15, .18, 1);
      }
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    const boost = this.grounded ? world.boostAt(this.position) : null;
    this.boosted = Boolean(boost);
    if (boost) {
      this.velocity.y = boost.strength;
      this.grounded = false;
    }

    const angle = Math.atan2(this.aim.x, this.aim.z);
    // Visual inertia follows acceleration/braking without changing collisions,
    // aiming or feet: the existing grounded leg solver runs after the lean.
    const ax = (this.velocity.x - this.previousVisualVelocity.x) / Math.max(dt, .0001);
    const az = (this.velocity.z - this.previousVisualVelocity.z) / Math.max(dt, .0001);
    this.previousVisualVelocity.copy(this.velocity);
    if (actions.reducedMotion || this.graphicsEffects?.mechaMotion === false) {
      this.bodyPitchSpring.value = this.bodyPitchSpring.velocity = 0;
      this.bodyRollSpring.value = this.bodyRollSpring.velocity = 0;
    } else {
      advanceSpring(this.bodyPitchSpring, clamp(-(ax * this.aim.x + az * this.aim.z) * .0015, -.07, .07), dt);
      advanceSpring(this.bodyRollSpring, clamp(-(ax * this.aim.z - az * this.aim.x) * .00125, -.06, .06), dt);
    }
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, angle, 15, dt);
    const time = performance.now() * .009;
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const locomotion = clamp(horizontalSpeed / 9, 0, 1);
    const grappled = Boolean(this.grapple);
    this.locomotionVisual = THREE.MathUtils.damp(this.locomotionVisual || 0,
      this.grounded && !grappled ? locomotion : 0, 10, dt);
    if (this.grounded && !grappled) this.gaitPhase = (this.gaitPhase + dt * (4 + horizontalSpeed * .72) * this.locomotionVisual) % (Math.PI * 2);
    const gait = Math.sin(this.gaitPhase);
    const landing = this.landTimer > 0
      ? this.landStrength * Math.sin((1 - this.landTimer / .22) * Math.PI)
      : 0;
    const hitProgress = 1 - clamp(this.hitTimer / .5, 0, 1);
    const hitWave = this.hitTimer > 0 ? Math.sin(hitProgress * Math.PI) : 0;
    let grappleSide = 0;
    if (grappled) {
      const anchor = this.grapple.wraps?.[0] || this.grapple.anchor;
      const dx = anchor.x - this.position.x;
      const dz = anchor.z - this.position.z;
      grappleSide = (dx * this.aim.z - dz * this.aim.x) / Math.max(1, Math.hypot(dx, dz));
    }
    // Air poses blend normally; grounded hips, knees and ankles are solved
    // together after the body's lean below.
    if (!this.grounded) {
      const tuck = clamp(Math.abs(this.velocity.y) / 18, .12, .52);
      const leftLegTarget = grappled ? .94 + clamp(-this.velocity.y * .024, -.28, .34) - grappleSide * .18
        : this.velocity.y > 0 ? .48 + tuck * .55 : .18 + tuck;
      const rightLegTarget = grappled ? -.52 + clamp(-this.velocity.y * .018, -.2, .28) + grappleSide * .18
        : this.velocity.y > 0 ? -.32 + tuck * .38 : -.14 + tuck * .78;
      this.leftLeg.rotation.x = THREE.MathUtils.damp(this.leftLeg.rotation.x, leftLegTarget, 15, dt);
      this.rightLeg.rotation.x = THREE.MathUtils.damp(this.rightLeg.rotation.x, rightLegTarget, 15, dt);
      this.leftKnee.rotation.x = THREE.MathUtils.damp(this.leftKnee.rotation.x, grappled ? .7 : .48, 15, dt);
      this.rightKnee.rotation.x = THREE.MathUtils.damp(this.rightKnee.rotation.x, grappled ? .7 : .48, 15, dt);
      this.leftAnkle.rotation.x = THREE.MathUtils.damp(this.leftAnkle.rotation.x, -.18, 15, dt);
      this.rightAnkle.rotation.x = THREE.MathUtils.damp(this.rightAnkle.rotation.x, -.18, 15, dt);
      this.leftAnkle.rotation.y = this.rightAnkle.rotation.y = 0;
      this.leftAnkle.rotation.z = this.rightAnkle.rotation.z = 0;
    }

    const aimPitch = Math.asin(clamp(this.aim.y, -1, 1));
    const melee = this.weapon.type === "melee";
    const meleeMotion = this.weapon.meleeMotion;
    const attacking = this.attackTimer > this.weapon.cooldown * .55;
    const attackPhase = this.weapon.cooldown > 0 ? clamp(this.attackTimer / this.weapon.cooldown, 0, 1) : 0;
    const attackSwing = attacking ? Math.sin((1 - attackPhase) * Math.PI) : 0;
    const reloadingPose = this.reloadTimer > 0 ? 1 : 0;
    let leftArmTarget = -1.06 - aimPitch * .65 - gait * locomotion * .075;
    let rightArmTarget = -1.24 - aimPitch * .72 + this.recoilVisual * 1.06 + gait * locomotion * .045;
    let leftArmRoll = .64;
    let rightArmRoll = -.18;
    if (melee) {
      leftArmTarget = -.42;
      rightArmTarget = attacking
        ? meleeMotion === "overhead" ? -2.28 + attackSwing * .92
          : ["thrust", "stab", "punch"].includes(meleeMotion) ? -.7 - attackSwing * .65
            : -1.72 + attackSwing * .46
        : -.48;
      leftArmRoll = .1;
      rightArmRoll = -.2 - attackSwing * (meleeMotion === "saw" ? .12 : meleeMotion === "overhead" ? .3 : .78);
    } else if (grappled) {
      const anchor = this.grapple.wraps?.[0] || this.grapple.anchor;
      const ropeLength = anchor ? this.position.distanceTo(anchor) : 1;
      const ropePitch = anchor ? Math.asin(clamp((anchor.y - this.position.y - 1.4) / Math.max(.01, ropeLength), -1, 1)) : 0;
      leftArmTarget = -1.78 - ropePitch * .82;
      leftArmRoll = .5 + grappleSide * .3;
      rightArmTarget -= .22;
    } else if (reloadingPose) {
      leftArmTarget = -.58;
      rightArmTarget = -.82;
      leftArmRoll = .72;
      rightArmRoll = -.38;
    }
    if (landing > .05) {
      leftArmTarget -= landing * .24;
      rightArmTarget -= landing * .2;
      leftArmRoll += landing * .18;
      rightArmRoll -= landing * .18;
    }
    if (hitWave > .01) {
      leftArmTarget += hitWave * .24;
      rightArmTarget -= hitWave * .2;
      leftArmRoll += this.hitStagger * hitWave * .34;
      rightArmRoll += this.hitStagger * hitWave * .28;
    }
    this.leftArm.rotation.x = THREE.MathUtils.damp(this.leftArm.rotation.x, leftArmTarget, 19, dt);
    this.rightArm.rotation.x = THREE.MathUtils.damp(this.rightArm.rotation.x, rightArmTarget, 19, dt);
    this.leftArm.rotation.z = THREE.MathUtils.damp(this.leftArm.rotation.z, leftArmRoll, 17, dt);
    this.rightArm.rotation.z = THREE.MathUtils.damp(this.rightArm.rotation.z, rightArmRoll, 17, dt);
    this.leftArm.rotation.y = THREE.MathUtils.damp(this.leftArm.rotation.y, melee ? 0 : -.26, 17, dt);
    this.rightArm.rotation.y = THREE.MathUtils.damp(this.rightArm.rotation.y, melee ? .15 : .08, 17, dt);

    let leftElbow = melee ? -.22 : -.78 - aimPitch * .16;
    let rightElbow = melee ? -.18 : -.42 - aimPitch * .12 + this.recoilVisual * .48;
    let leftElbowRoll = melee ? .08 : -.18;
    let rightElbowRoll = melee ? -.05 : .12;
    if (grappled) {
      leftElbow = .08;
      leftElbowRoll = .03;
      rightElbow = -.55;
    } else if (reloadingPose) {
      leftElbow = -1.08;
      rightElbow = -.72;
      leftElbowRoll = -.38;
      rightElbowRoll = .26;
    } else if (landing > .05) {
      leftElbow -= landing * .38;
      rightElbow -= landing * .38;
      leftElbowRoll -= landing * .24;
      rightElbowRoll += landing * .24;
    }
    this.leftForearm.rotation.x = THREE.MathUtils.damp(this.leftForearm.rotation.x, leftElbow, 22, dt);
    this.rightForearm.rotation.x = THREE.MathUtils.damp(this.rightForearm.rotation.x, rightElbow, 22, dt);
    this.leftForearm.rotation.z = THREE.MathUtils.damp(this.leftForearm.rotation.z, leftElbowRoll, 18, dt);
    this.rightForearm.rotation.z = THREE.MathUtils.damp(this.rightForearm.rotation.z, rightElbowRoll, 18, dt);

    const overheadPitch = meleeMotion === "overhead" ? -attackSwing * 1.05 : 0;
    const thrustMotion = ["thrust", "stab", "punch"].includes(meleeMotion) ? attackSwing : 0;
    const weaponReducedMotion = actions.reducedMotion || this.graphicsEffects?.weaponMotion === false;
    if (weaponReducedMotion) this.weaponKick.value = this.weaponKick.velocity = 0;
    const kick = weaponReducedMotion ? this.recoilVisual * .05 : clamp(advanceSpring(this.weaponKick, 0, dt, 24, .74), -.02, .22);
    const reloadProgress = reloadingPose ? 1 - clamp(this.reloadTimer / this.weapon.reload, 0, 1) : 0;
    const reloadMotion = reloadingPose && !weaponReducedMotion ? Math.sin(reloadProgress * Math.PI) : 0;
    this.weaponGroup.rotation.x = THREE.MathUtils.damp(this.weaponGroup.rotation.x, -aimPitch + kick * 1.8 + overheadPitch - reloadMotion * .12, 22, dt);
    this.weaponGroup.rotation.y = THREE.MathUtils.damp(this.weaponGroup.rotation.y, melee && !thrustMotion ? attackSwing * (meleeMotion === "saw" ? .12 : .72) : 0, 19, dt);
    this.weaponGroup.rotation.z = THREE.MathUtils.damp(this.weaponGroup.rotation.z, melee ? -.18 - attackSwing * (meleeMotion === "overhead" ? .26 : meleeMotion === "saw" ? .1 : .85) : reloadingPose ? -.25 * reloadMotion : grappled ? Math.sin(time * .42) * .035 : 0, 16, dt);
    this.weaponGroup.position.x = THREE.MathUtils.damp(this.weaponGroup.position.x, melee ? .34 : reloadingPose ? .18 : .26, 18, dt);
    this.weaponGroup.position.y = THREE.MathUtils.damp(this.weaponGroup.position.y, 1.6 - landing * .11 + (this.grounded && moving && !grappled ? gait * .025 : 0), 20, dt);
    this.weaponGroup.position.z = THREE.MathUtils.damp(this.weaponGroup.position.z, .22 - kick + thrustMotion * .58, 24, dt);
    this.weaponGroup.scale.set(1, 1, 1);
    this.weaponGroup.updateMatrix();
    this.gripForward.set(0, 0, 1).transformDirection(this.weaponGroup.matrix);
    this.gripTarget.copy(this.weaponGrip).applyMatrix4(this.weaponGroup.matrix);
    alignArmGrip(this.rightArm, this.rightForearm, this.gripTarget, this.gripForward);
    if (this.weaponHasSupportGrip && !grappled && !reloadingPose) {
      this.gripTarget.copy(this.weaponSupportGrip).applyMatrix4(this.weaponGroup.matrix);
      alignArmGrip(this.leftArm, this.leftForearm, this.gripTarget, this.gripForward);
      this.supportGripProgress = Math.min(1, this.supportGripProgress + dt / .20);
      const t = this.supportGripProgress, blend = t * t * (3 - 2 * t);
      this.leftArm.quaternion.slerp(this.supportArmStart, 1 - blend);
      this.leftForearm.quaternion.slerp(this.supportForearmStart, 1 - blend);
    } else this.supportGripProgress = 0;
    if (this.weaponGlowMaterial) this.weaponGlowMaterial.emissiveIntensity = .25 + this.recoilVisual * .9 + this.chargeLevel * (2.4 + Math.sin(time * 2.4) * .55);
    this.weaponSpinSpeed = THREE.MathUtils.damp(this.weaponSpinSpeed, this.attackTimer > 0 ? 32 : 0, this.attackTimer > 0 ? 9 : 3, dt);
    if (this.weaponSpinner && !weaponReducedMotion) this.weaponSpinner.rotation.z += dt * this.weaponSpinSpeed;
    if (this.weaponMagazine) {
      this.weaponMagazine.position.copy(this.weaponMagazineHome); this.weaponMagazine.rotation.copy(this.weaponMagazineRotation);
      this.weaponMagazine.position.y -= reloadMotion * .32;
      this.weaponMagazine.rotation.z += reloadMotion * .18;
    }
    if (this.weaponPiston) this.weaponPiston.position.z = THREE.MathUtils.damp(this.weaponPiston.position.z, attacking ? .42 * attackSwing : 0, 24, dt);
    const bob = this.grounded ? -.035 + this.locomotionVisual * (-.01 + Math.cos(this.gaitPhase * 2) * .009) - landing * .14 : 0;
    this.rig.position.y = THREE.MathUtils.damp(this.rig.position.y, bob, 18, dt);
    this.rig.scale.set(1.07, 1.04, 1.07);
    const strafe = this.velocity.x * this.aim.z - this.velocity.z * this.aim.x;
    const bodyRoll = clamp(-strafe * .032, -.2, .2) + grappleSide * .36 + this.hitStagger * hitWave * .4 + this.bodyRollSpring.value;
    this.rig.rotation.z = THREE.MathUtils.damp(this.rig.rotation.z, bodyRoll, 12, dt);
    const bodyPitch = grappled
      ? clamp(-.38 - this.velocity.y * .02, -.62, .12)
      : !this.grounded ? clamp(-this.velocity.y * .015, -.18, .2)
        : moving ? -.1 * locomotion + landing * .12 : landing * .12;
    this.rig.rotation.x = THREE.MathUtils.damp(this.rig.rotation.x, bodyPitch + hitWave * .2 + this.bodyPitchSpring.value, 11, dt);
    this.rig.rotation.y = THREE.MathUtils.damp(this.rig.rotation.y, melee ? -attackSwing * .34 : clamp(-strafe * .009, -.09, .09) - this.recoilVisual * .12, 12, dt);
    const legBrace = landing * .22 + (this.grounded && !moving ? .025 : 0) + (grappled ? Math.abs(grappleSide) * .08 : 0);
    this.leftLeg.rotation.z = THREE.MathUtils.damp(this.leftLeg.rotation.z, legBrace, 14, dt);
    this.rightLeg.rotation.z = THREE.MathUtils.damp(this.rightLeg.rotation.z, -legBrace, 14, dt);
    this.helmet.rotation.x = THREE.MathUtils.damp(this.helmet.rotation.x, -aimPitch * .18 + landing * .07 - this.bodyPitchSpring.value * .45, 12, dt);
    this.helmet.rotation.z = THREE.MathUtils.damp(this.helmet.rotation.z, -this.bodyRollSpring.value * .6, 10, dt);
    if (this.grounded) this.poseGroundedLegs(dt, this.gaitPhase, this.locomotionVisual);
    const thrust = landing > .05 ? 1.7 + landing * .7 : grappled ? 1.8 : this.grounded ? .65 : 1.2 + clamp(horizontalSpeed / 32, 0, .65);
    this.thrusterScale = THREE.MathUtils.damp(this.thrusterScale, thrust, 11, dt);
    this.thrusterLights.scale.y = this.thrusterScale;
    if (this.thrusterMaterial) this.thrusterMaterial.opacity = .32 + clamp(thrust / 2.4, 0, 1) * .48;
    const travelSpeed = Math.hypot(horizontalSpeed, this.grounded ? 0 : this.velocity.y);
    this.backGlow = THREE.MathUtils.damp(this.backGlow, clamp((travelSpeed - .6) / 8, 0, 1), 8, dt);
    this.backHaloMaterial.opacity = this.backGlow * .48;
    this.backVentMaterial.opacity = .12 + this.backGlow * .88;
    const hit = this.hitTimer > 0;
    const hitFlash = hit ? .55 + hitWave * .95 : 0;
    this.armorMaterial.emissiveIntensity = .025 + hitFlash * 1.45;
    this.accentMaterial.emissiveIntensity = .7 + hitFlash * 1.15;

    const pulse = .5 + Math.sin(time * .55 + this.id.length) * .5;
    const frozen = this.slowTimer > 0;
    const freezePulse = .5 + Math.sin(time * 1.8) * .5;
    this.freezeRing.material.opacity = frozen ? .4 + freezePulse * .28 : 0;
    this.freezeRing.scale.setScalar(1 + freezePulse * .16);
    this.freezeRing.rotation.z -= dt * (frozen ? 1.6 : 0);
    this.identityRing.material.opacity = hit ? .62 + hitWave * .32 : .34 + pulse * .17;
    this.identityRing.scale.setScalar(1 + pulse * .045);
    this.identityRing.rotation.z += dt * .32;
    this.identityBeacon.position.y = 2.82 + Math.sin(time * .7) * .04;
    this.identityBeacon.material.opacity = hit ? 1 : .86 + pulse * .12;
    this.identityBeacon.scale.set(.78, 1.32, .52).multiplyScalar((hit ? 1.18 : 1) * (1 + pulse * .06));
  }

  forwardPoint(distance) {
    return this.position.clone().add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(this.aim, distance);
  }

  visualMuzzlePoint(target = new THREE.Vector3()) {
    if (this.weapon.id !== "blaster") return this.muzzlePoint(target);
    this.weaponGroup.updateWorldMatrix(true, false);
    return target.set(.05, .06, .994).applyMatrix4(this.weaponGroup.matrixWorld);
  }

  muzzlePoint(target = new THREE.Vector3()) {
    const flatLength = Math.hypot(this.aim.x, this.aim.z);
    const rightX = flatLength > .001 ? this.aim.z / flatLength : Math.cos(this.group.rotation.y);
    const rightZ = flatLength > .001 ? -this.aim.x / flatLength : -Math.sin(this.group.rotation.y);
    target.copy(this.position).add(new THREE.Vector3(0, 1.43, 0)).addScaledVector(this.aim, this.weaponMuzzleDistance || .92);
    target.x += rightX * .5;
    target.z += rightZ * .5;
    return target;
  }

  dispose() {
    this.muzzleRevision = (this.muzzleRevision || 0) + 1;
    this.scene.remove(this.group);
    for (const model of this.weaponModels.values()) disposeChildren(model.group);
    this.weaponModels.clear();
    const geometries = new Set();
    const materials = new Set();
    this.group.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) {
        for (const entry of Array.isArray(child.material) ? child.material : [child.material]) materials.add(entry);
      }
    });
    for (const geometry of geometries) disposeGeometry(geometry);
    for (const entry of materials) entry.dispose();
  }
}

export const GRAPPLE_SPEED_CAP = 48;

export function applyGrapplePhysics(player, dt, reelFaster = false) {
  if (!player.grapple) return;
  const chest = player.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  const wraps = player.grapple.wraps || [];
  const pullPoint = wraps[0] || player.grapple.anchor;
  const towardAnchor = pullPoint.clone().sub(chest);
  const distance = towardAnchor.length();
  if (distance < .01) return;

  const direction = towardAnchor.multiplyScalar(1 / distance);
  const movementScale = player.slowTimer > 0 ? .55 : 1;
  player.grapple.ropeLength = Math.max(5, player.grapple.ropeLength - (reelFaster ? 36 : 18) * movementScale * dt);
  let wrappedLength = 0;
  for (let index = 0; index < wraps.length; index++) wrappedLength += wraps[index].distanceTo(wraps[index + 1] || player.grapple.anchor);
  const stretch = Math.max(0, distance - Math.max(1, player.grapple.ropeLength - wrappedLength));
  const targetPullSpeed = (reelFaster ? 46 : 31) * movementScale;
  player.grapple.pullSpeed = THREE.MathUtils.damp(Math.max(0, player.grapple.pullSpeed || 0), targetPullSpeed, 8.5, dt);
  if (player.grounded && !wraps.length && Math.abs(pullPoint.y - player.position.y) < .35) {
    // On the floor, arrive at the anchor with the feet and brake sideways drift.
    const offset = pullPoint.clone().sub(player.position).setY(0);
    const desired = offset.clone().clampLength(0, player.grapple.pullSpeed / 4).multiplyScalar(4);
    player.velocity.x = THREE.MathUtils.damp(player.velocity.x, desired.x, 16, dt);
    player.velocity.z = THREE.MathUtils.damp(player.velocity.z, desired.z, 16, dt);
    player.grapple.launchLift = false;
    if (player.velocity.length() > GRAPPLE_SPEED_CAP) player.velocity.setLength(GRAPPLE_SPEED_CAP);
    return;
  }
  const radialSpeed = player.velocity.dot(direction);
  const nextRadialSpeed = THREE.MathUtils.damp(radialSpeed, player.grapple.pullSpeed, stretch > 0 ? 15 : 10, dt);
  player.velocity.addScaledVector(direction, nextRadialSpeed - radialSpeed);
  if (player.grapple.launchLift) {
    const elevation = Math.max(0, direction.y);
    if (elevation > .03) {
      const forward = direction.clone().setY(0);
      if (forward.lengthSq() > .001) player.velocity.addScaledVector(forward.normalize(), (6 + elevation * 4) * movementScale);
      const lift = (5 + elevation * 10) * movementScale;
      player.velocity.y = Math.max(player.velocity.y + lift, lift);
    }
    player.grapple.launchLift = false;
  }

  const steering = player.controlMove.clone().sub(direction.clone().multiplyScalar(player.controlMove.dot(direction)));
  if (steering.lengthSq() > .01) player.velocity.addScaledVector(steering.normalize(), 14 * movementScale * dt);
  if (player.ledgeContact && Math.max(pullPoint.y, player.grapple.anchor.y) >= player.ledgeContact.top - .35) {
    player.velocity.y = Math.max(player.velocity.y, 11);
    const inwardSpeed = player.velocity.dot(player.ledgeContact.inward);
    if (inwardSpeed < 7) player.velocity.addScaledVector(player.ledgeContact.inward, 7 - inwardSpeed);
  }
  if (player.velocity.length() > GRAPPLE_SPEED_CAP) player.velocity.setLength(GRAPPLE_SPEED_CAP);
}

export function boostGrappleRelease(player) {
  const speed = player.velocity.length();
  if (speed < 5) return;
  player.velocity.multiplyScalar(1 + Math.min(.28, 6 / speed));
  player.velocity.y += 2.2;
}

export function grappleSightline(player, camera) {
  if (player.isBot) {
    return {
      origin: player.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
      direction: player.aim.clone()
    };
  }
  return {
    origin: camera.position.clone(),
    direction: camera.getWorldDirection(new THREE.Vector3())
  };
}

export function directionFromKeys(input) {
  const value = new THREE.Vector3(
    (input.down("KeyD") ? 1 : 0) - (input.down("KeyA") ? 1 : 0),
    0,
    (input.down("KeyS") ? 1 : 0) - (input.down("KeyW") ? 1 : 0)
  );
  return value.lengthSq() ? value.normalize() : value;
}

export function directionFromTouch(touch) {
  const value = new THREE.Vector3(touch?.x || 0, 0, touch?.y || 0);
  return value.lengthSq() > 1 ? value.normalize() : value;
}

export function cameraRelative(vector, yaw) {
  if (!vector.lengthSq()) return vector;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  return right.multiplyScalar(vector.x).addScaledVector(forward, -vector.z);
}

export function reconcileRemotePosition(player, authoritativePosition, blend, world) {
  const previous = player.previousPosition.copy(player.position);
  const implausibleDisplacement = player.position.distanceToSquared(authoritativePosition) > 24 ** 2;
  if (implausibleDisplacement || world.ropeBlocked(player.position, authoritativePosition)) {
    player.position.copy(authoritativePosition);
    previous.copy(authoritativePosition);
  } else player.position.lerp(authoritativePosition, blend);
  return world.resolve(player.position, player.radius, previous);
}

export function aimWithSpread(aim, spread, random = Math.random) {
  if (!spread) return aim.clone().normalize();
  const forward = aim.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < .001) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return forward
    .addScaledVector(right, (random() - .5) * spread)
    .addScaledVector(up, (random() - .5) * spread)
    .normalize();
}

export function reticleAim(player, cameraOrigin, cameraDirection, world, targets, surface = undefined) {
  const direction = cameraDirection.clone().normalize();
  const ray = new THREE.Ray(cameraOrigin, direction);
  // undefined keeps standalone callers compatible; null reuses a known miss.
  if (surface === undefined) surface = world.grapplePoint(cameraOrigin, direction);
  let distance = surface ? cameraOrigin.distanceTo(surface) : 520;
  let point = surface || cameraOrigin.clone().addScaledVector(direction, distance);
  let selectedTarget = null;
  const hit = new THREE.Vector3();

  // Exact ray intersections only: this corrects third-person parallax without aim assist.
  for (const target of targets) {
    if (target === player || !target.alive) continue;
    const samples = target.isDecoy ? [[1.05, target.radius]] : [[.55, target.radius * .72], [1.2, target.radius], [2.08, target.radius * .72]];
    for (const [height, radius] of samples) {
      const sphere = new THREE.Sphere(target.position.clone().add(new THREE.Vector3(0, height, 0)), radius);
      if (!ray.intersectSphere(sphere, hit)) continue;
      const hitDistance = cameraOrigin.distanceTo(hit);
      if (hitDistance >= distance) continue;
      distance = hitDistance;
      point = hit.clone();
      selectedTarget = target;
    }
  }

  const weapon = player.weapon || {};
  const origin = combatShotOrigin(player, weapon, direction);
  const aim = point.clone().sub(new THREE.Vector3(player.position.x, origin.y, player.position.z));
  if (selectedTarget && aim.dot(direction) <= 0 && selectedTarget.position.distanceToSquared(player.position) < selectedTarget.radius ** 2) {
    aim.copy(selectedTarget.position).add(new THREE.Vector3(0, 1.2, 0)).sub(new THREE.Vector3(player.position.x, origin.y, player.position.z));
  }
  // The shoulder muzzle is half a metre to the right of the firing line.
  // Solve its yaw exactly so close headshots converge on the camera hit point.
  const lateral = weapon.hitscan || weapon.type === "flame" ? .5 : 0;
  const horizontal = Math.hypot(aim.x, aim.z);
  if (lateral && horizontal > lateral) {
    const yaw = Math.atan2(aim.x, aim.z) - Math.asin(lateral / horizontal);
    const forward = Math.sqrt(horizontal * horizontal - lateral * lateral);
    aim.x = Math.sin(yaw) * forward;
    aim.z = Math.cos(yaw) * forward;
  }
  return (aim.lengthSq() > .001 ? aim : direction).normalize();
}

export function damageIndicatorAngle(cameraYaw, toAttacker) {
  const delta = Math.atan2(toAttacker.x, toAttacker.z) - cameraYaw;
  return THREE.MathUtils.radToDeg(Math.atan2(Math.sin(delta), Math.cos(delta)));
}

export function cameraCollisionFirstPerson(clearance, active = false) {
  return clearance < (active ? 3.4 : 2.6);
}

export function projectileTouchesPlayer(player, position, radius = .22) {
  if (!player.alive) return false;
  if (!player.isDecoy && position.y - player.position.y >= 1.9) return headContact(player, position, radius);
  const body = new THREE.Vector3(
    player.position.x,
    clamp(position.y, player.position.y + .72, player.position.y + 1.85),
    player.position.z
  );
  return body.distanceTo(position) < player.radius + radius;
}

export function flameConeFactor(origin, direction, target, targetRadius = .72, reach = 11.5, halfAngle = .22) {
  const aim = direction.clone().normalize();
  const offset = target.clone().sub(origin);
  const along = offset.dot(aim);
  if (along < -targetRadius || along > reach + targetRadius) return 0;
  const radial = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
  const coneRadius = .32 + Math.max(0, along) * Math.tan(halfAngle);
  if (radial > coneRadius + targetRadius) return 0;
  const edge = clamp((radial - targetRadius * .65) / Math.max(.01, coneRadius), 0, 1);
  const distance = clamp(along / reach, 0, 1);
  return (1 - edge * .45) * (1 - Math.max(0, distance - .45) / .55 * .28);
}

export function applyWeaponStatus(target, weapon) {
  if (!target?.alive || weapon?.effect !== "freeze") return;
  target.slowTimer = Math.max(target.slowTimer || 0, weapon.effectDuration || 2);
}
