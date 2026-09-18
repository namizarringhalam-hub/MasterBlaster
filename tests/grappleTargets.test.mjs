import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle"))
  .replaceAll("import.meta.url", JSON.stringify(new URL("../src/main.js", import.meta.url).href));
const Game = new Function(`return ${controller}`)();
const world = Object.create(ArenaWorld.prototype);
Object.assign(world, { group: new THREE.Group(), obstacles: [], anchors: [], boostPads: [], ground: null });
const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 8), new THREE.MeshBasicMaterial());
mesh.position.set(0, 10, 0);
world.group.add(mesh);
const platform = { mesh, x: 0, z: 0, w: 8, d: 8, h: 1, baseY: 9.5, top: 10.5 };
world.obstacles.push(platform);
const attach = (x = 0) => world.grappleTarget(new THREE.Vector3(x, 15, 0), new THREE.Vector3(0, -1, 0));
const target = attach();
assert.equal(target.item, platform);
assert.ok(target.point.distanceTo(new THREE.Vector3(0, 10.5, 0)) < 1e-6);
assert.ok(world.grapplePoint(new THREE.Vector3(0, 15, 0), new THREE.Vector3(0, -1, 0)).isVector3);
const player = { alive: true, position: new THREE.Vector3(0, 3, 0), radius: .55, grounded: false,
  grapple: { target, anchor: target.point } };
let collisions = 0, releases = 0;
world.resolve = () => { collisions++; };
const game = Object.assign(Object.create(Game.prototype), { world, releaseGrapple: (fighter, boost = false) => {
  assert.equal(boost, false, "a vanished target must not grant a release boost");
  releases++;
  fighter.grapple = null;
} });
mesh.position.add(new THREE.Vector3(2, 3, 0));
platform.x += 2; platform.top += 3; platform.baseY += 3;
game.syncGrappleTarget(player);
assert.deepEqual(player.position.toArray(), [2, 6, 0], "airborne grappler follows horizontal and vertical platform motion");
assert.deepEqual(player.grapple.anchor.toArray(), [2, 13.5, 0]);
assert.equal(collisions, 1, "carrying still resolves collisions");
game.syncGrappleTarget(player);
assert.equal(collisions, 1, "the same platform motion is never applied twice");
player.grounded = true;
player.position.set(4, 15.5, 0); // World.update has already carried this rider.
player.grapple.carriedDelta = new THREE.Vector3(2, 2, 0);
mesh.position.add(new THREE.Vector3(2, 2, 0));
platform.x += 2; platform.top += 2; platform.baseY += 2;
game.syncGrappleTarget(player);
assert.deepEqual(player.position.toArray(), [4, 15.5, 0], "standing on the grappled platform does not double its motion");
Object.assign(world, { time: 0, rotors: [], pulsers: [], temporaryWalls: [], portals: [], sweepers: [],
  movers: [{ obstacle: platform, axis: "x", baseX: 4, speed: 0, phase: Math.PI / 2, travel: 2 }],
  updateStructuralChanges() {}, updateStructuralDebris() {} });
world.update(.1, [player]);
game.syncGrappleTarget(player);
assert.deepEqual(player.position.toArray(), [6, 15.5, 0], "actual moving-platform rider transport is applied exactly once");
assert.equal(player.grapple.carriedDelta, null);
platform.removed = true;
game.syncGrappleTarget(player);
assert.equal(player.grapple, null, "a removed wall or floor releases on the next synchronization");
assert.equal(releases, 1);

// Structural decks share one mesh: attachment and removal must identify the instance.
world.group.remove(mesh);
const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, 2);
world.group.add(batch);
world.obstacles = [0, 1].map((index) => ({ mesh: batch, instanceVisuals: [{ mesh: batch, index }] }));
batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 10, 0));
batch.setMatrixAt(1, new THREE.Matrix4().makeTranslation(12, 10, 0));
const deckTarget = attach(12);
assert.equal(deckTarget.item, world.obstacles[1]);
batch.setMatrixAt(1, new THREE.Matrix4().makeTranslation(12, 7, 0));
assert.equal(world.resolveGrappleTarget(deckTarget, deckTarget.point), true);
assert.ok(Math.abs(deckTarget.point.y - 7.5) < 1e-6, "the hit point follows its individual falling deck");
world.obstacles.shift();
assert.equal(world.resolveGrappleTarget(deckTarget, deckTarget.point), true, "removing a different deck preserves the grapple");
world.obstacles.splice(0, 1);
assert.equal(world.resolveGrappleTarget(deckTarget, deckTarget.point), false, "detaching collision releases even while the shared mesh remains");
assert.equal(attach(12), null, "detached instances cannot accept new grapples");

world.group.remove(batch);
world.ground = mesh;
world.group.add(mesh);
const floorTarget = world.grappleTarget(new THREE.Vector3(6, 20, 0), new THREE.Vector3(0, -1, 0));
assert.ok(floorTarget);
assert.equal(world.resolveGrappleTarget(floorTarget, floorTarget.point), true, "permanent ground remains attachable");
world.ground = null;
assert.equal(world.resolveGrappleTarget(floorTarget, floorTarget.point), false);
mesh.geometry.dispose(); mesh.material.dispose(); batch.dispose();
console.log("Grapple moving targets, rider carry, instance identity and disappearing surfaces passed.");
