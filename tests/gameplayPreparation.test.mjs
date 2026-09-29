import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { GameplayPreparation, gameplayPreparationKey, prepareFighterWeapons, warmGameplayScene, disposeGameplaySamples } from "../src/gameplayPreparation.js";
import { graphicsProfile, loadSettings, WEAPONS } from "../src/gameData.js";
import { NeonRenderPipeline } from "../src/renderPipeline.js";

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
  scene, camera, keyLight, settings: loadSettings(), graphics: graphicsProfile("low", false, 1),
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
const first = await preparation.request("WARMUP-A");
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
