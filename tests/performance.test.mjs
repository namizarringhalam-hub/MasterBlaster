import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three/webgpu";
import { CombatVisuals, createProjectileVisual } from "../src/combatVisuals.js";
import { WEAPONS, projectileStepCount } from "../src/gameData.js";
import { Fighter } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";
import { cloneMechaHologram } from "../src/mecha.js";
import { emissiveEffectMaterial } from "../src/effectMaterials.js";
import { PLAYER_TEXT } from "../PLAYER_TEXT.js";

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
assert.ok(bot.thrusterLights.isMesh && !bot.thrusterLights.isInstancedMesh,
  "the fighter's two flames must share an ordinary mesh without unique per-fighter instance bindings");
const referenceFlame = new THREE.ConeGeometry(.105, .36, 6, 1, true);
const referenceTransform = new THREE.Object3D();
for (const scale of [.65, 1.2, 1.8]) {
  bot.thrusterScale = scale;
  bot.update(0, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), {}, { resolve: () => ({ grounded: true }), boostAt: () => null });
  bot.updatePresentation(0);
  bot.thrusterLights.updateMatrix();
  assert.equal(bot.thrusterLights.scale.y, scale, "actual fighter update animates only the pair's local scale");
  assert.deepEqual(bot.thrusterLights.position.toArray(), [0, 1.356, -.402], "thrust cannot move the common anchor");
  const actual = bot.thrusterLights.geometry.clone().applyMatrix4(bot.thrusterLights.matrix);
  const expectedBounds = new THREE.Box3();
  assert.equal(actual.index.count, referenceFlame.index.count * 2);
  assert.equal(actual.groups.length, 0, "both flames retain a single material batch");
  for (let instance = 0; instance < 2; instance++) {
    referenceTransform.position.set(instance ? .124 : -.124, 1.356, -.402);
    referenceTransform.rotation.set(Math.PI, 0, 0); referenceTransform.scale.set(.62, scale, .82); referenceTransform.updateMatrix();
    // Old instance matrices are float32, as are the new merged vertex buffers.
    const matrix = new THREE.Matrix4().fromArray(new Float32Array(referenceTransform.matrix.elements));
    const expected = referenceFlame.clone().applyMatrix4(matrix);
    expected.computeBoundingBox(); expectedBounds.union(expected.boundingBox);
    for (const name of ["position", "normal", "uv"]) {
      const source = expected.attributes[name].array, values = actual.attributes[name].array;
      for (let i = 0; i < source.length; i++) assert.ok(Math.abs(source[i] - values[instance * source.length + i]) < 2e-7,
        `scale ${scale}, flame ${instance}, ${name}[${i}] remains float32-equivalent`);
    }
    const offset = instance * referenceFlame.attributes.position.count;
    assert.deepEqual(actual.index.array.slice(instance * referenceFlame.index.count, (instance + 1) * referenceFlame.index.count),
      referenceFlame.index.array.map(index => index + offset), "triangle order and winding are unchanged");
    expected.dispose();
  }
  actual.computeBoundingBox();
  assert.ok(actual.boundingBox.min.distanceTo(expectedBounds.min) < 2e-7 && actual.boundingBox.max.distanceTo(expectedBounds.max) < 2e-7,
    "animation preserves the full flame bounds, not just its tip");
  actual.dispose();
}
referenceFlame.dispose();
const otherFighter = new Fighter(botScene, { id: "independent-thruster", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const otherOpacity = otherFighter.thrusterMaterial.opacity;
bot.thrusterMaterial.opacity = .1;
assert.notEqual(bot.thrusterMaterial, otherFighter.thrusterMaterial);
assert.equal(otherFighter.thrusterMaterial.opacity, otherOpacity, "thruster intensity remains independent per fighter");
assert.equal(bot.thrusterLights.frustumCulled, true);
otherFighter.dispose();
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
  assert.ok(count <= 30, `${weaponId} costume ${variant}: complete mecha stays within the existing draw budget`);
  fighter.dispose();
}
assert.ok(maximumFighterRenderables <= 30, "all forty-seven weapons and four costumes stay within thirty renderables");

const scene = new THREE.Scene();
const world = new ArenaWorld(scene, "PERFORMANCE-GRID");
// Frozen pre-pass19 reference: preserve stable-sort ties and retained point ownership.
function legacyRopeWrapPoint(origin, target) {
  const obstruction = this.ropeObstacle(origin, target);
  if (!obstruction) return null;
  const { item, hit } = obstruction, clearance = .3;
  const xs = [item.x - item.w / 2 - clearance, item.x + item.w / 2 + clearance];
  const ys = [Math.max(.12, item.baseY - clearance), item.top + clearance];
  const zs = [item.z - item.d / 2 - clearance, item.z + item.d / 2 + clearance];
  const candidates = [];
  for (const x of xs) for (const y of ys) candidates.push(new THREE.Vector3(x, y, THREE.MathUtils.clamp(hit.z, zs[0], zs[1])));
  for (const x of xs) for (const z of zs) candidates.push(new THREE.Vector3(x, THREE.MathUtils.clamp(hit.y, ys[0], ys[1]), z));
  for (const y of ys) for (const z of zs) candidates.push(new THREE.Vector3(THREE.MathUtils.clamp(hit.x, xs[0], xs[1]), y, z));
  const blockedByItem = (a, b) => {
    const delta = b.clone().sub(a), length = delta.length();
    if (length < .05) return false;
    const box = new THREE.Box3(new THREE.Vector3(item.x - item.w / 2, item.baseY, item.z - item.d / 2), new THREE.Vector3(item.x + item.w / 2, item.top, item.z + item.d / 2));
    const contact = new THREE.Ray(a, delta.multiplyScalar(1 / length)).intersectBox(box, new THREE.Vector3());
    return Boolean(contact && a.distanceTo(contact) > .03 && a.distanceTo(contact) < length - .03);
  };
  return candidates.filter(point => point.distanceTo(origin) > .2 && !blockedByItem(origin, point))
    .sort((a, b) => origin.distanceTo(a) + a.distanceTo(target) - origin.distanceTo(b) - b.distanceTo(target))[0] || null;
}
const wrapCases = [];
for (let i = 0; i < 1800; i++) wrapCases.push([
  new THREE.Vector3((i * 37 % 211) - 105, i * 13 % 75 + .12, (i * 71 % 211) - 105),
  new THREE.Vector3((i * 67 % 211) - 105, i * 31 % 75 + .12, (i * 43 % 211) - 105)
]);
wrapCases.push([new THREE.Vector3(), new THREE.Vector3()], [new THREE.Vector3(90, 10, 90), new THREE.Vector3(90, 10.01, 90)]);
function wrapRoute(method, start, end) {
  const points = []; let from = start;
  for (let i = 0; i < 8; i++) {
    const point = method.call(world, from, end);
    if (!point) break;
    points.push(point); from = point;
  }
  return points;
}
let routedCases = 0;
for (const [start, end] of wrapCases) {
  const expected = wrapRoute(legacyRopeWrapPoint, start, end).map(point => point.toArray());
  const points = wrapRoute(ArenaWorld.prototype.ropeWrapPoint, start, end);
  if (expected.length) routedCases++;
  assert.deepEqual(points.map(point => point.toArray()), expected, "full route including legacy repeated corners stays exact");
  world.ropeWrapPoint(end, start);
  assert.deepEqual(points.map(point => point.toArray()), expected, "later queries cannot mutate retained wrap points");
}
assert.ok(routedCases > 50, "comparison must actually exercise obstructed routes");
const wrapAllocations = { Vector3: 0, Box3: 0, Ray: 0 };
const countedThree = { ...THREE };
for (const name of Object.keys(wrapAllocations)) countedThree[name] = class extends THREE[name] {
  constructor(...args) { super(...args); wrapAllocations[name]++; }
};
const countedWrap = new Function("THREE", `return ({${ArenaWorld.prototype.ropeWrapPoint.toString()}}).ropeWrapPoint;`)(countedThree);
const symmetricObstruction = { item: { x: 0, z: 0, w: 2, d: 2, baseY: -1, top: 1 }, hit: new THREE.Vector3(-1, 0, 0) };
const wrapFixture = { ropeObstacle: () => symmetricObstruction, collisionDirection: new THREE.Vector3(), collisionBox: new THREE.Box3(), collisionRay: new THREE.Ray(), collisionHit: new THREE.Vector3() };
const wrapStart = new THREE.Vector3(-4, 0, 0), wrapEnd = new THREE.Vector3(4, 0, 0);
assert.deepEqual(countedWrap.call(wrapFixture, wrapStart, wrapEnd).toArray(), legacyRopeWrapPoint.call(wrapFixture, wrapStart, wrapEnd).toArray(), "symmetric equal-length candidates preserve the first stable-sort choice");
const tieItem = { x: 0, z: 0, w: 2, d: 2, baseY: 0, top: 10 };
const tieFixture = { ...wrapFixture, nearbyObstacles: () => [tieItem], ropeObstacle: ArenaWorld.prototype.ropeObstacle };
for (const endX of [2.25, 5, 5.5, 5.75]) {
  const start = new THREE.Vector3(-2.25, 5, 0), end = new THREE.Vector3(endX, 5, 0);
  assert.deepEqual(ArenaWorld.prototype.ropeWrapPoint.call(tieFixture, start, end).toArray(), legacyRopeWrapPoint.call(tieFixture, start, end).toArray(),
    "left-associative comparator rounding must preserve the original side of a symmetric obstacle");
}
assert.equal(wrapAllocations.Box3, 0, "wrap candidates reuse one existing collision box");
assert.equal(wrapAllocations.Ray, 0, "wrap candidates reuse the existing collision ray");
assert.equal(wrapAllocations.Vector3, 17, "rope wrapping allocates its twelve reusable candidates plus collision and retained-point scratch");
const retainedWrap = countedWrap.call(wrapFixture, wrapStart, wrapEnd);
assert.ok(retainedWrap !== countedWrap.call(wrapFixture, wrapStart, wrapEnd), "retained wrap points stay independently owned across queries");
assert.equal(wrapAllocations.Vector3, 19, "subsequent rope queries allocate one independent retained-point vector each");
if (process.argv.includes("--bench-rope")) {
  const results = [];
  for (let batch = 0; batch < 6; batch++) for (const [name, method] of (batch % 2 ? [["current", ArenaWorld.prototype.ropeWrapPoint], ["legacy", legacyRopeWrapPoint]] : [["legacy", legacyRopeWrapPoint], ["current", ArenaWorld.prototype.ropeWrapPoint]])) {
    const started = performance.now(); let points = 0;
    for (let round = 0; round < 25; round++) for (const [start, end] of wrapCases.slice(0, 182)) points += wrapRoute(method, start, end).length;
    results.push({ batch, name, ms: performance.now() - started, routes: 25 * Math.min(182, wrapCases.length), points });
  }
  console.log(JSON.stringify({ ropeBenchmark: results }));
}
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

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const createDecoyMeshMethod = mainSource.slice(mainSource.indexOf("\n  createDecoyMesh("), mainSource.indexOf("\n  spawnDecoy("));
const decoyMethods = mainSource.slice(mainSource.indexOf("\n  spawnDecoy("), mainSource.indexOf("\n  damagePlayer("));
const removeObjectMethod = mainSource.slice(mainSource.indexOf("\n  removeObject(object) {"), mainSource.indexOf("\n}\n\nconst game ="));
const transientMethod = mainSource.slice(mainSource.indexOf("\n  clearTransientNetworkCombat() {"), mainSource.indexOf("\n  removeOwnedCombat("));
const disposalMethod = mainSource.slice(mainSource.indexOf("\n  disposeAfterGraphicsWarmup("), mainSource.indexOf("\n  clearMatch("));
const decoyHarness = new Function("THREE", "WEAPONS", "cloneMechaHologram", "emissiveEffectMaterial",
  `return new (class {${createDecoyMeshMethod}${decoyMethods}${removeObjectMethod}${transientMethod}${disposalMethod}})();`)
  (THREE, WEAPONS, cloneMechaHologram, emissiveEffectMaterial);
Object.assign(decoyHarness, { scene: new THREE.Scene(), world: { surfaceHeightAt: () => 0 },
  decoys: [], projectiles: [], hazards: [], effects: [], decoyRenderAnchor: null, spawnBurst() {}, renderPipeline: { quality: "high", direct: false } });
// Holograms share immutable armor buffers while owning separate animated skeletons.
const decoyOwner = new Fighter(decoyHarness.scene, { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
decoyOwner.rig.visible = false;
const decoyDisposals = new Map();
function trackDecoy(mesh) {
  const ownedSkeletons = new Set();
  mesh.traverse(child => { if (child.isSkinnedMesh) ownedSkeletons.add(child.skeleton); });
  assert.equal(ownedSkeletons.size, decoyOwner.mechaSkinMeshes.length, "each rigid armor batch owns a clone skeleton");
  for (const source of decoyOwner.mechaSkinMeshes) {
    const clone = mesh.getObjectByName(source.name);
    assert.ok(clone?.isSkinnedMesh, "holograms preserve each rigid armor batch");
    assert.notEqual(clone.skeleton, source.skeleton, "pose state is independent between owner and decoy");
    assert.equal(clone.geometry, source.geometry, "immutable batched geometry is shared across decoys");
    assert.equal(clone.material, decoyHarness.decoyMaterial, "one hologram material is shared across all decoy batches");
  }
  for (const skeleton of ownedSkeletons) {
    decoyDisposals.set(skeleton, 0);
    const dispose = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => { decoyDisposals.set(skeleton, decoyDisposals.get(skeleton) + 1); dispose(); };
  }
  return ownedSkeletons;
}
decoyOwner.group.updateMatrixWorld(true);
decoyHarness.spawnDecoy(new THREE.Vector3(), decoyOwner, WEAPONS.decoy_launcher);
const firstDecoy = decoyHarness.decoys[0], firstSkeletons = trackDecoy(firstDecoy.mesh);
assert.equal(firstDecoy.mesh.children[decoyOwner.group.children.indexOf(decoyOwner.rig)].visible, true,
  "world decoys stay visible when the first-person camera hides their local owner's rig");
decoyHarness.spawnDecoy(new THREE.Vector3(2, 0, 0), decoyOwner, WEAPONS.decoy_launcher);
const secondDecoy = decoyHarness.decoys[1], secondSkeletons = trackDecoy(secondDecoy.mesh);
for (const source of decoyOwner.mechaSkinMeshes) {
  assert.notEqual(firstDecoy.mesh.getObjectByName(source.name).skeleton, secondDecoy.mesh.getObjectByName(source.name).skeleton,
    "overlapping holograms never share mutable pose state");
}
decoyHarness.removeDecoy(firstDecoy);
assert.equal(decoyHarness.decoys.length, 1, "removing a hologram removes only its gameplay target");
assert.ok([...firstSkeletons].every(skeleton => decoyDisposals.get(skeleton) === 1), "removed hologram releases its owned skeletons");
assert.ok([...secondSkeletons].every(skeleton => decoyDisposals.get(skeleton) === 0), "the surviving clone keeps its pose state alive");
decoyHarness.removeDecoy(secondDecoy);
assert.equal(decoyHarness.decoys.length, 0);
assert.ok([...decoyDisposals.values()].every(count => count === 1), "each cloned skeleton is disposed exactly once");
const clearMatchMethod = mainSource.slice(mainSource.indexOf("\n  disposeAfterGraphicsWarmup("), mainSource.indexOf("\n  renderMain("));
const cleanupMethods = new Function("clearTouchActions", "disposeGameplaySamples", `return (class {${clearMatchMethod}}).prototype;`)(() => {}, () => {});
decoyHarness.clearMatch = cleanupMethods.clearMatch;
decoyHarness.disposeAfterGraphicsWarmup = cleanupMethods.disposeAfterGraphicsWarmup;
Object.assign(decoyHarness, { input: { releasePointer() {} }, touch: {}, hideNetworkReconnecting() {},
  sound: { stopAll() {} }, players: [], botTargets: new Map(), networkTargets: new Map(), networkRespawnRequests: new Map() });
decoyHarness.world = null;
decoyHarness.hideMatchLoadingAfterFrame = true;
decoyHarness.clearMatch(); decoyHarness.clearMatch();
assert.equal(decoyHarness.hideMatchLoadingAfterFrame, false, "match teardown cancels stale first-frame loader completion");
decoyHarness.hideMatchLoadingAfterFrame = true;
decoyHarness.clearMatch(true);
assert.equal(decoyHarness.hideMatchLoadingAfterFrame, false, "preserving reconnect identity cannot preserve a previous arena's loader completion");
const menuSource = mainSource.slice(mainSource.indexOf("\n  renderMain("), mainSource.indexOf("\n  renderSetup("));
const menuMethod = new Function("ui", "TEXT", "menuAtmosphereMarkup", `return ({${menuSource}}).renderMain;`)({}, PLAYER_TEXT, () => "");
const frameSource = mainSource.slice(mainSource.indexOf("\n  frame(time) {"), mainSource.indexOf("\n  updateFrameInput() {"));
const menuMarks = [], loaderCalls = [];
const frameMethod = new Function("performance", `return ({${frameSource}}).frame;`)({ mark: name => menuMarks.push(name), measure: name => menuMarks.push(name) });
Object.assign(decoyHarness, { settings: {}, bindUi() {}, commitResize() {}, stopGameplayPreparation() {}, setJourney() {},
  timer: { update() {}, getDelta: () => 1 / 60 }, renderScene: () => true,
  loaderVisible: true, hideMatchLoadingAfterFrame: true,
  setMatchLoading(visible) { this.loaderVisible = visible; loaderCalls.push(visible); } });
Object.assign(decoyHarness.input, { tapped: () => false, endFrame() {} });
for (const name of ["resume", "setVolume", "setMix", "setPaused", "setMusicScene", "startMusic"]) decoyHarness.sound[name] = () => {};
menuMethod.call(decoyHarness);
frameMethod.call(decoyHarness, 100);
assert.equal(decoyHarness.loaderVisible, false, "returning to the menu dismisses the obsolete pending arena loader");
assert.deepEqual(loaderCalls, [false]);
assert.equal(menuMarks.length, 0, "a successful menu frame never completes the old arena timing");
loaderCalls.length = 0; decoyHarness.loaderVisible = true;
menuMethod.call(decoyHarness);
assert.equal(decoyHarness.loaderVisible, true, "initial menu creation preserves the separate fresh-session boot overlay");
assert.equal(loaderCalls.length, 0);
decoyHarness.hideMatchLoadingAfterFrame = true;
decoyHarness.clearMatch(true);
assert.equal(decoyHarness.loaderVisible, true, "network-preserving teardown does not hide the next match's newly shown loader");
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
assert.equal(projectileVisualUpdates, 0, "fixed-step projectile simulation leaves cosmetic batching to the once-per-render presentation pass");
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
    // Simulate renderer consumption; pending ranges otherwise survive skipped draws.
    layer.instanceMatrix.clearUpdateRanges();
    layer.instanceColor.clearUpdateRanges();
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
assert.ok(/const rendered = hidden \|\| this\.matchFramePending \|\|[\s\S]*?: this\.renderScene\(active \?[\s\S]*?if \(this\.hideMatchLoadingAfterFrame && rendered\)/.test(mainSource), "hidden or pending frames cannot submit; the loading screen stays until the selected pipeline submits its first frame");
assert.match(mainSource, /dataset\.drawCalls[\s\S]*?dataset\.geometries[\s\S]*?dataset\.longTasks[\s\S]*?dataset\.budget/, "live frame telemetry exposes draw, memory, long-task, and performance-budget health");
const projectileUpdateStart = mainSource.indexOf("\n  updateProjectiles(dt) {");
assert.doesNotMatch(mainSource.slice(projectileUpdateStart, mainSource.indexOf("\n  bounceProjectile(", projectileUpdateStart)), /\.filter\(|\.sort\(/, "projectile simulation avoids full-list allocation and sorting every frame");
assert.match(mainSource, /previousPosition\.copy\(shot\.mesh\.position\)/, "projectile substeps reuse a persistent collision position");
assert.match(playerSource, /this\.desiredMove\.copy\(move\)/, "fighters reuse movement vectors instead of allocating per frame");
assert.match(worldSource, /nearbyObstacles\([\s\S]*?obstacleGrid/, "arena collisions use the spatial broad phase");
assert.match(mainSource, /!child\.geometry\?\.userData\?\.sharedProjectile/, "shared projectile GPU buffers survive individual shot cleanup");
assert.match(pipelineSource, /aoPass\.samples\.value = this\.options\.aoSamples/, "ambient occlusion uses the validated sample setting");
assert.match(pipelineSource, /bloomPass\.setResolutionScale\(this\.options\.renderScale \* this\.options\.bloomScale\)/, "bloom scale composes with the scene render scale");
assert.ok([visuals.flashOuter, visuals.flashInner, visuals.tracerOuter, visuals.tracerInner, visuals.ringOuter, visuals.ringInner, visuals.sparkLayer]
  .every((layer) => layer.isInstancedMesh && layer.matrixAutoUpdate === false), "pooled GPU effect layers keep one static object transform and one instanced draw per family");

visuals.dispose();
world.dispose();
console.log("Output-equivalent high-graphics performance checks passed.");
