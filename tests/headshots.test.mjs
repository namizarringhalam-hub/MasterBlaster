import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { GAME_CONFIG } from "../GAME_CONFIG.js";
import { WEAPONS } from "../src/gameData.js";
import { projectileTouchesPlayer } from "../src/player.js";
import * as headshots from "../src/headshots.js";
import { validateHitProposal } from "../src/combatAuthority.js";
import TEXT from "../src/playerText.js";

const target = { id: "target", alive: true, health: 100, radius: .72, position: new THREE.Vector3(8, 0, 0) };
const attacker = { id: "attacker", position: new THREE.Vector3() };
const headPoint = { x: 7.5, y: 2.08, z: 0 };
const bodyPoint = { x: 7.5, y: 1.2, z: 0 };
assert.equal(GAME_CONFIG.headshotDamageMultiplier, 2);
assert.equal(headshots.headContact(target, headPoint), true);
assert.equal(headshots.headContact(target, bodyPoint), false);
assert.equal(headshots.headContact(target, { x: 8, y: 1.89, z: 0 }), false, "neck overlap stays a body hit");
assert.equal(headshots.headContact(target, { x: 7, y: 2.08, z: 0 }), false, "a nearby blast is not a head hit");
assert.equal(headshots.headContact({ ...target, isDecoy: true }, headPoint), false);
assert.equal(projectileTouchesPlayer(target, new THREE.Vector3(7.2, 2.08, 0), .11), false, "wide torso capsule cannot intercept helmet shots prematurely");
assert.equal(projectileTouchesPlayer(target, new THREE.Vector3(7.4, 2.08, 0), .11), true);

// Execute the real controller's offline damage and feedback paths without a renderer.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", JSON.stringify(import.meta.url));
const bindings = { THREE, ...headshots, WEAPONS, TEXT };
const Game = new Function(...Object.keys(bindings), `return ${controller}`)(...Object.values(bindings));
const game = Object.create(Game.prototype);
let received, feedback;
Object.assign(game, { players: [attacker, target], isOnlineMatch: () => false, spawnImpact() {},
  showCombatFeedback(...args) { feedback = args[4]; } });
target.takeHit = (damage) => { received = damage; return false; };
for (const weapon of Object.values(WEAPONS).filter(weapon => weapon.damage > 0)) {
  game.damagePlayer(target, weapon.damage, new THREE.Vector3(), attacker, weapon, { point: headPoint });
  assert.equal(received, weapon.damage * 2, `${weapon.id}: shared offline head multiplier`);
  assert.equal(feedback, true);
  game.damagePlayer(target, weapon.damage, new THREE.Vector3(), attacker, weapon, { point: bodyPoint });
  assert.equal(received, weapon.damage, `${weapon.id}: unchanged body damage`);
  assert.equal(feedback, false);
}
game.damagePlayer(target, 4, new THREE.Vector3(), attacker, WEAPONS.napalm_launcher, { point: headPoint, phase: "hazard" });
assert.equal(received, 4, "lingering hazards never headshot");
assert.equal(feedback, false);

const proposal = (weapon, originY = 2.08, position = target, extra = {}) => validateHitProposal({
  shot: { playerId: attacker.id, weaponId: weapon.id, firedAt: 1000, origin: { x: 0, y: originY, z: 0 },
    direction: { x: 1, y: 0, z: 0 }, hitPositions: [], damageScale: 1 },
  attacker, target: position, weapon, impact: headPoint, now: 1200, seed: "AUTHORITY", ...extra,
});
for (const id of ["machine_gun", "laser_beam", "gravity_beam", "railgun", "blaster", "shotgun", "freeze_gun", "rocket_launcher", "plasma_cannon", "arc_lightning"]) {
  const result = proposal(WEAPONS[id]);
  assert.equal(result?.headshot, true, `${id}: server confirms helmet contact`);
  assert.equal(result.damage, WEAPONS[id].damage * 2, `${id}: server owns the multiplier`);
}
for (const id of ["knife", "hammer", "flamethrower"]) {
  assert.equal(proposal(WEAPONS[id], 2.08, { ...target, position: new THREE.Vector3(2, 0, 0) })?.headshot, true, `${id}: close head aim is valid`);
}
const forged = proposal(WEAPONS.machine_gun, 1.2, target, { headshot: true, damage: 99999, headshotDamageMultiplier: 999 });
assert.equal(forged.headshot, false, "ray headshots are reconstructed from the stored shot, not claimed impact/flags");
assert.equal(forged.damage, WEAPONS.machine_gun.damage);
const forgedProjectile = proposal(WEAPONS.blaster, 1.2);
assert.equal(forgedProjectile.headshot, false, "broad projectile validation cannot upgrade a body trajectory using a forged higher impact");
assert.equal(proposal(WEAPONS.napalm_launcher, 2.08, target, { phase: "hazard" }).headshot, undefined);
assert.equal(proposal(WEAPONS.rocket_launcher, 2.08, { ...target, position: new THREE.Vector3(9, 0, 0) }).headshot, false, "nearby splash is normal damage");

// The online controller waits for the server; its outgoing proposal carries no bonus.
let report;
game.isOnlineMatch = () => true;
game.controlsNetworkPlayer = () => true;
game.multiplayer = { reportHit(...args) { report = args; } };
received = null;
game.damagePlayer(target, 18, new THREE.Vector3(), attacker, WEAPONS.blaster, { point: headPoint });
assert.equal(received, null);
assert.equal(report[3], 18);

// Source-configured decimal multipliers preserve fractional damage.
const helperSource = readFileSync(new URL("../src/headshots.js", import.meta.url), "utf8");
for (const multiplier of [1, 1.2, 1.5, 2]) {
  const moduleSource = helperSource.replace('import { GAME_CONFIG } from "../GAME_CONFIG.js";', `const GAME_CONFIG = { headshotDamageMultiplier: ${multiplier} };`);
  const helper = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);
  assert.equal(helper.headshotDamage(7, true), 7 * multiplier);
  assert.equal(helper.headshotDamage(7, false), 7);
}
console.log("Headshots: every damaging weapon's offline multiplier, server geometry, forged claims, splash/hazards and decimal settings passed.");
