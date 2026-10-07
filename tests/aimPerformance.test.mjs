import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";
import { reticleAim } from "../src/player.js";

// Frozen implementation: compare actual rendered triangles, normal transforms,
// instance ownership and unrestricted range rather than approximate colliders.
function legacyGrappleTarget(origin, direction) {
  if (!direction.lengthSq()) return null;
  this.group.updateMatrixWorld(true);
  const surfaces = [...new Set([
    this.ground,
    ...this.obstacles.map(item => item.mesh),
    ...this.anchors.map(anchor => anchor.mesh),
    ...this.boostPads.filter(pad => pad.active).map(pad => pad.mesh)
  ].filter(Boolean))];
  const ray = new THREE.Raycaster(origin, direction.clone().normalize(), .05);
  for (const hit of ray.intersectObjects(surfaces, false)) {
    const matches = item => item.mesh === hit.object &&
      (hit.instanceId === undefined || item.instanceVisuals?.some(visual => visual.mesh === hit.object && visual.index === hit.instanceId));
    const collection = [this.obstacles, this.anchors, this.boostPads].find(items => items.some(matches));
    const item = collection?.find(matches);
    if (!item && hit.object !== this.ground) continue;
    const matrix = hit.object.matrixWorld.clone();
    if (hit.instanceId !== undefined) {
      const instance = new THREE.Matrix4();
      hit.object.getMatrixAt(hit.instanceId, instance);
      matrix.multiply(instance);
    }
    const localNormal = hit.face.normal.clone();
    const normal = localNormal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
    return { point: hit.point.clone(), normal, localNormal, mesh: hit.object, instanceId: hit.instanceId, item, collection,
      localPoint: hit.point.clone().applyMatrix4(matrix.invert()) };
  }
  return null;
}

function compareHit(world, origin, direction) {
  const actual = world.grappleTarget(origin, direction);
  const expected = legacyGrappleTarget.call(world, origin, direction);
  assert.equal(Boolean(actual), Boolean(expected));
  if (!actual) return false;
  for (const key of ["point", "normal", "localNormal", "localPoint"]) {
    assert.deepEqual(actual[key].toArray(), expected[key].toArray(), `${key} keeps exact triangle coordinates`);
  }
  for (const key of ["mesh", "instanceId", "item", "collection"]) assert.equal(actual[key], expected[key], `${key} keeps hit ownership`);
  return true;
}

function downwardHit(world, position) {
  return compareHit(world, position.clone().add(new THREE.Vector3(0, 16, 0)), new THREE.Vector3(0, -1, 0));
}

const scene = new THREE.Scene();
const world = new ArenaWorld(scene, "SMOOTH-AIM-01");
const rays = Array.from({ length: 180 }, (_, index) => {
  const origin = new THREE.Vector3((index * 37 % 211) - 105, (index * 13 % 72) + 2, (index * 71 % 211) - 105);
  const destination = new THREE.Vector3((index * 67 % 211) - 105, (index * 31 % 75) + .12, (index * 43 % 211) - 105);
  return [origin, destination.sub(origin).normalize()];
});
rays.push([new THREE.Vector3(-300, 10, 0), new THREE.Vector3(1, 0, 0)],
  [new THREE.Vector3(90, 10, 90), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(), new THREE.Vector3()]);
let hits = 0;
for (const [origin, direction] of rays) hits += Number(compareHit(world, origin, direction));
assert.ok(hits > 70, "the comparison must exercise real rendered surfaces");

const topology = world.getGrappleTopology(), raycaster = world.grappleRaycaster, hitArray = world.grappleRayHits;
world.grappleTarget(...rays[0]);
assert.equal(world.getGrappleTopology(), topology, "unchanged topology and ownership maps are retained");
assert.equal(world.grappleRaycaster, raycaster, "raycast scratch storage is retained");
assert.equal(world.grappleRayHits, hitArray, "the intersection output array is reused");
const ownedHit = world.grappleTarget(new THREE.Vector3(-300, 10, 0), new THREE.Vector3(1, 0, 0));
const retained = ["point", "normal", "localNormal", "localPoint"].map(key => ownedHit[key].toArray());
for (const [origin, direction] of rays) world.grappleTarget(origin, direction);
assert.deepEqual(["point", "normal", "localNormal", "localPoint"].map(key => ownedHit[key].toArray()), retained,
  "later queries cannot mutate grapple endpoints retained by fighters");

const allocations = { Raycaster: 0, Matrix4: 0, Matrix3: 0 }, countedThree = { ...THREE };
for (const name of Object.keys(allocations)) countedThree[name] = class extends THREE[name] {
  constructor(...args) { super(...args); allocations[name]++; }
};
const countedMethod = method => new Function("THREE", `return (${method.toString().startsWith("function") ? method.toString() : `function ${method.toString()}`});`)(countedThree);
const countedLegacy = countedMethod(legacyGrappleTarget), countedCurrent = countedMethod(ArenaWorld.prototype.grappleTarget);
for (const [origin, direction] of rays) countedLegacy.call(world, origin, direction);
const legacyAllocations = { ...allocations };
for (const key of Object.keys(allocations)) allocations[key] = 0;
for (const [origin, direction] of rays) countedCurrent.call(world, origin, direction);
assert.ok(legacyAllocations.Raycaster > 100 && legacyAllocations.Matrix3 > 70);
assert.deepEqual(allocations, { Raycaster: 0, Matrix4: 0, Matrix3: 0 }, "warm queries reuse all explicitly constructed ray/matrix scratch objects");

let decorationUpdates = 0;
const decoration = new THREE.Object3D();
decoration.updateMatrixWorld = () => { decorationUpdates++; };
decoration.updateWorldMatrix = () => { decorationUpdates++; };
world.group.add(decoration);
legacyGrappleTarget.call(world, ...rays[0]);
assert.ok(decorationUpdates > 0, "the reference traverses decorative children");
decorationUpdates = 0;
world.grappleTarget(...rays[0]);
assert.equal(decorationUpdates, 0, "target queries avoid unrelated decorative transform traversal");
world.group.remove(decoration);

// Optimized queries run first so the legacy traversal cannot hide stale matrices.
scene.position.set(3, 2, -4); scene.rotation.y = .13; scene.scale.set(1.1, .9, 1.2);
for (const [origin, direction] of rays.slice(0, 20)) compareHit(world, origin, direction);
scene.position.set(0, 0, 0); scene.rotation.y = 0; scene.scale.set(1, 1, 1);
world.update(.3, []);
for (const mover of world.movers) downwardHit(world, new THREE.Vector3(mover.obstacle.x, mover.obstacle.top, mover.obstacle.z));
const part = world.structuralParts.find(part => part.structuralKind === "platform");
const oldTopology = world.getGrappleTopology();
part.visualOffset = new THREE.Vector3(.2, -1.5, .1);
world.updateStructuralVisual(part);
downwardHit(world, new THREE.Vector3(part.x, part.top, part.z));
assert.equal(world.getGrappleTopology(), oldTopology, "instance motion changes transforms without rebuilding topology");
part.visualOffset = null; world.updateStructuralVisual(part);
const pad = world.boostPads[0];
pad.mesh.position.y += 2; pad.mesh.updateMatrix();
downwardHit(world, pad.mesh.position);
pad.active = false;
downwardHit(world, pad.mesh.position);
pad.active = true;
downwardHit(world, pad.mesh.position);

const wall = world.addTemporaryWall(new THREE.Vector3(95, 1, 95), new THREE.Vector3(1, 0, 0), 0x22eeff, .1);
downwardHit(world, new THREE.Vector3(wall.x, wall.top, wall.z));
assert.notEqual(world.getGrappleTopology(), oldTopology, "adding a wall rebuilds topology");
world.update(.2, []);
downwardHit(world, new THREE.Vector3(wall.x, wall.top, wall.z));
assert.ok(!world.getGrappleTopology().owners.has(wall.mesh), "expired walls cannot retain disposed geometry in the cache");
const victim = world.destructibles[0];
world.destroy(new THREE.Vector3(victim.x, victim.baseY + victim.h / 2, victim.z), .01);
assert.ok(victim.removed);
downwardHit(world, new THREE.Vector3(victim.x, victim.top, victim.z));
assert.ok(!world.getGrappleTopology().owners.has(victim.mesh), "destroyed bodies leave hit ownership");
world.removeStructuralPart(part);
downwardHit(world, new THREE.Vector3(part.x, part.top, part.z));
const entries = world.getGrappleTopology().owners.get(part.mesh);
for (const owner of entries?.values() || []) assert.notEqual(owner.item, part, "removed instances cannot accept new grapples");

const fixture = Object.assign(Object.create(ArenaWorld.prototype), {
  group: new THREE.Group(), obstacles: [], anchors: [], boostPads: [], ground: null
});
const parent = new THREE.Group(), nested = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
parent.add(nested); fixture.group.add(parent);
fixture.obstacles.push({ mesh: nested });
parent.position.set(0, 5, 0); parent.rotation.y = .2; parent.scale.set(1.3, .8, 1.1);
parent.updateMatrix(); parent.matrixAutoUpdate = false;
assert.ok(compareHit(fixture, new THREE.Vector3(0, 12, 0), new THREE.Vector3(0, -1, 0)), "nested surface ancestors stay current");
parent.position.y = 7; parent.updateMatrix();
assert.ok(compareHit(fixture, new THREE.Vector3(0, 12, 0), new THREE.Vector3(0, -1, 0)), "frozen changed ancestors are refreshed before querying");
nested.geometry.dispose(); nested.material.dispose();

// Reusing only the world hit preserves target intersections and muzzle parallax.
const cameraOrigin = new THREE.Vector3(0, 3, -8), cameraDirection = new THREE.Vector3(0, -.05, 1).normalize();
const fighter = { alive: true, position: new THREE.Vector3(), weapon: { hitscan: true } };
const targets = [fighter, { alive: true, position: new THREE.Vector3(0, 0, 8), radius: .72 }];
for (const surface of [null, new THREE.Vector3(0, 1.2, 12)]) {
  let queryCount = 0;
  const aimWorld = { grapplePoint: () => { queryCount++; return surface; } };
  const cachedSurface = aimWorld.grapplePoint(cameraOrigin, cameraDirection);
  const originalSurface = surface?.toArray();
  for (const x of [0, .15]) {
    fighter.position.x = x;
    const expected = reticleAim(fighter, cameraOrigin, cameraDirection, aimWorld, targets);
    const before = queryCount;
    const actual = reticleAim(fighter, cameraOrigin, cameraDirection, aimWorld, targets, cachedSurface);
    assert.deepEqual(actual.toArray(), expected.toArray());
    assert.equal(queryCount, before, "cached hits and misses avoid the second world query");
  }
  assert.deepEqual(surface?.toArray(), originalSurface, "aim convergence cannot mutate a retained world hit");
}

if (process.argv.includes("--bench")) {
  const batches = [];
  for (let batch = 0; batch < 6; batch++) {
    const pair = batch % 2 ? [["current", world.grappleTarget], ["legacy", legacyGrappleTarget]]
      : [["legacy", legacyGrappleTarget], ["current", world.grappleTarget]];
    const result = {};
    for (const [name, method] of pair) {
      const start = performance.now();
      for (const [origin, direction] of rays) method.call(world, origin, direction);
      result[name] = Number((performance.now() - start).toFixed(2));
    }
    batches.push(result);
  }
  console.log(JSON.stringify({ rays: rays.length, hits, timingsMs: batches }));
}
world.dispose();
assert.equal(world.grappleTopology, null);
assert.equal(world.grappleRayHits, null);
assert.equal(world.grappleTarget(...rays[0]), null, "disposed arenas cannot accept stale hits");
console.log("Exact aiming hits, topology lifecycle, scratch reuse and cached parallax passed.");
