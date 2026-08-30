import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three/webgpu";
import { CombatVisuals, createProjectileVisual } from "../src/combatVisuals.js";
import { WEAPONS } from "../src/gameData.js";
import { Fighter } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";

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
const worldSource = fs.readFileSync(new URL("../src/world.js", import.meta.url), "utf8");
const playerSource = fs.readFileSync(new URL("../src/player.js", import.meta.url), "utf8");
const pipelineSource = fs.readFileSync(new URL("../src/renderPipeline.js", import.meta.url), "utf8");
assert.match(mainSource, /selectNearestAudio\([\s\S]*?this\.projectiles, listener\.position, 6/, "projectile audio uses a bounded nearest-six selector");
assert.match(mainSource, /new Worker\(new URL\("\.\/botPlanner\.worker\.js"[\s\S]*?updateBotPlanner\(dt\)/, "batched bot target planning runs off the render thread when workers are available");
assert.match(mainSource, /renderer\.compileAsync\?\.\(this\.scene, this\.camera\)[\s\S]*?arenaWarmup/, "arena shaders and WebGPU pipelines warm behind the match loader");
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
