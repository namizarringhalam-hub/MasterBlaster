import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { FrameTiming } from "../src/frameTiming.js";
import { SimulationTiming, RenderInterpolation } from "../src/simulationTiming.js";
import { InputManager, updateOrbit } from "../src/input.js";
import { Fighter, reticleAim, cameraRelative, directionFromKeys, directionFromTouch } from "../src/player.js";
import { WEAPONS, weaponFireMode, weaponUsesAmmo } from "../src/gameData.js";

for (const fps of [10, 20, 30, 60, 120, 144]) {
  const clock = new SimulationTiming();
  let simulated = 0, wall = 0, steps = 0;
  for (let frame = 0; frame < fps * 2; frame++) clock.advance(1 / fps, (dt, realDt) => {
    assert.equal(dt, 1 / 60);
    simulated += dt; wall += realDt; steps++;
  });
  assert.ok(Math.abs(simulated - 2) < 1e-10, `${fps} FPS: physics advances at real speed`);
  assert.ok(Math.abs(wall - 2) < 1e-10);
  assert.equal(steps, 120);
}
const stalled = new SimulationTiming();
let physics = 0, real = 0;
assert.equal(stalled.advance(.1, (dt, realDt) => { physics += dt; real += realDt; }), 6);
assert.ok(Math.abs(physics - .1) < 1e-10);
assert.equal(stalled.advance(2, (dt, realDt) => { physics += dt; real += realDt; }), 15);
assert.ok(Math.abs(real - 2.1) < 1e-10, "wall clocks keep the actual stall duration");
assert.ok(Math.abs(stalled.dropped - 1.75) < 1e-10, "overload is bounded and reported explicitly");
stalled.reset(); assert.equal(stalled.alpha, 0);

const timing = new FrameTiming(4);
for (let i = 0; i < 4; i++) timing.record(1 / 60, 2, 3, 1);
timing.record(2, 4, 5, 15, 1.75);
let stats = timing.snapshot();
assert.equal(stats.frames, 5); assert.equal(stats.recentFrames, 4);
assert.equal(stats.p95Ms, 2000); assert.equal(stats.p99Ms, 2000); assert.equal(stats.worstMs, 2000);
assert.equal(stats.stallFrames, 1); assert.equal(stats.droppedSimulationMs, 1750);
assert.ok(stats.averageFps < 3, "a long frame is never capped to a misleading 4 FPS");
for (let i = 0; i < 4; i++) timing.record(1 / 120, 1, 2);
stats = timing.snapshot();
assert.equal(stats.p99Ms, 1000 / 120); assert.equal(stats.worstMs, 2000);
assert.equal(stats.updateP95Ms, 1); assert.equal(stats.renderP95Ms, 2);

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const Game = new Function("THREE", "FrameTiming", "SimulationTiming", "RenderInterpolation", "updateOrbit", "reticleAim", "weaponFireMode", "weaponUsesAmmo", "WEAPONS", "clamp", "cameraRelative", "directionFromKeys", "directionFromTouch", `return ${controller}`)(THREE, FrameTiming, SimulationTiming, RenderInterpolation, updateOrbit, reticleAim, weaponFireMode, weaponUsesAmmo, WEAPONS, THREE.MathUtils.clamp, cameraRelative, directionFromKeys, directionFromTouch);
function fixture() {
  const input = Object.assign(Object.create(InputManager.prototype), { pressed: new Set(), keys: new Set(),
    mouse: { movementX: 0, movementY: 0 }, touchMoveValue: { x: 0, y: 0 }, shouldCapture: () => true });
  const game = Object.assign(Object.create(Game.prototype), {
    state: "play", paused: false, settings: {}, players: [], projectiles: [], hazards: [], decoys: [], touch: {},
    simulationTiming: new SimulationTiming(), renderInterpolation: new RenderInterpolation(), interpolationTargets: new Set(),
    simulationFrameActive: true, performanceSample: new FrameTiming(), input,
    world: { movers: [] }, camera: new THREE.PerspectiveCamera(),
    timer: { update() {}, getDelta: () => 1 / 60 }, commitResize() {}, renderScene: () => true,
    isOnlineMatch: () => false, updateAudio() {}, updateHud() {},
    updatePerformanceSample(dt, updateMs, renderMs, steps, dropped) { this.performanceSample.record(dt, updateMs, renderMs, steps, dropped); }
  });
  return game;
}
for (const fps of [20, 30, 60, 120]) {
  const game = fixture();
  let x = 0, cooldown = 2, jumps = 0, physicsSteps = 0;
  game.update = dt => {
    x += 12 * dt; cooldown -= dt; physicsSteps++;
    if (game.input.tapped("Space")) jumps++;
  };
  game.timer.getDelta = () => 1 / fps;
  game.input.pressed.add("Space");
  for (let frame = 0; frame < fps; frame++) game.frame(frame * 1000 / fps);
  assert.ok(Math.abs(x - 12) < 1e-10, `${fps} FPS: controller consumes all physics time`);
  assert.ok(Math.abs(cooldown - 1) < 1e-10);
  assert.equal(jumps, 1, "a key tap survives zero-step frames and occurs once across catch-up steps");
  assert.equal(physicsSteps, 60);
}
const game = fixture();
let updates = 0;
game.update = () => { updates++; };
game.paused = true; game.timer.getDelta = () => 40; game.frame(40_000);
assert.equal(updates, 0); assert.equal(game.performanceSample.frames, 0);
game.paused = false; game.frame(40_016);
assert.equal(updates, 1, "resume never replays the pause or loading interval");
assert.equal(game.performanceSample.frames, 0, "resume interval is excluded from gameplay pacing");
game.timer.getDelta = () => .1; game.frame(40_116);
assert.equal(updates, 7, "an ordinary 100ms hitch advances six small physics steps");
assert.equal(game.performanceSample.snapshot().worstMs, 100);

const resume = fixture(); resume.paused = true;
resume.togglePause = () => { resume.paused = !resume.paused; resume.simulationFrameActive = false; resume.simulationTiming.reset(); };
resume.update = () => {};
resume.input.pressed.add("Escape"); resume.timer.getDelta = () => 1 / 120;
resume.frame(0); assert.equal(resume.paused, false); assert.equal(resume.input.tapped("Escape"), false);
resume.frame(1000 / 120); resume.frame(2000 / 120); assert.equal(resume.paused, false, "Escape resume cannot bounce back to pause on zero-step frames");

const documentBefore = globalThis.document;
try {
  globalThis.document = { hidden: true };
  resume.paused = true; resume.input.pressed.add("Escape"); resume.frame(1000);
  assert.equal(resume.paused, true, "a queued Escape cannot resume a hidden tab");
  assert.equal(resume.input.tapped("Escape"), false);
  globalThis.document.hidden = false; resume.frame(1016);
  assert.equal(resume.paused, true, "returning to the tab keeps the visibility pause");
} finally {
  if (documentBefore === undefined) delete globalThis.document;
  else globalThis.document = documentBefore;
}

let physicalReference;
for (const fps of [20, 30, 60, 120]) {
  const fighter = new Fighter(new THREE.Scene(), { id: `timing-${fps}`, color: 0x12ccff, accent: 0x9dffff }, ["blaster"], new THREE.Vector3());
  fighter.grounded = true; fighter.attackTimer = .5;
  const floor = { resolve(position) { if (position.y <= 0) { position.y = 0; return { grounded: true }; } return { grounded: false }; }, boostAt: () => null };
  const clock = new SimulationTiming(), move = new THREE.Vector3(0, 0, 1), aim = new THREE.Vector3(0, 0, 1);
  let jumped = false;
  for (let frame = 0; frame < fps; frame++) clock.advance(1 / fps, dt => {
    fighter.update(dt, move, aim, { jump: !jumped, reducedMotion: true }, floor); jumped = true;
  });
  const physical = [...fighter.position.toArray(), ...fighter.velocity.toArray(), fighter.attackTimer, fighter.reloadTimer, fighter.grounded];
  if (!physicalReference) physicalReference = physical;
  else assert.deepEqual(physical, physicalReference, `${fps} FPS preserves actual fighter acceleration, jump, gravity, landing and cooldowns`);
  fighter.dispose();
}

// The actual human update consumes a retained mouse/touch tap even after release.
const click = fixture();
const human = { alive: true, weapon: WEAPONS.blaster, weaponMuzzleDistance: 1, radius: .5, position: new THREE.Vector3(), aim: new THREE.Vector3(0, 0, 1),
  grounded: false, ammo: { blaster: 10 }, forwardPoint: () => new THREE.Vector3(), muzzlePoint: target => target.set(0, 1, 0), update() {} };
Object.assign(click, { players: [human], cameraYaw: 0, updateCamera() {}, updateGrapple() {}, cancelCharge() {}, aimDirection: new THREE.Vector3(), aimTargets: [],
  world: { grapplePoint: () => null }, sound: { updateWeaponLoop() {} }, updateHuman: Game.prototype.updateHuman,
  update: dt => click.updateHuman(dt), audioSpatial() {}, beginReload() {} });
let clicks = 0; click.tryFire = () => { clicks++; };
click.input.mouse.left = true; click.input.pressed.add("MouseLeft"); click.timer.getDelta = () => 1 / 120;
click.frame(0); assert.equal(clicks, 0); click.input.mouse.left = false;
click.frame(1000 / 120); assert.equal(clicks, 1, "short mouse tap survives a zero-step frame and release");
click.touch.fireTap = true; click.frame(2000 / 120); click.frame(3000 / 120);
assert.equal(clicks, 2, "touch fire tap also survives until one simulation step");

// Online catch-up must respect the unchanged authoritative wall-clock fire gate.
const online = fixture(); const gunner = { ...human, id: "gunner", weapon: WEAPONS.minigun, recoil() {}, attackTimer: 0, reloadTimer: 0, ammo: { minigun: 80 } };
let shots = 0; Object.assign(online, { players: [gunner], simulationBatch: true,
  controlsNetworkPlayer: () => true, multiplayer: { fire() { shots++; } }, fireHitscan() {},
  sound: { playWeapon() {} }, audioSpatial() {}, beginReload() {} });
const wallNow = Date.now; let now = 10_000;
try {
  Date.now = () => now;
  const clock = new SimulationTiming();
  clock.advance(.25, dt => { gunner.attackTimer = Math.max(0, gunner.attackTimer - dt); online.tryFire(gunner, true); });
  assert.equal(shots, 1); assert.equal(gunner.ammo.minigun, 79, "rejected catch-up shots consume no local ammo or damage");
  now += 50; gunner.attackTimer = 0; online.tryFire(gunner, true);
  assert.equal(shots, 2); assert.equal(gunner.ammo.minigun, 78, "the next legal wall-clock shot remains available");
} finally { Date.now = wallNow; }

// Exercise the actual production update's clocks, countdown, pause and respawn path.
Object.assign(game, {
  mode: "quick", matchTime: 10, scores: [0], targetScore: 100, matchStartDelay: 0,
  awaitingAudioGesture: false, audioCountdown: false, networkRecovering: false,
  world: { update() {} }, players: [{ alive: true }], multiplayer: null, simulationBatch: false
});
for (const method of ["syncGrappleTarget", "handleWeaponSwitch", "updateHuman", "updateBotPlanner", "updateBurst", "updateProjectiles", "updateHazards", "updateDecoys", "processStructuralEvents", "updateEffects"]) game[method] = () => {};
let respawnTime = 0;
game.updateRespawns = dt => { respawnTime += dt; };
Game.prototype.update.call(game, 1 / 60, .5);
assert.equal(game.matchTime, 9.5); assert.equal(respawnTime, .5);
game.paused = true; Game.prototype.update.call(game, 1 / 60, 40);
assert.equal(game.matchTime, 9.5); assert.equal(respawnTime, .5);

// Rendering blends a half-step pose and always restores authoritative transforms,
// even if submission throws. A later world-space query sees the physics position.
const actor = new THREE.Group(), child = new THREE.Object3D(); actor.add(child); child.position.x = 1;
const interpolation = new RenderInterpolation(); interpolation.capture(new Set([actor])); actor.position.x = 4;
Object.assign(game, { paused: false, state: "play", hideMatchLoadingAfterFrame: false, settings: {},
  world: { updatePresentation() {} }, renderInterpolation: interpolation,
  simulationTiming: { alpha: .5 }, updateCamera() {},
  renderPipeline: { render() { assert.equal(actor.position.x, 2); throw Error("render rejected"); } }
});
assert.throws(() => Game.prototype.renderScene.call(game), /render rejected/);
assert.equal(actor.position.x, 4); assert.equal(child.getWorldPosition(new THREE.Vector3()).x, 5);
interpolation.capture(new Set([actor])); actor.position.x = 30;
interpolation.apply(.25); assert.equal(actor.position.x, 30, "teleports are never smeared across the arena"); interpolation.restore();
interpolation.capture(new Set()); assert.equal(interpolation.transforms.size, 0, "removed actors release interpolation records");
console.log("Fixed physics speed, input edges, uncapped frame/CPU tails, bounded catch-up, pause/clock semantics and render restoration pass.");
