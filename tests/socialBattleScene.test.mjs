import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { battleControls, stageSocialBattle } from "./socialBattleScene.js";
import { WEAPONS } from "../src/gameData.js";
import { readFileSync } from "node:fs";

// Execute the fixture's actual setup routing: normal/legacy views keep their ordinary blend.
const harness = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
const settleCode = harness.match(/const settlePlayerCamera = [^;]+;\s*game\.updateCamera\(settlePlayerCamera \? 1 : undefined\);/)[0];
const settle = new Function("recordVideo", "videoParams", "game", settleCode);
for (const [recording, query, expected] of [[true, "videoScene=battle&videoView=player", 1],
  [false, "videoScene=battle&videoView=player", undefined], [true, "videoScene=battle&videoView=outside", undefined],
  [true, "videoScene=grapple&videoView=player", undefined]]) {
  let actual; settle(recording, new URLSearchParams(query), { updateCamera: dt => { actual = dt; } });
  assert.equal(actual, expected);
}

assert.equal(battleControls(.8, true).grapple, true);
assert.equal(battleControls(1.05, true).grapple, false, "short combat swing releases before crossing the spire");
assert.equal(battleControls(2, true).grapple, false);
assert.equal(battleControls(.8, true).fire, true);
assert.equal(battleControls(.4, true).fire, false);

for (const view of ["outside", "player"]) {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`, isBot: i > 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    aim: new THREE.Vector3(0, 0, 1), rig: { visible: true }, alive: true, health: 100,
    grounded: true, trainingStandStill: false, trainingDontAttack: false, trainingAnchor: null,
    get weapon() { return WEAPONS[this.loadout[this.slotIndex]]; },
    update(dt, move, aim) { this.lastMove = move.clone(); this.position.addScaledVector(move, dt); this.aim.copy(aim); }
  }));
  let productionShots = 0, productionHits = 0, productionCameras = 0, attached = 0;
  const game = { players, camera: new THREE.PerspectiveCamera(62, 1080 / 1920, .1, 520), settings: { reducedMotion: false },
    world: { nearbyObstacles: () => [], surfaceHeightAt: () => 15, ropeBlocked: () => false, effectBlocked: () => false },
    updateBot() {}, updateHuman() {}, updateCamera() { throw Error("Showcase override must not become player camera"); },
    tryFire(p) { productionShots++; p.ammo[p.weapon.id]--; },
    damagePlayer(p, damage) { productionHits++; p.health -= damage; },
    toggleGrapple(p) { attached++; p.grapple = { line: { visible: true }, anchor: new THREE.Vector3(0, 42, 0) }; },
    updateGrapple(p) { if (p.grapple) { p.grounded = false; p.velocity.set(4, 4, 0); } },
    releaseGrapple(p) { p.grapple = null; }, beginReload() {}
  };
  const original = { updateBot: game.updateBot, updateHuman: game.updateHuman, tryFire: game.tryFire,
    damagePlayer: game.damagePlayer, updateCamera: game.updateCamera };
  const prepared = [];
  const battle = await stageSocialBattle(game, { params: new URLSearchParams(`videoView=${view}`),
    prepareFighterWeapons: async p => prepared.push(p.id),
    productionCamera(dt) { productionCameras++; assert.equal(dt, .1); game.camera.position.set(0, 20, 40); game.camera.lookAt(0, 15, 0); } });
  assert.deepEqual(prepared, ["p1", "p2"]);
  assert.equal(battle.evidence.hudCaptured, false);
  assert.equal(players[0].health, 100); assert.equal(players[1].health, 100);
  assert.equal(players[2].trainingDontAttack, true);
  assert.ok(players[2].position.distanceTo(players[1].position) > 8);
  battle.evidence.performanceStartMs = performance.now() - 800;
  game.updateCamera(.1);
  assert.equal(productionCameras, view === "player" ? 1 : 0);
  if (view === "outside") {
    const midpoint = players[0].position.clone().lerp(players[1].position, .5);
    assert.ok(game.camera.position.x > midpoint.x && game.camera.position.z > midpoint.z, "camera stays on the open east fight side");
    assert.ok(game.camera.position.x - midpoint.x > (game.camera.position.z - midpoint.z) * 4, "east-oriented view keeps diagonal duelists laterally distinct instead of looking along their battle line");
  }
  game.updateHuman(.016);
  assert.ok(players[0].lastMove.dot(players[1].position.clone().sub(players[0].position)) > 0, "fighter advances toward the opponent rather than orbiting off the platform");
  game.updateBot(players[1], .016);
  assert.equal(attached, 1); assert.equal(productionShots, 1); assert.equal(productionHits, 0);
  assert.equal(battle.evidence.events.find(e => e.kind === "production-shot").targetId, "p1");
  game.damagePlayer(players[0], 7, new THREE.Vector3(), players[1], WEAPONS.machine_gun, { shotId: "real-shot" });
  assert.equal(productionHits, 1);
  const damage = battle.evidence.events.find(e => e.kind === "production-damage");
  assert.equal(damage.healthBefore, 100); assert.equal(damage.healthAfter, 93); assert.equal(damage.shotId, "real-shot");
  battle.restore();
  for (const [key, value] of Object.entries(original)) assert.equal(game[key], value);
  assert.equal(players[2].trainingDontAttack, false); assert.equal(players[2].trainingAnchor, null);
}
console.log("Battle staging, real camera source, actual shot/damage evidence and cleanup passed.");
