import assert from "node:assert/strict";
import { WEAPONS } from "../src/gameData.js";
import { botRemoteChargeAction, botWeaponPolicy, botFireChance, shouldBotPlaceWall } from "../src/botBrain.js";
import { chooseBotTargets } from "../src/botPlanner.worker.js";

assert.equal(Object.keys(WEAPONS).length, 47);
for (const weapon of Object.values(WEAPONS)) {
  const policy = botWeaponPolicy(weapon);
  assert.ok(Number.isFinite(policy.min) && Number.isFinite(policy.preferred) && Number.isFinite(policy.max));
  assert.ok(policy.min <= policy.preferred && policy.preferred <= policy.max);
  assert.ok(policy.intent);
}

const decoy = WEAPONS.decoy_launcher;
assert.equal(botWeaponPolicy(decoy).intent, "decoy", "distraction metadata uses the decoy policy");
assert.ok(botFireChance(decoy.preferredRange, true, decoy) > 0);
assert.equal(botFireChance(decoy.preferredRange, false, decoy), 0);

const wall = WEAPONS.temporary_wall;
assert.equal(shouldBotPlaceWall(wall, { distance: wall.preferredRange, visible: true, ammo: 1 }), true);
assert.equal(shouldBotPlaceWall(wall, { distance: 35, visible: true, healthFraction: .4, ammo: 1 }), true);
assert.equal(shouldBotPlaceWall(wall, { distance: wall.preferredRange, visible: false, ammo: 1 }), false);
assert.equal(shouldBotPlaceWall(wall, { distance: wall.preferredRange, visible: true, wallNearby: true, ammo: 1 }), false);

const remote = WEAPONS.remote_explosive;
assert.equal(botRemoteChargeAction(remote, { targetDistance: 20, armedChargeDistances: [4], ammo: 0 }), "detonate");
assert.equal(botRemoteChargeAction(remote, { targetDistance: remote.preferredRange, visible: true, ammo: 2 }), "place");
assert.equal(botRemoteChargeAction(remote, { targetDistance: remote.preferredRange, visible: true, armedChargeDistances: [30, 35, 40], ammo: 2 }), "hold");
assert.equal(botRemoteChargeAction(remote, { targetDistance: remote.preferredRange, visible: false, ammo: 2 }), "hold");
assert.equal(botRemoteChargeAction(WEAPONS.blaster, { targetDistance: 10, visible: true, ammo: 2 }), "hold");

const plannedTargets = chooseBotTargets(
  [
    { id: "human", alive: true, position: [0, 0, 0] },
    { id: "bot-a", alive: true, position: [12, 0, 0] },
    { id: "bot-b", alive: true, position: [80, 0, 0] }
  ],
  [{ id: "decoy", alive: true, ownerId: "human", position: [13, 0, 0] }]
);
assert.deepEqual(plannedTargets, [["bot-a", "decoy"], ["bot-b", "decoy"]], "the worker preserves decoy priority and nearest-target fallback off the render thread");

console.log("Bot weapon policy checks passed.");
