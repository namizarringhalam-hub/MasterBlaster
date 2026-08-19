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
assert.ok(bot.botTargetPoint?.isVector3, "bot target-position scratch storage survives AI target initialization");
assert.equal(bot.botTarget, null, "bot target selection remains independent from its target-position scratch vector");
bot.dispose();

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
const projectileUpdateStart = mainSource.indexOf("\n  updateProjectiles(dt) {");
assert.doesNotMatch(mainSource.slice(projectileUpdateStart, mainSource.indexOf("\n  bounceProjectile(", projectileUpdateStart)), /\.filter\(|\.sort\(/, "projectile simulation avoids full-list allocation and sorting every frame");
assert.match(mainSource, /previousPosition\.copy\(shot\.mesh\.position\)/, "projectile substeps reuse a persistent collision position");
assert.match(playerSource, /this\.desiredMove\.copy\(move\)/, "fighters reuse movement vectors instead of allocating per frame");
assert.match(worldSource, /nearbyObstacles\([\s\S]*?obstacleGrid/, "arena collisions use the spatial broad phase");
assert.match(mainSource, /!child\.geometry\?\.userData\?\.sharedProjectile/, "shared projectile GPU buffers survive individual shot cleanup");
assert.match(pipelineSource, /aoPass\.samples\.value = 16/, "high graphics retains sixteen-sample ambient occlusion");
assert.match(pipelineSource, /bloomPass\.resolutionScale = \.5/, "high graphics retains half-resolution HDR bloom");

visuals.dispose();
world.dispose();
console.log("Output-equivalent high-graphics performance checks passed.");
