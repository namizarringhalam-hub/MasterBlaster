import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";
import { Fighter } from "../src/player.js";
import { WEAPONS } from "../src/gameData.js";

const scene = new THREE.Scene(), world = new ArenaWorld(scene, "BLAST-01");
const fighter = new Fighter(scene, { id: "portal-bot", color: 0x43ffd1, accent: 0xffffff }, ["blaster"], new THREE.Vector3(), true);
const still = new THREE.Vector3(), look = new THREE.Vector3(0, 0, 1);
for (const portal of world.portals) {
  fighter.respawn(portal.position);
  let transits = 0;
  const arrive = (player, departure) => {
    assert.equal(player, fighter);
    assert.ok(departure.distanceTo(portal.position) < .01);
    transits++;
  };
  world.update(1 / 60, [fighter], arrive);
  assert.equal(transits, 1);
  assert.equal(fighter.group.userData.interpolationReset, true);
  assert.equal(fighter.portalArrival, portal.pair);
  for (let step = 0; step < 1200; step++) {
    world.update(1 / 60, [fighter], () => transits++);
    fighter.update(1 / 60, still, look, { reducedMotion: true }, world);
  }
  assert.equal(transits, 1, "an idle living bot never bounces back after its arrival cooldown expires");
  assert.ok(fighter.position.distanceTo(portal.pair.position) < 1.4);
  fighter.position.copy(portal.pair.position).add(new THREE.Vector3(4, 0, 0));
  world.update(1 / 60, [fighter]);
  assert.equal(fighter.portalArrival, null, "leaving the arrival trigger rearms it");
  fighter.position.copy(portal.pair.position);
  world.update(1 / 60, [fighter], () => transits++);
  assert.equal(transits, 2, "intentional re-entry still returns through the portal");
  fighter.respawn(portal.pair.position);
  assert.equal(fighter.portalArrival, null);
  assert.equal(fighter.portalCooldown, 0);
  world.update(1 / 60, [fighter], () => transits++);
  assert.equal(transits, 3, "a new life cannot inherit the old arrival latch");
}

for (const upwardSpeed of [7.5, 15, 30]) {
  fighter.respawn(world.portals[0].position);
  fighter.velocity.y = upwardSpeed;
  fighter.grounded = false;
  let transits = 0;
  for (let step = 0; step < 600; step++) {
    world.update(1 / 60, [fighter], () => transits++);
    fighter.update(1 / 60, still, look, { jump: fighter.grounded, reducedMotion: true }, world);
  }
  assert.equal(transits, 1, `vertical jumps/knockback at ${upwardSpeed}m/s cannot rearm the arrival portal`);
}

for (const flag of ["networkRemote", "trainingStandStill"]) {
  fighter.respawn(world.portals[0].position);
  fighter[flag] = true;
  world.update(2, [fighter], () => assert.fail(`${flag} must not perform local portal transit`));
  assert.ok(fighter.position.equals(world.portals[0].position));
  fighter[flag] = false;
}

// Exercise the actual controller callback, including grapple disposal and cues.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle"));
const Game = new Function("THREE", "WEAPONS", `return ${controller.replaceAll("import.meta.url", JSON.stringify(new URL("../src/main.js", import.meta.url).href))}`)(THREE, WEAPONS);
const game = Object.assign(Object.create(Game.prototype), {
  world, players: [fighter], matchTime: 600, matchStartDelay: 0, targetScore: 10000, scores: [0],
  state: "play", settings: {}, simulationBatch: true, isOnlineMatch: () => false,
  sound: { play: (...args) => cues.push(args) }, audioSpatial: () => ({}), spawnBurst: point => bursts.push(point.clone()),
  removeObject: line => removed.push(line), soundEvents: [],
});
const cues = [], bursts = [], removed = [];
game.sound.updateGrappleLoop = () => {};
for (const name of ["syncGrappleTarget", "handleWeaponSwitch", "updateHuman", "updateBotPlanner", "updateBurst", "updateProjectiles", "updateHazards", "updateDecoys", "processStructuralEvents", "updateEffects", "updateRespawns"]) game[name] = () => {};
fighter.respawn(world.portals[0].position);
const line = {};
fighter.grapple = { line };
game.update(1 / 60);
assert.equal(fighter.grapple, null, "portal transit releases the old grapple before its physics can pull the fighter back");
assert.deepEqual(removed, [line], "portal transit disposes the rope through the normal controller path");
assert.equal(cues.length, 1);
assert.equal(cues[0][0], "teleport");
assert.equal(bursts.length, 2, "departure and arrival both visibly explain intentional portal transit");
fighter.dispose(); world.dispose();
console.log("Portal arrival latch, re-entry, respawn, remote ownership, training lock, grapple release and transit cues passed.");
