import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { CombatVisuals, createProjectileVisual } from "../src/combatVisuals.js";
import { PROJECTILE_BATCH_CAPACITY } from "../src/projectileBatches.js";
import { WEAPONS } from "../src/gameData.js";
import { warmGameplayScene } from "../src/gameplayPreparation.js";

const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
const allLayers = [...effects.projectileBatches.templates.values()].flatMap(template => template.layers);
assert.ok(allLayers.every(layer => layer.mesh.count === 0 && !layer.mesh.visible), "idle pools never enter the render list");
const owner = { accent: 0x47bd83, color: 0xe669c4 };
const actual = new THREE.Vector3(), expected = new THREE.Vector3(), matrix = new THREE.Matrix4();
const oldWorld = new THREE.Matrix4(), oldNormal = new THREE.Matrix3(), newNormal = new THREE.Matrix3();
const velocity = new THREE.Vector3(3, .4, -2), stopped = new THREE.Vector3();
let checkedVertices = 0, checkedNormals = 0;

// Compare the batched render result to the existing authored hierarchy. This
// exercises real geometry and legacy animation, rather than restating the new
// static-part transform implementation in the expected calculation.
for (const [key, template] of effects.projectileBatches.templates) {
  const [id, mode] = key.split(":"), mine = mode === "1";
  const weapon = WEAPONS[id] || { ...WEAPONS.cluster_grenade, id, type: "grenade", split: 0,
    damage: Math.max(14, WEAPONS.cluster_grenade.damage), projectileSpeed: 18, fuse: .62, gravity: 15,
    bounces: 1, bounceEnergy: .55, arcLift: 0, projectileRadius: .16 };
  for (const radiusScale of [.75, 1, 1.3]) {
    const source = createProjectileVisual(weapon, owner, template.radius, { mine });
    const anchor = effects.createProjectile(owner, weapon, template.radius * radiusScale, { mine });
    scene.add(anchor); source.scale.set(1.1, .9, 1.2).multiplyScalar(radiusScale); anchor.scale.set(1.1, .9, 1.2);
    for (const [step, dt] of [0, 1 / 60, .1, .33].entries()) {
      source.position.set(2 + step * .1, 1 + step * .04, -3 + step * .15); anchor.position.copy(source.position);
      const speed = step === 3 ? stopped : velocity;
      effects.updateProjectile({ mesh: source, velocity: speed }, dt);
      effects.updateProjectile({ mesh: anchor, velocity: speed }, dt);
      effects.projectileBatches.sync(); source.updateMatrixWorld(true);
      assert.equal(template.layers.length, source.children.length);
      for (let index = 0; index < template.layers.length; index++) {
        const layer = template.layers[index], child = source.children[index];
        layer.mesh.getMatrixAt(0, matrix); oldWorld.copy(child.matrixWorld);
        const original = child.geometry.getAttribute("position"), current = layer.mesh.geometry.getAttribute("position");
        assert.equal(current.count, original.count);
        for (let vertex = 0; vertex < current.count; vertex++) {
          expected.fromBufferAttribute(original, vertex).applyMatrix4(oldWorld);
          actual.fromBufferAttribute(current, vertex).applyMatrix4(matrix);
          assert.ok(actual.distanceTo(expected) < 2e-5, `${key} part${index} vertex${vertex} step${step} radius${radiusScale}: ${actual.distanceTo(expected)}`);
          checkedVertices++;
        }
        const originalNormals = child.geometry.getAttribute("normal"), currentNormals = layer.mesh.geometry.getAttribute("normal");
        oldNormal.getNormalMatrix(oldWorld); newNormal.getNormalMatrix(matrix);
        for (let vertex = 0; vertex < currentNormals.count; vertex++) {
          expected.fromBufferAttribute(originalNormals, vertex).applyNormalMatrix(oldNormal);
          actual.fromBufferAttribute(currentNormals, vertex).applyNormalMatrix(newNormal);
          assert.ok(actual.distanceTo(expected) < 2e-5, `${key} part${index} normal${vertex}`);
          checkedNormals++;
        }
        const tint = child.material.color.clone();
        const combined = layer.mesh.material.color.clone();
        if (layer.mesh.instanceColor) combined.multiply(new THREE.Color().fromArray(layer.mesh.instanceColor.array));
        assert.ok(Math.abs(tint.r - combined.r) + Math.abs(tint.g - combined.g) + Math.abs(tint.b - combined.b) < 2e-6, `${key} part${index} tint`);
        assert.ok(Math.abs(child.material.opacity - layer.mesh.material.opacity * (layer.alpha?.getX(0) ?? 1)) < 2e-6, `${key} part${index} alpha`);
      }
    }
    effects.removeProjectile({ mesh: anchor });
    for (const material of new Set(source.children.map(child => child.material))) material.dispose();
  }
}

// Same visual ceiling, including the single-family worst case. No smaller
// per-family cap, overflow eviction, or fallback allocation is introduced.
const anchors = [];
for (let i = 0; i < PROJECTILE_BATCH_CAPACITY; i++) {
  const anchor = effects.createProjectile(owner, WEAPONS.rocket_launcher, .25);
  anchor.position.set(i % 64, Math.floor(i / 64), i * .01); anchors.push(anchor);
}
effects.projectileBatches.sync();
const rocket = effects.projectileBatches.templates.get("rocket_launcher:0");
assert.ok(rocket.layers.every(layer => layer.mesh.count === 4096 && layer.mesh.visible));
assert.ok(allLayers.filter(layer => !rocket.layers.includes(layer)).every(layer => !layer.mesh.visible), "only active families become visible");
assert.ok(rocket.layers.filter(layer => layer.fixed).every(layer => layer.mesh.instanceMatrix === rocket.fixedMatrix));
assert.ok(rocket.layers.filter(layer => layer.ownerTint).every(layer => layer.mesh.instanceColor === rocket.ownerColors));
assert.ok(rocket.layers.filter(layer => !layer.ownerTint).every(layer => layer.mesh.instanceColor === null));
for (const anchor of anchors) effects.removeProjectile({ mesh: anchor });
effects.projectileBatches.sync();
assert.ok(allLayers.every(layer => layer.mesh.count === 0 && !layer.mesh.visible), "releasing the last shot hides its buffers again");

// Compare unique array ownership with the former full arrays for every layer;
// this is CPU backing storage, not inflated interleaved-view renderer telemetry.
let layers = 0, bytes = 0;
const arrays = new Set();
for (const template of effects.projectileBatches.templates.values()) for (const layer of template.layers) {
  layers++;
  for (const attribute of [layer.mesh.instanceMatrix, layer.mesh.instanceColor, layer.alpha]) {
    if (!attribute || arrays.has(attribute.array)) continue;
    arrays.add(attribute.array); bytes += attribute.array.byteLength;
  }
}
const previousBytes = layers * PROJECTILE_BATCH_CAPACITY * (16 + 3 + 1) * 4;
assert.ok(bytes < previousBytes * .75, "sharing meaningfully reduces backing arrays without changing capacity");

// Empty meshes warm their first instance temporarily. Two meshes sharing that
// instance attribute must restore its original slot once, even if rendering
// fails, rather than saving a preceding mesh's temporary identity as original.
effects.projectileBatches.sync();
const sharedMeshes = rocket.layers.filter(layer => layer.fixed).slice(0, 2).map(layer => layer.mesh);
assert.equal(sharedMeshes.length, 2);
matrix.compose(new THREE.Vector3(11, -3, 7), new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, -.2, .6)), new THREE.Vector3(.8, 1.2, .7));
sharedMeshes[0].setMatrixAt(0, matrix);
const originalSlot = Array.from(rocket.fixedMatrix.array.slice(0, 16));
const camera = new THREE.PerspectiveCamera(); camera.position.set(8, 9, 10);
const identity = new THREE.Matrix4().elements;
sharedMeshes[0].visible = false; sharedMeshes[0].frustumCulled = true;
sharedMeshes[1].visible = true; sharedMeshes[1].frustumCulled = false;
let renders = 0;
const game = { scene, camera, renderer: { backend: {} }, renderPipeline: { render() {
  renders++;
  assert.equal(game.preparingGraphics, true);
  for (const mesh of sharedMeshes) {
    assert.equal(mesh.count, 1); assert.equal(mesh.visible, true); assert.equal(mesh.frustumCulled, false);
    mesh.getMatrixAt(0, matrix); assert.deepEqual(matrix.elements, identity);
  }
} } };
const assertRestored = () => {
  assert.deepEqual(Array.from(rocket.fixedMatrix.array.slice(0, 16)), originalSlot);
  assert.ok(sharedMeshes.every(mesh => mesh.count === 0));
  assert.equal(sharedMeshes[0].visible, false); assert.equal(sharedMeshes[0].frustumCulled, true);
  assert.equal(sharedMeshes[1].visible, true); assert.equal(sharedMeshes[1].frustumCulled, false);
  assert.deepEqual(camera.position.toArray(), [8, 9, 10]);
  assert.equal(game.preparingGraphics, false);
};
assert.equal(await warmGameplayScene(game, sharedMeshes), true);
assert.equal(renders, 2); assertRestored();
game.renderPipeline.render = () => { throw new Error("warmup probe"); };
await assert.rejects(warmGameplayScene(game, sharedMeshes), /warmup probe/);
assertRestored();
effects.dispose();
console.log(`Projectile sharing preserves ${checkedVertices} world vertices/${checkedNormals} normals, tint/alpha and 4096 slots; backing arrays ${previousBytes}->${bytes} bytes. Shared warmup restoration passed.`);
