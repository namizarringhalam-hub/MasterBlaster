import assert from "node:assert/strict";
import * as THREE from "three";
import { chooseBotSlot, botFireChance } from "../src/botBrain.js";
import { DEFAULT_LOADOUT, LOADOUT_SLOTS, seededRandom, seedFromText, WEAPONS } from "../src/gameData.js";
import { shouldCaptureGameKey } from "../src/input.js";
import { aimWithSpread, Fighter, projectileTouchesPlayer } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";

assert.equal(Object.keys(WEAPONS).length, 8, "the prototype exposes all eight specified weapons");
assert.equal(LOADOUT_SLOTS.length, 5, "players carry five main weapons");
assert.equal(DEFAULT_LOADOUT.length, 5, "the default loadout is match-ready");
assert.deepEqual(
  Object.keys(WEAPONS).sort(),
  ["blaster", "grenade_launcher", "machine_gun", "mine", "plasma_cannon", "railgun", "rocket_launcher", "shotgun"],
  "weapon IDs match the specification"
);

const randomA = seededRandom(seedFromText("BLAST-01"));
const randomB = seededRandom(seedFromText("BLAST-01"));
assert.deepEqual([randomA(), randomA(), randomA()], [randomB(), randomB(), randomB()], "map randomness is seed-reproducible");

assert.ok(shouldCaptureGameKey({ code: "KeyE", target: null }, true), "grapple input is captured in play");
assert.ok(shouldCaptureGameKey({ code: "Digit5", target: null }, true), "the fifth weapon slot is reachable");
assert.ok(!shouldCaptureGameKey({ code: "KeyR", ctrlKey: true, target: null }, true), "browser shortcuts are preserved");
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

fighter.dispose();
worldB.dispose();
console.log("Blaster Battle smoke check passed.");
