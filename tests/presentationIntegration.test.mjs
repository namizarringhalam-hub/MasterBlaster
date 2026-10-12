import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import TEXT from "../src/playerText.js";
import { SimulationTiming, RenderInterpolation } from "../src/simulationTiming.js";
import { RemoteSnapshots } from "../src/remoteSnapshots.js";
import { reconcileRemotePosition, flameConeFactor } from "../src/player.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const method = (name, next, args = []) => {
  const body = source.slice(source.indexOf(`  ${name}(`), source.indexOf(`\n  ${next}(`));
  assert.ok(body.startsWith(`  ${name}(`), `${name} exists in main controller`);
  return new Function(...args, `return ({${body}}).${name};`);
};
const frame = method("frame", "updateFrameInput", ["performance"])(globalThis.performance);
const advanceSimulation = method("advanceSimulation", "update", ["SimulationTiming", "RenderInterpolation"])(SimulationTiming, RenderInterpolation);
const renderScene = method("renderScene", "prepareResources", ["THREE", "clamp", "updateGrappleVisual"])(THREE, (v, a, b) => Math.max(a, Math.min(b, v)), () => {});

// Catch-up remains fixed-step gameplay; cosmetic presentation runs once with
// elapsed render time, even when a rendered frame consumes multiple steps.
{
  const heroRoot = new THREE.Group(), events = [];
  const hero = { group: heroRoot, velocity: new THREE.Vector3(), updatePresentation: dt => events.push(["fighter", dt]) };
  const game = {
    state: "play", paused: false, hideMatchLoadingAfterFrame: false, simulationFrameActive: true,
    matchFramePending: false, sceneDirty: false, players: [hero], projectiles: [], hazards: [], decoys: [],
    settings: { reducedMotion: false }, camera: new THREE.PerspectiveCamera(), cameraKick: null,
    timer: { update() {}, getDelta: () => .1 }, input: { tapped: () => false, endFrame() {} }, commitResize() {},
    simulationTiming: new SimulationTiming(), renderInterpolation: new RenderInterpolation(),
    world: { movers: [], updatePresentation(_camera, _reduced, dt) { events.push(["world", dt]); } },
    combatVisuals: { update: dt => events.push(["combat", dt]), syncPresentation: () => events.push(["sync"]) },
    renderPipeline: { updatePresentation: () => events.push(["screen"]), render: () => events.push(["render"]) },
    updateFrameInput() {}, updateCamera() {}, updateDamageIndicators() {}, flushCombatAnimations() {}, advanceSimulation, renderScene,
    isOnlineMatch: () => false,
    update(_dt) { events.push(["step"]); this.simulationStateAdvanced = true; },
    updateAudio() {}, updateHud() {}, updatePerformanceSample() {}, performanceSample: { longTasks: 0, longTaskMs: 0 }
  };
  frame.call(game, 100);
  assert.equal(events.filter(([name]) => name === "step").length, 6, "a 100ms frame advances fixed simulation steps");
  for (const name of ["fighter", "combat", "sync", "world", "screen", "render"])
    assert.equal(events.filter(([event]) => event === name).length, 1, `${name} presentation runs once per rendered frame`);
  for (const name of ["fighter", "combat", "world"]) assert.equal(events.find(([event]) => event === name)[1], .1,
    `${name} receives real render elapsed time, not one fixed simulation step`);
}

// Paused and results screens render their final dirty frame, then hold it.
for (const state of ["play", "results"]) {
  const renders = [];
  const game = {
    state, paused: state === "play", hideMatchLoadingAfterFrame: false, matchFramePending: false,
    sceneDirty: false, timer: { update() {}, getDelta: () => 1 / 60 }, input: { tapped: () => false, endFrame() {} }, commitResize() {},
    simulationTiming: { reset() {} }, renderInterpolation: { clear() {} }, renderScene() { renders.push(state); return true; }
  };
  frame.call(game, 0);
  assert.equal(renders.length, 0, `${state}: clean held scene skips render work`);
  game.sceneDirty = true;
  frame.call(game, 16);
  assert.deepEqual(renders, [state], `${state}: one dirty frame is drawn before holding`);
  assert.equal(game.sceneDirty, false);
  frame.call(game, 32);
  assert.equal(renders.length, 1, `${state}: held frame stays frozen until dirtied`);
}

// A dirty temporal image gets one bounded jitter cycle before holding. Paused
// time never advances during those frames, and an unchanged image stays idle.
for (const state of ["play", "results"]) {
  const renders = [];
  const game = {
    state, paused: state === "play", sceneDirty: true, matchFramePending: false,
    timer: { update() {}, getDelta: () => 1 / 60 }, input: { tapped: () => false, endFrame() {} }, commitResize() {},
    simulationTiming: { reset() {} }, renderInterpolation: { clear() {} }, renderPipeline: { temporal: {} },
    renderScene(dt) { renders.push(dt); return true; }
  };
  for (let i = 0; i < 80; i++) frame.call(game, i * 16);
  assert.equal(renders.length, 32); assert.ok(renders.every(dt => dt === 0));
  assert.equal(game.sceneSettleFrames, 0); assert.equal(game.sceneDirty, false);
  game.sceneDirty = true;
  for (let i = 0; i < 60; i++) frame.call(game, 2000 + i * 16);
  assert.equal(renders.length, 64, "resize or graphics edits get a fresh bounded cycle");
  const priorDocument = globalThis.document;
  try {
    globalThis.document = { hidden: true }; game.sceneDirty = true;
    frame.call(game, 4000);
    assert.equal(renders.length, 64, "hidden tabs never spend GPU work settling");
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
  }
  frame.call(game, 4016);
  assert.equal(game.sceneSettleFrames, 31, "visible dirty state resumes convergence");
}

// Shadows and the submitted frame must use the same final camera orientation,
// after camera kick has been applied for this presentation frame.
{
  const camera = new THREE.PerspectiveCamera();
  const orientations = [];
  const game = {
    world: { updatePresentation() {} }, camera, settings: { reducedMotion: false }, state: "menu", players: [], cameraKick: new THREE.Vector3(.025, -.018, .01),
    updateCamera() { camera.quaternion.setFromEuler(new THREE.Euler(.2, -.35, .07)); },
    shadowRig: { update(value) { orientations.push(["shadow", value.quaternion.clone()]); } },
    renderPipeline: { render() { orientations.push(["draw", camera.quaternion.clone()]); } },
    updateDamageIndicators() {}, flushCombatAnimations() {}
  };
  assert.equal(renderScene.call(game, 1 / 60), true);
  assert.deepEqual(orientations.map(([name]) => name), ["shadow", "draw"]);
  assert.ok(orientations[0][1].equals(orientations[1][1]),
    "shadow rig and draw use the same camera after camera kick, avoiding directional shadow drift");
}

// Hit events update semantic DOM state immediately but defer visual animation
// to the frame and coalesce each channel to one Web Animation API call.
{
  const showFeedback = method("showCombatFeedback", "queueCombatAnimation", ["THREE", "TEXT", "clamp", "setText", "setStyle", "setTimeout", "clearTimeout"])(
    THREE, TEXT, (v, a, b) => Math.max(a, Math.min(b, v)),
    (element, value) => { element.textContent = String(value); }, (element, key, value) => { element.style[key] = value; }, () => 1, () => {});
  const queueFeedback = method("queueCombatAnimation", "flushCombatAnimations")();
  const flushFeedback = method("flushCombatAnimations", "addDamageIndicator")();
  const feedback = { showCombatFeedback: showFeedback, queueCombatAnimation: queueFeedback, flushCombatAnimations: flushFeedback };
  const makeElement = () => {
    const classes = new Set();
    return {
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      animate(frames, options) { this.animations ||= []; this.animations.push({ frames, options }); return { cancel() { this.cancelled = true; } }; }
    };
  };
  const hud = { reticle: makeElement(), headshot: makeElement(), targetName: {}, targetValue: {}, targetFill: { style: {} }, targetHealth: makeElement() };
  for (const element of [hud.reticle, hud.headshot]) Object.defineProperty(element, "offsetWidth", { get() { throw Error("forced layout read"); } });
  const local = {}, target = { name: "Target", health: 51 }, weapon = { name: "Blaster" }, soundCalls = [];
  const game = Object.assign({}, feedback, {
    hud, players: [local], settings: { reducedMotion: false }, sound: { play: (...args) => soundCalls.push(args) },
    queueCombatAnimation: kind => feedback.queueCombatAnimation.call(game, kind),
    feedbackAnimations: new Map()
  });
  for (let i = 0; i < 5; i++) feedback.showCombatFeedback.call(game, target, local, weapon, false, i % 2 === 0);
  feedback.queueCombatAnimation.call(game, "elimination");
  feedback.queueCombatAnimation.call(game, "hit");
  assert.equal(game.pendingCombatFeedback.size, 2, "five hits coalesce into reticle and headshot channels");
  assert.equal(hud.reticle.animations, undefined, "per-hit callbacks do not animate synchronously");
  feedback.flushCombatAnimations.call(game);
  assert.equal(hud.reticle.animations.length, 1);
  assert.equal(hud.headshot.animations.length, 1);
  assert.match(hud.reticle.animations[0].frames[1].transform, /rotate\(45deg\)/, "a later hit cannot erase a queued elimination cue");
  assert.equal(soundCalls.length, 5, "coalescing visual feedback does not drop individual hit-confirm audio");
}

// The controller consumes the buffered server-time sample when one exists,
// while preserving authoritative aim, movement, slot and health presentation.
{
  const updateRemoteFighter = method("updateRemoteFighter", "setRemoteTarget", ["THREE", "reconcileRemotePosition"])(THREE, reconcileRemotePosition);
  const sampled = { position: { x: 12, y: 3, z: 4 }, velocity: { x: 2, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, grounded: true, health: 60, slotIndex: 1 };
  const latest = { position: { x: 90, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 0, y: 0, z: 1 }, health: 10, slotIndex: 1 };
  const remote = { id: "remote", alive: true, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), velocity: new THREE.Vector3(), radius: .5, group: new THREE.Group(), slotIndex: 0,
    switchSlot(slot) { this.slotIndex = slot; }, update(_dt, move, aim) { this.move = move.clone(); this.aim = aim.clone(); } };
  const game = { networkTargets: new Map([[remote.id, latest]]), remoteSnapshots: new Map([[remote.id, { sample: () => sampled, samples: [{}] }]]),
    settings: { reducedMotion: false }, world: { resolve() { return { grounded: true }; }, ropeBlocked: () => false } };
  updateRemoteFighter.call(game, remote, 1 / 60);
  assert.deepEqual(remote.networkPosition.toArray(), [12, 3, 4], "snapshot buffer wins over newest-arrival state");
  assert.deepEqual(remote.networkVelocity.toArray(), [2, 0, 0]);
  assert.ok(remote.networkAim.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-12);
  assert.equal(remote.health, 10, "health remains the newest authoritative discrete field");
  assert.equal(remote.grounded, true); assert.equal(remote.slotIndex, 1);
}

// Roster life changes reset the interpolation buffer at the authoritative spawn,
// while removal and local ownership release stale remote presentation state.
{
  const setRemoteTarget = method("setRemoteTarget", "updateBotPlanner", ["RemoteSnapshots"])(RemoteSnapshots);
  const syncOnlineRoster = method("syncOnlineRoster", "handleNetworkMessage", ["THREE", "uniquePlayersById"])(THREE, players => players);
  const remote = {
    id: "remote", position: new THREE.Vector3(20, 0, 0), alive: true, networkLifeSequence: 0, ammo: {}, group: new THREE.Group(),
    respawn(position) { this.position.copy(position); },
    reconcileAuthoritativeLife(_health, alive, position) { this.alive = alive; this.position.copy(position); }, dispose() { this.disposed = true; }
  };
  const local = {
    id: "local", position: new THREE.Vector3(), alive: true, networkLifeSequence: 0, ammo: {}, group: new THREE.Group(),
    reconcileAuthoritativeLife(_health, alive, position) { this.alive = alive; this.position.copy(position); }, dispose() {}
  };
  const game = {
    players: [remote, local], scores: [0, 0], state: "play", world: {}, multiplayer: { playerId: "local" },
    networkTargets: new Map(), remoteSnapshots: new Map(), networkRespawnRequests: new Map(),
    setRemoteTarget, sound: { stopOwner() {} }, releaseGrapple() {}, removeOwnedCombat() {}, disposeAfterGraphicsWarmup(callback) { callback(); },
    controlsNetworkPlayer: fighter => fighter.id === "local", authoritativeNetworkPosition(data) { return new THREE.Vector3(data.position.x, data.position.y, data.position.z); },
    prepareGrappleVisual() {}, renderHud() {}
  };
  setRemoteTarget.call(game, remote, { position: { x: 19, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, 1000, true);
  syncOnlineRoster.call(game, { serverTime: 2000, players: [
    { id: "remote", alive: true, lifeSequence: 1, position: { x: 2, y: 3, z: 4 }, velocity: { x: 1, y: 0, z: 0 }, ammo: {} },
    { id: "local", alive: true, lifeSequence: 0, position: { x: 0, y: 0, z: 0 }, ammo: {} }
  ] });
  const buffer = game.remoteSnapshots.get("remote");
  assert.equal(buffer.samples.length, 1, "respawn roster replaces the prior life snapshots");
  assert.equal(buffer.samples[0].state.position.x, 2, "respawn starts at the authoritative spawn, never the old-life location");
  assert.equal(remote.networkLifeSequence, 1);
  assert.equal(game.remoteSnapshots.has("local"), false, "locally controlled fighters never retain a remote interpolation buffer");
  syncOnlineRoster.call(game, { serverTime: 2016, players: [
    { id: "local", alive: true, lifeSequence: 0, position: { x: 0, y: 0, z: 0 }, ammo: {} }
  ] });
  assert.equal(game.remoteSnapshots.has("remote"), false, "roster removal disposes the departed player's snapshot history");
  assert.equal(game.networkTargets.has("remote"), false);
  assert.equal(remote.disposed, true);
}

// Killing adjacent decoys must not mutate the recipients under a flame tick.
{
  const fireFlame = method("fireFlame", "fireMelee", ["flameConeFactor", "aimedHeadContact"])(flameConeFactor, () => null);
  const applied = [];
  const attacker = { position: new THREE.Vector3(), aim: new THREE.Vector3(0, 0, 1), muzzlePoint(target) { return target.set(0, 1, 0); } };
  const decoys = ["first", "second"].map((id, index) => ({ id, isDecoy: true, alive: true, health: .1, radius: .5, position: new THREE.Vector3(index * .1, 0, 5) }));
  const game = {
    players: [attacker], decoys, attackScratch: { origin: new THREE.Vector3(), direction: new THREE.Vector3(), point: new THREE.Vector3(), push: new THREE.Vector3(), targets: [] },
    world: { grapplePoint: () => null, ropeBlocked: () => false }, combatVisuals: { flameStream() {} },
    damageTarget(target) { applied.push(target.id); target.alive = false; this.decoys.splice(this.decoys.indexOf(target), 1); }
  };
  fireFlame.call(game, attacker, { reach: 11.5, coneAngle: .22, recoil: 1, damage: 4 });
  assert.deepEqual(applied, ["first", "second"], "both adjacent low-health decoys receive the same flame tick despite removal");
  assert.equal(game.decoys.length, 0);
}

console.log("Main presentation cadence, held-scene rendering, coalesced hit feedback and remote snapshot integration pass.");
