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
effects.update(3);
for (const layer of [fire, smoke]) {
  assert.equal(layer.mesh.count, 0); assert.ok(layer.alpha.array.every(v => v === 0));
}
for (let i = 0; i < 100; i++) effects.explosions.spawn(point, 2);
effects.update(.016);
assert.ok(fire.mesh.count <= 192 && smoke.mesh.count <= 96, "saturation reuses fixed storage");

const rockets = Array.from({ length: 10 }, () => effects.createProjectile(owner, WEAPONS.rocket_launcher, .2));
for (const mesh of rockets) { mesh.position.copy(point); scene.add(mesh); }
assert.equal(effects.projectileLights.length, 4);
const tracked = rockets.at(-1), light = effects.projectileLights.find(l => l.userData.projectile === tracked);
tracked.position.set(9, 8, 7); effects.updateProjectile({ mesh: tracked, velocity: new THREE.Vector3(1, 0, 0) }, .016);
assert.deepEqual(light.position.toArray(), [9, 8, 7]);
assert.ok(light.intensity > 0 && light.intensity < 2 && !light.castShadow);
effects.removeProjectile({ mesh: tracked }); assert.equal(light.intensity, 0); assert.equal(light.userData.projectile, null);
effects.setGraphicsProfile(graphicsProfile("low")); effects.update(.016);
assert.ok(effects.projectileLights.filter(l => l.intensity > 0).length <= graphicsProfile("low").combatLights);
for (const weapon of Object.values(WEAPONS)) if (weaponPresentation(weapon).energy) {
  let emitting = 0;
  createProjectileVisual(weapon, owner).traverse(mesh => { if (mesh.material?.emissiveNode) emitting++; });
  assert.ok(emitting > 0, `${weapon.id} has custom emission`);
}
let disposals = 0;
for (const layer of [fire, smoke]) for (const resource of [layer.mesh.geometry, layer.mesh.material]) resource.addEventListener("dispose", () => disposals++);
effects.dispose(); assert.equal(disposals, 4); assert.ok(effects.projectileLights.every(l => !l.userData.projectile));

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
