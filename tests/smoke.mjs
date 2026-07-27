import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { chooseBotSlot, botFireChance } from "../src/botBrain.js";
import { DEFAULT_LOADOUT, LOADOUT_SLOTS, projectileStepCount, seededRandom, seedFromText, WEAPONS } from "../src/gameData.js";
import { InputManager, shouldCaptureGameKey, touchLookDelta, updateOrbit } from "../src/input.js";
import { aimWithSpread, applyGrapplePhysics, boostGrappleRelease, cameraRelative, directionFromTouch, Fighter, projectileTouchesPlayer } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";

const [mainSource, serviceWorkerSource] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8")
]);
assert.doesNotMatch(mainSource, /serviceWorker\.register/, "the game no longer installs the stale offline cache");
assert.match(serviceWorkerSource, /caches\.delete/, "the replacement worker clears old cached builds");
assert.match(serviceWorkerSource, /clients\.claim/, "the replacement worker takes control before refreshing old clients");
assert.match(serviceWorkerSource, /registration\.unregister/, "the replacement worker removes itself after cleanup");

assert.equal(Object.keys(WEAPONS).length, 8, "the prototype exposes all eight specified weapons");
assert.equal(LOADOUT_SLOTS.length, 5, "players carry five main weapons");
assert.equal(DEFAULT_LOADOUT.length, 5, "the default loadout is match-ready");
assert.deepEqual(
  Object.keys(WEAPONS).sort(),
  ["blaster", "grenade_launcher", "machine_gun", "mine", "plasma_cannon", "railgun", "rocket_launcher", "shotgun"],
  "weapon IDs match the specification"
);
assert.equal(WEAPONS.grenade_launcher.projectileSpeed, 13, "grenades keep their deliberate throwing arc");
assert.ok(WEAPONS.railgun.projectileSpeed >= WEAPONS.grenade_launcher.projectileSpeed * 30, "the railgun feels almost instant beside a grenade");
assert.ok(WEAPONS.machine_gun.projectileSpeed > WEAPONS.blaster.projectileSpeed, "rifle-class bullets outrun visible blaster bolts");
assert.ok(WEAPONS.blaster.projectileSpeed > WEAPONS.plasma_cannon.projectileSpeed, "heavy plasma remains slower than a standard bolt");
assert.ok(WEAPONS.plasma_cannon.projectileSpeed > WEAPONS.rocket_launcher.projectileSpeed, "rockets remain the slower guided explosive");
assert.ok(projectileStepCount(WEAPONS.railgun.projectileSpeed, 1 / 60, .11) > 1, "fast shots use swept stepping instead of tunnelling");

const randomA = seededRandom(seedFromText("BLAST-01"));
const randomB = seededRandom(seedFromText("BLAST-01"));
assert.deepEqual([randomA(), randomA(), randomA()], [randomB(), randomB(), randomB()], "map randomness is seed-reproducible");

assert.ok(shouldCaptureGameKey({ code: "KeyE", target: null }, true), "grapple input is captured in play");
assert.ok(shouldCaptureGameKey({ code: "Digit5", target: null }, true), "the fifth weapon slot is reachable");
assert.ok(!shouldCaptureGameKey({ code: "KeyR", ctrlKey: true, target: null }, true), "browser shortcuts are preserved");
assert.deepEqual(updateOrbit(0, 0, 100, -50), { yaw: -.22, pitch: .11 }, "mouse-right turns the third-person camera right without reversing vertical aim");
assert.equal(updateOrbit(0, .6, 0, -1000).pitch, .65, "vertical camera aim is clamped before it can flip");
assert.deepEqual(touchLookDelta(20, 30, 70, 5), { x: 50, y: -25 }, "dragging right and up produces rightward and upward touch look");
assert.ok(cameraRelative(directionFromTouch({ up: true }), 0).distanceTo(new THREE.Vector3(0, 0, 1)) < .001, "touch up moves forward with the camera");
assert.ok(cameraRelative(directionFromTouch({ down: true }), 0).distanceTo(new THREE.Vector3(0, 0, -1)) < .001, "touch down moves backward from the camera");
assert.ok(cameraRelative(directionFromTouch({ left: true }), 0).distanceTo(new THREE.Vector3(-1, 0, 0)) < .001, "touch left strafes left relative to the camera");
assert.ok(cameraRelative(directionFromTouch({ right: true }), 0).distanceTo(new THREE.Vector3(1, 0, 0)) < .001, "touch right strafes right relative to the camera");

const previousAddEventListener = globalThis.addEventListener;
const previousDocument = globalThis.document;
const windowListeners = {};
const canvasListeners = {};
globalThis.addEventListener = (type, listener) => { windowListeners[type] = listener; };
globalThis.document = { pointerLockElement: null, addEventListener() {} };
const touchInput = new InputManager({
  addEventListener(type, listener) { canvasListeners[type] = listener; },
  setPointerCapture() {}
});
canvasListeners.pointerdown({ pointerType: "touch", pointerId: 7, clientX: 20, clientY: 30, preventDefault() {} });
windowListeners.pointermove({ pointerType: "touch", pointerId: 7, clientX: 70, clientY: 5, preventDefault() {} });
assert.deepEqual(touchInput.consumeLook(), { x: 50, y: -25 }, "dragging the gameplay view feeds horizontal and vertical camera look");
assert.equal(touchInput.mouse.left, false, "touching the gameplay view does not fire the weapon");
windowListeners.pointerup({ pointerType: "touch", pointerId: 7 });
assert.equal(touchInput.touchLook, null, "lifting the look finger ends the drag");
if (previousAddEventListener) globalThis.addEventListener = previousAddEventListener;
else delete globalThis.addEventListener;
if (previousDocument) globalThis.document = previousDocument;
else delete globalThis.document;

assert.equal(chooseBotSlot(["shotgun", "railgun"], 5, () => 0), 0, "bot prefers shotgun up close");
assert.equal(chooseBotSlot(["shotgun", "railgun"], 30, () => 0), 1, "bot prefers railgun at range");
assert.ok(botFireChance(10, true, WEAPONS.blaster) > 0, "bot can fire visible projectiles");

const worldScene = new THREE.Scene();
const worldA = new ArenaWorld(worldScene, "SAME-SEED");
const obstacleLayoutA = worldA.obstacles.map(({ x, z, w, d }) => [x, z, w, d]);
worldA.dispose();
const worldB = new ArenaWorld(new THREE.Scene(), "SAME-SEED");
const obstacleLayoutB = worldB.obstacles.map(({ x, z, w, d }) => [x, z, w, d]);
assert.deepEqual(obstacleLayoutA, obstacleLayoutB, "seeded arenas generate the same collision layout");
assert.equal(worldB.spawnPoints().length, 4, "the arena provides fair spawn candidates");
const wallGrapple = worldB.grapplePoint(new THREE.Vector3(100, 10, 0), new THREE.Vector3(1, 0, 0));
assert.ok(wallGrapple && Math.abs(wallGrapple.x - 111.4) < .01 && wallGrapple.y === 10, "the grapple attaches exactly where aimed on a wall");
const blockGrapple = worldB.grapplePoint(new THREE.Vector3(12, 20, 0), new THREE.Vector3(-1, 0, 0));
assert.ok(blockGrapple && Math.abs(blockGrapple.x - 3.5) < .01 && blockGrapple.y === 20, "the grapple attaches to ordinary blocks, not only anchor spheres");
assert.equal(worldB.grapplePoint(new THREE.Vector3(90, 10, 90), new THREE.Vector3(0, 1, 0)), null, "a missed grapple does not snap to an unrelated anchor");
assert.ok(worldB.size >= 100, "the arena spans a large horizontal combat area");
assert.ok(worldB.height >= 70, "the arena spans a large vertical combat area");
assert.ok(Math.max(...worldB.platforms.map((platform) => platform.top)) >= 60, "combat platforms reach the upper arena");
assert.ok(Math.max(...worldB.anchors.map((anchor) => anchor.point.y)) >= 70, "grapple anchors use the full arena height");
assert.ok(worldB.spawnPoints().some((point) => point.y >= 30), "respawns include elevated combat levels");
const upperSpawn = worldB.spawnPoints().find((point) => point.y >= 30);
const fallingOntoUpperSpawn = upperSpawn.clone().setY(upperSpawn.y - .1);
assert.ok(worldB.resolve(fallingOntoUpperSpawn, .72, upperSpawn.clone().setY(upperSpawn.y + .2)).grounded, "players land on elevated platforms");

const fighter = new Fighter(
  worldScene,
  { id: "p1", name: "Rookie", color: 0x26d9ff, accent: 0xd9fbff },
  DEFAULT_LOADOUT,
  new THREE.Vector3()
);
fighter.switchSlot(4);
assert.equal(fighter.weapon.id, "railgun", "weapon switching selects the expected loadout slot");
fighter.recoil(2);
assert.ok(fighter.velocity.z < 0, "weapon recoil contributes to movement");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, 1.15, 0)), "projectiles collide with the fighter volume");
assert.ok(aimWithSpread(new THREE.Vector3(0, 0, 1), .02, () => .5).equals(new THREE.Vector3(0, 0, 1)), "centered spread preserves aim");
fighter.velocity.set(0, 0, 8);
fighter.grapple = { anchor: new THREE.Vector3(20, 20, 0), ropeLength: 24 };
const ropeBefore = fighter.grapple.ropeLength;
applyGrapplePhysics(fighter, .1);
assert.ok(fighter.velocity.x > 0 && fighter.velocity.y > 0, "the grapple actively pulls toward elevated anchors");
assert.ok(fighter.grapple.ropeLength < ropeBefore, "the grapple reels in while attached");
const speedBeforeRelease = fighter.velocity.length();
boostGrappleRelease(fighter);
assert.ok(fighter.velocity.length() > speedBeforeRelease, "releasing a fast swing adds a slingshot boost");

fighter.dispose();
worldB.dispose();
console.log("Blaster Battle smoke check passed.");
