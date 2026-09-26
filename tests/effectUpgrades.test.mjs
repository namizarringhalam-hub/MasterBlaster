import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { CombatVisuals, createProjectileVisual } from "../src/combatVisuals.js";
import { ArenaWorld, fractureShardGeometry } from "../src/world.js";
import { WEAPONS, graphicsProfile } from "../src/gameData.js";
import { weaponPresentation } from "../src/weaponPresentation.js";
import "./effectShaders.test.mjs";

const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
const point = new THREE.Vector3(12, 3, -5), owner = { color: 0x42adff, accent: 0x42adff };
effects.impact(point, WEAPONS.rocket_launcher, owner, { explosive: true, size: 2 });
const [fire, smoke] = effects.explosions.layers;
assert.equal(fire.mesh.material.blending, THREE.AdditiveBlending);
assert.equal(smoke.mesh.material.blending, THREE.NormalBlending);
assert.ok(fire.mesh.material.emissiveNode && !smoke.mesh.material.emissiveNode);
const [,, shell, scorch] = effects.explosions.layers;
assert.equal(shell.particles.filter(p => p.life > 0).length, 1);
assert.equal(scorch.particles.filter(p => p.life > 0).length, 0, "airbursts cannot leave floating decals");
assert.ok(fire.particles.some(p => p.mode === "flash" && p.maxLife <= .1));
assert.ok(fire.particles.some(p => p.mode === "ember" && p.maxLife > .8));
assert.ok(fire.particles.filter(p => p.life > 0).every(p => p.tint.getHex() === WEAPONS.rocket_launcher.color));
effects.explosions.scorch(new THREE.Vector3(12, 0, -5), 2);
assert.equal(scorch.particles[0].position.y, .025);
assert.ok(!scorch.mesh.material.emissiveNode && !scorch.mesh.material.depthWrite);
for (const layer of [fire, smoke]) {
  const live = layer.particles.filter(p => p.life > 0);
  assert.ok(live.length >= 10);
  assert.ok(live.every(p => p.position.equals(point) && p.spin.lengthSq() > 0));
  assert.ok(new Set(live.map(p => p.velocity.toArray().join())).size > 5);
}
effects.update(.15);
const smokeMatrix = new THREE.Matrix4(); smoke.mesh.getMatrixAt(0, smokeMatrix);
const earlyScale = new THREE.Vector3().setFromMatrixScale(smokeMatrix).length();
const earlyAlpha = smoke.alpha.getX(0), earlyColor = smoke.mesh.instanceColor.array.slice(0, 3);
effects.update(.55); smoke.mesh.getMatrixAt(0, smokeMatrix);
assert.ok(new THREE.Vector3().setFromMatrixScale(smokeMatrix).length() > earlyScale);
assert.ok(smoke.alpha.getX(0) < earlyAlpha);
assert.ok(smoke.mesh.instanceColor.array[0] < earlyColor[0], "smoke darkens as it disperses");
effects.update(5);
for (const layer of effects.explosions.layers) {
  assert.equal(layer.mesh.count, 0); assert.ok(layer.alpha.array.every(v => v === 0));
}
for (let i = 0; i < 100; i++) effects.explosions.spawn(point, 2);
effects.update(.016);
assert.ok(fire.mesh.count <= 192 && smoke.mesh.count <= 96, "saturation reuses fixed storage");
assert.ok(shell.mesh.count <= 32 && scorch.mesh.count <= 32);
effects.update(5);
effects.explosions.spawn(point, 2, .5, true, 0x22aaff);
effects.update(.05);
for (const layer of effects.explosions.layers) for (let i = 0; i < layer.particles.length; i++) {
  if (layer.particles[i].life > 0) assert.equal(layer.phase.getX(i), 0, "reduced motion disables turbulent animation");
}

const rockets = Array.from({ length: 10 }, () => effects.createProjectile(owner, WEAPONS.rocket_launcher, .2));
for (const mesh of rockets) { mesh.position.copy(point); scene.add(mesh); }
assert.equal(effects.projectileLights.length, 4);
const tracked = rockets.at(-1), light = effects.projectileLights.find(l => l.userData.projectile === tracked);
tracked.position.set(9, 8, 7); effects.updateProjectile({ mesh: tracked, velocity: new THREE.Vector3(1, 0, 0) }, .016);
assert.deepEqual(light.position.toArray(), [9, 8, 7]);
assert.ok(light.intensity > 0 && light.intensity <= 4.5 && !light.castShadow);
effects.removeProjectile({ mesh: tracked }); assert.equal(light.intensity, 0); assert.equal(light.userData.projectile, null);
effects.setGraphicsProfile(graphicsProfile("low")); effects.update(.016);
assert.ok(effects.projectileLights.filter(l => l.intensity > 0).length <= graphicsProfile("low").combatLights);
for (const weapon of Object.values(WEAPONS)) if (weaponPresentation(weapon).energy) {
  let emitting = 0;
  createProjectileVisual(weapon, owner).traverse(mesh => { if (mesh.material?.emissiveNode) emitting++; });
  assert.ok(emitting > 0, `${weapon.id} has custom emission`);
}
let disposals = 0;
for (const layer of effects.explosions.layers) for (const resource of [layer.mesh.geometry, layer.mesh.material]) resource.addEventListener("dispose", () => disposals++);
effects.dispose(); assert.equal(disposals, 8); assert.ok(effects.projectileLights.every(l => !l.userData.projectile));

{
  const marks = new CombatVisuals(new THREE.Scene());
  const surface = { x: 0, z: 0, baseY: 0, top: 4, w: 4, d: 4, mesh: { material: { metalness: .7 } } };
  const weapon = Object.values(WEAPONS).find(w => !weaponPresentation(w).energy && !w.radius);
  marks.impact(new THREE.Vector3(0, 2, 2), weapon, owner, { size: 1, normal: new THREE.Vector3(0, 0, 1), surface });
  assert.ok(marks.sparks.filter(p => p.life > 0).every(p => p.color.getHex() === 0xffba63), "metal produces hot sparks");
  marks.update(.1);
  const layer = marks.explosions.layers[3], matrix = new THREE.Matrix4();
  assert.equal(layer.mesh.count, 1); layer.mesh.getMatrixAt(0, matrix);
  assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(matrix).z > .999, "wall mark faces out of its host face");
  const start = new THREE.Vector3().setFromMatrixPosition(matrix);
  surface.x += 3; surface.baseY += 2; surface.top += 2; marks.update(.1); layer.mesh.getMatrixAt(0, matrix);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(start.add(new THREE.Vector3(3, 2, 0))) < 1e-5, "moving hosts carry marks");
  surface.removed = true; marks.update(.1);
  assert.equal(layer.mesh.count, 0); assert.equal(layer.particles[0].surface, null, "destroyed hosts remove marks and release their references");
  surface.removed = false; surface.mesh.material.metalness = 0;
  marks.update(10);
  marks.impact(new THREE.Vector3(3, 4, 2), weapon, owner, { size: 1, normal: new THREE.Vector3(0, 0, 1), surface });
  assert.ok(marks.sparks.filter(p => p.life > 0).every(p => p.color.getHex() === 0x89959e), "masonry produces neutral debris");
  const cursor = layer.cursor;
  marks.explosions.surfaceMark(new THREE.Vector3(5, 4, 2), new THREE.Vector3(0, 0, 1), .4, surface);
  assert.equal(layer.cursor, cursor, "face-edge contacts cannot leave hanging marks");
  for (let i = 0; i < 100; i++) marks.explosions.surfaceMark(new THREE.Vector3(3, 4, 2), new THREE.Vector3(0, 0, 1), .4, surface);
  marks.update(.1); assert.equal(layer.mesh.count, 32, "impact marks reuse the existing bounded scorch batch");
  marks.update(7); assert.equal(layer.mesh.count, 0); assert.ok(layer.particles.every(p => !p.surface));
  marks.dispose();
}

const shard = fractureShardGeometry();
assert.notEqual(shard.type, "BoxGeometry");
assert.ok(new Set(shard.attributes.position.array).size > 12, "fracture faces are irregular"); shard.dispose();
const world = new ArenaWorld(new THREE.Scene(), "VFX-SHARDS");
const pieces = world.spawnStructuralDebris(point, 0xff8040, 12, { w: 4, h: 3, d: 4 }, "test");
assert.equal(pieces.length, 12);
assert.ok(pieces.every(p => p.maxVisualLife >= 1 && p.maxVisualLife <= 2 && p.spin.lengthSq() > 0));
world.updateStructuralDebris(1.1);
world.debrisMesh.getMatrixAt(0, smokeMatrix);
assert.ok(new THREE.Vector3().setFromMatrixScale(smokeMatrix).length() < pieces[0].scale.length());
world.updateStructuralDebris(1.3); assert.equal(world.debrisMesh.count, 0); assert.ok(pieces.every(p => !p.active));
const deck = world.spawnStructuralDebris(new THREE.Vector3(0, 65, 0), 0xff8040, 12, { w: 8, h: 1, d: 8, structuralKind: "platform" }, "deck");
for (let i = 0; i < 130; i++) world.updateStructuralDebris(1 / 60);
assert.equal(world.debrisMesh.count, 0, "cosmetic deck shards expire within two seconds");
assert.ok(deck.some(p => p.majorFragment && p.active), "landing simulation survives cosmetic expiry");
world.updateStructuralDebris(6); assert.ok(deck.every(p => !p.active)); world.dispose();
console.log("Explosion blending/lifetimes/reuse, animated emission, capped moving lights, shard shrink and disposal passed.");
