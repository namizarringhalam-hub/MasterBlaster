import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { hitProposalLimit, lineBlockedByStructure, validateHitProposal, validateImpactProposal, weaponAuthorityStrategy } from "../src/combatAuthority.js";
import { WEAPONS } from "../src/gameData.js";
import { headContact, projectileHitRadius } from "../src/headshots.js";
import { weaponPresentation } from "../src/weaponPresentation.js";

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
assert.equal(lineBlockedByStructure(coverStart, coverEnd, coverSeed, destroyedCover), true, "surviving upper pillars settle into the destroyed base's space");
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
  shot: rocketShot, attacker, target: player("outside-blast", 40 + WEAPONS.rocket_launcher.radius + .72 + .01), weapon: WEAPONS.rocket_launcher,
  impact: { x: 40, y: 1.05, z: 0 }, now: 1_450, seed: "AUTHORITY"
}), null, "an enemy just beyond the canonical rocket radius and player hull receives no splash damage");

// These are the shipped values before damage reach was matched to the animation.
const originalBlasts = {
  rocket_launcher: [7.2, 6.5, 56, 5.6, 20], grenade_launcher: [6.4, 5.8, 45, 2.2, 45 * .28],
  mine: [5.8, 5.2, 60, .5, 60 * .28], plasma_cannon: [3.6, 2.7, 38, 3.6, 38 * .18],
  cluster_grenade: [3.6, 3.2, 18, 2.2, 18 * .28], sticky_launcher: [6.2, 5.5, 54, 2.2, 54 * .28],
  remote_explosive: [7.8, 7, 68, 1.3, 68 * .3], mortar: [8.4, 8, 64, 4.2, 64 * .28],
  bouncing_bomb: [6, 5.2, 48, 2, 48 * .28], napalm_launcher: [5.4, 4, 28, 3.8, 28 * .36],
  drill_missile: [4.2, 5, 42, 3.8, 42 * .36], tornado_generator: [3.5, 0, 10, 2.5, 10 * .18]
};
const oldWeapon = (weapon, radius, terrainRadius) => {
  const original = { ...weapon, radius, terrainRadius };
  delete original.visualRadius;
  return original;
};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, message);
for (const [id, [radius, terrainRadius, damage, recoil, structureDamage]] of Object.entries(originalBlasts)) {
  const weapon = WEAPONS[id], original = oldWeapon(weapon, radius, terrainRadius);
  assert.equal(weapon.visualRadius, radius, `${id} retains its original visual radius`);
  assert.ok(weapon.radius > radius, `${id} reaches beyond its former damage sphere`);
  assert.deepEqual([weapon.damage, weapon.recoil, weapon.structureDamage], [damage, recoil, structureDamage], `${id} keeps damage and force amounts`);
  close(weapon.terrainRadius, terrainRadius * weapon.radius / radius, `${id} expands structural reach in the same proportion`);
  assert.deepEqual(weaponPresentation(weapon), weaponPresentation(original), `${id} retains visual and audio presentation`);

  // Put these comparisons above the arena so that only blast geometry is exercised.
  const impact = { x: 0, y: 101.05, z: 0 };
  const authorityShot = { ...shot(id), origin: impact };
  for (const fraction of [.18, .47, .81]) for (const self of [false, true]) {
    const proposal = current => {
      const target = player(self ? "attacker" : "fractional-target", .72 + current.radius * fraction, 100);
      return validateHitProposal({ shot: authorityShot, attacker: self ? target : attacker, target, weapon: current, impact, now: 1_250, seed: "AUTHORITY" });
    };
    const before = proposal(original), after = proposal(weapon);
    assert.ok(before && after, `${id} accepts proportional ${self ? "self" : "enemy"} splash`);
    assert.equal(after.damage, before.damage, `${id} retains damage at ${fraction} of its radius, self=${self}`);
    assert.equal(after.headshot, false, `${id} nearby splash stays a body hit`);
    for (const axis of ["x", "y", "z"]) close(after.push[axis], before.push[axis], `${id} retains proportional authoritative push`);
  }
  const helmetImpact = { x: 0, y: 102.08, z: 0 };
  const helmetTarget = player("helmet", .5, 100);
  const helmetProposal = current => validateHitProposal({
    shot: { ...authorityShot, origin: helmetImpact }, attacker, target: helmetTarget,
    weapon: current, impact: helmetImpact, now: 1_250, seed: "AUTHORITY"
  });
  assert.equal(helmetProposal(weapon)?.headshot, true, `${id} still recognizes direct helmet contact`);
  assert.equal(helmetProposal(weapon).damage, helmetProposal(original).damage, `${id} preserves direct head damage`);

  if (weapon.hazard) {
    for (const fraction of [.18, .47, .81, 1.01]) {
      const target = player("hazard-target", .72 + radius * fraction, 100);
      const hazardProposal = current => validateHitProposal({
        shot: authorityShot, attacker, target, weapon: current, impact, phase: "hazard", now: 1_250, seed: "AUTHORITY"
      });
      assert.deepEqual(hazardProposal(weapon), hazardProposal(original), `${id} lingering hazard reach and per-tick damage remain unchanged`);
    }
  }
}
for (const [id, radius, terrainRadius] of [
  ["implosion_bomb", 9, 6], ["gravity_grenade", 8, 1], ["black_hole_generator", 4, 2],
  ["pulse_cannon", 4.8, 1.5], ["grapple_disrupting_pulse", 6.5, 0]
]) {
  assert.deepEqual([WEAPONS[id].radius, WEAPONS[id].terrainRadius], [radius, terrainRadius], `${id} retains its field or pulse geometry`);
}

// Exercise the real controller, including decoys, cover, self damage and visuals.
const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const explodeSource = mainSource.slice(mainSource.indexOf("\n  explode(shot) {"), mainSource.indexOf("\n  damageTarget(", mainSource.indexOf("\n  explode(shot) {")));
const explode = new Function("THREE", "clamp", "headContact", "WEAPONS", `return ({${explodeSource}}).explode;`)(THREE, (v, min, max) => Math.min(max, Math.max(min, v)), headContact, WEAPONS);
const runExplosion = (weapon, impactHeight = 1.05) => {
  const position = new THREE.Vector3(40, impactHeight, 0);
  const fighter = (id, fraction, extras = {}) => ({ id, alive: true, position: new THREE.Vector3(40 + weapon.radius * fraction, 0, 0), ...extras });
  const owner = fighter("owner", .47);
  const decoy = fighter("decoy", .81, { isDecoy: true });
  const result = { hits: new Map(), impacts: [], scorches: [], terrain: [], hazards: [] };
  const context = {
    players: [owner, fighter("center", 0), fighter("near", .18), fighter("far", .81), fighter("outside", 1.01), fighter("blocked", .18, { position: new THREE.Vector3(40, 0, 1) }), fighter("dead", .18, { alive: false })],
    decoys: [decoy], world: { effectBlocked: (_from, to) => to.z === 1, surfaceHeightAt: () => 0 },
    damageTarget(target, damage, push, _owner, _weapon, feedback) { result.hits.set(target.id, { damage, push: push.length(), headshot: feedback.headshot }); },
    damageTerrain(...args) { result.terrain.push(args); }, spawnHazard(...args) { result.hazards.push(args); },
    combatVisuals: { impact(_point, _weapon, _owner, options) { result.impacts.push(options); }, explosions: { scorch(_point, size) { result.scorches.push(size); } } },
    sound: { playImpact() {} }, audioSpatial() {}
  };
  explode.call(context, { weapon, owner, mesh: { position }, radius: projectileHitRadius(weapon), velocity: new THREE.Vector3(1, 0, 0) });
  return result;
};
for (const [id, [radius, terrainRadius]] of Object.entries(originalBlasts)) {
  const weapon = WEAPONS[id], original = oldWeapon(weapon, radius, terrainRadius);
  const before = runExplosion(original), after = runExplosion(weapon);
  assert.deepEqual([...after.hits.keys()], ["owner", "center", "near", "far", "decoy"], `${id} applies expanded splash to players and decoys while respecting cover and life state`);
  for (const [targetId, hit] of after.hits) {
    assert.equal(hit.damage, before.hits.get(targetId).damage, `${id} retains controller damage for ${targetId} at the same radius fraction`);
    close(hit.push, before.hits.get(targetId).push, `${id} retains controller knockback magnitude for ${targetId}`);
    assert.equal(hit.headshot, false, `${id} controller splash stays a body hit`);
  }
  assert.deepEqual(after.impacts, before.impacts, `${id} keeps its actual explosion animation size`);
  assert.deepEqual(after.scorches, before.scorches, `${id} keeps its scorch size`);
  assert.equal(after.terrain.length, before.terrain.length, `${id} keeps the structural damage path`);
  assert.equal(after.hazards.length, before.hazards.length, `${id} keeps the lingering hazard spawn path`);
}
assert.deepEqual(runExplosion(WEAPONS.plasma_cannon, 3.8).scorches, [], "expanded player damage does not create new high-airburst scorch marks");

console.log("Server combat-authority geometry and canonical-damage checks passed.");
