import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { ArenaPreparation } from "../src/arenaPreparation.js";
import { ArenaWorld } from "../src/world.js";
import { prepareSurfaceTextures, surfaceTexturesReady } from "../src/surfaceTextures.js";
import { surfaceTextureData } from "../src/surfaceTextureData.js";

const seeds = ["CPU-PARTIAL", "CPU-CANCEL", "CPU-LIMIT", "CPU-CHANGED"];
await prepareSurfaceTextures(seeds);
const signature = world => {
  const meshes = [];
  world.group.traverse(object => {
    if (object.geometry) meshes.push([object.name, object.type, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.count, object.geometry.attributes.position?.count, object.geometry.index?.count]);
  });
  return {
    obstacles: world.obstacles.map(item => [item.x, item.z, item.w, item.h, item.d, item.baseY]),
    structures: world.structuralParts.map(part => [part.structuralId, part.x, part.z, part.w, part.h, part.d, part.baseY]),
    meshes
  };
};
const synchronous = new ArenaWorld(new THREE.Scene(), seeds[0]);
const deferred = new ArenaWorld(new THREE.Scene(), seeds[0], { deferBuild: true });
assert.equal(deferred.buildComplete, false);
const retainedGroup = deferred.group;
for (let i = 0; i < 12; i++) assert.equal(deferred.advanceBuild(), false, "individual phases leave a resumable partial arena");
deferred.build();
assert.equal(deferred.buildComplete, true);
assert.equal(deferred.group, retainedGroup, "foreground draining retains the partially built arena group");
assert.deepEqual(signature(deferred), signature(synchronous), "paused/resumed and synchronous construction preserve seeded geometry and structural IDs");
assert.equal(deferred.advanceBuild(), true, "an exhausted builder stays complete without recreating geometry");
const expected = signature(synchronous);
deferred.dispose(); synchronous.dispose();

const globals = ["document", "navigator", "performance", "requestIdleCallback", "cancelIdleCallback", "setTimeout", "clearTimeout", "Worker"];
const original = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const idle = new Map(), timers = new Map(), preparations = [];
let clock = 0, nextId = 0, inputPending = false;
const document = new EventTarget(); document.hidden = false;
const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
const advanceTime = milliseconds => {
  clock += milliseconds;
  for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
};
const runIdle = async (remaining = 20, didTimeout = false) => {
  const next = idle.entries().next().value;
  assert.ok(next, "the controlled scheduler has an idle callback to run");
  idle.delete(next[0]);
  next[1]({ didTimeout, timeRemaining: () => remaining });
  await new Promise(setImmediate);
};
const settle = async promise => {
  let settled = false, value, failure;
  promise.then(result => { settled = true; value = result; }, error => { settled = true; failure = error; });
  for (let i = 0; i < 1000 && !settled; i++) {
    if (idle.size) await runIdle(); else await new Promise(setImmediate);
  }
  assert.ok(settled, "foreground promotion completes or cancels within a bounded number of phases");
  if (failure) throw failure;
  return value;
};
const gpu = { render: 0, compile: 0, texture: 0, common: 0 };
const game = {
  state: "menu", world: null, scene: new THREE.Scene(),
  graphics: { level: "high" }, settings: { graphicsEffects: {} }, renderSize: { width: 800, height: 600 },
  renderer: { initTexture() { gpu.texture++; } },
  renderPipeline: { render() { gpu.render++; }, prepareScene() { gpu.compile++; } },
  prepareResources() { gpu.common++; return Promise.resolve(); }
};
game.scene.background = new THREE.Color(0x123456);
game.scene.fog = new THREE.Fog(0x123456, 1, 50);
const liveAtmosphere = [game.scene.background, game.scene.backgroundNode, game.scene.fog, game.scene.fogNode];
const assertMenuUntouched = () => {
  assert.equal(game.world, null, "speculative construction cannot become the simulated world");
  assert.deepEqual([game.scene.background, game.scene.backgroundNode, game.scene.fog, game.scene.fogNode], liveAtmosphere, "staging never changes the live scene atmosphere");
  assert.equal(game.scene.getObjectByName("Neon Parkour Arena"), undefined, "partial geometry stays outside the live render scene");
  assert.deepEqual(gpu, { render: 0, compile: 0, texture: 0, common: 0 }, "CPU preloading invokes no common preparation, GPU uploads, rendering or compilation");
};
const preload = seed => {
  const preparation = new ArenaPreparation(game); preparations.push(preparation);
  preparation.preload(seed); advanceTime(350);
  return preparation;
};

try {
  install("document", document);
  install("navigator", { scheduling: { isInputPending: options => { assert.equal(options.includeContinuous, true, "continuous scroll/input also takes priority"); return inputPending; } } });
  install("performance", { now: () => clock, mark() {} });
  install("requestIdleCallback", callback => { const id = ++nextId; idle.set(id, callback); return id; });
  install("cancelIdleCallback", id => idle.delete(id));
  install("setTimeout", (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, at: clock + delay }); return id; });
  install("clearTimeout", id => timers.delete(id));
  delete globalThis.Worker;

  const preparation = preload(seeds[0]);
  await runIdle(7.9);
  assert.equal(preparation.entry.world, null, "insufficient idle time does no arena construction");
  await runIdle(20, true);
  assert.equal(preparation.entry.world, null, "a timed-out idle callback does no arena construction");
  inputPending = true; await runIdle();
  assert.equal(preparation.entry.world, null, "pending input takes priority over arena construction");
  inputPending = false; await runIdle();
  const partial = preparation.entry.world;
  assert.ok(partial && !partial.buildComplete);
  assert.equal(partial.time, 0);
  assert.equal(partial.group.visible, false);
  assert.notEqual(partial.scene, game.scene, "partial arena owns an isolated staging scene");
  assertMenuUntouched();

  const interruptedCallback = idle.values().next().value, beforeInterrupted = preparation.entry.steps;
  document.dispatchEvent(new Event("input")); advanceTime(350);
  interruptedCallback({ didTimeout: false, timeRemaining: () => 20 });
  assert.equal(preparation.entry.steps, beforeInterrupted, "a cancelled callback cannot run after input reschedules the same entry");
  assert.equal(idle.size, 1, "a stale callback preserves the current idle handle");

  for (const event of ["pointerdown", "pointermove", "wheel", "touchmove", "keydown", "input", "scroll"]) {
    const steps = preparation.entry.steps;
    document.dispatchEvent(new Event(event));
    assert.equal(idle.size, 0, "interaction cancels scheduled optional work");
    advanceTime(349); assert.equal(idle.size, 0, "optional construction waits for the quiet period");
    assert.equal(preparation.entry.steps, steps);
    advanceTime(1); await runIdle();
    assert.equal(preparation.entry.steps, steps + 1, "one idle callback advances only one construction phase");
  }
  document.hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  advanceTime(400);
  assert.equal(idle.size, 0, "hidden documents pause optional arena construction");
  document.hidden = false; document.dispatchEvent(new Event("visibilitychange"));
  advanceTime(350); await runIdle();
  const entry = preparation.entry;
  game.renderSize = { width: 390, height: 844 };
  game.graphics = { level: "low" }; game.settings.graphicsEffects.wetSurfaces = false;
  preparation.preload(seeds[0]);
  assert.equal(preparation.entry, entry, "viewport and graphics changes preserve reusable CPU geometry");
  const promoted = await settle(preparation.promote(seeds[0]));
  assert.equal(promoted.world, partial, "explicit launch resumes the exact partial arena");
  assert.equal(partial.buildComplete, true);
  assert.equal(partial.time, 0, "finishing construction never advances arena simulation");
  assert.deepEqual(signature(partial), expected, "promoted geometry matches synchronous seeded construction");
  assertMenuUntouched();
  partial.dispose();

  const slow = preload(seeds[2]); await runIdle();
  const slowWorld = slow.entry.world, advance = slowWorld.advanceBuild.bind(slowWorld);
  slowWorld.advanceBuild = () => { const complete = advance(); clock += 9; return complete; };
  await runIdle();
  assert.equal(slow.entry.limited, true, "a phase over budget stops optional CPU work");
  assert.equal(idle.size, 0);
  slowWorld.advanceBuild = advance;
  assert.equal((await settle(slow.promote(seeds[2]))).world, slowWorld, "foreground launch resumes work paused for a slow phase");
  slowWorld.dispose();

  const cancelled = preload(seeds[1]); await runIdle(); await runIdle();
  const obsolete = cancelled.entry.world;
  let disposals = 0;
  obsolete.textures[0].addEventListener("dispose", () => disposals++);
  const staleCallback = idle.values().next().value;
  cancelled.cancel(); cancelled.cancel();
  assert.equal(disposals, 1, "cancelled partial resources are disposed once");
  assert.equal(obsolete.group.parent, null);
  cancelled.preload(seeds[1]); advanceTime(350); await runIdle();
  const replacement = cancelled.entry.world;
  staleCallback({ didTimeout: false, timeRemaining: () => 20 });
  assert.equal(cancelled.entry.world, replacement, "a stale callback cannot replace or dispose same-seed reentry");
  assert.notEqual(replacement, obsolete);
  cancelled.preload(seeds[3]);
  assert.equal(replacement.group.parent, null, "changing seeds releases the previous partial owner");
  advanceTime(350); await runIdle();
  const previousEnvironmentWorld = cancelled.entry.world;
  game.scene.environment = new THREE.Texture();
  cancelled.preload(seeds[3]);
  assert.equal(previousEnvironmentWorld.group.parent, null, "changed environment identity invalidates staging resources");
  cancelled.cancel(); game.scene.environment.dispose(); game.scene.environment = null;

  const owner = preload(seeds[1]); await runIdle(); await runIdle();
  const cancelledWorld = owner.entry.world;
  let disposeCount = 0;
  cancelledWorld.textures[0].addEventListener("dispose", () => disposeCount++);
  const pending = owner.promote(seeds[1]);
  await new Promise(setImmediate); owner.cancel();
  assert.equal(await settle(pending), null, "navigation during foreground draining cannot hand off a world");
  assert.equal(disposeCount, 1, "cancellation during foreground draining disposes resources once");
  assert.equal(cancelledWorld.group.parent, null);

  const retry = preload(seeds[1]); await runIdle(); await runIdle();
  const retryWorld = retry.entry.world;
  let current = true, retryDisposals = 0;
  retryWorld.textures[0].addEventListener("dispose", () => retryDisposals++);
  const interrupted = retry.promote(seeds[1], () => current);
  await new Promise(setImmediate);
  current = false; game.renderSize = { width: 844, height: 390 }; game.graphics.level = "medium";
  assert.equal(await settle(interrupted), null, "an invalid render configuration cannot hand off a world");
  assert.equal(retry.entry.world, retryWorld, "resize/graphics retry retains compatible partial CPU geometry");
  assert.equal(retryDisposals, 0);
  assert.equal((await settle(retry.promote(seeds[1]))).world, retryWorld, "the next foreground attempt resumes the retained partial owner");
  retryWorld.dispose(); assert.equal(retryDisposals, 1);

  const complete = preload(seeds[3]);
  for (let phases = 0; phases < 1000 && !complete.entry.cpuComplete; phases++) await runIdle();
  assert.equal(complete.entry.cpuComplete, true, "available idle time eventually completes CPU construction");
  const completedWorld = complete.entry.world;
  assert.equal(completedWorld.buildComplete, true);
  assert.equal(completedWorld.time, 0);
  assert.equal(idle.size, 0, "completed CPU construction stops requesting idle work");
  complete.preload(seeds[3]);
  assert.equal(complete.entry.world, completedWorld, "unchanged requests reuse completed CPU geometry");
  assert.equal(idle.size, 0);
  assert.equal((await settle(complete.promote(seeds[3]))).world, completedWorld);
  completedWorld.dispose();

  const failed = preload(seeds[1]); await runIdle();
  const failedWorld = failed.entry.world;
  let failureDisposals = 0;
  failedWorld.textures[0].addEventListener("dispose", () => failureDisposals++);
  failedWorld.advanceBuild = () => { throw Error("optional construction failed"); };
  await runIdle();
  assert.equal(failed.entry.world, null);
  assert.equal(failed.entry.limited, true, "an optional failure stops speculative work without affecting the menu");
  assert.equal(failureDisposals, 1);
  const recovered = await settle(failed.promote(seeds[1]));
  assert.notEqual(recovered.world, failedWorld, "explicit launch recovers from failed speculative construction");
  assert.equal(recovered.world.buildComplete, true);
  recovered.world.dispose();

  const missingSeed = "CPU-NO-WORKER";
  const unavailable = preload(missingSeed); await runIdle();
  assert.equal(surfaceTexturesReady(missingSeed), false, "optional texture preparation has no main-thread fallback without a worker");
  assert.equal(unavailable.entry.world, null);
  assert.equal(unavailable.entry.limited, true);
  unavailable.cancel();

  const workerSeed = "CPU-WORKER";
  let worker;
  install("Worker", class {
    constructor() { worker = this; }
    postMessage(entries) { this.entries = entries; }
    terminate() { this.terminated = true; }
  });
  const waiting = preload(workerSeed); await runIdle();
  assert.ok(worker);
  for (const entry of worker.entries) worker.onmessage({ data: { key: JSON.stringify(entry), buffers: surfaceTextureData(...entry) } });
  worker.onmessage({ data: { done: true } });
  await new Promise(setImmediate);
  assert.equal(worker.terminated, true);
  assert.equal(waiting.entry.world, null, "worker completion schedules work without constructing geometry in its promise continuation");
  await runIdle();
  assert.ok(waiting.entry.world);
  waiting.cancel();

  delete globalThis.requestIdleCallback;
  const unsupported = new ArenaPreparation(game); preparations.push(unsupported);
  unsupported.preload(seeds[0]);
  assert.equal(unsupported.entry, null, "browsers without idle callbacks skip optional preparation");
  assert.equal(idle.size, 0); assert.equal(timers.size, 0);
  assertMenuUntouched();
} finally {
  for (const preparation of preparations) preparation.cancel();
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
console.log("CPU arena preparation: deterministic pause/resume, idle/input/visibility budgets, zero GPU work, worker-only textures, launch handoff, invalidation and cancellation passed.");
