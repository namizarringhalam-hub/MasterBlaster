import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { cameraCollisionFirstPerson } from "../src/player.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const cameraMethod = source.slice(source.indexOf("  updateCamera(dt ="), source.indexOf("  renderScene()"));
const updateCamera = new Function("THREE", "cameraCollisionFirstPerson", "clamp",
  `return ({${cameraMethod}}).updateCamera`)(THREE, cameraCollisionFirstPerson, THREE.MathUtils.clamp);

function fixture(firstPerson = false) {
  const player = { position: new THREE.Vector3(), velocity: new THREE.Vector3(31, 8, 0), rig: { visible: true }, grapple: {} };
  return {
    players: [player], camera: new THREE.PerspectiveCamera(62, 1, .1, 520),
    cameraScratch: Object.fromEntries(["forward", "flatForward", "right", "pivot", "desired", "target", "constrained", "focus", "menuPosition"].map(key => [key, new THREE.Vector3()])),
    cameraPitch: 0, cameraClearance: {}, cameraFirstPerson: false, cameraFirstPersonRequested: firstPerson,
    settings: { reducedMotion: true }, mouseAim: out => out.set(0, 0, -1),
    world: { constrainCamera: (pivot, desired, radius, out) => out.copy(desired) }, updateCamera
  };
}

for (const firstPerson of [false, true]) for (const fps of [30, 60, 120]) {
  const game = fixture(firstPerson), player = game.players[0];
  game.updateCamera(10);
  const offset = game.camera.position.clone().sub(player.position);
  for (let frame = 0; frame < fps * 2; frame++) {
    const dt = (frame % 2 ? .7 : 1.3) / fps;
    game.updateCamera(dt); // Current input / aim, before the fighter moves.
    player.position.addScaledVector(player.velocity, dt);
    if (frame === fps) player.velocity.set(-24, -12, 8);
    game.updateCamera(0); // Final render pose, after movement and collisions.
    assert.ok(game.camera.position.clone().sub(player.position).distanceTo(offset) < 1e-8,
      "player translation must not change camera-relative framing, even with uneven frames or direction reversals");
  }
  player.position.add(new THREE.Vector3(50, 10, -20));
  game.updateCamera(0);
  assert.ok(game.camera.position.clone().sub(player.position).distanceTo(offset) < 1e-8, "teleports/respawns carry the camera in the same frame");
  game.world.constrainCamera = (pivot, desired, radius, out) => out.copy(pivot).lerp(desired, .1);
  game.updateCamera(0);
  assert.ok(game.cameraClearance.actual < 1, "same-frame translation still passes through camera collision checks");
}

// Exercise the real simulation ordering, including changes after updateHuman.
const updateMethod = source.slice(source.indexOf("  update(dt, realDt"), source.indexOf("  handleWeaponSwitch()"));
const update = new Function(`return ({${updateMethod}}).update`)();
const game = fixture(), player = game.players[0];
Object.assign(game, { matchStartDelay: 0, matchTime: 100, scores: [0], isOnlineMatch: () => false,
  world: { update() {} }, updateHuman() { player.position.x = 1; }, updateProjectiles() { player.position.x = 2; },
  updateRespawns() { player.position.x = 3; }, updateCamera(dt) { assert.equal(dt, 0); assert.equal(player.position.x, 3); this.followed = true; },
  updateAudio() { assert.equal(this.followed, true); } });
for (const key of ["handleWeaponSwitch", "updateBotPlanner", "updateBurst", "updateHazards", "updateDecoys", "processStructuralEvents", "updateEffects", "updateHud"]) game[key] = () => {};
update.call(game, 1 / 60);
assert.equal(game.followed, true, "the final camera correction must execute before rendering");
console.log("Camera movement: stable framing across frame rates, reversals, first person, teleports, collision and simulation ordering passed.");
