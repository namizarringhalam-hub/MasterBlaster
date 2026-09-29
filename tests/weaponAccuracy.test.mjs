import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import * as data from "../src/gameData.js";
import * as playerHelpers from "../src/player.js";
import { combatShotOrigin, headContact } from "../src/headshots.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", JSON.stringify(import.meta.url));
const bindings = { THREE, ...data, ...playerHelpers, clamp: THREE.MathUtils.clamp };
const Game = new Function(...Object.keys(bindings), `return ${controller}`)(...Object.values(bindings));
const player = {
  id: "human", alive: true, position: new THREE.Vector3(), aim: new THREE.Vector3(0, 0, 1),
  group: new THREE.Group(), ammo: {}, attackTimer: 0, reloadTimer: 0, recoil() {},
  muzzlePoint: playerHelpers.Fighter.prototype.muzzlePoint,
  forwardPoint: playerHelpers.Fighter.prototype.forwardPoint,
};
const world = { grapplePoint: () => null, grappleTarget: () => null };
const game = Object.assign(Object.create(Game.prototype), {
  players: [player], decoys: [], world, projectiles: [], combatMusicPulse: 0,
  controlsNetworkPlayer: () => false, audioSpatial: () => ({}),
  sound: { playWeapon() {}, stopChargeLoop() {} },
});

// Exercise the actual first/repeated, burst, charged, beam and pellet dispatch.
for (const weapon of Object.values(data.WEAPONS)) {
  const mode = data.weaponFireMode(weapon);
  if (["mine", "chain", "flame", "melee"].includes(mode)) continue;
  player.weapon = weapon;
  player.aim.set(.1, .04, 1).normalize();
  const shots = [];
  game.spawnProjectile = (_player, _weapon, direction) => shots.push(direction.clone());
  game.fireHitscan = (_player, _weapon, direction) => shots.push(direction.clone());
  game.spawnTracer = (start, end) => shots.push(end.clone().sub(start).normalize());
  game.damageTerrain = () => 0;
  for (let round = 0; round < 8; round++) {
    player.attackTimer = 0;
    player.ammo[weapon.id] = weapon.ammo;
    if (weapon.chargeTime) {
      player.chargingWeaponId = weapon.id;
      player.chargeTimer = weapon.chargeTime;
      game.releaseCharge(player);
    } else {
      game.tryFire(player);
      if (mode === "burst") game.updateBurst(player, weapon.cooldown);
    }
  }
  assert.ok(shots.length >= 8, `${weapon.id}: shots were actually fired`);
  for (const direction of shots) assert.ok(direction.distanceTo(player.aim) < 1e-12, `${weapon.id}: no random firing error`);
}
delete game.fireHitscan;

// Camera rays must converge from each weapon's real firing origin and match
// the multiplayer origin, including after movement, at multiple view angles.
for (const weapon of Object.values(data.WEAPONS).filter(w => !["mine", "melee"].includes(w.type))) {
  player.weapon = weapon;
  for (const range of [4, 18, 90]) for (const yaw of [0, .8, -2.2]) {
    const target = { id: "target", alive: true, radius: .72,
      position: new THREE.Vector3(Math.sin(yaw) * range, 0, Math.cos(yaw) * range) };
    const head = target.position.clone().add(new THREE.Vector3(0, 2.08, 0));
    const camera = new THREE.Vector3(1.05, 4.45, -8.25);
    const direction = head.clone().sub(camera).normalize();
    const point = new THREE.Ray(camera, direction).intersectSphere(new THREE.Sphere(head, .72 * .72), new THREE.Vector3());
    for (const movement of [new THREE.Vector3(), new THREE.Vector3(.2, .1, -.15)]) {
      player.position.copy(movement);
      player.aim.copy(playerHelpers.reticleAim(player, camera, direction, world, [player, target]));
      const origin = weapon.hitscan || weapon.type === "flame" ? player.muzzlePoint() : player.forwardPoint(.08);
      assert.ok(new THREE.Ray(origin, player.aim).distanceToPoint(point) < 1e-5, `${weapon.id}: crosshair/muzzle alignment at ${range}m`);
      const serverOrigin = new THREE.Vector3().copy(combatShotOrigin(player, weapon, player.aim));
      assert.ok(new THREE.Ray(serverOrigin, player.aim).distanceToPoint(point) < 1e-5, `${weapon.id}: multiplayer agrees`);
      if (weapon.hitscan || weapon.type === "beam") {
        game.players = [player, target];
        let impact, tracerEnd;
        game.damageTarget = (_target, _damage, _push, _owner, _weapon, context) => { impact = context.point; };
        game.spawnTracer = (_start, end) => { tracerEnd = end; };
        if (weapon.hitscan) game.fireHitscan(player, weapon, player.aim);
        else game.fireBeam(player, weapon);
        assert.ok(headContact(target, impact), `${weapon.id}: real firing path hits the head`);
        if (!weapon.penetration) assert.ok(tracerEnd.distanceTo(impact) < 1e-9, `${weapon.id}: visible beam stops at the hit`);
      }
    }
  }
}
console.log("Weapon accuracy: exact first/repeated shots, pellets, burst/charge, camera/muzzle convergence, headshots and multiplayer origins passed.");
