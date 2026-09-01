import assert from "node:assert/strict";
import { hitProposalLimit, lineBlockedByStructure, validateHitProposal, validateImpactProposal, weaponAuthorityStrategy } from "../src/combatAuthority.js";
import { WEAPONS } from "../src/gameData.js";

const player = (id, x, y = 0, z = 0) => ({ id, alive: true, health: 100, position: { x, y, z } });
const shot = (weaponId, direction = { x: 1, y: 0, z: 0 }, firedAt = 1_000) => ({
  id: "11111111-1111-4111-8111-111111111111", playerId: "attacker", weaponId, firedAt,
  origin: { x: 0, y: 1.2, z: 0 }, direction, damageScale: 1, hits: {}, hitPositions: []
});
const attacker = player("attacker", 0);
const target = player("target", 8);

for (const weapon of Object.values(WEAPONS)) {
  assert.ok(["ray", "projectile", "explosive", "melee", "cone", "chain"].includes(weaponAuthorityStrategy(weapon)), `${weapon.id} declares a server authority strategy`);
}
assert.equal(hitProposalLimit(WEAPONS.burst_rifle), WEAPONS.burst_rifle.burstCount, "one authoritative fire permits every round in a paid burst");
assert.equal(hitProposalLimit(WEAPONS.shotgun), WEAPONS.shotgun.pellets, "one authoritative fire permits every paid shotgun pellet");
assert.equal(hitProposalLimit(WEAPONS.needle_launcher), WEAPONS.needle_launcher.penetration + 1, "one authoritative fire permits the initial impact and paid penetration");

const aligned = validateHitProposal({ shot: shot("machine_gun"), attacker, target, weapon: WEAPONS.machine_gun, now: 1_050, seed: "AUTHORITY" });
assert.equal(aligned.damage, WEAPONS.machine_gun.damage, "an aligned unobstructed ray applies canonical damage");
assert.equal(validateHitProposal({ shot: shot("machine_gun", { x: -1, y: 0, z: 0 }), attacker, target, weapon: WEAPONS.machine_gun, now: 1_050, seed: "AUTHORITY" }), null, "an opposite-facing claim is rejected");
assert.equal(validateHitProposal({ shot: shot("machine_gun", { x: 0, y: 0, z: 1 }), attacker, target, weapon: WEAPONS.machine_gun, now: 1_050, seed: "AUTHORITY" }), null, "a ninety-degree claim is rejected");
assert.equal(validateHitProposal({ shot: shot("machine_gun", { x: 1, y: 0, z: 0 }, 0), attacker, target, weapon: WEAPONS.machine_gun, now: 9_000, seed: "AUTHORITY" }), null, "an expired ray claim is rejected");
assert.equal(validateHitProposal({
  shot: shot("temporary_wall"), attacker, target, weapon: WEAPONS.temporary_wall,
  impact: { x: 8, y: 1.05, z: 0 }, now: 1_100, seed: "AUTHORITY"
}), null, "a zero-damage utility projectile can never be forged into player damage");

const coverSeed = "AUTHORITY-COVER";
const coverStart = { x: 30, y: 2.1, z: -22 };
const coverEnd = { x: 50, y: 2.1, z: -22 };
assert.equal(lineBlockedByStructure(coverStart, coverEnd, coverSeed), true, "an intact structural pillar blocks combat sightlines");
const destroyedCover = new Map([["structure-1-pillar-1", 0]]);
assert.equal(lineBlockedByStructure(coverStart, coverEnd, coverSeed, destroyedCover), false, "authoritatively destroyed cover opens the same sightline");
const embeddedAttacker = player("embedded-attacker", 30, 0, -22);
const embeddedTarget = player("embedded-target", 42, 0, -22);
const embeddedShot = {
  ...shot("machine_gun", { x: 1, y: 0, z: 0 }), playerId: embeddedAttacker.id,
  origin: { x: 30, y: 1.2, z: -22 }
};
assert.equal(validateHitProposal({
  shot: embeddedShot, attacker: embeddedAttacker, target: player("behind-cover", 50, 0, -22),
  weapon: WEAPONS.machine_gun, now: 1_050, seed: coverSeed
}), null, "an ordinary target behind intact cover remains protected");
assert.equal(validateHitProposal({
  shot: embeddedShot, attacker: embeddedAttacker, target: { ...embeddedTarget, position: { x: 46.15, y: 0, z: -22 } },
  weapon: WEAPONS.machine_gun, now: 1_050, seed: coverSeed
}), null, "a target just inside the far face cannot turn endpoint containment into damage through an intact pillar");

const rocketShot = shot("rocket_launcher");
assert.equal(validateImpactProposal({ shot: rocketShot, weapon: WEAPONS.rocket_launcher, impact: { x: -20, y: 1.2, z: 0 }, now: 1_250 }), false, "reverse-direction terrain damage is rejected by the same authoritative path rule");
assert.equal(validateHitProposal({
  shot: rocketShot, attacker, target: player("behind", -20), weapon: WEAPONS.rocket_launcher,
  impact: { x: -20, y: 1.05, z: 0 }, now: 1_250, seed: "AUTHORITY"
}), null, "a client cannot forge a rocket impact behind its authoritative firing direction");
assert.equal(validateHitProposal({
  shot: rocketShot, attacker, target: player("far", 60), weapon: WEAPONS.rocket_launcher,
  impact: { x: 60, y: 1.05, z: 0 }, now: 1_010, seed: "AUTHORITY"
}), null, "an impossible early projectile impact is rejected");
const blastTarget = player("blast", 40);
const blast = validateHitProposal({
  shot: rocketShot, attacker, target: blastTarget, weapon: WEAPONS.rocket_launcher,
  impact: { x: 40, y: 1.05, z: 0 }, now: 1_450, seed: "AUTHORITY"
});
assert.equal(blast.damage, WEAPONS.rocket_launcher.damage, "a valid projectile impact uses canonical blast damage");
const selfBlast = validateHitProposal({
  shot: rocketShot, attacker, target: attacker, weapon: WEAPONS.rocket_launcher,
  impact: { x: 0, y: 1.05, z: 0 }, now: 1_050, seed: "AUTHORITY"
});
assert.equal(selfBlast.damage, Math.ceil(WEAPONS.rocket_launcher.damage * .35), "explosive self-damage is calculated by authority");

const previousExplosiveRadii = {
  bouncing_bomb: [4.8, 3.4], cluster_grenade: [2.8, 2.3], grenade_launcher: [5.1, 4.4],
  implosion_bomb: [7.2, 2], mine: [4.7, 3.8], mortar: [6.6, 6], napalm_launcher: [4.2, 2.5],
  remote_explosive: [6.2, 5.4], rocket_launcher: [5.8, 5.2], sticky_launcher: [5, 3.8]
};
for (const [weaponId, [playerRadius, terrainRadius]] of Object.entries(previousExplosiveRadii)) {
  assert.ok(WEAPONS[weaponId].radius >= playerRadius * 1.2, `${weaponId} has at least twenty percent more enemy splash reach`);
  assert.ok(WEAPONS[weaponId].terrainRadius >= terrainRadius * 1.2, `${weaponId} has at least twenty percent more structural splash reach`);
}
const nearMissBlast = validateHitProposal({
  shot: rocketShot, attacker, target: player("near-miss", 47), weapon: WEAPONS.rocket_launcher,
  impact: { x: 40, y: 1.05, z: 0 }, now: 1_450, seed: "AUTHORITY"
});
assert.ok(nearMissBlast?.damage > 0, "an enemy seven metres from a rocket impact receives authoritative splash damage");
assert.equal(validateHitProposal({
  shot: rocketShot, attacker, target: player("outside-blast", 47.93), weapon: WEAPONS.rocket_launcher,
  impact: { x: 40, y: 1.05, z: 0 }, now: 1_450, seed: "AUTHORITY"
}), null, "an enemy just beyond the canonical rocket radius and player hull receives no splash damage");

console.log("Server combat-authority geometry and canonical-damage checks passed.");
