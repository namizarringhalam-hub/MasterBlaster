import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { Fighter } from "../src/player.js";

const colors = [[0x129dba, 0x6ff6ff], [0xc82849, 0xff6b82], [0x6bad22, 0xb9ff55],
  [0x7847ca, 0xc793ff], [0xd77a16, 0xffc14f], [0xb92d86, 0xff75cf]];
const world = { resolve(position) { const grounded = position.y <= 0; if (grounded) position.y = 0; return { grounded }; }, boostAt: () => null };
const still = new THREE.Vector3(), move = new THREE.Vector3(0, 0, 1), look = new THREE.Vector3(0, 0, 1);
const variants = new Set();
for (let variant = 0; variant < 4; variant++) for (const [color, accent] of colors) {
  const fighter = new Fighter(new THREE.Scene(), { id: `helmet-${variant}`, color, accent }, ["blaster", "energy_sword"], new THREE.Vector3());
  const geometries = new Set(), materials = new Set(), palette = new THREE.Color(color);
  let triangles = 0, matches = 0, meshes = 0;
  fighter.rig.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry;
    geometries.add(geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), "all vertex data is finite");
    if (!object.name.startsWith("Mecha")) return;
    assert.equal(geometry.groups.length, 0, "paint colors do not introduce material draws");
    const p = geometry.attributes.position, n = geometry.attributes.normal, c = geometry.attributes.color;
    assert.ok(p.count > 0 && p.count === n.count && p.count === c.count);
    for (let i = 0; i < n.count; i++) {
      const normal = new THREE.Vector3().fromBufferAttribute(n, i);
      assert.ok(Math.abs(normal.length() - 1) < 1e-5, "armor normals stay normalized for AO and lighting");
      if (Math.abs(c.getX(i) - palette.r) + Math.abs(c.getY(i) - palette.g) + Math.abs(c.getZ(i) - palette.b) < 1e-5) matches++;
    }
    if (object.name === "Mecha helmet armor") variants.add(Buffer.from(p.array.buffer).toString("base64"));
  });
  assert.ok(matches > 1000, "player paint covers large armor surfaces");
  assert.ok(meshes <= 22, `bounded draw count: ${meshes}`);
  assert.ok(triangles < 10000, `bounded geometry budget: ${triangles}`);
  assert.equal(fighter.visor.parent, fighter.helmet);
  assert.equal(fighter.leftKnee.parent, fighter.leftLeg);
  assert.equal(fighter.rightKnee.parent, fighter.rightLeg);
  fighter.group.updateMatrixWorld(true);
  const eyeTransform = fighter.helmet.matrixWorld.clone().invert().multiply(fighter.visor.matrixWorld);
  for (const pitch of [-1.2, 0, 1.2]) {
    look.set(0, Math.sin(pitch), Math.cos(pitch));
    for (let i = 0; i < 60; i++) fighter.update(1 / 60, still, look, {}, world);
    fighter.group.updateMatrixWorld(true);
    const relative = fighter.helmet.matrixWorld.clone().invert().multiply(fighter.visor.matrixWorld);
    assert.ok(relative.elements.every((value, i) => Math.abs(value - eyeTransform.elements[i]) < 1e-10), "eyes stay in their moving helmet");
  }
  look.set(0, 0, 1);
  const kneeAngles = [];
  for (let i = 0; i < 90; i++) {
    fighter.update(1 / 60, move, look, {}, world);
    kneeAngles.push(fighter.leftKnee.rotation.x - fighter.rightKnee.rotation.x);
  }
  assert.ok(Math.min(...kneeAngles) < -.2 && Math.max(...kneeAngles) > .2, "running alternates the articulated knees");
  fighter.update(1 / 60, still, look, { jump: true }, world);
  assert.equal(fighter.grounded, false, "new armor retains production jumping");
  for (let i = 0; i < 8; i++) fighter.update(1 / 60, still, look, {}, world);
  assert.ok(fighter.leftKnee.rotation.x > .25 && fighter.rightKnee.rotation.x > .25, "airborne legs tuck");
  fighter.position.set(0, 0, 0); fighter.velocity.set(0, 0, 0); fighter.grounded = true;
  for (let i = 0; i < 100; i++) fighter.update(1 / 60, still, look, {}, world);
  const idle = fighter.armorMaterial.emissiveIntensity;
  fighter.takeHit(10, look);
  fighter.update(1 / 60, still, look, {}, world);
  assert.ok(fighter.armorMaterial.emissiveIntensity > idle, "colored armor retains hit feedback");
  fighter.takeHit(500, look); fighter.updateDeath(.2);
  assert.equal(fighter.alive, false);
  fighter.respawn(new THREE.Vector3());
  assert.equal(fighter.alive, true);
  assert.equal(fighter.leftKnee.rotation.x, 0); assert.equal(fighter.rightKnee.rotation.x, 0);
  assert.equal(fighter.armorMaterial.emissiveIntensity, idle, "respawn restores the armor finish");
  // Weapon cache and appearance resources have separate ownership.
  const disposals = new Map();
  for (const resource of [...geometries, ...materials]) if (!resource.userData?.sharedFighterGeometry) {
    disposals.set(resource, 0); resource.addEventListener("dispose", () => disposals.set(resource, disposals.get(resource) + 1));
  }
  fighter.switchSlot(1); fighter.switchSlot(0);
  assert.ok([...disposals.values()].every(count => count === 0), "switching weapons preserves the armor");
  fighter.dispose();
  assert.ok([...disposals.values()].every(count => count === 1), "all owned model resources dispose exactly once");
}
assert.equal(variants.size, 4, "all four deterministic armor families have distinct helmets");
console.log("Mecha colors, geometry budgets, head tracking, knee animation, jumping, hit feedback and disposal passed.");
