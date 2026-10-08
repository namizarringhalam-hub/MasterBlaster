import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { GameplayPreparation, gameplayPreparationKey, prepareFighterWeapons, warmGameplayScene, disposeGameplaySamples } from "../src/gameplayPreparation.js";
import { graphicsProfile, loadSettings, WEAPONS } from "../src/gameData.js";
import { NeonRenderPipeline } from "../src/renderPipeline.js";
import { prepareSurfaceTextures } from "../src/surfaceTextures.js";

// Exercise real arena, fighter, effect and hazard constructors; only GPU submit
// is replaced here. The browser companion verifies real shader/render work.
globalThis.requestIdleCallback = callback => setImmediate(callback);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(62, 1.5, .1, 600);
camera.position.set(9, 8, 7);
const keyLight = new THREE.DirectionalLight(); keyLight.position.set(-22, 40, 18);
scene.add(keyLight, keyLight.target);
const observed = new Set();
let renders = 0, inject = null;
const game = {
  state: "menu", scene, camera, keyLight, settings: loadSettings(), graphics: graphicsProfile("low", false, 1),
  renderSize: { width: 800, height: 600, pixelRatio: 1 },
  renderer: { samples: 0, backend: {}, getMaxAnisotropy: () => 4 },
  renderPipeline: { render() {
    renders++;
    scene.traverseVisible(object => { if (object.isMesh) observed.add(object.name); });
    const explosion = scene.getObjectByName("Explosion smoke");
    if (explosion) assert.ok(explosion.count > 0, "empty explosion pools participate in warmup draws");
    inject?.();
  } },
  prepareResources: async () => {}, commitResize() {},
  removeObject(object) {
    object.removeFromParent(); object.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
  }
};
const key = gameplayPreparationKey(game, "A", "v1");
assert.notEqual(key, gameplayPreparationKey(game, "B", "v1"));
assert.notEqual(key, gameplayPreparationKey(game, "A", "v2"), "any release resource edit invalidates memory/GPU preparation");
game.settings.graphicsEffects.bloom = !game.settings.graphicsEffects.bloom;
assert.notEqual(key, gameplayPreparationKey(game, "A", "v1"));
game.settings.graphicsEffects.bloom = !game.settings.graphicsEffects.bloom;
game.renderSize.width++;
assert.notEqual(key, gameplayPreparationKey(game, "A", "v1"));
game.renderSize.width--;

const preparation = new GameplayPreparation(game);
const beforeCamera = camera.clone(), beforeBackground = scene.backgroundNode;
await prepareSurfaceTextures(["WARMUP-A"]);
const foregroundIdle = globalThis.requestIdleCallback, previousCancelIdle = globalThis.cancelIdleCallback;
const optionalIdle = new Map();
let idleId = 0, first, partialWorld;
try {
  globalThis.requestIdleCallback = callback => { const id = ++idleId; optionalIdle.set(id, callback); return id; };
  globalThis.cancelIdleCallback = id => optionalIdle.delete(id);
  preparation.preload("WARMUP-A");
  await new Promise(resolve => setTimeout(resolve, 360));
  const idle = optionalIdle.entries().next().value;
  assert.ok(idle, "quiet menu time schedules optional CPU preparation");
  optionalIdle.delete(idle[0]);
  idle[1]({ didTimeout: false, timeRemaining: () => 20 });
  partialWorld = preparation.arena.entry.world;
  assert.ok(partialWorld && !partialWorld.buildComplete, "one idle callback leaves a reusable partial arena");
  assert.notEqual(partialWorld.scene, scene);
  assert.equal(scene.getObjectByName("Neon Parkour Arena"), undefined);
  assert.equal(renders, 0, "optional arena construction does no GPU warmup");
  globalThis.requestIdleCallback = foregroundIdle;
  first = await preparation.request("WARMUP-A");
} finally {
  globalThis.requestIdleCallback = foregroundIdle;
  if (previousCancelIdle === undefined) delete globalThis.cancelIdleCallback; else globalThis.cancelIdleCallback = previousCancelIdle;
}
assert.equal(first.world, partialWorld, "full gameplay preparation resumes and adopts the exact speculative arena");
assert.equal(first.world.scene, scene, "the promoted arena changes ownership to the live scene");
assert.equal(first.world.group.parent, scene);
assert.equal(first.world.buildComplete, true);
assert.equal(first.complete, true);
assert.equal(first.world.time, 0, "preparation never simulates the arena");
assert.ok(first.world.debrisMesh.instanceColor, "debris color layout exists before first destruction");
assert.equal(first.visuals.effectTime, 0);
assert.ok(first.fighters.every(fighter => fighter.health === 100 && fighter.slotIndex === 0));
assert.equal(first.fighters.flatMap(fighter => [...fighter.weaponModels.keys()]).length, Object.keys(WEAPONS).length);
assert.ok(first.visuals.explosions.layers.every(layer => layer.mesh.count === 0), "no sample explosions leak into combat");
assert.equal(first.world.group.visible, false);
assert.equal(first.visuals.group.visible, false);
assert.equal(first.projectiles.visible, false);
assert.equal(scene.backgroundNode, beforeBackground);
assert.ok(camera.position.equals(beforeCamera.position));
assert.ok(camera.quaternion.equals(beforeCamera.quaternion));
assert.ok(observed.has("Explosion smoke"));
const count = renders;
assert.equal(await preparation.request("WARMUP-A"), first);
assert.equal(renders, count, "unchanged resources reuse GPU preparation");
assert.equal(preparation.take("OTHER"), null);
const taken = preparation.take("WARMUP-A");
assert.equal(taken.world, first.world, "launch takes the exact warmed arena and buffers");
assert.equal(taken.visuals, first.visuals);
assert.equal(preparation.ready, null);
assert.equal(taken.world.group.visible, true);
taken.world.dispose(); taken.visuals.dispose(); disposeGameplaySamples(game, taken);

// Superseding a request during an actual render must dispose it, prepare the
// latest seed, and never mark partial preparation as reusable.
inject = () => { inject = null; preparation.request("LATEST"); };
const latest = await preparation.request("OBSOLETE");
assert.equal(latest.world.seed, "LATEST");
assert.equal(scene.children.filter(child => child.name === "Neon Parkour Arena").length, 1);
const oldWorld = latest.world;
game.settings.graphicsEffects.wetSurfaces = !game.settings.graphicsEffects.wetSurfaces;
const refreshed = await preparation.request("LATEST");
assert.notEqual(refreshed.world, oldWorld);
assert.equal(oldWorld.group.parent, null, "changed configurations release their old GPU resources");
preparation.cancel();
assert.equal(preparation.ready, null);
assert.equal(scene.children.length, 2, "all warmup resources are removed when leaving the menus");

inject = () => { inject = null; preparation.cancel(); };
assert.equal(await preparation.request("CANCEL"), null);
assert.equal(scene.children.length, 2);
inject = () => { throw Error("GPU submission failed"); };
await assert.rejects(preparation.request("FAIL"), /GPU submission failed/);
assert.equal(preparation.ready, null);
assert.equal(game.preparingGraphics, false);
assert.equal(scene.children.length, 2);
inject = null;

let finishCompile;
game.renderPipeline.prepareScene = () => new Promise(resolve => { finishCompile = resolve; });
const compiling = preparation.request("ASYNC-CANCEL");
while (!finishCompile) await new Promise(setImmediate);
const compilingWorld = preparation.ready.world;
preparation.cancel();
assert.equal(compilingWorld.group.parent, scene, "cancellation retains resources until async compilation stops using them");
camera.aspect = 2; camera.updateProjectionMatrix();
finishCompile();
assert.equal(await compiling, null);
assert.equal(camera.aspect, 2, "a resize during async compilation must survive camera restoration");
assert.equal(compilingWorld.group.parent, null);
assert.equal(scene.children.length, 2);
delete game.renderPipeline.prepareScene;

let finishRenderPreparation;
game.renderPipeline.prepareRender = () => new Promise(resolve => { finishRenderPreparation = resolve; });
const preparingRender = preparation.request("ASYNC-RENDER-CANCEL");
while (!finishRenderPreparation) await new Promise(setImmediate);
const renderingWorld = preparation.ready.world;
assert.equal(game.preparingGraphics, true);
preparation.cancel();
assert.equal(renderingWorld.group.parent, scene, "native discovery retains scene ownership until queued pipelines settle");
camera.aspect = 2.5; camera.updateProjectionMatrix();
finishRenderPreparation(false);
assert.equal(await preparingRender, null);
assert.equal(renderingWorld.group.parent, null);
assert.equal(game.preparingGraphics, false);
assert.equal(camera.aspect, 2.5, "a resize during native discovery survives camera restoration");
assert.equal(scene.children.length, 2);
delete game.renderPipeline.prepareRender;

// Restore pooled matrices/visibility even on failure; stop before a second
// submission when a navigation invalidates work while the GPU is busy.
const pooled = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
pooled.count = 0; pooled.visible = false; pooled.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
scene.add(pooled);
let finishGpu, valid = true;
game.renderer.backend.device = { queue: { onSubmittedWorkDone: () => new Promise(resolve => { finishGpu = resolve; }) } };
const pending = warmGameplayScene(game, [pooled], () => valid);
await new Promise(setImmediate);
assert.equal(pooled.count, 0); assert.equal(pooled.visible, false);
const submitted = renders;
valid = false; finishGpu();
assert.equal(await pending, false);
assert.equal(renders, submitted);
assert.equal(game.preparingGraphics, false);
pooled.geometry.dispose(); pooled.material.dispose();

const target = new THREE.RenderTarget(), originalTarget = {}, mrt = {}, originalMRT = {};
let currentTarget = originalTarget, currentMRT = originalMRT, compiled = 0, compileValid = true;
const compileRenderer = {
  samples: 4, getRenderTarget: () => currentTarget, getMRT: () => currentMRT,
  setRenderTarget: value => { currentTarget = value; }, setMRT: value => { currentMRT = value; },
  getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, getRenderObjectFunction: () => null,
  getPixelRatio: () => 1, getClearColor: color => color, getClearAlpha: () => 1, getScissorTest: () => false,
  setRenderObjectFunction() {}, setPixelRatio() {}, setClearColor() {}, setScissorTest() {},
  getOutputBufferType: () => THREE.HalfFloatType,
  async compileAsync(object, view, context) {
    assert.equal(currentTarget, target); assert.equal(currentMRT, mrt);
    assert.equal(view, camera); assert.equal(context, scene);
    assert.ok(object.isMesh); compiled++; compileValid = false;
  }
};
const pass = { renderTarget: target, getMRT: () => mrt };
const pipeline = { renderer: compileRenderer, scenePass: pass, scene, camera, nativeWebGPU: false, renderQuality: "medium" };
const root = new THREE.Group(); root.add(new THREE.Mesh(), new THREE.Mesh());
await NeonRenderPipeline.prototype.prepareScene.call(pipeline, [root], () => compileValid);
assert.equal(compiled, 1, "WebGL compilation observes cancellation between objects");
assert.equal(currentTarget, originalTarget); assert.equal(currentMRT, originalMRT);
assert.equal(target.samples, 4);
compileRenderer.compileAsync = async () => { throw Error("shader failure"); };
await assert.rejects(NeonRenderPipeline.prototype.prepareScene.call(pipeline, [root]), /shader failure/);
assert.equal(currentTarget, originalTarget); assert.equal(currentMRT, originalMRT);

target.dispose();

// Discover the actual graph with asynchronous native pipeline creation. Shadows
// and depth/post passes can expose further dependencies on subsequent renders.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const firstPipeline = deferred(), dependentPipeline = deferred(), callerPromises = [];
const renderObject = name => ({ name, pipeline: { error: false } });
const pipelineState = pipeline => { assert.ok(pipeline, "discovery inspects the captured native pipeline"); return pipeline; };
const pipelineCalls = [];
const backend = { get: pipelineState, createRenderPipeline(object, promises) {
  assert.equal(this, backend, "the temporary hook preserves backend method ownership");
  assert.ok(Array.isArray(promises), "native discovery never creates a synchronous GPU pipeline");
  pipelineCalls.push({ object, promises });
  if (object.name === "shadow") promises.push(firstPipeline.promise);
  else if (object.name === "particle-depth") promises.push(dependentPipeline.promise);
  else promises.push(Promise.resolve());
} };
const originalCreate = backend.createRenderPipeline;
let discoveryRenders = 0;
const discovery = { nativeWebGPU: true, renderer: { backend }, render() {
  discoveryRenders++;
  assert.notEqual(backend.createRenderPipeline, originalCreate, "the hook covers the complete render graph");
  if (discoveryRenders === 1) {
    backend.createRenderPipeline(renderObject("shadow"), null);
    backend.createRenderPipeline(renderObject("caller-owned"), callerPromises);
  } else if (discoveryRenders === 2) backend.createRenderPipeline(renderObject("particle-depth"), null);
} };
let settled = false;
const discovering = NeonRenderPipeline.prototype.prepareRender.call(discovery).then(result => { settled = true; return result; });
assert.equal(discoveryRenders, 1);
assert.equal(backend.createRenderPipeline, originalCreate, "the hook is restored before yielding to queued GPU work");
assert.equal(pipelineCalls[1].promises, callerPromises, "an existing compilation owner keeps its own promise array");
assert.notEqual(pipelineCalls[0].promises, callerPromises);
assert.equal(settled, false);
firstPipeline.resolve();
await new Promise(setImmediate);
assert.equal(discoveryRenders, 2, "completed pipelines permit discovery of dependent render passes");
assert.equal(backend.createRenderPipeline, originalCreate);
assert.equal(settled, false, "the whole graph remains owned while dependent GPU work is pending");
dependentPipeline.resolve();
assert.equal(await discovering, true);
assert.equal(discoveryRenders, 3, "preparation completes only after a render creates no new pipeline");
assert.equal(backend.createRenderPipeline, originalCreate);
await Promise.all(callerPromises);

const cancellationPipeline = deferred();
let discoveryValid = true, cancelledRenders = 0;
const cancellationBackend = { get: pipelineState, createRenderPipeline(object, promises) { promises.push(cancellationPipeline.promise); } };
const cancellationCreate = cancellationBackend.createRenderPipeline;
const cancellable = { nativeWebGPU: true, renderer: { backend: cancellationBackend }, render() {
  cancelledRenders++; cancellationBackend.createRenderPipeline(renderObject("cancelled"), null);
} };
let cancellationSettled = false;
const cancelling = NeonRenderPipeline.prototype.prepareRender.call(cancellable, () => discoveryValid)
  .then(result => { cancellationSettled = true; return result; });
discoveryValid = false;
assert.equal(cancellationBackend.createRenderPipeline, cancellationCreate);
await new Promise(setImmediate);
assert.equal(cancellationSettled, false, "cancellation retains ownership until submitted compilation settles");
cancellationPipeline.resolve();
assert.equal(await cancelling, false);
assert.equal(cancelledRenders, 1, "cancelled work cannot submit another discovery render");
assert.equal(await NeonRenderPipeline.prototype.prepareRender.call(cancellable, () => false), false);
assert.equal(cancelledRenders, 1, "an already invalid request never touches the GPU");

const failedPipeline = deferred(), renderFailure = Error("native discovery failed");
const failureBackend = { get: pipelineState, createRenderPipeline(object, promises) { promises.push(failedPipeline.promise); } };
const failureCreate = failureBackend.createRenderPipeline;
let failureSettled = false;
const failing = { nativeWebGPU: true, renderer: { backend: failureBackend }, render() {
  failureBackend.createRenderPipeline(renderObject("render-failed"), null); throw renderFailure;
} };
const failure = NeonRenderPipeline.prototype.prepareRender.call(failing).catch(error => { failureSettled = true; throw error; });
const expectedFailure = assert.rejects(failure, error => error === renderFailure);
assert.equal(failureBackend.createRenderPipeline, failureCreate, "a render failure restores the hook synchronously");
await new Promise(setImmediate);
assert.equal(failureSettled, false, "a failed render retains any GPU work it already queued");
failedPipeline.resolve();
await expectedFailure;
assert.equal(failureBackend.createRenderPipeline, failureCreate);

const rejectedPipeline = deferred(), remainingPipeline = deferred(), pipelineFailure = Error("native shader rejected");
const rejectingBackend = { get: pipelineState, createRenderPipeline(object, promises) {
  promises.push(rejectedPipeline.promise, remainingPipeline.promise);
} };
const rejectingCreate = rejectingBackend.createRenderPipeline;
let rejectionSettled = false;
const rejecting = { nativeWebGPU: true, renderer: { backend: rejectingBackend }, render() {
  rejectingBackend.createRenderPipeline(renderObject("shader-rejected"), null);
} };
const rejection = NeonRenderPipeline.prototype.prepareRender.call(rejecting).catch(error => { rejectionSettled = true; throw error; });
const expectedRejection = assert.rejects(rejection, error => error === pipelineFailure);
rejectedPipeline.reject(pipelineFailure);
await new Promise(setImmediate);
assert.equal(rejectionSettled, false, "one rejected shader cannot release other queued pipeline owners early");
assert.equal(rejectingBackend.createRenderPipeline, rejectingCreate);
remainingPipeline.resolve();
await expectedRejection;

// Three reports native validation failures in backend data while resolving its
// promise. Capture each pipeline before another render can replace the object.
const invalidObject = renderObject("shader-invalid");
const resolvedFailureBackend = { get: pipelineState, createRenderPipeline(object, promises) {
  const captured = object.pipeline;
  promises.push(Promise.resolve().then(() => { captured.error = true; object.pipeline = { error: false }; }));
} };
const resolvedFailureCreate = resolvedFailureBackend.createRenderPipeline;
let invalidRenders = 0;
const invalidGraph = { nativeWebGPU: true, renderer: { backend: resolvedFailureBackend }, render() {
  invalidRenders++; resolvedFailureBackend.createRenderPipeline(invalidObject, null);
} };
await assert.rejects(NeonRenderPipeline.prototype.prepareRender.call(invalidGraph), /Graphics shader compilation failed/);
assert.equal(invalidRenders, 1, "a resolved native failure cannot be marked ready or retried indefinitely");
assert.equal(invalidObject.pipeline.error, false, "validation uses the captured pipeline rather than a newer object binding");
assert.equal(resolvedFailureBackend.createRenderPipeline, resolvedFailureCreate);

let unstableRenders = 0;
const unstableBackend = { get: pipelineState, createRenderPipeline(object, promises) { promises.push(Promise.resolve()); } };
const unstableCreate = unstableBackend.createRenderPipeline;
const unstable = { nativeWebGPU: true, renderer: { backend: unstableBackend }, render() {
  unstableRenders++; unstableBackend.createRenderPipeline(renderObject("unstable"), null);
} };
await assert.rejects(NeonRenderPipeline.prototype.prepareRender.call(unstable), /Graphics pipeline preparation did not settle/);
assert.equal(unstableRenders, 8, "a graph that changes every render fails within the bounded preparation budget");
assert.equal(unstableBackend.createRenderPipeline, unstableCreate);

let compatibilityRenders = 0, compatibilityValid = true;
const compatibility = { nativeWebGPU: false, render() { compatibilityRenders++; compatibilityValid = false; } };
assert.equal(await NeonRenderPipeline.prototype.prepareRender.call(compatibility, () => compatibilityValid), false);
assert.equal(compatibilityRenders, 1, "compatibility preparation renders once and observes cancellation afterward");
assert.equal(await NeonRenderPipeline.prototype.prepareRender.call({ nativeWebGPU: false, render() { compatibilityRenders++; } }), true);
assert.equal(compatibilityRenders, 2);


let live = true, modelUpdates = 0;
const remote = { slotIndex: 0, loadout: ["a", "b", "c"], updateWeaponModel() { assert.ok(live); modelUpdates++; } };
globalThis.requestIdleCallback = callback => setImmediate(() => {
  assert.equal(remote.slotIndex, modelUpdates === 2 ? 0 : 2, "temporary warmup weapons never escape into network event handling");
  remote.slotIndex = 2;
  if (modelUpdates >= 4) live = false;
  callback();
});
assert.equal(await prepareFighterWeapons(remote, () => live), false);
assert.equal(remote.slotIndex, 2, "a newer authoritative slot survives warmup cancellation");
assert.equal(modelUpdates, 4, "departed fighters cannot recreate disposed models");
console.log("Gameplay warmup: real resource coverage, reuse, handoff, release/configuration refresh, supersession, cancellation and GPU failure passed.");
