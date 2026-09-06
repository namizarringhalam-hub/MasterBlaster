import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three/webgpu";
import { CombatVisuals, createProjectileVisual } from "../src/combatVisuals.js";
import { WEAPONS, projectileStepCount } from "../src/gameData.js";
import { Fighter } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const botScene = new THREE.Scene();
const bot = new Fighter(
  botScene,
  { id: "performance-bot", name: "Performance Bot", color: 0x32bedd, accent: 0x9df8ff },
  ["submachine_gun"],
  new THREE.Vector3(),
  true
);
let fighterRenderables = 0;
bot.group.traverse((object) => { if (object.isMesh || object.isLine || object.isPoints) fighterRenderables++; });
assert.ok(fighterRenderables <= 30, `a complete fighter stays within the thirty-renderable budget (received ${fighterRenderables})`);
assert.ok(bot.botTargetPoint?.isVector3, "bot target-position scratch storage survives AI target initialization");
assert.equal(bot.botTarget, null, "bot target selection remains independent from its target-position scratch vector");
bot.dispose();

let maximumFighterRenderables = 0;
for (const weaponId of Object.keys(WEAPONS)) for (let variant = 0; variant < 4; variant++) {
  const fighterScene = new THREE.Scene();
  const fighter = new Fighter(
    fighterScene,
    { id: `${weaponId}-${"v".repeat(variant + 1)}`, name: weaponId, color: WEAPONS[weaponId].color, accent: 0x9df8ff },
    [weaponId],
    new THREE.Vector3()
  );
  let count = 0;
  fighter.group.traverse((object) => { if (object.isMesh || object.isLine || object.isPoints) count++; });
  maximumFighterRenderables = Math.max(maximumFighterRenderables, count);
  assert.ok(count <= 30, `${weaponId} costume ${variant} stays within the fighter render budget`);
  fighter.dispose();
}
assert.ok(maximumFighterRenderables <= 30, "all forty-seven weapons and four costume variants preserve the full-quality draw budget");

const scene = new THREE.Scene();
const world = new ArenaWorld(scene, "PERFORMANCE-GRID");
let candidateTotal = 0;
let samples = 0;
for (let x = -104; x <= 104; x += 8) for (let z = -104; z <= 104; z += 8) {
  const position = new THREE.Vector3(x + .37, 18 + (samples % 7) * 8.1, z - .29);
  const radius = .11 + (samples % 4) * .13;
  const indexed = world.projectileHit(position, radius);
  const brute = Math.abs(position.x) >= world.size || Math.abs(position.z) >= world.size || position.y <= 0 || position.y >= world.height + 18 || world.obstacles.some((item) => !item.removed &&
    position.x + radius > item.x - item.w / 2 && position.x - radius < item.x + item.w / 2 &&
    position.z + radius > item.z - item.d / 2 && position.z - radius < item.z + item.d / 2 &&
    position.y + radius > item.baseY && position.y - radius < item.top);
  assert.equal(indexed, brute, `spatial collision matches the exhaustive result at ${position.toArray()}`);
  candidateTotal += world.nearbyObstacles(position.x - radius, position.x + radius, position.z - radius, position.z + radius).length;
  samples++;
}
assert.ok(candidateTotal / samples < world.obstacles.length * .35, "the spatial grid rejects most arena obstacles before narrow-phase projectile collision");
assert.ok(world.group.children.some((child) => child.matrixAutoUpdate === false), "static arena transforms are frozen after construction");
assert.ok(world.movers.every((mover) => mover.obstacle.mesh.matrixAutoUpdate), "moving platforms keep live transforms");
assert.ok(world.destructibleBatches.length > 0 && world.destructibleBatches.length <= 2, "all breakable arena bodies collapse into at most two identical-quality instanced draws");
assert.ok(world.destructibles.every((item) => item.batch && item.mesh.material.visible === false), "batched breakable bodies replace their duplicate individual base draws while retaining decorations and collision proxies");
const batchedVictim = world.destructibles[0];
const batchedVictimCenter = new THREE.Vector3(batchedVictim.x, batchedVictim.baseY + batchedVictim.h / 2, batchedVictim.z);
const batchedVictimMesh = batchedVictim.batch.mesh;
const batchedVictimIndex = batchedVictim.batch.index;
world.destroy(batchedVictimCenter, .01);
const hiddenBatchMatrix = new THREE.Matrix4();
batchedVictimMesh.getMatrixAt(batchedVictimIndex, hiddenBatchMatrix);
assert.equal(hiddenBatchMatrix.determinant(), 0, "destroyed instanced arena bodies disappear without restoring an individual draw call");
assert.ok(world.debrisParticles.filter((particle) => particle.active).length >= 10, "destroyed battlefield containers burst into dimension-scaled pooled debris");
const initialSmoke = world.dustParticles.filter((particle) => particle.active);
assert.ok(initialSmoke.length >= 10, "destroyed battlefield containers leave a dense but bounded pooled smoke cloud");
assert.ok(initialSmoke.every((particle) => particle.maxLife >= 5 && particle.maxLife <= 10), "destruction smoke persists for a bounded five-to-ten-second aftermath");
assert.ok(world.dustMesh.material.opacity > .13 && world.dustMesh.material.opacity <= .16, "smoke is thicker without becoming an opaque combat-visibility wall");
const smokeProbe = initialSmoke[0];
const smokeProbeIndex = world.dustParticles.indexOf(smokeProbe);
const smokeMatrix = new THREE.Matrix4(), smokePosition = new THREE.Vector3(), smokeRotation = new THREE.Quaternion(), midSmokeScale = new THREE.Vector3(), lateSmokeScale = new THREE.Vector3();
smokeProbe.life = smokeProbe.maxLife * .5;
world.updateStructuralDebris(0);
world.dustMesh.getMatrixAt(smokeProbeIndex, smokeMatrix);
smokeMatrix.decompose(smokePosition, smokeRotation, midSmokeScale);
smokeProbe.life = smokeProbe.maxLife * .05;
world.updateStructuralDebris(0);
world.dustMesh.getMatrixAt(smokeProbeIndex, smokeMatrix);
smokeMatrix.decompose(smokePosition, smokeRotation, lateSmokeScale);
assert.ok(lateSmokeScale.length() < midSmokeScale.length() * .5, "late smoke visibly thins instead of popping away at full density");
smokeProbe.life = smokeProbe.maxLife;
const smokeSurvivorsAfterSixSeconds = initialSmoke.filter((particle) => particle.life > 6).length;
world.updateStructuralDebris(6);
assert.equal(world.dustParticles.filter((particle) => particle.active).length, smokeSurvivorsAfterSixSeconds, "staggered smoke lifetimes gradually thin the cloud after five seconds");
assert.ok(smokeSurvivorsAfterSixSeconds > 0 && smokeSurvivorsAfterSixSeconds < initialSmoke.length, "some smoke remains after six seconds while the earliest wisps have dispersed");
world.updateStructuralDebris(4);
assert.ok(!world.debrisParticles.some((particle) => particle.active) && !world.dustParticles.some((particle) => particle.active), "temporary destruction debris and smoke vanish after ten seconds");
let renderables = 0;
const worldGeometries = new Set();
const worldMaterials = new Set();
world.group.traverse((object) => {
  if (!(object.isMesh || object.isLine || object.isPoints)) return;
  renderables++;
  if (object.geometry) worldGeometries.add(object.geometry);
  if (object.material) worldMaterials.add(object.material);
});
assert.ok(renderables <= 420 && worldGeometries.size <= 420 && worldMaterials.size <= 300, "the full-quality arena stays inside explicit draw-candidate and GPU-resource budgets");

const visualScene = new THREE.Scene();
const visuals = new CombatVisuals(visualScene, { quality: 1 });
const idleVersions = [visuals.flashOuter, visuals.flashInner, visuals.tracerOuter, visuals.tracerInner, visuals.ringOuter, visuals.ringInner, visuals.sparkLayer, visuals.bloodLayer]
  .map((layer) => layer.instanceMatrix.version);
visuals.update(1 / 60);
assert.deepEqual(
  [visuals.flashOuter, visuals.flashInner, visuals.tracerOuter, visuals.tracerInner, visuals.ringOuter, visuals.ringInner, visuals.sparkLayer, visuals.bloodLayer].map((layer) => layer.instanceMatrix.version),
  idleVersions,
  "idle combat pools do not upload hundreds of unchanged hidden transforms"
);
const rocket = createProjectileVisual(WEAPONS.rocket_launcher, { color: 0x129dba, accent: 0x6ff6ff }, .25);
const secondRocket = createProjectileVisual(WEAPONS.rocket_launcher, { color: 0xc82849, accent: 0xff6b82 }, .25);
const rocketGeometries = [];
const secondRocketGeometries = [];
rocket.traverse((child) => {
  if (child.isMesh) {
    assert.equal(child.frustumCulled, true, "ordinary projectile meshes retain Three.js frustum culling");
    rocketGeometries.push(child.geometry);
  }
});
secondRocket.traverse((child) => { if (child.isMesh) secondRocketGeometries.push(child.geometry); });
assert.deepEqual(secondRocketGeometries, rocketGeometries, "repeat shots reuse immutable GPU geometry while retaining separate materials");

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const decoyMethods = mainSource.slice(mainSource.indexOf("\n  spawnDecoy("), mainSource.indexOf("\n  damagePlayer("));
const removeObjectMethod = mainSource.slice(mainSource.indexOf("\n  removeObject(object) {"), mainSource.indexOf("\n}\n\nconst game ="));
const transientMethod = mainSource.slice(mainSource.indexOf("\n  clearTransientNetworkCombat() {"), mainSource.indexOf("\n  removeOwnedCombat("));
const decoyHarness = new Function("THREE", "mergeGeometries", `return new (class {${decoyMethods}${removeObjectMethod}${transientMethod}})();`)(THREE, mergeGeometries);
Object.assign(decoyHarness, { scene: new THREE.Scene(), world: { surfaceHeightAt: () => 0 },
  decoys: [], projectiles: [], hazards: [], effects: [], decoyRenderAnchor: null, spawnBurst() {}, renderPipeline: { quality: "high", direct: false } });
const decoyOwner = new Fighter(decoyHarness.scene, { id: "decoy-qa", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const decoyDisposals = new Map();
function trackDecoy(mesh) {
  mesh.traverse(child => {
    for (const resource of [child.geometry, ...(Array.isArray(child.material) ? child.material : [child.material])].filter(Boolean)) {
      decoyDisposals.set(resource, 0);
      resource.addEventListener("dispose", () => decoyDisposals.set(resource, decoyDisposals.get(resource) + 1));
    }
  });
}
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
const firstDecoy = decoyHarness.decoys[0]; trackDecoy(firstDecoy.mesh);
const thrusterSnapshot = firstDecoy.mesh.getObjectByName("Fighter thruster pair");
assert.ok(thrusterSnapshot.isMesh && !thrusterSnapshot.isInstancedMesh, "a frozen decoy pair uses one ordinary draw without per-clone instance bindings");
assert.equal(thrusterSnapshot.geometry.index.count, decoyOwner.thrusterLights.geometry.index.count * 2);
const thrusterMatrix = new THREE.Matrix4();
for (let instance = 0; instance < 2; instance++) {
  decoyOwner.thrusterLights.getMatrixAt(instance, thrusterMatrix);
  const expected = decoyOwner.thrusterLights.geometry.clone().applyMatrix4(thrusterMatrix);
  for (const name of ["position", "normal", "uv"]) {
    const source = expected.attributes[name].array, actual = thrusterSnapshot.geometry.attributes[name].array;
    assert.deepEqual(actual.slice(instance * source.length, (instance + 1) * source.length), source,
      `decoy thruster ${instance} retains the exact ${name} data`);
  }
  expected.dispose();
}
thrusterSnapshot.onAfterRender();
assert.equal(firstDecoy.mesh.userData.decoyRendered, false, "a partially visible decoy cannot retain incomplete shader coverage");
assert.ok(thrusterSnapshot.onAfterRender === THREE.Object3D.prototype.onAfterRender, "render marker removes its own per-draw work after first use");
firstDecoy.mesh.traverse(child => { if (child.isMesh) child.onAfterRender(); });
assert.equal(firstDecoy.mesh.userData.decoyRendered, true);
decoyHarness.removeDecoy(firstDecoy);
assert.ok(decoyHarness.decoyRenderAnchor === firstDecoy.mesh, "one removed decoy retains its already-compiled renderer resources");
assert.equal(firstDecoy.mesh.parent, null, "the render anchor cannot draw");
assert.equal(decoyHarness.decoys.length, 0, "the render anchor cannot become a gameplay target");
assert.ok([...decoyDisposals.values()].every(count => count === 0), "last removal keeps bounded shader references alive");
for (let i = 0; i < 2; i++) decoyHarness.spawnDecoy(new THREE.Vector3(i + 2, 0, 0), decoyOwner, WEAPONS.decoy_launcher);
const [decoyA, decoyB] = decoyHarness.decoys;
decoyA.life = 8; decoyB.life = 10;
decoyHarness.updateDecoys(.1);
assert.notEqual(decoyA.materials[0].material.opacity, decoyB.materials[0].material.opacity, "overlapping holograms retain independent flicker");
assert.ok(decoyA.materials.every(({ material }, i) => material !== decoyB.materials[i].material), "visible decoys never alias mutated materials");
trackDecoy(decoyA.mesh); trackDecoy(decoyB.mesh);
decoyHarness.removeDecoy(decoyA); decoyHarness.removeDecoy(decoyA);
assert.ok(decoyHarness.decoyRenderAnchor === firstDecoy.mesh, "retention stays bounded to one clone");
decoyB.mesh.traverse(child => { if (child.isMesh) child.onAfterRender(); });
decoyHarness.removeDecoy(decoyB);
assert.ok(decoyHarness.decoyRenderAnchor === decoyB.mesh, "the latest complete render owns the anchor so current-tier pipelines survive");
decoyHarness.clearTransientNetworkCombat(); decoyHarness.clearTransientNetworkCombat();
assert.equal(decoyHarness.decoyRenderAnchor, null);
assert.ok([...decoyDisposals.values()].every(count => count === 1), "all owned decoy resources dispose exactly once on cleanup");
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
decoyHarness.removeDecoy(decoyHarness.decoys[0]);
assert.equal(decoyHarness.decoyRenderAnchor, null, "an offscreen/unrendered first decoy must not occupy the sole shader anchor");
for (const scale of [.65, 1.8]) {
  for (let instance = 0; instance < 2; instance++) {
    thrusterMatrix.makeScale(1, scale, 1).setPosition(instance ? .2 : -.2, 1.02, -.49);
    decoyOwner.thrusterLights.setMatrixAt(instance, thrusterMatrix);
  }
  decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
  const snapshot = decoyHarness.decoys[0].mesh.getObjectByName("Fighter thruster pair");
  for (let instance = 0; instance < 2; instance++) {
    decoyOwner.thrusterLights.getMatrixAt(instance, thrusterMatrix);
    const expected = decoyOwner.thrusterLights.geometry.clone().applyMatrix4(thrusterMatrix);
    for (const name of ["position", "normal", "uv"]) {
      const values = expected.attributes[name].array;
      assert.deepEqual(snapshot.geometry.attributes[name].array.slice(instance * values.length, (instance + 1) * values.length), values);
    }
    expected.dispose();
  }
  const frozenPositions = snapshot.geometry.attributes.position.array.slice();
  decoyOwner.thrusterLights.setMatrixAt(0, new THREE.Matrix4().makeScale(9, 9, 9));
  assert.deepEqual(snapshot.geometry.attributes.position.array, frozenPositions, "later owner thrust cannot change an existing decoy pose");
  decoyHarness.clearTransientNetworkCombat();
}
const clearMatchMethod = mainSource.slice(mainSource.indexOf("\n  clearMatch("), mainSource.indexOf("\n  renderMain("));
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
const oldTierDecoy = decoyHarness.decoys[0];
oldTierDecoy.mesh.traverse(child => { if (child.isMesh) child.onAfterRender(); });
decoyHarness.renderPipeline.quality = "medium";
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
const currentTierDecoy = decoyHarness.decoys[1];
currentTierDecoy.mesh.traverse(child => { if (child.isMesh) child.onAfterRender(); });
decoyHarness.removeDecoy(currentTierDecoy);
decoyHarness.removeDecoy(oldTierDecoy);
assert.ok(decoyHarness.decoyRenderAnchor === currentTierDecoy.mesh, "late offscreen old-tier expiry cannot evict the current-tier cache");
decoyHarness.renderPipeline.quality = "high";
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
const mixedTierDecoy = decoyHarness.decoys[0];
mixedTierDecoy.mesh.getObjectByName("Fighter thruster pair").onAfterRender();
decoyHarness.renderPipeline.quality = "medium";
mixedTierDecoy.mesh.traverse(child => { if (child.isMesh) child.onAfterRender(); });
assert.equal(mixedTierDecoy.mesh.userData.decoyRendered, false, "partial coverage from different render contexts cannot combine into a complete anchor");
decoyHarness.removeDecoy(mixedTierDecoy);
assert.ok(decoyHarness.decoyRenderAnchor === currentTierDecoy.mesh);
decoyHarness.clearTransientNetworkCombat();
decoyHarness.clearMatch = new Function("clearTouchActions", `return (class {${clearMatchMethod}}).prototype.clearMatch;`)(() => {});
Object.assign(decoyHarness, { input: { releasePointer() {} }, touch: {}, hideNetworkReconnecting() {},
  sound: { stopAll() {} }, players: [], botTargets: new Map(), networkTargets: new Map(), networkRespawnRequests: new Map() });
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
const matchAnchor = decoyHarness.decoys[0]; trackDecoy(matchAnchor.mesh);
matchAnchor.mesh.getObjectByName("Fighter thruster pair").onAfterRender();
matchAnchor.mesh.traverse(child => { if (child.isMesh) child.onAfterRender(); });
decoyHarness.removeDecoy(matchAnchor);
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
trackDecoy(decoyHarness.decoys[0].mesh);
decoyHarness.world = null;
decoyHarness.clearMatch(); decoyHarness.clearMatch();
assert.equal(decoyHarness.decoyRenderAnchor, null);
assert.ok([...decoyDisposals.values()].every(count => count === 1), "match teardown releases active and retained clones exactly once");
decoyOwner.dispose();
const audioSelectors = mainSource.slice(mainSource.indexOf("function projectileNeedsLoop("), mainSource.indexOf("function setText("));
const updateMethod = mainSource.slice(mainSource.indexOf("\n  updateProjectiles(dt) {"), mainSource.indexOf("\n  findProjectileTarget("));
const updateProjectiles = new Function("projectileStepCount", `${audioSelectors}; return ({${updateMethod}}).updateProjectiles;`)(projectileStepCount);
let spatialQueries = 0, projectileVisualUpdates = 0;
const activeLoops = [];
const shots = Array.from({ length: 112 }, (_, index) => ({
  audioId: `shot-${index}`, weapon: WEAPONS.rocket_launcher, owner: { id: "owner" },
  mesh: new THREE.Object3D(),
  velocity: new THREE.Vector3(1, 0, 0), previousPosition: new THREE.Vector3(),
  radius: .25, age: 0, life: 100
}));
for (let index = 0; index < shots.length; index++) shots[index].mesh.position.set(index, 30, 0);
updateProjectiles.call({
  players: [{ position: new THREE.Vector3(0, 30, 0) }], projectiles: shots,
  nearestAudioDistances: new Float64Array(6), nearestAudioIds: [], audibleProjectileIds: new Set(),
  sound: { updateProjectileLoop(id, weapon, active) { if (active) activeLoops.push(id); } },
  audioSpatial() { spatialQueries++; return {}; }, world: { projectileHit: () => false }, findProjectileTarget: () => null,
  combatVisuals: { updateProjectile() { projectileVisualUpdates++; } }
}, 1 / 60);
assert.equal(spatialQueries, 6, "112 projectiles request only the nearest six spatial audio calculations");
assert.deepEqual(activeLoops.sort(), Array.from({ length: 6 }, (_, index) => `shot-${index}`), "the audible projectile identities are unchanged");
assert.equal(projectileVisualUpdates, 112, "every projectile keeps its full visual update");
shots.forEach((shot, index) => {
  assert.ok(Math.abs(shot.mesh.position.x - index - 1 / 60) < 1e-10, "all projectile movement remains simulated");
  assert.equal(shot.age, 1 / 60);
});

const fireballA = visuals.createProjectile({ color: 0x12ccff }, WEAPONS.fireball, .36);
fireballA.position.set(1, 2, 3);
const assertFireballUploads = (count) => {
  visuals.updateFireballs();
  for (const layer of visuals.fireballLayerList) {
    assert.equal(layer.count, count, "all seven authored Fireball layers remain drawn");
    assert.equal(layer.instanceMatrix.count, 4096, "the maximum effect capacity is not reduced");
    if (count) {
      assert.deepEqual(layer.instanceMatrix.updateRanges, [{ start: 0, count: count * 16 }]);
      assert.deepEqual(layer.instanceColor.updateRanges, [{ start: 0, count: count * 3 }]);
    }
  }
};
assertFireballUploads(1);
const firstFireballMatrices = visuals.fireballLayerList.map((layer) => Array.from(layer.instanceMatrix.array.slice(0, 16)));
const fireballB = visuals.createProjectile({ color: 0xff1234 }, WEAPONS.fireball, .36);
fireballB.position.set(4, 5, 6);
assertFireballUploads(2);
assert.deepEqual(visuals.fireballLayerList.map((layer) => Array.from(layer.instanceMatrix.array.slice(0, 16))), firstFireballMatrices, "growing the active prefix preserves the original complete effect");
visuals.removeProjectile({ mesh: fireballA });
assertFireballUploads(1);
const cinderColor = new THREE.Color();
visuals.fireballLayers.cinder.getColorAt(0, cinderColor);
assert.deepEqual(cinderColor.toArray(), fireballB.userData.combatVisual.ownerColor.toArray().map(Math.fround), "compaction uploads the surviving owner's exact float32 color");
visuals.removeProjectile({ mesh: fireballB });
assertFireballUploads(0);

const fallingPart = world.structuralParts.find((part) => part.structuralKind === "pillar" && part.structure.major);
assert.ok(world.queueStructuralFailure(fallingPart, "collapse-owner"));
const collapse = world.structuralChanges.at(-1);
world.updateStructuralChanges(collapse.warningDuration, []);
assert.equal(collapse.phase, "falling");
const updateStructuralVisual = world.updateStructuralVisual;
const visualUpdates = new Map();
world.updateStructuralVisual = function(part) {
  visualUpdates.set(part, (visualUpdates.get(part) || 0) + 1);
  return updateStructuralVisual.call(this, part);
};
world.updateStructuralChanges(collapse.fallDuration * .25, []);
for (const { part } of collapse.movingParts) {
  assert.equal(visualUpdates.get(part), 1, "falling structure visuals are updated exactly once per frame");
  const matrices = part.instanceVisuals.map(({ mesh, index }) => Array.from(mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16)));
  // Replaying the former extra pass must not change the rendered output.
  updateStructuralVisual.call(world, part);
  assert.deepEqual(part.instanceVisuals.map(({ mesh, index }) => Array.from(mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16))), matrices);
}
world.updateStructuralVisual = updateStructuralVisual;
const worldSource = fs.readFileSync(new URL("../src/world.js", import.meta.url), "utf8");
const playerSource = fs.readFileSync(new URL("../src/player.js", import.meta.url), "utf8");
const pipelineSource = fs.readFileSync(new URL("../src/renderPipeline.js", import.meta.url), "utf8");
assert.match(mainSource, /selectNearestAudio\([\s\S]*?this\.projectiles, listener\.position, 6/, "projectile audio uses a bounded nearest-six selector");
assert.match(mainSource, /new Worker\(new URL\("\.\/botPlanner\.worker\.js"[\s\S]*?updateBotPlanner\(dt\)/, "batched bot target planning runs off the render thread when workers are available");
assert.doesNotMatch(mainSource, /renderer\.compileAsync/, "no unowned async compilation may recreate disposed match resources");
assert.match(mainSource, /const rendered = this\.renderScene\(\);[\s\S]*?hideMatchLoadingAfterFrame && rendered/, "the loading screen stays until the selected pipeline submits its first frame");
assert.match(mainSource, /dataset\.drawCalls[\s\S]*?dataset\.geometries[\s\S]*?dataset\.longTasks[\s\S]*?dataset\.budget/, "live frame telemetry exposes draw, memory, long-task, and performance-budget health");
const projectileUpdateStart = mainSource.indexOf("\n  updateProjectiles(dt) {");
assert.doesNotMatch(mainSource.slice(projectileUpdateStart, mainSource.indexOf("\n  bounceProjectile(", projectileUpdateStart)), /\.filter\(|\.sort\(/, "projectile simulation avoids full-list allocation and sorting every frame");
assert.match(mainSource, /previousPosition\.copy\(shot\.mesh\.position\)/, "projectile substeps reuse a persistent collision position");
assert.match(playerSource, /this\.desiredMove\.copy\(move\)/, "fighters reuse movement vectors instead of allocating per frame");
assert.match(worldSource, /nearbyObstacles\([\s\S]*?obstacleGrid/, "arena collisions use the spatial broad phase");
assert.match(mainSource, /!child\.geometry\?\.userData\?\.sharedProjectile/, "shared projectile GPU buffers survive individual shot cleanup");
assert.match(pipelineSource, /aoPass\.samples\.value = 16/, "high graphics retains sixteen-sample ambient occlusion");
assert.match(pipelineSource, /bloomPass\.resolutionScale = \.5/, "high graphics retains half-resolution HDR bloom");
assert.ok([visuals.flashOuter, visuals.flashInner, visuals.tracerOuter, visuals.tracerInner, visuals.ringOuter, visuals.ringInner, visuals.sparkLayer]
  .every((layer) => layer.isInstancedMesh && layer.matrixAutoUpdate === false), "pooled GPU effect layers keep one static object transform and one instanced draw per family");

visuals.dispose();
world.dispose();
console.log("Output-equivalent high-graphics performance checks passed.");
