import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { FrameTiming } from "../src/frameTiming.js";
import { SimulationTiming, RenderInterpolation } from "../src/simulationTiming.js";
import { InputManager, updateOrbit } from "../src/input.js";
import { Fighter, reconcileRemotePosition, reticleAim, cameraCollisionFirstPerson, cameraRelative, directionFromKeys, directionFromTouch } from "../src/player.js";
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
const Game = new Function("THREE", "FrameTiming", "SimulationTiming", "RenderInterpolation", "updateOrbit", "reticleAim", "weaponFireMode", "weaponUsesAmmo", "WEAPONS", "clamp", "cameraRelative", "directionFromKeys", "directionFromTouch", "cameraCollisionFirstPerson", "uniquePlayersById", `return ${controller}`)(THREE, FrameTiming, SimulationTiming, RenderInterpolation, updateOrbit, reticleAim, weaponFireMode, weaponUsesAmmo, WEAPONS, THREE.MathUtils.clamp, cameraRelative, directionFromKeys, directionFromTouch, cameraCollisionFirstPerson, players => players);
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

// Quaternion round trips preserve orientation but can change the Euler branch
// that the next simulation step reads for yaw damping or accumulated spins.
for (const order of ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"]) {
  for (const yaw of [2.4, -2.4, Math.PI, -Math.PI, 7 * Math.PI + .4, -7 * Math.PI - .4]) {
    const object = new THREE.Object3D(), blend = new RenderInterpolation();
    object.rotation.set(.1, yaw - .2, -.3, order); blend.capture(new Set([object]));
    object.rotation.set(.13, yaw, -.08, order);
    const euler = object.rotation.toArray(), quaternion = object.quaternion.toArray();
    blend.apply(.37); blend.restore();
    assert.deepEqual(object.rotation.toArray(), euler, `${order} yaw ${yaw}: restore the exact Euler components and order`);
    assert.deepEqual(object.quaternion.toArray(), quaternion, "restored Euler preserves the authoritative orientation");
  }
}

for (const fps of [20, 30, 60, 120, 144]) {
  const createFighter = () => new Fighter(new THREE.Scene(), { id: "interpolation-facing", color: 0x12ccff, accent: 0x9dffff }, ["blaster"], new THREE.Vector3());
  const reference = createFighter(), presented = createFighter();
  reference.grounded = presented.grounded = true;
  const clock = new SimulationTiming(), blend = new RenderInterpolation(), objects = new Set([presented.group]);
  const floor = { resolve(position) { position.y = 0; return { grounded: true }; }, boostAt: () => null };
  const move = new THREE.Vector3(.4, 0, 1), aim = new THREE.Vector3();
  const referenceHeading = new THREE.Vector3(), presentedHeading = new THREE.Vector3();
  const referenceMuzzle = new THREE.Vector3(), presentedMuzzle = new THREE.Vector3();
  let steps = 0;
  try {
    for (let frame = 0; frame < fps * 4; frame++) {
      clock.advance(1 / fps, dt => {
        const yaw = steps < 120 ? 2.4 : -2.4;
        aim.set(Math.sin(yaw), 0, Math.cos(yaw));
        blend.capture(objects);
        reference.update(dt, move, aim, { reducedMotion: true }, floor);
        presented.update(dt, move, aim, { reducedMotion: true }, floor);
        steps++;
      });
      blend.apply(clock.alpha); blend.restore();
      assert.deepEqual(presented.group.rotation.toArray(), reference.group.rotation.toArray(), `${fps} FPS frame ${frame}: presentation cannot alter the next facing update`);
      assert.deepEqual(presented.position.toArray(), reference.position.toArray(), "movement remains authoritative after rendering");
      assert.deepEqual(presented.velocity.toArray(), reference.velocity.toArray());
      referenceHeading.set(0, 0, 1).applyQuaternion(reference.group.quaternion);
      presentedHeading.set(0, 0, 1).applyQuaternion(presented.group.quaternion);
      assert.ok(presentedHeading.distanceTo(referenceHeading) < 1e-10, "world-space mecha heading matches uninterrupted simulation");
      reference.visualMuzzlePoint(referenceMuzzle); presented.visualMuzzlePoint(presentedMuzzle);
      assert.ok(presentedMuzzle.distanceTo(referenceMuzzle) < 1e-9, "world-space weapon hierarchy remains aligned with the mecha");
    }
    assert.equal(steps, 240);
    assert.ok(Math.abs(presented.group.rotation.y + 2.4) < 1e-10, "the mecha reaches the requested facing without a camera update");
  } finally { reference.dispose(); presented.dispose(); }
}
// A render-only collision at the previous pose may hide the model for that
// frame, but cannot latch first-person mode into the authoritative 3.3m pose.
const cameraGame = fixture(), root = new THREE.Group(), rig = new THREE.Group(); root.add(rig);
const local = { group: root, rig, position: root.position, velocity: new THREE.Vector3() };
Object.assign(cameraGame, { players: [local], cameraYaw: 0, cameraPitch: 0, cameraFirstPerson: false,
  cameraFirstPersonRequested: false, settings: { reducedMotion: true }, cameraClearance: { actual: 3.3, target: 3.3 },
  cameraScratch: Object.fromEntries(["forward", "flatForward", "right", "pivot", "desired", "target", "constrained", "focus", "menuPosition"].map(key => [key, new THREE.Vector3()])),
  updateCamera: Game.prototype.updateCamera, renderScene: Game.prototype.renderScene });
cameraGame.world = { updatePresentation() {}, constrainCamera(pivot, desired, radius, target) {
  return desired === cameraGame.cameraScratch.desired ? target.copy(pivot).add(new THREE.Vector3(0, 0, -local.position.x)) : target.copy(desired);
} };
root.position.x = 2.5; cameraGame.camera.position.set(2.5, 1.65, -3.3);
cameraGame.renderInterpolation.capture(new Set([root, cameraGame.camera]));
root.position.x = 3.3; cameraGame.camera.position.x = 3.3; cameraGame.simulationTiming.accumulator = 0;
for (const throws of [false, true]) {
  cameraGame.renderPipeline = { render() {
    assert.equal(cameraGame.cameraFirstPerson, true); assert.equal(rig.visible, false);
    if (throws) throw Error("camera submission failed");
  } };
  if (throws) assert.throws(() => cameraGame.renderScene(), /camera submission failed/);
  else cameraGame.renderScene();
  assert.equal(cameraGame.cameraFirstPerson, false); assert.equal(rig.visible, true);
  assert.deepEqual(cameraGame.cameraClearance, { actual: 3.3, target: 3.3 });
  assert.equal(local.position.x, 3.3);
  cameraGame.updateCamera(1 / 60);
  assert.equal(cameraGame.cameraFirstPerson, false, "render collision cannot keep the next physics camera in first-person mode");
  assert.equal(rig.visible, true, "the authoritative third-person fighter stays visible");
}

// Respawns and portal jumps are discontinuities even within the 8m heuristic.
const spawned = new Fighter(new THREE.Scene(), { id: "respawn-blending", color: 0x12ccff, accent: 0x9dffff }, ["blaster"], new THREE.Vector3());
const spawnBlend = new RenderInterpolation(), spawnObjects = new Set([spawned.group]);
try {
  spawned.takeHit(100); spawned.updateDeath(1.4);
  assert.equal(spawned.alive, false); assert.equal(spawned.group.visible, false);
  spawnBlend.capture(spawnObjects);
  spawned.respawn(new THREE.Vector3(4, 0, 0));
  for (const alpha of [0, .25, .75]) {
    spawnBlend.apply(alpha); assert.equal(spawned.position.x, 4); assert.equal(spawned.group.visible, true); spawnBlend.restore();
  }
  spawnBlend.capture(spawnObjects); spawned.position.x = 5;
  spawnBlend.apply(.5); assert.equal(spawned.position.x, 4.5, "ordinary movement resumes interpolation after respawn"); spawnBlend.restore();
  const portal = fixture(); Object.assign(portal, { players: [spawned], world: { resolve() {} }, releaseGrapple() {}, spawnBurst() {}, sound: { play() {} }, audioSpatial() {} });
  spawnBlend.capture(spawnObjects);
  portal.teleportOwner(spawned, new THREE.Vector3(7.35, .2, 0), new THREE.Vector3(1, 0, 0));
  for (const alpha of [0, .25, .75]) {
    spawnBlend.apply(alpha); assert.equal(spawned.position.x, 6); spawnBlend.restore();
  }
  spawnBlend.capture(spawnObjects); spawned.position.x = 7;
  spawnBlend.apply(.5); assert.equal(spawned.position.x, 6.5, "portal jumps do not disable subsequent smooth movement"); spawnBlend.restore();
  spawnBlend.capture(spawnObjects);
  reconcileRemotePosition(spawned, new THREE.Vector3(3, 0, 0), .25, { ropeBlocked: () => true, resolve() {} });
  for (const alpha of [0, .25, .75]) {
    spawnBlend.apply(alpha); assert.equal(spawned.position.x, 3, "an obstruction snap cannot render inside the intervening wall"); spawnBlend.restore();
  }
  spawnBlend.capture(spawnObjects);
  reconcileRemotePosition(spawned, new THREE.Vector3(5, 0, 0), .5, { ropeBlocked: () => false, resolve() {} });
  spawnBlend.apply(.5); assert.equal(spawned.position.x, 3.5, "unobstructed network movement remains smooth"); spawnBlend.restore();
  Object.assign(portal, { multiplayer: { playerId: spawned.id }, hideNetworkReconnecting() {}, clearTransientNetworkCombat() {}, syncOnlineRoster() {}, updateCamera() {} });
  spawnBlend.capture(spawnObjects);
  portal.handleNetworkReconnect({ players: [{ id: spawned.id, position: { x: 8, y: 0, z: 0 }, health: 100, alive: true }] });
  for (const alpha of [0, .25, .75]) {
    spawnBlend.apply(alpha); assert.equal(spawned.position.x, 8, "reconnecting restores the local fighter at the server position immediately"); spawnBlend.restore();
  }
} finally { spawned.dispose(); }
console.log("Fixed physics/input/timing, exact facing restoration, render-only camera isolation and respawn/teleport discontinuities pass.");
