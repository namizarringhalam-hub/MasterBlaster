import assert from "node:assert/strict";
import * as THREE from "three";
import { chooseBotSlot, botFireChance } from "../src/botBrain.js";
import { DEFAULT_LOADOUT, LOADOUT_SLOTS, projectileStepCount, seededRandom, seedFromText, WEAPONS } from "../src/gameData.js";
import { shouldCaptureGameKey, updateOrbit } from "../src/input.js";
import { aimWithSpread, applyGrapplePhysics, boostGrappleRelease, Fighter, projectileTouchesPlayer } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";

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
assert.ok(worldB.grapplePoint(new THREE.Vector3(), new THREE.Vector3(1, 0, 0)), "the arena always offers a grapple point");
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
